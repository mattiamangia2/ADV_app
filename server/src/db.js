import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ADV_DB_PATH || path.join(__dirname, '..', 'data', 'adv.db');

/** Columns of the billboards table that the API accepts (besides id/company_id). */
export const BILLBOARD_FIELDS = {
  code: 'TEXT',                    // owner's internal reference
  name: 'TEXT NOT NULL',
  format: 'TEXT NOT NULL',         // see FORMATS
  media_type: "TEXT NOT NULL DEFAULT 'static'", // static | digital
  status: "TEXT NOT NULL DEFAULT 'available'",  // available | booked | maintenance | inactive
  ownership: "TEXT NOT NULL DEFAULT 'owned'",   // owned | unknown (site known, not ours, operator unknown) | competitor
  operator_name: 'TEXT',           // who runs the site when it isn't ours (e.g. from OSM "operator")
  // Location & orientation
  lat: 'REAL NOT NULL',
  lon: 'REAL NOT NULL',
  address: 'TEXT',
  city: 'TEXT',
  road_name: 'TEXT',
  road_type: 'TEXT',               // motorway | arterial | urban | local
  speed_limit_kmh: 'REAL',
  facing_azimuth: 'REAL',          // direction the face points to (0=N, 90=E). NULL = visible from all directions
  viewing_angle_deg: 'REAL DEFAULT 60', // half-angle of the readable cone
  visibility_m: 'REAL',            // max readable distance
  height_above_ground_m: 'REAL',
  // Physical
  width_m: 'REAL',
  height_m: 'REAL',
  surface_m2: 'REAL',
  faces: 'INTEGER DEFAULT 1',
  illuminated: 'INTEGER DEFAULT 0',
  material: 'TEXT',                // paper | vinyl | led | lcd | mesh ...
  // Digital
  resolution: 'TEXT',
  slot_seconds: 'REAL',
  loop_seconds: 'REAL',
  operating_hours: 'TEXT',         // e.g. "06:00-24:00"
  // Commercial
  currency: "TEXT DEFAULT 'EUR'",
  price_week: 'REAL',
  price_month: 'REAL',
  price_year: 'REAL',
  production_cost: 'REAL',
  min_booking_days: 'INTEGER',
  // Admin
  installed_at: 'TEXT',
  permit_number: 'TEXT',
  permit_expires_at: 'TEXT',
  photo_url: 'TEXT',
  notes: 'TEXT',
  extra: "TEXT DEFAULT '{}'",      // free-form custom fields as JSON
};

export const CAMPAIGN_FIELDS = {
  advertiser: 'TEXT NOT NULL',
  brand: 'TEXT',
  category: 'TEXT',
  title: 'TEXT',
  creative_url: 'TEXT',
  start_date: 'TEXT NOT NULL',
  end_date: 'TEXT NOT NULL',
  price_paid: 'REAL',
  notes: 'TEXT',
};

export function openDb(file = DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

/** Add columns introduced after a database was created (SQLite ALTER TABLE ADD COLUMN). */
function addMissingColumns(db, table, fields) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [k, type] of Object.entries(fields)) {
    if (!have.has(k)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${k} ${type}`);
  }
}

function migrate(db) {
  const bbCols = Object.entries(BILLBOARD_FIELDS).map(([k, t]) => `${k} ${t}`).join(',\n  ');
  const cpCols = Object.entries(CAMPAIGN_FIELDS).map(([k, t]) => `${k} ${t}`).join(',\n  ');
  db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  color TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS billboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ${bbCols},
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bb_company ON billboards(company_id);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billboard_id INTEGER NOT NULL REFERENCES billboards(id) ON DELETE CASCADE,
  ${cpCols},
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cp_bb ON campaigns(billboard_id);
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'upload',
  vehicle_type TEXT DEFAULT 'car',
  weight REAL DEFAULT 1,           -- how many real trips this sample represents (panel expansion factor)
  occupancy REAL DEFAULT 1.3,      -- people per vehicle
  started_at TEXT,
  ended_at TEXT,
  distance_m REAL,
  coords TEXT NOT NULL             -- JSON [[lon, lat, unixSeconds], ...]
);
-- Traffic volumes per road segment (e.g. exported from QGIS / AequilibraE / TomTom / counts).
CREATE TABLE IF NOT EXISTS road_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  road_class TEXT,
  vol_ab REAL NOT NULL DEFAULT 0,  -- vehicles/day travelling in the drawing direction of the line
  vol_ba REAL NOT NULL DEFAULT 0,  -- vehicles/day travelling against it
  speed_kmh REAL,
  occupancy REAL DEFAULT 1.3,
  source TEXT,
  props TEXT DEFAULT '{}',         -- original attributes
  coords TEXT NOT NULL             -- JSON [[lon, lat], ...]
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);
  addMissingColumns(db, 'billboards', BILLBOARD_FIELDS);
  addMissingColumns(db, 'campaigns', CAMPAIGN_FIELDS);
}

/** Keep only known keys, coerce booleans/objects for SQLite. */
export function pick(obj, fields) {
  const out = {};
  for (const k of Object.keys(fields)) {
    if (!(k in obj)) continue;
    let v = obj[k];
    if (v === '' ) v = null;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (k === 'extra' && v && typeof v === 'object') v = JSON.stringify(v);
    out[k] = v ?? null;
  }
  return out;
}

export function insert(db, table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const res = db.prepare(sql).run(...keys.map((k) => row[k]));
  return Number(res.lastInsertRowid);
}

export function update(db, table, id, row) {
  const keys = Object.keys(row);
  if (!keys.length) return;
  const extra = table === 'billboards' ? ", updated_at = datetime('now')" : '';
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}${extra} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => row[k]), id);
}

export function getSetting(db, key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
