const express = require('express');
const router = express.Router();
const uploadController = require('./upload');
const db = require('./db');
const { deleteObjectByKey } = require('./s3');
const { authenticate, requireAdmin } = require('./auth');
const { body, validationResult } = require('express-validator');
const authController = require('./authController');

// Upload signed URL endpoint (protected)
router.post(
  '/upload-url',
  authenticate,
  [
    body('userId').optional().isString().isLength({ max: 128 }),
    body('fileName').isString().isLength({ min: 1, max: 255 }),
    body('contentType').isString().isLength({ min: 3, max: 128 }),
    body('maxSize').optional().isInt({ min: 0, max: 50 * 1024 * 1024 })
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Invalid parameters', details: errors.array() });
    // server-side content type whitelist
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const { contentType } = req.body || {};
    if (!allowed.includes(contentType)) return res.status(400).json({ success: false, error: 'Content type not allowed' });

    // enforce max size if provided (client hint)
    const maxSize = req.body.maxSize || 20 * 1024 * 1024; // 20MB default
    if (maxSize > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'Requested maxSize too large' });

    return uploadController.getSignedUploadUrl(req, res, next);
  }
);

// Auth
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.post('/auth/forgot-password', authController.forgotPassword);
router.post('/auth/reset-password', authController.resetPassword);
router.post('/auth/update-password', authenticate, authController.updatePassword);
router.get('/auth/me', authenticate, authController.getProfile);
router.patch('/auth/profile', authenticate, authController.updateProfile);

