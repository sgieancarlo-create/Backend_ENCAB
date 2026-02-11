-- Fix "Data truncated for column 'status' at row 1" when submitting enrollment.
-- enrollments.status was ENUM('draft','submitted') but the app uses 'pending'.
-- Run this once: mysql -u root -p enrollment < backend/scripts/alter-status.sql

USE enrollment;

-- Option A: Allow 'pending' by changing to VARCHAR (recommended)
ALTER TABLE enrollments
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'draft';

-- Option B (if you prefer ENUM): add 'pending' to the enum
-- ALTER TABLE enrollments
--   MODIFY COLUMN status ENUM('draft', 'pending', 'submitted') NOT NULL DEFAULT 'draft';
