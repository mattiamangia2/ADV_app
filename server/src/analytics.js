// Exposure engine: crosses vehicle trajectories with billboard positions.
//
// A trip "passes" a billboard when any segment of its path comes within the
// billboard's visibility distance AND the vehicle is driving towards the face
// (heading within the viewing cone). Each trip counts at most once per billboard.
// Results are scaled by the trip's panel weight and vehicle occupancy and
// normalised to an average day.

import { GridIndex, angleDiff, bearing, haversine, pointToSegment } from './geo.js';
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
export function computeExposure(db, { hourFrom = 0, hourTo = 23 } = {}) {
  const key = `${dataVersion}:${hourFrom}:${hourTo}`;
  if (cache.key === key) return cache.value;

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

  // Market-wide percentile -> how "on route" a billboard is.
  const sorted = perBillboard.map((p) => p.people_per_day).sort((a, b) => a - b);
  for (const p of perBillboard) {
    const rank = sorted.filter((v) => v <= p.people_per_day).length / Math.max(1, sorted.length);
    p.traffic_percentile = round(rank * 100);
    p.route_fit = p.people_per_day === 0 ? 'off-route' : rank >= 0.66 ? 'main flow' : rank >= 0.33 ? 'secondary' : 'marginal';
  }

  const value = { days: nDays, totalTrips, totalPeople, perBillboard, tripHits, billboards };
  cache = { key, value };
  return value;
}

/** Network-level reach for a set of billboards (e.g. one company's inventory). */
export function reachSummary(exposure, billboardIds) {
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

function round(v, d = 0) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}
