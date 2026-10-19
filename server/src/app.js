import express from 'express';
import cors from 'cors';
import { BILLBOARD_FIELDS, CAMPAIGN_FIELDS, getSetting, insert, pick, setSetting, update } from './db.js';
import { CAMPAIGN_CATEGORIES, FORMATS, OWNERSHIPS, ROAD_TYPES, STATUSES, campaignTiming, isOwned, withDefaults } from './domain.js';
import { computeExposure, findGaps, invalidate, loadBillboards, loadSegments, odFlows, reachSummary, trafficMode } from './analytics.js';
import { billboardsFromGeoJson, normaliseBillboardRow, parseCsv, parseGeoJson, parsePings, parseSegments } from './ingest.js';

const NUMERIC = new Set(Object.entries(BILLBOARD_FIELDS).filter(([, t]) => /REAL|INTEGER/.test(t)).map(([k]) => k));

export function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '300mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '300mb' }));

  const companyOf = (req) => {
    const v = req.query.companyId ?? req.get('x-company-id');
    return v ? Number(v) : null;
  };

  // ---------- meta ----------
  app.get('/api/meta', (_req, res) => {
    res.json({ formats: FORMATS, statuses: STATUSES, ownerships: OWNERSHIPS, roadTypes: ROAD_TYPES, categories: CAMPAIGN_CATEGORIES, fields: Object.keys(BILLBOARD_FIELDS) });
  });

  // ---------- companies ----------
  app.get('/api/companies', (_req, res) => {
    res.json(db.prepare(`SELECT c.*, COUNT(b.id) AS billboard_count FROM companies c
      LEFT JOIN billboards b ON b.company_id = c.id GROUP BY c.id ORDER BY c.name`).all());
  });
  app.post('/api/companies', (req, res) => {
    const { name, contact_email, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
      const id = insert(db, 'companies', { name, contact_email: contact_email ?? null, color: color ?? null });
      res.status(201).json(db.prepare('SELECT * FROM companies WHERE id = ?').get(id));
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  });

  // ---------- billboards ----------
  const hydrate = (rows) => {
    const exposure = computeExposure(db);
    const metrics = new Map(exposure.perBillboard.map((m) => [m.billboard_id, m]));
    const now = new Date();
    const cps = db.prepare('SELECT * FROM campaigns WHERE billboard_id = ? ORDER BY start_date DESC');
    return rows.map((b) => {
      const campaigns = cps.all(b.id).map((c) => ({ ...c, timing: campaignTiming(c, now) }));
      const { sample_trip_ids, ...m } = metrics.get(b.id) || {};
      return {
        ...b,
        current_campaign: campaigns.find((c) => c.timing.state === 'running') || null,
        campaigns,
        metrics: m,
      };
    });
  };

  app.get('/api/billboards', (req, res) => {
    res.json(hydrate(loadBillboards(db, companyOf(req))));
  });

  app.get('/api/billboards/:id', (req, res) => {
    const b = loadBillboards(db).find((x) => x.id === Number(req.params.id));
    if (!b) return res.status(404).json({ error: 'not found' });
    const [out] = hydrate([b]);
    const m = computeExposure(db).perBillboard.find((p) => p.billboard_id === b.id);
    out.sample_trip_ids = m?.sample_trip_ids?.slice(0, 200) ?? [];
    res.json(out);
  });

  const validateBillboard = (row, partial) => {
    const errs = [];
    if (!partial || 'name' in row) if (!row.name) errs.push('name is required');
    if (!partial || 'format' in row) if (!row.format) errs.push('format is required');
    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!partial || 'lat' in row) if (!isNum(row.lat) || row.lat < -90 || row.lat > 90) errs.push('lat must be a number between -90 and 90');
    if (!partial || 'lon' in row) if (!isNum(row.lon) || row.lon < -180 || row.lon > 180) errs.push('lon must be a number between -180 and 180');
    for (const k of Object.keys(row)) if (NUMERIC.has(k) && row[k] != null && !isNum(row[k])) errs.push(`${k} must be a number`);
    if ('status' in row && row.status && !STATUSES.includes(row.status)) errs.push(`status must be one of ${STATUSES.join(', ')}`);
    if ('ownership' in row && row.ownership && !OWNERSHIPS.includes(row.ownership)) errs.push(`ownership must be one of ${OWNERSHIPS.join(', ')}`);
    if ('format' in row && row.format && !FORMATS[row.format]) errs.push(`unknown format "${row.format}" (use one of ${Object.keys(FORMATS).join(', ')})`);
    if ('facing_azimuth' in row && row.facing_azimuth != null && !(row.facing_azimuth >= 0 && row.facing_azimuth < 360)) errs.push('facing_azimuth must be 0..359');
    return errs;
  };
  const clean = (body) => {
    const row = pick(body, BILLBOARD_FIELDS);
    for (const k of Object.keys(row)) if (NUMERIC.has(k) && row[k] != null) row[k] = Number(row[k]);
    return row;
  };

  const createBillboard = (companyId, body) => {
    const row = clean(body);
    const errs = validateBillboard(row, false);
    if (errs.length) return { errors: errs };
    const id = insert(db, 'billboards', { ...row, company_id: companyId });
    for (const c of body.campaigns || []) {
      const cr = pick(c, CAMPAIGN_FIELDS);
      if (cr.advertiser && cr.start_date && cr.end_date) insert(db, 'campaigns', { ...cr, billboard_id: id });
    }
    return { id };
  };

  app.post('/api/billboards', (req, res) => {
    const companyId = companyOf(req) ?? Number(req.body.company_id);
    if (!companyId) return res.status(400).json({ error: 'companyId is required' });
    const r = createBillboard(companyId, req.body);
    if (r.errors) return res.status(400).json({ error: r.errors.join('; ') });
    invalidate();
    res.status(201).json(hydrate(loadBillboards(db).filter((b) => b.id === r.id))[0]);
  });

  /** Bulk import: JSON array or CSV text (header = field names). */
  app.post('/api/billboards/import', (req, res) => {
    const companyId = companyOf(req);
    if (!companyId) return res.status(400).json({ error: 'companyId is required' });
    let rows;
    try {
      rows = typeof req.body === 'string' ? parseCsv(req.body).map(normaliseBillboardRow)
        : Array.isArray(req.body) ? req.body.map(normaliseBillboardRow)
        : req.body?.type ? billboardsFromGeoJson(req.body) : [];
    } catch (e) {
      return res.status(400).json({ error: `could not read file: ${e.message}` });
    }
    if (!rows.length) return res.status(400).json({ error: 'no billboards found in the file' });
    // ?ownership=unknown marks the whole file as "sites that exist but aren't ours" (a row's own column wins).
    const defaultOwnership = OWNERSHIPS.includes(req.query.ownership) ? req.query.ownership : 'owned';
    rows = rows.map((r) => {
      let ownership = r.ownership || defaultOwnership;
      if (ownership === 'unknown' && r.operator_name) ownership = 'competitor';
      return { ...r, ownership };
    });
    const results = { created: 0, errors: [], assumed_format: rows.filter((r) => r.format_assumed).length };
    db.exec('BEGIN');
    rows.forEach((r, i) => {
      // Unknown CSV columns go into `extra` so no information is lost.
      const extra = {};
      for (const [k, v] of Object.entries(r)) if (!(k in BILLBOARD_FIELDS) && v !== '' && k !== 'campaigns') extra[k] = v;
      try {
        const out = createBillboard(companyId, { ...r, extra: { ...(typeof r.extra === 'object' ? r.extra : {}), ...extra } });
        if (out.errors) results.errors.push({ row: i + 1, errors: out.errors });
        else results.created++;
      } catch (e) {
        results.errors.push({ row: i + 1, errors: [e.message] });
      }
    });
    db.exec('COMMIT');
    invalidate();
    res.json(results);
  });

  const owned = (req, res) => {
    const b = db.prepare('SELECT * FROM billboards WHERE id = ?').get(Number(req.params.id));
    if (!b) { res.status(404).json({ error: 'not found' }); return null; }
    const cid = companyOf(req);
    if (cid && b.company_id !== cid) { res.status(403).json({ error: 'billboard belongs to another company' }); return null; }
    return b;
  };

  /**
   * Bulk actions on many billboards at once.
   * Body: { ids: number[], set?: {field: value}, price_adjust_pct?: number, extra_set?: {key: value},
   *         add_campaign?: {...}, end_running_campaigns?: boolean, delete?: boolean }
   */
  app.post('/api/billboards/bulk', (req, res) => {
    const cid = companyOf(req);
    const { ids, set = {}, price_adjust_pct, extra_set, add_campaign, end_running_campaigns } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids is required' });
    const list = ids.map(Number).filter(Boolean);
    const rows = db.prepare(`SELECT * FROM billboards WHERE id IN (${list.map(() => '?').join(',')})`).all(...list);
    if (rows.length !== list.length) return res.status(404).json({ error: 'some billboards were not found' });
    if (cid && rows.some((b) => b.company_id !== cid)) return res.status(403).json({ error: 'some billboards belong to another company' });

    if (req.body.delete) {
      db.exec('BEGIN');
      for (const b of rows) db.prepare('DELETE FROM billboards WHERE id = ?').run(b.id);
      db.exec('COMMIT');
      invalidate();
      return res.json({ deleted: rows.length });
    }

    const row = clean(set);
    for (const k of ['name', 'lat', 'lon', 'code', 'extra']) delete row[k]; // per-site fields can't be bulk-set
    const errs = validateBillboard(row, true);
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });
    let campaign = null;
    if (add_campaign) {
      campaign = pick(add_campaign, CAMPAIGN_FIELDS);
      if (!campaign.advertiser || !campaign.start_date || !campaign.end_date) return res.status(400).json({ error: 'campaign needs advertiser, start_date and end_date' });
      if (campaign.end_date < campaign.start_date) return res.status(400).json({ error: 'campaign end_date must be after start_date' });
    }
    const pct = Number(price_adjust_pct);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const now = new Date();
    const result = { updated: rows.length, campaigns_added: 0, campaigns_ended: 0 };

    db.exec('BEGIN');
    try {
      for (const b of rows) {
        const patch = { ...row };
        if (Number.isFinite(pct) && pct !== 0) {
          for (const k of ['price_week', 'price_month', 'price_year']) {
            const base = k in patch ? patch[k] : b[k];
            if (base != null) patch[k] = Math.round(base * (1 + pct / 100) * 100) / 100;
          }
        }
        if (extra_set && typeof extra_set === 'object') {
          let ex = {};
          try { ex = JSON.parse(b.extra || '{}'); } catch { /* keep empty */ }
          for (const [k, v] of Object.entries(extra_set)) if (k.trim()) { if (v === '' || v == null) delete ex[k.trim()]; else ex[k.trim()] = v; }
          patch.extra = JSON.stringify(ex);
        }
        update(db, 'billboards', b.id, patch);
        if (end_running_campaigns) {
          for (const c of db.prepare('SELECT * FROM campaigns WHERE billboard_id = ?').all(b.id)) {
            if (campaignTiming(c, now).state === 'running') {
              db.prepare('UPDATE campaigns SET end_date = ? WHERE id = ?').run(c.start_date > yesterday ? c.start_date : yesterday, c.id);
              result.campaigns_ended++;
            }
          }
        }
        if (campaign) { insert(db, 'campaigns', { ...campaign, billboard_id: b.id }); result.campaigns_added++; }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: e.message });
    }
    invalidate();
    res.json(result);
  });

  app.put('/api/billboards/:id', (req, res) => {
    const b = owned(req, res);
    if (!b) return;
    const row = clean(req.body);
    const errs = validateBillboard(row, true);
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });
    update(db, 'billboards', b.id, row);
    invalidate();
    res.json(hydrate(loadBillboards(db).filter((x) => x.id === b.id))[0]);
  });

  app.delete('/api/billboards/:id', (req, res) => {
    const b = owned(req, res);
    if (!b) return;
    db.prepare('DELETE FROM billboards WHERE id = ?').run(b.id);
    invalidate();
    res.status(204).end();
  });

  // ---------- campaigns ----------
  app.post('/api/billboards/:id/campaigns', (req, res) => {
    const b = owned(req, res);
    if (!b) return;
    const row = pick(req.body, CAMPAIGN_FIELDS);
    if (!row.advertiser || !row.start_date || !row.end_date) return res.status(400).json({ error: 'advertiser, start_date and end_date are required' });
    if (row.end_date < row.start_date) return res.status(400).json({ error: 'end_date must be after start_date' });
    const id = insert(db, 'campaigns', { ...row, billboard_id: b.id });
    res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
  });
  app.delete('/api/campaigns/:id', (req, res) => {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- mobility ----------
  /** Trip paths for the map. `limit` caps payload; `ids` returns specific trips. */
  app.get('/api/trips', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 5000, 50000);
    let rows;
    if (req.query.ids) {
      const ids = String(req.query.ids).split(',').map(Number).filter(Boolean).slice(0, 1000);
      rows = ids.length ? db.prepare(`SELECT * FROM trips WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
    } else rows = db.prepare('SELECT * FROM trips ORDER BY id LIMIT ?').all(limit);
    res.json(rows.map((t) => ({ id: t.id, weight: t.weight, vehicle_type: t.vehicle_type, started_at: t.started_at, distance_m: t.distance_m, path: JSON.parse(t.coords) })));
  });

  app.get('/api/trips/stats', (_req, res) => {
    res.json(db.prepare(`SELECT COUNT(*) AS trips, SUM(weight) AS weighted_trips, SUM(distance_m) AS distance_m,
      MIN(started_at) AS first, MAX(ended_at) AS last FROM trips`).get());
  });

  app.post('/api/trips/import', (req, res) => {
    let trips = [];
    try {
      if (typeof req.body === 'string') trips = parsePings(parseCsv(req.body));
      else if (Array.isArray(req.body)) trips = parsePings(req.body);
      else if (req.body?.type) trips = parseGeoJson(req.body);
    } catch (e) {
      return res.status(400).json({ error: `could not parse upload: ${e.message}` });
    }
    if (!trips.length) return res.status(400).json({ error: 'no valid trips found (need ≥2 timestamped points per trip)' });
    db.exec('BEGIN');
    for (const t of trips) insert(db, 'trips', t);
    db.exec('COMMIT');
    invalidate();
    res.json({ imported: trips.length });
  });

  app.delete('/api/trips', (_req, res) => {
    db.exec('DELETE FROM trips');
    invalidate();
    res.status(204).end();
  });

  // ---------- road-segment volumes (from QGIS / AequilibraE / TomTom / counts) ----------
  app.get('/api/segments', (_req, res) => {
    res.json(loadSegments(db).map((s) => ({ id: s.id, name: s.name, road_class: s.road_class, vol_ab: s.vol_ab, vol_ba: s.vol_ba, vehicles_per_day: Math.round(s.vol_ab + s.vol_ba), path: s.coords })));
  });
  app.get('/api/segments/stats', (_req, res) => {
    const r = db.prepare('SELECT COUNT(*) AS segments, SUM(vol_ab + vol_ba) AS total_volume, MAX(vol_ab + vol_ba) AS max_volume FROM road_segments').get();
    res.json({ ...r, mode: trafficMode(db), source_setting: getSetting(db, 'traffic_source', 'auto') });
  });
  /** Body: { geojson, options: { volumeField?, abField?, baField?, nameField?, speedField?, multiplier?, occupancy?, replace? } } */
  app.post('/api/segments/import', (req, res) => {
    const { geojson, options = {} } = req.body || {};
    if (!geojson?.type) return res.status(400).json({ error: 'send { geojson, options }' });
    let parsed;
    try { parsed = parseSegments(geojson, options); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!parsed.rows.length) return res.status(400).json({ error: 'no road segments with a traffic volume above 0 were found' });
    db.exec('BEGIN');
    if (options.replace) db.exec('DELETE FROM road_segments');
    for (const r of parsed.rows) insert(db, 'road_segments', r);
    db.exec('COMMIT');
    invalidate();
    res.json({ imported: parsed.rows.length, skipped: parsed.skipped, used: parsed.used, name_field: parsed.nameField, speed_field: parsed.speedField });
  });
  app.delete('/api/segments', (_req, res) => {
    db.exec('DELETE FROM road_segments');
    invalidate();
    res.status(204).end();
  });
  app.put('/api/settings/traffic-source', (req, res) => {
    const v = req.body?.value;
    if (!['auto', 'trips', 'segments'].includes(v)) return res.status(400).json({ error: 'value must be auto, trips or segments' });
    setSetting(db, 'traffic_source', v);
    invalidate();
    res.json({ value: v, mode: trafficMode(db) });
  });

  // ---------- analytics ----------
  const hours = (req) => ({ hourFrom: clampHour(req.query.hourFrom, 0), hourTo: clampHour(req.query.hourTo, 23) });

  app.get('/api/analytics/billboards', (req, res) => {
    const cid = companyOf(req);
    const e = computeExposure(db, hours(req));
    res.json(e.perBillboard.filter((p) => !cid || p.company_id === cid).map(({ sample_trip_ids, ...p }) => p));
  });

  app.get('/api/analytics/summary', (req, res) => {
    const cid = companyOf(req);
    const e = computeExposure(db, hours(req));
    // Only sites the company actually owns count towards its inventory figures.
    const scoped = e.billboards.filter((b) => !cid || b.company_id === cid);
    const bbs = scoped.filter(isOwned);
    const ownedIds = new Set(bbs.map((b) => b.id));
    const mine = e.perBillboard.filter((p) => ownedIds.has(p.billboard_id));
    const monthly = bbs.reduce((s, b) => s + (b.price_month ?? (b.price_year ? b.price_year / 12 : 0)), 0);
    const imps = mine.reduce((s, p) => s + p.impressions_per_month, 0);
    const now = new Date();
    const running = db.prepare(`SELECT c.* FROM campaigns c JOIN billboards b ON b.id = c.billboard_id ${cid ? 'WHERE b.company_id = ?' : ''}`)
      .all(...(cid ? [cid] : [])).filter((c) => ownedIds.has(c.billboard_id) && campaignTiming(c, now).state === 'running');
    const occupied = new Set(running.map((c) => c.billboard_id));
    res.json({
      mode: e.mode,
      ...reachSummary(e, mine.map((p) => p.billboard_id)),
      billboards: bbs.length,
      not_owned: scoped.length - bbs.length,
      digital: bbs.filter((b) => b.media_type === 'digital').length,
      surface_m2: Math.round(bbs.reduce((s, b) => s + (b.surface_m2 || 0), 0)),
      occupancy_pct: bbs.length ? Math.round((occupied.size / bbs.length) * 100) : 0,
      running_campaigns: running.length,
      monthly_list_price: Math.round(monthly),
      impressions_per_month: Math.round(imps),
      avg_cpm: imps ? Math.round((monthly / imps) * 1000 * 100) / 100 : null,
      off_route: mine.filter((p) => p.route_fit === 'off-route' || p.route_fit === 'marginal').length,
      expiring_30d: running.filter((c) => campaignTiming(c, now).remaining_days <= 30).length,
    });
  });

  app.get('/api/analytics/gaps', (req, res) => {
    const cid = companyOf(req);
    const scope = req.query.scope === 'market' ? null : cid;
    const sites = loadBillboards(db, scope).filter((b) => req.query.scope === 'market' || isOwned(b));
    res.json(findGaps(db, sites, { radiusM: Number(req.query.radius) || 350 }));
  });

  app.get('/api/analytics/flows', (req, res) => {
    res.json(odFlows(db, { cellM: Number(req.query.cell) || 1000 }));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'internal error' });
  });

  return app;
}

function clampHour(v, d) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
}
