-- migration: create documents table
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
);
