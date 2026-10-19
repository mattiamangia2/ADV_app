// Exposure engine: crosses vehicle trajectories with billboard positions.
//
// A trip "passes" a billboard when any segment of its path comes within the
// billboard's visibility distance AND the vehicle is driving towards the face
// (heading within the viewing cone). Each trip counts at most once per billboard.
// Results are scaled by the trip's panel weight and vehicle occupancy and
// normalised to an average day.

import { GridIndex, angleDiff, bearing, haversine, pointToSegment } from './geo.js';
import { getSetting } from './db.js';
import { withDefaults } from './domain.js';

const TZ = process.env.ADV_TZ || 'Europe/Rome';
const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
export const localHour = (unix) => Number(hourFmt.format(new Date(unix * 1000)));
export const localDay = (unix) => dayFmt.format(new Date(unix * 1000));

/** Heuristic "likelihood to see" given that a person passed within range. Tune with real audits. */
export function visibilityIndex(bb, dwellSeconds) {
  let v = 0.25;
  v += Math.min(0.25, 0.04 * Math.sqrt(bb.surface_m2 || 1));
  if (bb.illuminated) v += 0.08;
  if (bb.media_type === 'digital') v += 0.07;
  v += Math.min(0.2, (dwellSeconds || 0) / 40);
  return Math.max(0.15, Math.min(0.9, v));
}

let cache = { key: null, value: null };
let dataVersion = 0;
export const invalidate = () => { dataVersion++; cache = { key: null, value: null }; };

export function loadTrips(db) {
  return db.prepare('SELECT * FROM trips').all().map((t) => ({ ...t, coords: JSON.parse(t.coords) }));
}

export function loadBillboards(db, companyId) {
  const rows = companyId
    ? db.prepare('SELECT * FROM billboards WHERE company_id = ?').all(companyId)
    : db.prepare('SELECT * FROM billboards').all();
  return rows.map((r) => withDefaults({ ...r, extra: safeJson(r.extra) }));
}

const safeJson = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/**
 * Core computation over ALL billboards (company filtering happens after so that
 * benchmarks/percentiles are market-wide). Cached until data changes.
 */
/** Which traffic data drives analytics: GPS trips or road-segment volumes. */
export function trafficMode(db) {
  const pref = getSetting(db, 'traffic_source', 'auto');
  if (pref === 'trips' || pref === 'segments') return pref;
  return db.prepare('SELECT COUNT(*) AS n FROM road_segments').get().n > 0 ? 'segments' : 'trips';
}

export function computeExposure(db, { hourFrom = 0, hourTo = 23 } = {}) {
  const mode = trafficMode(db);
  const key = `${dataVersion}:${mode}:${hourFrom}:${hourTo}`;
  if (cache.key === key) return cache.value;
  const value = mode === 'segments' ? computeSegmentExposure(db, { hourFrom, hourTo }) : computeTripExposure(db, { hourFrom, hourTo });
  value.mode = mode;
  cache = { key, value };
  return value;
}

