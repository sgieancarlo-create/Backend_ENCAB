// Vercel serverless entry: all requests go to Express app
const app = require('../app');
module.exports = (req, res) => {
  // Restore path from query (rewrite /api/:path* -> /api?path=:path*)
  const idx = req.url && req.url.indexOf('?');
  const q = idx >= 0 ? req.url.slice(idx + 1) : '';
  const params = new URLSearchParams(q);
  const pathSeg = params.get('path');
  if (pathSeg) {
    params.delete('path');
    const rest = params.toString();
    req.url = '/api/' + pathSeg + (rest ? '?' + rest : '');
  }
  app(req, res);
};
