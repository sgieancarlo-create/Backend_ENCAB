require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const db = require('./db');
const upload = require('./upload');
const routes = require('./routes');
const rateLimit = require('express-rate-limit');

const app = express();
// Ensure DB is initialized before any route (required for Vercel serverless; no-op after first call)
app.use((req, res, next) => {
  db.initialize()
    .then(() => next())
    .catch((err) => {
      console.error('DB init failed', err);
      res.status(503).json({ success: false, error: 'Service unavailable' });
    });
});
// Security middlewares
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// Basic rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

app.use('/api', routes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Backend running on port ${PORT}`);
  // ensure DB ready and create tables
  try {
    await db.initialize();
    console.log('Database initialized');
  } catch (e) {
    console.error('DB init failed', e);
  }
});