function computeTripExposure(db, { hourFrom, hourTo }) {

  const trips = loadTrips(db);
  const billboards = loadBillboards(db);
  const index = new GridIndex(0.005);
  let maxVis = 0;
  for (const b of billboards) {
    index.insert(b.lat, b.lon, b);
    maxVis = Math.max(maxVis, b.visibility_m);
  }
  const padDeg = maxVis / 111000 + 0.001;
  const inWindow = (h) => (hourFrom <= hourTo ? h >= hourFrom && h <= hourTo : h >= hourFrom || h <= hourTo);

  const days = new Set();
  const stats = new Map(billboards.map((b) => [b.id, {
    trips: 0, people: 0, dwellSum: 0, hourly: new Array(24).fill(0), speedSum: 0, tripIds: [],
  }]));
  let totalTrips = 0, totalPeople = 0;
  const tripHits = new Map(); // tripId -> Set(billboardId)

  for (const trip of trips) {
    const c = trip.coords;
    if (c.length < 2) continue;
    days.add(localDay(c[0][2]));
    const startHour = localHour(c[0][2]);
    if (!inWindow(startHour)) continue;
    const w = trip.weight ?? 1;
    const people = w * (trip.occupancy ?? 1.3);
    totalTrips += w;
    totalPeople += people;

    const seen = new Map(); // billboardId -> { t, dwell, speed }
    for (let i = 0; i < c.length - 1; i++) {
      const [aLon, aLat, aT] = c[i];
      const [bLon, bLat, bT] = c[i + 1];
      const cands = index.query(Math.min(aLat, bLat), Math.min(aLon, bLon), Math.max(aLat, bLat), Math.max(aLon, bLon), padDeg);
      if (!cands.length) continue;
      const segLen = haversine(aLat, aLon, bLat, bLon);
      if (segLen < 0.5) continue;
      const heading = bearing(aLat, aLon, bLat, bLon);
      const segDur = Math.max(0, bT - aT);
      for (const b of cands) {
        const { dist, t } = pointToSegment(b.lat, b.lon, aLat, aLon, bLat, bLon);
        if (dist > b.visibility_m) continue;
        if (b.facing_azimuth != null && angleDiff(heading, (b.facing_azimuth + 180) % 360) > b.viewing_angle_deg) continue;
        const chord = 2 * Math.sqrt(Math.max(0, b.visibility_m ** 2 - dist ** 2));
        const dwell = segDur * Math.min(1, chord / segLen);
        const hit = seen.get(b.id);
        if (hit) hit.dwell += dwell;
        else seen.set(b.id, { t: aT + t * segDur, dwell, speed: segDur > 0 ? (segLen / segDur) * 3.6 : 0 });
      }
    }
    if (seen.size) tripHits.set(trip.id, { w, set: new Set(seen.keys()) });
    for (const [bid, hit] of seen) {
      const s = stats.get(bid);
      s.trips += w;
      s.people += people;
      s.dwellSum += Math.min(hit.dwell, 120) * w;
      s.speedSum += hit.speed * w;
      s.hourly[localHour(hit.t)] += people;
      if (s.tripIds.length < 500) s.tripIds.push(trip.id);
    }
  }

  const nDays = Math.max(1, days.size);
  const perBillboard = billboards.map((b) => {
    const s = stats.get(b.id);
    const avgDwell = s.trips ? s.dwellSum / s.trips : 0;
    const vi = visibilityIndex(b, avgDwell);
    const shareOfVoice = b.media_type === 'digital' && b.slot_seconds && b.loop_seconds ? b.slot_seconds / b.loop_seconds : 1;
    const peopleDay = s.people / nDays;
    const impressionsDay = peopleDay * vi * shareOfVoice;
    const impressionsMonth = impressionsDay * 30;
    const priceMonth = b.price_month ?? (b.price_year ? b.price_year / 12 : b.price_week ? b.price_week * 4.33 : null);
    return {
      billboard_id: b.id,
      company_id: b.company_id,
      vehicles_per_day: round(s.trips / nDays),
      people_per_day: round(peopleDay),
      avg_dwell_s: round(avgDwell, 1),
      avg_speed_kmh: s.trips ? round(s.speedSum / s.trips) : null,
      visibility_index: round(vi, 2),
      share_of_voice: round(shareOfVoice, 3),
      impressions_per_day: round(impressionsDay),
      impressions_per_month: round(impressionsMonth),
      cpm: priceMonth && impressionsMonth > 0 ? round((priceMonth / impressionsMonth) * 1000, 2) : null,
      hourly_people: s.hourly.map((v) => round(v / nDays, 1)),
      peak_hour: s.hourly.indexOf(Math.max(...s.hourly)),
      sample_trip_ids: s.tripIds,
    };
  });

  rankRouteFit(perBillboard);
  return { days: nDays, totalTrips, totalPeople, perBillboard, tripHits, billboards };
}

