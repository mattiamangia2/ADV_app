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
if (db.prepare('SELECT COUNT(*) AS n FROM companies').get().n === 0 && process.env.ADV_SEED !== '0') {
  console.log('Empty database: generating demo data (set ADV_SEED=0 to skip)…');
  await seed(db);
}

const app = createApp(db);

// Serve the built client in production.
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`ADV API listening on http://localhost:${PORT}`));
