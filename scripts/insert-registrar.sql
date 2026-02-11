-- Insert a registrar (admin) user.
-- Password below is bcrypt hash for: Registrar123!
-- Change the email/username if needed. To use a different password, run:
--   node scripts/create-registrar.js --email your@email.com --password YourPassword
--
USE enrollment;

INSERT INTO users (
  id,
  email,
  username,
  first_name,
  middle_name,
  last_name,
  suffix,
  password_hash,
  contact_no,
  profile_picture_url,
  role
) VALUES (
  UUID(),
  'registrar@school.edu',
  'registrar',
  'Registrar',
  NULL,
  'Admin',
  NULL,
  '$2b$10$LFZ6w6TneE3QRYd9/YsZzO7tbdzdkeyL6d.O3pH3UOwGBI1S5wtbq',
  NULL,
  NULL,
  'admin'
);

-- If the above fails (e.g. bcrypt hash length), use the Node script instead:
--   cd backend && node scripts/create-registrar.js