/** Market-wide percentile -> how "on route" a billboard is. */
function rankRouteFit(perBillboard) {
  const sorted = perBillboard.map((p) => p.people_per_day).sort((a, b) => a - b);
  for (const p of perBillboard) {
    const rank = sorted.filter((v) => v <= p.people_per_day).length / Math.max(1, sorted.length);
    p.traffic_percentile = round(rank * 100);
    p.route_fit = p.people_per_day === 0 ? 'off-route' : rank >= 0.66 ? 'main flow' : rank >= 0.33 ? 'secondary' : 'marginal';
  }
}

/** Network-level reach for a set of billboards (e.g. one company's inventory). */
export function reachSummary(exposure, billboardIds) {
  if (exposure.mode === 'segments') {
    // Road volumes don't say which vehicles are the same trip, so reach/frequency can't be measured.
    return { days: 1, vehicle_trips_per_day: null, reached_trips_per_day: null, reach_pct: null, avg_frequency: null };
  }
  const ids = new Set(billboardIds);
  let reached = 0, contacts = 0;
  for (const { w, set } of exposure.tripHits.values()) {
    let n = 0;
    for (const id of set) if (ids.has(id)) n++;
    if (n) { reached += w; contacts += n * w; }
  }
  return {
    days: exposure.days,
    vehicle_trips_per_day: round(exposure.totalTrips / exposure.days),
    reached_trips_per_day: round(reached / exposure.days),
    reach_pct: exposure.totalTrips ? round((reached / exposure.totalTrips) * 100, 1) : 0,
    avg_frequency: reached ? round(contacts / reached, 2) : 0,
  };
}

/**
 * High-traffic grid cells with no billboard (of the given set) nearby —
 * candidate locations for new sites.
 */
export function findGaps(db, billboards, { cellM = 300, radiusM = 350, limit = 25 } = {}) {
  if (trafficMode(db) === 'segments') return findSegmentGaps(db, billboards, { cellM, radiusM, limit });
  const trips = loadTrips(db);
  const cellLat = cellM / 111000;
  const cells = new Map();
  for (const t of trips) {
    const cellLon = cellM / (111000 * Math.cos((t.coords[0][1] * Math.PI) / 180));
    const visited = new Set();
    for (const [lon, lat] of t.coords) {
      const k = `${Math.floor(lat / cellLat)}:${Math.floor(lon / cellLon)}`;
      if (visited.has(k)) continue;
      visited.add(k);
      const c = cells.get(k) || { lat: 0, lon: 0, n: 0, w: 0 };
      c.lat += lat; c.lon += lon; c.n++; c.w += t.weight ?? 1;
      cells.set(k, c);
    }
  }
  const days = new Set(trips.map((t) => localDay(t.coords[0][2]))).size || 1;
  const index = new GridIndex(0.01);
  for (const b of billboards) index.insert(b.lat, b.lon, b);
  const pad = radiusM / 111000;
  return [...cells.values()]
    .map((c) => ({ lat: c.lat / c.n, lon: c.lon / c.n, vehicles_per_day: round(c.w / days) }))
    .sort((a, b) => b.vehicles_per_day - a.vehicles_per_day)
    .filter((c) => !index.query(c.lat, c.lon, c.lat, c.lon, pad).some((b) => haversine(c.lat, c.lon, b.lat, b.lon) <= radiusM))
    .slice(0, limit);
}

