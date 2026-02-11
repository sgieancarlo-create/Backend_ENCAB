-- Enrollment App - MySQL Database Setup
-- Run this as a user with CREATE DATABASE privilege, e.g.:
--   mysql -u root -p < scripts/init-mysql.sql
-- Or create the database manually, then run the rest.

CREATE DATABASE IF NOT EXISTS enrollment
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE enrollment;

-- Users: login, register (email, username, first/middle/last name, suffix, password, contact_no)
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
  role ENUM('student', 'admin') NOT NULL DEFAULT 'student',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_username (username)
);

-- Reset password (survey): send temporary password to email
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
  INDEX idx_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Enrollment: basic info + school background, then submit -> documents
CREATE TABLE IF NOT EXISTS enrollments (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  basic_info JSON DEFAULT NULL COMMENT 'Basic information form data',
  school_background JSON DEFAULT NULL COMMENT 'School background form data',
  submitted_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY one_enrollment_per_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Documents (file uploads per user; matches db.js column names)
CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) DEFAULT NULL,
  url TEXT NOT NULL,
  filePath VARCHAR(1024) DEFAULT NULL,
  fileSize BIGINT DEFAULT NULL,
  userId VARCHAR(128) NOT NULL,
  status VARCHAR(32) DEFAULT 'pending',
  remarks TEXT DEFAULT NULL,
  uploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_userId (userId)
);
