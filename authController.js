const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const SALT_ROUNDS = 10;
const JWT_EXPIRY = '8h';

function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function toUserRow(row) {
  if (!row) return null;
  return {
    uid: row.id,
    email: row.email,
    username: row.username,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    suffix: row.suffix,
    contactNo: row.contact_no,
    profilePicture: row.profile_picture_url,
    role: row.role,
    name: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') + (row.suffix ? ` ${row.suffix}` : ''),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function register(req, res) {
  try {
    const {
      email,
      username,
      firstName,
      middleName,
      lastName,
      suffix,
      password,
      contactNo
    } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'email and password are required' });
    }
    const first_name = firstName ?? req.body?.first_name ?? '';
    const last_name = lastName ?? req.body?.last_name ?? '';
    const middle_name = middleName ?? req.body?.middle_name ?? null;
    const userUsername = username ?? email.split('@')[0];
    const contact_no = contactNo ?? req.body?.contact_no ?? null;
    const userSuffix = suffix ?? req.body?.suffix ?? null;

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password should be at least 6 characters' });
    }

    const pool = db.getPool();
    const id = uuidv4();
    const password_hash = await hashPassword(password);

    await pool.query(
      `INSERT INTO users (id, email, username, first_name, middle_name, last_name, suffix, password_hash, contact_no, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'student')`,
      [id, email, userUsername, first_name, middle_name, last_name, userSuffix, password_hash, contact_no]
    );

    const secret = process.env.JWT_SECRET || 'dev-secret';
    const token = jwt.sign({ sub: id, email, role: 'student' }, secret, { expiresIn: JWT_EXPIRY });
    const user = toUserRow({
      id,
      email,
      username: userUsername,
      first_name,
      middle_name,
      last_name,
      suffix: userSuffix,
      contact_no,
      profile_picture_url: null,
      role: 'student'
    });

    return res.status(201).json({
      success: true,
      data: { token, user }
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const msg = err.message.includes('email') ? 'Email already in use' : 'Username already in use';
      return res.status(409).json({ success: false, error: msg });
    }
    console.error('Register error', err);
    return res.status(500).json({ success: false, error: String(err.message) });
  }
}

async function login(req, res) {
  try {
    const { username, email, password } = req.body || {};
    const loginId = username || email;

    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: 'username/email and password are required' });
    }

    const pool = db.getPool();
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1',
      [loginId, loginId]
    );
    const row = rows && rows[0];
    if (!row) {
      return res.status(401).json({ success: false, error: 'Invalid email/username or password' });
    }

    const valid = await comparePassword(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid email/username or password' });
    }

    const secret = process.env.JWT_SECRET || 'dev-secret';
    const token = jwt.sign(
      { sub: row.id, email: row.email, role: row.role },
      secret,
      { expiresIn: JWT_EXPIRY }
    );
    const user = toUserRow(row);

    return res.json({
      success: true,
      data: { token, user }
    });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ success: false, error: String(err.message) });
  }
}

// Forgot password (survey): create token and temp password, send to email (stub; configure SMTP later)
async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'email is required' });
    }

    const pool = db.getPool();
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows && rows[0];
    if (!user) {
      return res.status(404).json({ success: false, error: 'Email address not found' });
    }

    const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
    const temp_password_hash = await hashPassword(tempPassword);
    const token = uuidv4().replace(/-/g, '');
    const id = uuidv4();
    const expires_at = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (id, user_id, token, temp_password_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, user.id, token, temp_password_hash, expires_at]
    );

    if (process.env.SMTP_HOST) {
      // TODO: send email with temp password (nodemailer)
    } else {
      console.log('[ForgotPassword] Temp password (dev only):', tempPassword);
    }

    return res.json({
      success: true,
      message: 'If this email is registered, a temporary password has been sent.',
      data: process.env.NODE_ENV === 'development' ? { tempPassword } : {}
    });
  } catch (err) {
    console.error('Forgot password error', err);
    return res.status(500).json({ success: false, error: String(err.message) });
  }
}

// Reset password using token (e.g. from email link or survey)
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: 'token and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password should be at least 6 characters' });
    }

    const pool = db.getPool();
    const [rows] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
      [token]
    );
    const reset = rows && rows[0];
    if (!reset) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
    }

    const password_hash = await hashPassword(newPassword);
    await pool.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [password_hash, reset.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [reset.id]);

    return res.json({ success: true, message: 'Password has been reset' });
  } catch (err) {
    console.error('Reset password error', err);
    return res.status(500).json({ success: false, error: String(err.message) });
  }
}

async function updatePassword(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password should be at least 6 characters' });
    }

    const pool = db.getPool();
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [userId]);
    const row = rows && rows[0];
    if (!row) return res.status(401).json({ success: false, error: 'User not found' });

    const valid = await comparePassword(currentPassword, row.password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }

    const password_hash = await hashPassword(newPassword);
    await pool.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [password_hash, userId]);

    return res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('Update password error', err);
    return res.status(500).json({ success: false, error: String(err.message) });
  }
}

async function getProfile(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const pool = db.getPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    const row = rows && rows[0];
    if (!row) return res.status(404).json({ success: false, error: 'User not found' });

    return res.json({ success: true, data: toUserRow(row) });
  } catch (err) {
    console.error('Get profile error', err);
    return res.status(500).json({ success: false, error: String(err.message) });
  }
}

async function updateProfile(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const allowed = ['username', 'first_name', 'middle_name', 'last_name', 'suffix', 'contact_no', 'profile_picture_url'];
    const updates = {};
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const value = req.body[camel] ?? req.body[key];
      if (value !== undefined) updates[key] = value;
    }
    // App sends profilePicture (not profilePictureUrl) for profile picture
    if (req.body.profilePicture !== undefined) {
      updates.profile_picture_url = req.body.profilePicture;
    }
    // App may send name as display name: map to first_name / last_name
    if (req.body.name !== undefined && typeof req.body.name === 'string') {
      const parts = req.body.name.trim().split(/\s+/);
      updates.first_name = parts[0] || '';
      updates.last_name = parts.slice(1).join(' ') || '';
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const pool = db.getPool();
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    await pool.query(`UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = ?`, values);

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    return res.json({ success: true, data: toUserRow(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Username or email already in use' });
    }
    console.error('Update profile error', err);
    return res.status(500).json({ success: false, error: String(err.message) });
  }
}

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  updatePassword,
  getProfile,
  updateProfile
};
