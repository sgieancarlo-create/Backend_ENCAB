#!/usr/bin/env node
/**
 * Create a registrar (admin) user in the enrollment database.
 * Uses same .env as the backend (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME).
 *
 * Usage:
 *   node scripts/create-registrar.js
 *   node scripts/create-registrar.js --email registrar@school.edu --password MySecurePass123
 *
 * Env (optional): REGISTRAR_EMAIL, REGISTRAR_USERNAME, REGISTRAR_PASSWORD, REGISTRAR_FIRST_NAME, REGISTRAR_LAST_NAME
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const SALT_ROUNDS = 10;

function getArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

async function main() {
  const email = process.env.REGISTRAR_EMAIL || getArg('--email') || 'registrar@school.edu';
  const username = process.env.REGISTRAR_USERNAME || getArg('--username') || email.split('@')[0];
  const password = process.env.REGISTRAR_PASSWORD || getArg('--password') || 'Registrar123!';
  const firstName = process.env.REGISTRAR_FIRST_NAME || getArg('--first-name') || 'Registrar';
  const lastName = process.env.REGISTRAR_LAST_NAME || getArg('--last-name') || 'Admin';

  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  await db.initialize();
  const pool = db.getPool();

  const id = uuidv4();
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    await pool.query(
      `INSERT INTO users (id, email, username, first_name, middle_name, last_name, suffix, password_hash, contact_no, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`,
      [id, email, username, firstName, null, lastName, null, password_hash, null]
    );
    console.log('Registrar user created successfully.');
    console.log('  Email:    ', email);
    console.log('  Username: ', username);
    console.log('  Password: ', password);
    console.log('  Role:     admin');
    console.log('\nSign in at the admin panel with the email/username and password above.');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.error('A user with that email or username already exists. Use a different email/username or update the existing user to admin role.');
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
  process.exit(0);
}

main();