/** Origin→destination flows aggregated to a grid, for arc/flow maps. */
export function odFlows(db, { cellM = 1000, limit = 300 } = {}) {
  const trips = loadTrips(db);
  const cellLat = cellM / 111000;
  const snap = (lon, lat) => {
    const cellLon = cellM / (111000 * Math.cos((lat * Math.PI) / 180));
    const i = Math.floor(lat / cellLat), j = Math.floor(lon / cellLon);
    return { k: `${i}:${j}`, lat: (i + 0.5) * cellLat, lon: (j + 0.5) * cellLon };
  };
  const days = new Set(trips.map((t) => localDay(t.coords[0][2]))).size || 1;
  const flows = new Map();
  for (const t of trips) {
    const a = t.coords[0], b = t.coords[t.coords.length - 1];
    const o = snap(a[0], a[1]), d = snap(b[0], b[1]);
    if (o.k === d.k) continue;
    const k = `${o.k}>${d.k}`;
    const f = flows.get(k) || { from: [o.lon, o.lat], to: [d.lon, d.lat], count: 0 };
    f.count += t.weight ?? 1;
    flows.set(k, f);
  }
  return [...flows.values()]
    .map((f) => ({ ...f, per_day: round(f.count / days, 1) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Road-segment volumes (vehicles/day per direction) instead of GPS trips.
// ---------------------------------------------------------------------------

/** Typical urban weekday share of daily traffic per hour (sums to 1). */
const HOURLY_RAW = [0.2, 0.1, 0.1, 0.1, 0.2, 0.6, 1.8, 4.5, 6, 4, 2.6, 2.5, 2.8, 2.6, 2.4, 2.6, 3.4, 5, 5.6, 4, 2.4, 1.6, 1, 0.5];
const HOURLY_TOTAL = HOURLY_RAW.reduce((a, b) => a + b, 0);
export const HOURLY_SHARE = HOURLY_RAW.map((v) => v / HOURLY_TOTAL);

export function loadSegments(db) {
  return db.prepare('SELECT * FROM road_segments').all().map((s) => ({ ...s, coords: JSON.parse(s.coords) }));
}

function segmentIndex(segments) {
  const index = new GridIndex(0.005);
  for (const s of segments) {
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const [lon, lat] of s.coords) {
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    }
    // Register the segment in every grid cell its bounding box touches.
    const c = index.cell;
    for (let i = Math.floor(minLat / c); i <= Math.floor(maxLat / c); i++)
      for (let j = Math.floor(minLon / c); j <= Math.floor(maxLon / c); j++) {
        const k = index.key(i, j);
        if (!index.cells.has(k)) index.cells.set(k, []);
        index.cells.get(k).push(s);
      }
  }
  return index;
}

/**
 * For each billboard: find road segments within readable distance, keep the directions whose
 * drivers face the billboard, and add up their daily volumes. Consecutive pieces of the same
 * road going the same way are the same vehicles, so per (road name, heading) only the largest
 * volume counts; different roads or directions add up.
 */
function computeSegmentExposure(db, { hourFrom, hourTo }) {
  const segments = loadSegments(db);
  const billboards = loadBillboards(db);
  const index = segmentIndex(segments);
  const inWindow = (h) => (hourFrom <= hourTo ? h >= hourFrom && h <= hourTo : h >= hourFrom || h <= hourTo);
  const windowShare = HOURLY_SHARE.reduce((s, v, h) => s + (inWindow(h) ? v : 0), 0);

  let totalVehicles = 0, totalPeople = 0;
  for (const s of segments) { totalVehicles += s.vol_ab + s.vol_ba; totalPeople += (s.vol_ab + s.vol_ba) * (s.occupancy ?? 1.3); }

  const perBillboard = billboards.map((b) => {
    const pad = b.visibility_m / 111000 + 0.0005;
    const seen = new Set();
    const groups = new Map(); // key -> { vehicles, people, dwell, speed }
    for (const s of index.query(b.lat, b.lon, b.lat, b.lon, pad)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      let best = null;
      for (let i = 0; i < s.coords.length - 1; i++) {
        const [aLon, aLat] = s.coords[i], [bLon, bLat] = s.coords[i + 1];
        const { dist } = pointToSegment(b.lat, b.lon, aLat, aLon, bLat, bLon);
        if (!best || dist < best.dist) best = { dist, heading: bearing(aLat, aLon, bLat, bLon) };
      }
      if (!best || best.dist > b.visibility_m) continue;
      const speed = s.speed_kmh || 40;
      const chord = 2 * Math.sqrt(Math.max(0, b.visibility_m ** 2 - best.dist ** 2));
      const dwell = Math.min(120, chord / (speed / 3.6));
      for (const [vol, heading] of [[s.vol_ab, best.heading], [s.vol_ba, (best.heading + 180) % 360]]) {
        if (!(vol > 0)) continue;
        if (b.facing_azimuth != null && angleDiff(heading, (b.facing_azimuth + 180) % 360) > b.viewing_angle_deg) continue;
        const key = `${(s.name || '').toLowerCase()}|${Math.round(heading / 45) % 8}`;
        const g = groups.get(key);
        if (!g || vol > g.vehicles) groups.set(key, { vehicles: vol, people: vol * (s.occupancy ?? 1.3), dwell, speed });
      }
    }
    let vehicles = 0, people = 0, dwellW = 0, speedW = 0;
    for (const g of groups.values()) { vehicles += g.vehicles; people += g.people; dwellW += g.dwell * g.vehicles; speedW += g.speed * g.vehicles; }
    vehicles *= windowShare; people *= windowShare;
    const avgDwell = vehicles ? dwellW * windowShare / vehicles : 0;
    const vi = visibilityIndex(b, avgDwell);
    const shareOfVoice = b.media_type === 'digital' && b.slot_seconds && b.loop_seconds ? b.slot_seconds / b.loop_seconds : 1;
    const impressionsDay = people * vi * shareOfVoice;
    const priceMonth = b.price_month ?? (b.price_year ? b.price_year / 12 : b.price_week ? b.price_week * 4.33 : null);
    const dayPeople = people / (windowShare || 1);
    const hourly = HOURLY_SHARE.map((v, h) => (inWindow(h) ? dayPeople * v : 0));
    return {
      billboard_id: b.id,
      company_id: b.company_id,
      vehicles_per_day: round(vehicles),
      people_per_day: round(people),
      avg_dwell_s: round(avgDwell, 1),
      avg_speed_kmh: vehicles ? round(speedW * windowShare / vehicles) : null,
      visibility_index: round(vi, 2),
      share_of_voice: round(shareOfVoice, 3),
      impressions_per_day: round(impressionsDay),
      impressions_per_month: round(impressionsDay * 30),
      cpm: priceMonth && impressionsDay > 0 ? round((priceMonth / (impressionsDay * 30)) * 1000, 2) : null,
      hourly_people: hourly.map((v) => round(v, 1)),
      peak_hour: hourly.indexOf(Math.max(...hourly)),
      sample_trip_ids: [],
    };
  });
  rankRouteFit(perBillboard);
  return { days: 1, totalTrips: totalVehicles * windowShare, totalPeople: totalPeople * windowShare, perBillboard, tripHits: new Map(), billboards };
}

function findSegmentGaps(db, billboards, { cellM, radiusM, limit }) {
  const cellLat = cellM / 111000;
  const cells = new Map();
  for (const s of loadSegments(db)) {
    const vol = s.vol_ab + s.vol_ba;
    for (let i = 0; i < s.coords.length - 1; i++) {
      const [aLon, aLat] = s.coords[i], [bLon, bLat] = s.coords[i + 1];
      const n = Math.max(1, Math.ceil(haversine(aLat, aLon, bLat, bLon) / 100));
      for (let k = 0; k <= n; k++) {
        const lat = aLat + ((bLat - aLat) * k) / n, lon = aLon + ((bLon - aLon) * k) / n;
        const cellLon = cellM / (111000 * Math.cos((lat * Math.PI) / 180));
        const key = `${Math.floor(lat / cellLat)}:${Math.floor(lon / cellLon)}`;
        const c = cells.get(key);
        if (!c || vol > c.vehicles_per_day) cells.set(key, { lat, lon, vehicles_per_day: round(vol) });
      }
    }
  }
  const index = new GridIndex(0.01);
  for (const b of billboards) index.insert(b.lat, b.lon, b);
  const pad = radiusM / 111000;
  return [...cells.values()]
    .sort((a, b) => b.vehicles_per_day - a.vehicles_per_day)
    .filter((c) => !index.query(c.lat, c.lon, c.lat, c.lon, pad).some((b) => haversine(c.lat, c.lon, b.lat, b.lon) <= radiusM))
    .slice(0, limit);
}

function round(v, d = 0) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}
