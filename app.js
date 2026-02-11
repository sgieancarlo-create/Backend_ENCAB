require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const db = require('./db');
const routes = require('./routes');
const rateLimit = require('express-rate-limit');

const app = express();
// Ensure DB is initialized before any route (required for Vercel serverless)
app.use((req, res, next) => {
  db.initialize()
    .then(() => next())
    .catch((err) => {
      console.error('DB init failed', err);
      res.status(503).json({ success: false, error: 'Service unavailable' });
    });
});
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);
app.get('/api', (req, res) => res.json({ ok: true, message: 'Enrollment API' }));
app.use('/api', routes);

module.exports = app;
