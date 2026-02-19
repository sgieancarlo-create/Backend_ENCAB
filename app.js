const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const db = require('./db');
const routes = require('./routes');
const rateLimit = require('express-rate-limit');

const app = express();

// Vercel: rewrite may send path as "/" – normalize so Express sees full path
app.use((req, res, next) => {
  const forwarded = req.headers['x-vercel-forwarded-host'] || req.headers['x-forwarded-host'];
  const path = req.headers['x-invoke-path'] || req.headers['x-vercel-invoke-path'];
  if (path) req.url = path;
  if (req.url === '/' && forwarded) req.url = '/api';
  next();
});

// Ensure DB is initialized before any route (Vercel serverless)
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
app.get('/', (req, res) => res.json({ ok: true, message: 'Enrollment API' }));
app.use('/api', routes);

// 404 – JSON so client always gets JSON
app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));

module.exports = app;
