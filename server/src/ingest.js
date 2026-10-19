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

// ---------------------------------------------------------------------------
// GeoJSON from QGIS (or any GIS): coordinate checks, road volumes, billboard points
// ---------------------------------------------------------------------------

/** Throws a helpful error unless the file is in WGS84 longitude/latitude (EPSG:4326). */
export function assertWgs84(fc) {
  const crs = fc?.crs?.properties?.name;
  if (crs && !/4326|CRS84/i.test(crs)) {
    throw new Error(`the file is in coordinate system ${crs}. In QGIS export it again with CRS = EPSG:4326 (WGS 84).`);
  }
  const first = firstCoord(fc);
  if (first && (Math.abs(first[0]) > 180 || Math.abs(first[1]) > 90)) {
    throw new Error(`coordinates look projected (e.g. ${first[0].toFixed(0)}, ${first[1].toFixed(0)}), not longitude/latitude. In QGIS export with CRS = EPSG:4326 (WGS 84).`);
  }
}
function firstCoord(fc) {
  for (const f of fc?.features || []) {
    let c = f.geometry?.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    if (Array.isArray(c) && c.length >= 2) return c;
  }
  return null;
}

const lowerKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));
const num = (v) => (v == null || v === '' ? NaN : Number(String(v).replace(',', '.')));
const firstKey = (keys, candidates) => candidates.find((c) => keys.includes(c));

export const VOLUME_CANDIDATES = ['vehicles_per_day', 'veh_day', 'aadt', 'tgm', 'tgma', 'volume', 'flow', 'traffic', 'traffico', 'flusso', 'count', 'conteggio', 'matrix_tot', 'tot_flow', 'pce_tot', 'demand_tot'];
const NAME_CANDIDATES = ['name', 'nome', 'road_name', 'denominazione', 'via', 'street', 'ref'];
const SPEED_CANDIDATES = ['speed_kmh', 'speed', 'maxspeed', 'velocita', 'free_flow_speed', 'speed_ab'];
const ONEWAY_CANDIDATES = ['oneway', 'senso_unico', 'one_way', 'direction'];

/**
 * Road segments with traffic volumes. Options (all optional — fields are auto-detected):
 *   volumeField  total vehicles (split 50/50, or all one way when the oneway field says so)
 *   abField/baField  per-direction volumes (AB = the direction the line was drawn)
 *   multiplier   e.g. 10 to turn a peak-hour volume into an approximate daily one
 */
export function parseSegments(fc, opts = {}) {
  assertWgs84(fc);
  const feats = (fc.type === 'FeatureCollection' ? fc.features : [fc]).filter((f) => f?.geometry);
  if (!feats.length) throw new Error('no features in file');
  const keys = Object.keys(lowerKeys(feats[0].properties));
  const ab = opts.abField?.toLowerCase() || keys.find((k) => /(^|_)ab$/.test(k) && !/speed|time|cap|delay|voc/.test(k));
  const ba = opts.baField?.toLowerCase() || (ab ? ab.replace(/ab$/, 'ba') : null);
  const useDirectional = opts.volumeField ? false : !!(ab && keys.includes(ab) && ba && keys.includes(ba));
  const vol = opts.volumeField?.toLowerCase() || (useDirectional ? null : firstKey(keys, VOLUME_CANDIDATES));
  if (!useDirectional && !vol) throw new Error(`could not find a traffic volume column. Columns found: ${keys.join(', ')}. Pick the right one in the upload form.`);
  const nameF = opts.nameField?.toLowerCase() || firstKey(keys, NAME_CANDIDATES);
  const speedF = opts.speedField?.toLowerCase() || firstKey(keys, SPEED_CANDIDATES);
  const onewayF = firstKey(keys, ONEWAY_CANDIDATES);
  const mult = Number(opts.multiplier) || 1;
  const occupancy = Number(opts.occupancy) || 1.3;

  const rows = [];
  let skipped = 0;
  for (const f of feats) {
    const p = lowerKeys(f.properties);
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    let vAB, vBA;
    if (useDirectional) { vAB = num(p[ab]) || 0; vBA = num(p[ba]) || 0; }
    else {
      const total = num(p[vol]);
      const ow = String(p[onewayF] ?? '').toLowerCase();
      if (['yes', 'true', '1', 't', 'ft', 'si', 'sì'].includes(ow)) { vAB = total; vBA = 0; }
      else if (['-1', 'tf', 'reverse'].includes(ow)) { vAB = 0; vBA = total; }
      else { vAB = total / 2; vBA = total / 2; }
    }
    if (!lines.length || !(vAB + vBA > 0)) { skipped++; continue; }
    for (const line of lines) {
      const coords = line.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [+c[0].toFixed(6), +c[1].toFixed(6)]);
      if (coords.length < 2) { skipped++; continue; }
      rows.push({
        name: nameF ? (p[nameF] == null ? null : String(p[nameF])) : null,
        road_class: p.highway ?? p.road_class ?? p.fclass ?? p.link_type ?? null,
        vol_ab: vAB * mult,
        vol_ba: vBA * mult,
        speed_kmh: speedF && num(p[speedF]) > 0 ? num(p[speedF]) : null,
        occupancy,
        source: opts.source || 'upload',
        props: JSON.stringify(f.properties || {}),
        coords: JSON.stringify(coords),
      });
    }
  }
  return { rows, skipped, used: useDirectional ? { ab, ba } : { volume: vol }, nameField: nameF, speedField: speedF };
}

