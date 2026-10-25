import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

const db = openDb();
const needsSeed = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n === 0 && process.env.ADV_SEED !== '0';

// Start listening straight away; while demo data is being prepared (the first start
// downloads Milan's roads) the API answers "preparing" and the web page waits.
let preparing = needsSeed;
const root = express();
root.use('/api', (_req, res, next) => {
  if (!preparing) return next();
  res.status(503).json({ preparing: true, error: "Preparing demo data: the first start downloads Milan's roads from OpenStreetMap (1–3 minutes)." });
});
root.use(createApp(db));

// Serve the built client in production.
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  root.use(express.static(dist));
  root.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

root.listen(PORT, () => console.log(`ADV API listening on http://localhost:${PORT}`));

if (needsSeed) {
  console.log('Empty database: generating demo data (set ADV_SEED=0 to skip)…');
  try {
    await seed(db);
    console.log('Demo data ready.');
  } catch (e) {
    console.error('Could not generate demo data:', e);
  } finally {
    preparing = false;
  }
}
