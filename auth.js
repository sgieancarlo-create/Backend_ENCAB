const jwt = require('jsonwebtoken');

// Middleware: accept either a valid JWT Bearer token (Authorization) or an API key in X-API-KEY
function authenticate(req, res, next) {
  const apiKey = process.env.BACKEND_API_KEY;
  const headerKey = req.header('x-api-key');
  if (apiKey && headerKey && headerKey === apiKey) return next();

  const auth = req.header('authorization');
  if (!auth) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ success: false, error: 'Invalid auth format' });

  const token = parts[1];
  try {
    const secret = process.env.JWT_SECRET || 'dev-secret';
    const payload = jwt.verify(token, secret);
    // attach user payload to request
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
  return next();
}

module.exports = { authenticate, requireAdmin };