/** OpenStreetMap advertising tags -> our formats (QuickOSM exports keep the tags as columns). */
const OSM_FORMAT = { billboard: 'poster_6x3', board: 'poster_4x3', poster_box: 'backlit', column: 'street_poster', screen: 'digital_billboard', wall_painting: 'maxi_wrap', tarp: 'maxi_wrap', totem: 'digital_totem' };

/** Billboard points from GeoJSON (or rows from a CSV with X/Y columns) -> billboard field objects. */
export function billboardsFromGeoJson(fc) {
  assertWgs84(fc);
  const feats = (fc.type === 'FeatureCollection' ? fc.features : [fc]).filter((f) => f?.geometry);
  return feats.map((f) => {
    let c = f.geometry.coordinates;
    if (f.geometry.type !== 'Point') { while (Array.isArray(c[0])) c = c[0]; } // polygons/lines: use first vertex
    return normaliseBillboardRow({ ...(f.properties || {}), lon: c[0], lat: c[1] });
  });
}

export function normaliseBillboardRow(r) {
  const p = lowerKeys(r);
  const out = { ...p };
  if (out.lat == null && out.latitude != null) out.lat = out.latitude;
  if (out.lon == null && (out.lng ?? out.longitude) != null) out.lon = out.lng ?? out.longitude;
  if (out.lat == null && out.y != null) out.lat = out.y; // QGIS "add geometry attributes" / CSV export
  if (out.lon == null && out.x != null) out.lon = out.x;
  for (const k of ['lat', 'lon']) if (out[k] != null) out[k] = num(out[k]);
  delete out.latitude; delete out.longitude; delete out.lng; delete out.x; delete out.y;
  // OpenStreetMap tags
  const adv = out.advertising;
  const isShelter = out.highway === 'bus_stop' || out.amenity === 'shelter' || out.shelter === 'yes';
  if (!out.format) {
    if (adv && OSM_FORMAT[adv]) out.format = OSM_FORMAT[adv];
    else if (isShelter) out.format = 'bus_shelter';
    else { out.format = 'poster_6x3'; out.format_assumed = 'yes'; }
  }
  if (!out.name) {
    const where = out['addr:street'] || out.ref || out.operator || '';
    const id = out.full_id || out.osm_id || out['@id'] || out.id || '';
    out.name = [adv ? `OSM ${adv}` : isShelter ? 'Bus shelter' : 'Billboard', where, id && `#${id}`].filter(Boolean).join(' ');
  }
  if (out.lit === 'yes' && out.illuminated == null) out.illuminated = 1;
  if (out.direction != null && out.facing_azimuth == null && Number.isFinite(num(out.direction))) out.facing_azimuth = num(out.direction) % 360;
  if (out.operator && !out.code) out.code = String(out.operator).slice(0, 40);
  return out;
}
