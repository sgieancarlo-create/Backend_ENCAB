// Vercel serverless entry: all /api/* requests go to this Express app
const app = require('../app');
module.exports = (req, res) => app(req, res);
