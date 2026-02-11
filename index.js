require('dotenv').config();
const app = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Backend running on port ${PORT}`);
  try {
    await db.initialize();
    console.log('Database initialized');
  } catch (e) {
    console.error('DB init failed', e);
  }
});
