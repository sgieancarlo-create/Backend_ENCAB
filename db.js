const mysql = require('mysql2/promise');

let pool;

async function initialize() {
  if (pool) return; // already initialized (idempotent for serverless)

  const host = process.env.DB_HOST;
  const useSsl = process.env.DB_SSL === '1' || process.env.DB_SSL === 'true' || String(host || '').includes('aivencloud');
  const poolConfig = {
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT, 10),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ...(useSsl && { ssl: { rejectUnauthorized: true } }),
  };
  if (useSsl && process.env.DB_SSL_CA) {
    poolConfig.ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
  }
  pool = mysql.createPool(poolConfig);

  // Users: login, register (email, username, first/middle/last, suffix, password, contact_no)
  const createUsers = `
  CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100) DEFAULT NULL,
    last_name VARCHAR(100) NOT NULL,
    suffix VARCHAR(20) DEFAULT NULL,
    password_hash VARCHAR(255) NOT NULL,
    contact_no VARCHAR(32) DEFAULT NULL,
    profile_picture_url VARCHAR(1024) DEFAULT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_username (username)
  );`;
  await pool.query(createUsers);

  // Reset password tokens (survey: send temp password to email)
  const createResetTokens = `
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token VARCHAR(64) NOT NULL,
    temp_password_hash VARCHAR(255) DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token),
    INDEX idx_user_id (user_id),
    INDEX idx_expires (expires_at)
  );`;
  await pool.query(createResetTokens);

  // Enrollments: basic info + school background
  const createEnrollments = `
  CREATE TABLE IF NOT EXISTS enrollments (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    basic_info JSON DEFAULT NULL,
    school_background JSON DEFAULT NULL,
    submitted_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY one_enrollment_per_user (user_id)
  );`;
  await pool.query(createEnrollments);

  // Documents (file uploads)
  const createDocs = `
  CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255),
    type VARCHAR(100),
    url TEXT,
    filePath VARCHAR(1024),
    fileSize BIGINT,
    userId VARCHAR(128),
    status VARCHAR(32),
    remarks TEXT,
    uploadedAt DATETIME
  );`;
  await pool.query(createDocs);
}

function getPool() {
  if (!pool) throw new Error('DB not initialized');
  return pool;
}

module.exports = { initialize, getPool };