// Enrollment: save basic information (upsert per user)
router.put('/enrollment/basic-info', authenticate, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const {
      lastName,
      firstName,
      middleName,
      suffix,
      birthdate,
      birthPlace,
      gender,
      motherName,
      fatherName,
      guardianName,
      guardianContact,
      studentType,
    } = req.body || {};

    if (!lastName || !firstName || !birthdate || !guardianName || !guardianContact) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: lastName, firstName, birthdate, guardianName, guardianContact',
      });
    }

    const pool = db.getPool();

    // Preserve existing studentType if not provided in this request
    let existingStudentType = 'new';
    try {
      const [rows] = await pool.query(
        'SELECT basic_info FROM enrollments WHERE user_id = ? LIMIT 1',
        [userId]
      );
      const row = rows && rows[0];
      if (row && row.basic_info) {
        let bi = row.basic_info;
        if (typeof bi === 'string') {
          try {
            bi = JSON.parse(bi);
          } catch (e) {
            bi = {};
          }
        }
        const prevType = String(bi.studentType || '').trim().toLowerCase();
        if (prevType === 'transferee') {
          existingStudentType = 'transferee';
        }
      }
    } catch (e) {
      console.warn('Failed to read existing basic_info for studentType', e.message || e);
    }

    let normalizedStudentType = existingStudentType;
    if (typeof studentType === 'string') {
      normalizedStudentType =
        String(studentType).trim().toLowerCase() === 'transferee' ? 'transferee' : 'new';
    }

    const basicInfo = {
      lastName: String(lastName).trim(),
      firstName: String(firstName).trim(),
      middleName: middleName != null ? String(middleName).trim() : '',
      suffix: suffix != null ? String(suffix).trim() : '',
      birthdate: String(birthdate).trim(),
      birthPlace: birthPlace != null ? String(birthPlace).trim() : '',
      gender: gender != null ? String(gender).trim() : '',
      motherName: motherName != null ? String(motherName).trim() : '',
      fatherName: fatherName != null ? String(fatherName).trim() : '',
      guardianName: String(guardianName).trim(),
      guardianContact: String(guardianContact).trim(),
      // Enrollment type: 'new' (freshman) vs 'transferee'
      studentType: normalizedStudentType,
    };

    const jsonStr = JSON.stringify(basicInfo);

    await pool.query(
      `INSERT INTO enrollments (id, user_id, status, basic_info) VALUES (UUID(), ?, 'draft', ?)
       ON DUPLICATE KEY UPDATE basic_info = VALUES(basic_info), updated_at = NOW()`,
      [userId, jsonStr]
    );

    res.json({ success: true, data: { basicInfo } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// Enrollment: get current user's enrollment (for loading school background, etc.)
router.get('/enrollment', authenticate, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const pool = db.getPool();
    const [rows] = await pool.query(
      'SELECT id, user_id, status, basic_info, school_background, submitted_at, created_at, updated_at FROM enrollments WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const row = rows && rows[0];
    if (!row) {
      return res.json({ success: true, data: null });
    }
    let sb = row.school_background;
    if (sb != null && typeof sb === 'string') {
      try { sb = JSON.parse(sb); } catch (e) { sb = {}; }
    }
    if (sb == null || typeof sb !== 'object') sb = {};
    const school_background = {
      elementary: Array.isArray(sb.elementary) ? sb.elementary : [],
      juniorHigh: Array.isArray(sb.juniorHigh) ? sb.juniorHigh : [],
      highSchool: Array.isArray(sb.highSchool) ? sb.highSchool : [],
    };
    res.json({
      success: true,
      data: {
        id: row.id,
        user_id: row.user_id,
        status: row.status,
        basic_info: row.basic_info,
        school_background,
        submitted_at: row.submitted_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// Enrollment: save school background (flexible: multiple records per level)
router.put('/enrollment/school-background', authenticate, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { elementary = [], juniorHigh = [], highSchool = [], studentType } = req.body || {};

    const sanitizeRecords = (arr) => {
      if (!Array.isArray(arr)) return [];
      return arr.slice(0, 50).map((r) => ({
        schoolName: String(r?.schoolName ?? '').trim(),
        location: String(r?.location ?? '').trim(),
        yearFrom: String(r?.yearFrom ?? '').trim(),
        yearTo: String(r?.yearTo ?? '').trim(),
        strand: String(r?.strand ?? '').trim(),
      }));
    };

    const school_background = {
      elementary: sanitizeRecords(elementary),
      juniorHigh: sanitizeRecords(juniorHigh),
      highSchool: sanitizeRecords(highSchool),
    };

    const pool = db.getPool();
    const sbJson = JSON.stringify(school_background);

    // Optionally update studentType inside basic_info when provided
    let basicInfoJson = null;
    if (typeof studentType === 'string') {
      let currentBasic = {};
      try {
        const [rows] = await pool.query(
          'SELECT basic_info FROM enrollments WHERE user_id = ? LIMIT 1',
          [userId]
        );
        const row = rows && rows[0];
        if (row && row.basic_info) {
          currentBasic = row.basic_info;
          if (typeof currentBasic === 'string') {
            try {
              currentBasic = JSON.parse(currentBasic);
            } catch (e) {
              currentBasic = {};
            }
          }
        }
      } catch (e) {
        console.warn('Failed to read existing basic_info for school-background', e.message || e);
      }

      const normalized =
        String(studentType).trim().toLowerCase() === 'transferee' ? 'transferee' : 'new';
      const merged = { ...currentBasic, studentType: normalized };
      basicInfoJson = JSON.stringify(merged);
    }

    if (basicInfoJson != null) {
      await pool.query(
        `INSERT INTO enrollments (id, user_id, status, basic_info, school_background)
         VALUES (UUID(), ?, 'draft', ?, ?)
         ON DUPLICATE KEY UPDATE basic_info = VALUES(basic_info), school_background = VALUES(school_background), updated_at = NOW()`,
        [userId, basicInfoJson, sbJson]
      );
    } else {
      await pool.query(
        `INSERT INTO enrollments (id, user_id, status, school_background)
         VALUES (UUID(), ?, 'draft', ?)
         ON DUPLICATE KEY UPDATE school_background = VALUES(school_background), updated_at = NOW()`,
        [userId, sbJson]
      );
    }

    res.json({ success: true, data: { school_background } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// Enrollment: submit application (set status to 'pending' so registrar can see it)
router.put('/enrollment/submit', authenticate, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const pool = db.getPool();

    const [rows] = await pool.query(
      'SELECT id, status, basic_info, school_background FROM enrollments WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const row = rows && rows[0];
    if (!row) {
      return res.status(400).json({ success: false, error: 'No enrollment record found. Complete Basic Info first.' });
    }
    if (row.status && row.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Application already submitted.' });
    }

    await pool.query(
      "UPDATE enrollments SET status = 'pending', submitted_at = NOW(), updated_at = NOW() WHERE user_id = ?",
      [userId]
    );

    res.json({ success: true, data: { status: 'pending' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// Documents CRUD (simple)
router.post('/documents', authenticate, async (req, res) => {
  try {
    const pool = db.getPool();
    const id = req.body.id || require('uuid').v4();
    const { name, type, url, filePath, fileSize, userId, status, remarks, uploadedAt } = req.body;

    // server-side validation of document metadata
    if (!name || !url || !userId) return res.status(400).json({ success: false, error: 'name, url, and userId are required' });
    if (fileSize && Number(fileSize) > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'file too large' });

    await pool.query(
      'INSERT INTO documents (id,name,type,url,filePath,fileSize,userId,status,remarks,uploadedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, name, type, url, filePath, fileSize, userId, status || 'pending', remarks || '', uploadedAt || new Date()]
    );

    res.json({ success: true, data: { id, name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.get('/documents/:userId', authenticate, async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query('SELECT * FROM documents WHERE userId = ? ORDER BY uploadedAt DESC', [req.params.userId]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.delete('/documents/:id', authenticate, async (req, res) => {
  try {
    const pool = db.getPool();
    // retrieve filePath to delete from S3 if present
    const [rows] = await pool.query('SELECT filePath FROM documents WHERE id = ?', [req.params.id]);
    const item = rows && rows[0];
    if (item && item.filePath) {
      try {
        await deleteObjectByKey(item.filePath);
      } catch (err) {
        console.warn('Failed to delete S3 object:', err);
      }
    }

    await pool.query('DELETE FROM documents WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ---------- Admin / Registrar routes (require admin role) ----------
router.get('/admin/enrollments', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const status = req.query.status || '';
    let sql = `SELECT e.id, e.user_id, e.status, e.basic_info, e.school_background, e.submitted_at, e.created_at, e.updated_at,
       u.email, u.username, u.first_name, u.last_name, u.middle_name, u.contact_no
       FROM enrollments e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE (e.archived_at IS NULL)
       ORDER BY e.submitted_at DESC, e.updated_at DESC`;
    const params = [];
    if (status) {
      sql = `SELECT e.id, e.user_id, e.status, e.basic_info, e.school_background, e.submitted_at, e.created_at, e.updated_at,
       u.email, u.username, u.first_name, u.last_name, u.middle_name, u.contact_no
       FROM enrollments e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE (e.archived_at IS NULL) AND e.status = ?
       ORDER BY e.submitted_at DESC, e.updated_at DESC`;
      params.push(status);
    }
    const [rows] = await pool.query(sql, params);
    const list = (rows || []).map((row) => {
      let basicInfo = row.basic_info;
      if (typeof basicInfo === 'string') {
        try { basicInfo = JSON.parse(basicInfo); } catch (e) { basicInfo = {}; }
      }
      const name = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') || row.username || row.email;
      return {
        id: row.id,
        user_id: row.user_id,
        status: row.status,
        studentName: name,
        email: row.email,
        contact_no: row.contact_no,
        submitted_at: row.submitted_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        basic_info: basicInfo,
      };
    });
    res.json({ success: true, data: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

router.get('/admin/enrollments/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(
      `SELECT e.id, e.user_id, e.status, e.basic_info, e.school_background, e.submitted_at, e.archived_at, e.school_year, e.created_at, e.updated_at,
       u.email, u.username, u.first_name, u.last_name, u.middle_name, u.contact_no, u.profile_picture_url
       FROM enrollments e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id = ? LIMIT 1`,
      [req.params.id]
    );
    const row = rows && rows[0];
    if (!row) return res.status(404).json({ success: false, error: 'Enrollment not found' });
    let basicInfo = row.basic_info;
    if (typeof basicInfo === 'string') {
      try { basicInfo = JSON.parse(basicInfo); } catch (e) { basicInfo = {}; }
    }
    let schoolBackground = row.school_background;
    if (typeof schoolBackground === 'string') {
      try { schoolBackground = JSON.parse(schoolBackground); } catch (e) { schoolBackground = {}; }
    }
    const studentName = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') || row.username || row.email;
    res.json({
      success: true,
      data: {
        id: row.id,
        user_id: row.user_id,
        status: row.status,
        studentName,
        email: row.email,
        username: row.username,
        contact_no: row.contact_no,
        profile_picture_url: row.profile_picture_url || null,
        basic_info: basicInfo,
        school_background: schoolBackground || {},
        submitted_at: row.submitted_at,
        archived_at: row.archived_at || null,
        school_year: row.school_year || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

router.patch('/admin/enrollments/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const [existing] = await pool.query('SELECT archived_at FROM enrollments WHERE id = ? LIMIT 1', [req.params.id]);
    if (existing && existing[0] && existing[0].archived_at) {
      return res.status(400).json({ success: false, error: 'Cannot update status: enrollment is archived (read-only).' });
    }
    const { status } = req.body || {};
    const allowed = ['pending', 'approved', 'rejected', 'draft'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be one of: ' + allowed.join(', ') });
    }
    const [result] = await pool.query('UPDATE enrollments SET status = ?, updated_at = NOW() WHERE id = ?', [status, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Enrollment not found' });
    res.json({ success: true, data: { status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// List distinct school years for archive tabs (must be before /admin/archived-enrollments/:id)
router.get('/admin/archived-enrollments/school-years', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(
      `SELECT DISTINCT school_year FROM enrollments WHERE archived_at IS NOT NULL AND school_year IS NOT NULL AND school_year != '' ORDER BY school_year DESC`
    );
    const years = (rows || []).map((r) => r.school_year);
    res.json({ success: true, data: years });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

router.get('/admin/archived-enrollments', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const schoolYear = req.query.school_year || '';
    let sql = `SELECT e.id, e.user_id, e.status, e.basic_info, e.school_background, e.submitted_at, e.archived_at, e.school_year, e.created_at, e.updated_at,
       u.email, u.username, u.first_name, u.last_name, u.middle_name, u.contact_no
       FROM enrollments e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.archived_at IS NOT NULL`;
    const params = [];
    if (schoolYear) {
      sql += ' AND e.school_year = ?';
      params.push(schoolYear);
    }
    sql += ' ORDER BY e.archived_at DESC, e.submitted_at DESC';
    const [rows] = await pool.query(sql, params);
    const list = (rows || []).map((row) => {
      let basicInfo = row.basic_info;
      if (typeof basicInfo === 'string') {
        try { basicInfo = JSON.parse(basicInfo); } catch (e) { basicInfo = {}; }
      }
      const name = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') || row.username || row.email;
      return {
        id: row.id,
        user_id: row.user_id,
        status: row.status,
        studentName: name,
        email: row.email,
        contact_no: row.contact_no,
        submitted_at: row.submitted_at,
        archived_at: row.archived_at,
        school_year: row.school_year || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        basic_info: basicInfo,
      };
    });
    res.json({ success: true, data: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

router.patch('/admin/enrollments/:id/archive', authenticate, requireAdmin, async (req, res) => {
  try {
    const { school_year } = req.body || {};
    const sy = typeof school_year === 'string' ? school_year.trim() : '';
    if (!sy) return res.status(400).json({ success: false, error: 'school_year is required (e.g. "2025-2026")' });
    const pool = db.getPool();
    const [result] = await pool.query(
      'UPDATE enrollments SET archived_at = NOW(), school_year = ?, updated_at = NOW() WHERE id = ?',
      [sy, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Enrollment not found' });
    res.json({ success: true, data: { archived_at: new Date().toISOString(), school_year: sy } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

router.delete('/admin/enrollments/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const [result] = await pool.query('DELETE FROM enrollments WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Enrollment not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

router.get('/admin/documents/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query('SELECT * FROM documents WHERE userId = ? ORDER BY uploadedAt DESC', [req.params.userId]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(
      'SELECT status, COUNT(*) as count FROM enrollments WHERE archived_at IS NULL GROUP BY status'
    );
    const stats = { total: 0, pending: 0, approved: 0, rejected: 0, draft: 0 };
    (rows || []).forEach((r) => {
      stats.total += Number(r.count);
      if (stats.hasOwnProperty(r.status)) stats[r.status] = Number(r.count);
    });
    stats.enrollingNow = stats.pending;

    let gender = { male: 0, female: 0, other: 0 };
    try {
      const [genderRows] = await pool.query(
        `SELECT LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(basic_info, '$.gender')), ''))) AS g, COUNT(*) AS count
         FROM enrollments WHERE archived_at IS NULL AND basic_info IS NOT NULL GROUP BY g`
      );
      (genderRows || []).forEach((r) => {
        const count = Number(r.count);
        const g = String(r.g || '').toLowerCase();
        if (g === 'male') gender.male = count;
        else if (g === 'female') gender.female = count;
        else gender.other += count;
      });
    } catch (e) {
      console.warn('Gender stats failed', e.message);
    }

    let byDate = [];
    try {
      const [dateRows] = await pool.query(
        `SELECT DATE(COALESCE(submitted_at, created_at)) AS d, COUNT(*) AS count
         FROM enrollments
         WHERE archived_at IS NULL AND (submitted_at IS NOT NULL OR created_at IS NOT NULL)
         GROUP BY DATE(COALESCE(submitted_at, created_at))
         ORDER BY d DESC
         LIMIT 30`
      );
      const countByDate = {};
      (dateRows || []).forEach((r) => {
        countByDate[r.d ? String(r.d).slice(0, 10) : ''] = Number(r.count);
      });
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        byDate.push({ date: dateStr, count: countByDate[dateStr] || 0 });
      }
    } catch (e) {
      console.warn('By-date stats failed', e.message);
    }

    res.json({ success: true, data: { ...stats, gender, byDate } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

module.exports = router;
