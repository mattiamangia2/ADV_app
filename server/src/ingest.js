// Parsers for mobility data uploads.
// Supported:
//  1. GeoJSON FeatureCollection of LineStrings. Time per vertex comes from either a
//     3rd/4th coordinate value or `properties.timestamps` (array). Optional props:
//     weight, occupancy, vehicle_type.
//  2. GPS pings as CSV or JSON rows: trip_id, lat, lon, timestamp [, weight, vehicle_type].
//     Rows are grouped by trip_id and sorted by time.

import { haversine } from './geo.js';

export function toUnix(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    return n > 1e12 ? n / 1000 : n; // ms -> s
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t / 1000;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]?.trim() ?? ''])));
}

function finalize(coords, props = {}) {
  coords = coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2]));
  coords.sort((a, b) => a[2] - b[2]);
  if (coords.length < 2) return null;
  let dist = 0;
  for (let i = 1; i < coords.length; i++) dist += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  return {
    source: props.source || 'upload',
    vehicle_type: props.vehicle_type || 'car',
    weight: Number(props.weight) || 1,
    occupancy: Number(props.occupancy) || 1.3,
    started_at: new Date(coords[0][2] * 1000).toISOString(),
    ended_at: new Date(coords.at(-1)[2] * 1000).toISOString(),
    distance_m: Math.round(dist),
    coords: JSON.stringify(coords.map(([lon, lat, t]) => [+lon.toFixed(6), +lat.toFixed(6), Math.round(t)])),
  };
}

export function parseGeoJson(fc) {
  const feats = fc.type === 'FeatureCollection' ? fc.features : [fc];
  const out = [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    const p = f.properties || {};
    for (const line of lines) {
      const coords = line.map((c, i) => [c[0], c[1], toUnix(p.timestamps?.[i] ?? c[3] ?? c[2])]);
      const t = finalize(coords, p);
      if (t) out.push(t);
    }
  }
  return out;
}

export function parsePings(rows) {
  const groups = new Map();
  for (const r of rows) {
    const id = r.trip_id ?? r.tripid ?? r.id ?? r.device_id;
    const lat = Number(r.lat ?? r.latitude);
    const lon = Number(r.lon ?? r.lng ?? r.longitude);
    const t = toUnix(r.timestamp ?? r.time ?? r.ts);
    if (id == null) continue;
    if (!groups.has(id)) groups.set(id, { props: r, coords: [] });
    groups.get(id).coords.push([lon, lat, t]);
  }
  return [...groups.values()].map((g) => finalize(g.coords, g.props)).filter(Boolean);
}
