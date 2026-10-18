import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insert } from '../src/db.js';
import { computeExposure, invalidate, reachSummary } from '../src/analytics.js';
import { angleDiff, haversine, pointToSegment } from '../src/geo.js';
import { parseCsv, parsePings, parseGeoJson } from '../src/ingest.js';

test('geo helpers', () => {
  assert.ok(Math.abs(haversine(45.4642, 9.19, 45.4742, 9.19) - 1112) < 5);
  assert.equal(angleDiff(350, 10), 20);
  const { dist } = pointToSegment(45.0005, 9.0, 45.0, 8.999, 45.0, 9.001);
  assert.ok(Math.abs(dist - 55.6) < 1);
});

function setup() {
  invalidate();
  const db = openDb(':memory:');
  const c = insert(db, 'companies', { name: 'Test' });
  // A straight road heading north along lon 9.19, one trip per day for 2 days.
  const mkTrip = (startUnix, north = true) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const lat = 45.46 + (north ? i : 20 - i) * 0.0005;
      pts.push([9.19, lat, startUnix + i * 10]);
    }
    return { weight: 10, occupancy: 1.5, coords: JSON.stringify(pts) };
  };
  const t0 = Date.parse('2026-10-05T08:00:00+02:00') / 1000;
  insert(db, 'trips', mkTrip(t0));
  insert(db, 'trips', mkTrip(t0 + 86400));
  insert(db, 'trips', mkTrip(t0 + 3600, false)); // southbound
  const base = { company_id: c, format: 'poster_6x3', lat: 45.465, lon: 9.1902, visibility_m: 100, price_month: 1000 };
  // Faces south (180°): northbound drivers see it.
  const south = insert(db, 'billboards', { ...base, name: 'faces south', facing_azimuth: 180 });
  const north = insert(db, 'billboards', { ...base, name: 'faces north', facing_azimuth: 0 });
  const any = insert(db, 'billboards', { ...base, name: 'all sides', facing_azimuth: null });
  const far = insert(db, 'billboards', { ...base, name: 'far away', lat: 45.5, lon: 9.3 });
  return { db, c, south, north, any, far };
}

test('exposure respects facing direction and distance', () => {
  const { db, south, north, any, far } = setup();
  const e = computeExposure(db);
  const m = Object.fromEntries(e.perBillboard.map((p) => [p.billboard_id, p]));
  assert.equal(e.days, 2);
  // 2 northbound trips × weight 10 over 2 days = 10 vehicles/day
  assert.equal(m[south].vehicles_per_day, 10);
  assert.equal(m[south].people_per_day, 15);
  // 1 southbound trip × 10 / 2 days
  assert.equal(m[north].vehicles_per_day, 5);
  assert.equal(m[any].vehicles_per_day, 15);
  assert.equal(m[far].vehicles_per_day, 0);
  assert.equal(m[far].route_fit, 'off-route');
  assert.ok(m[south].cpm > 0);
  assert.equal(m[south].hourly_people[8], 15);
});

test('hour filter restricts trips', () => {
  const { db, north } = setup();
  const e = computeExposure(db, { hourFrom: 9, hourTo: 9 });
  assert.equal(e.perBillboard.find((p) => p.billboard_id === north).vehicles_per_day, 5);
  assert.equal(e.totalTrips, 10);
});

test('reach summary', () => {
  const { db, south } = setup();
  const r = reachSummary(computeExposure(db), [south]);
  assert.equal(r.reach_pct, 66.7);
  assert.equal(r.avg_frequency, 1);
});

test('ingest csv pings and geojson', () => {
  const rows = parseCsv('trip_id,lat,lon,timestamp\na,45.1,9.1,2026-10-05T08:00:00Z\na,45.2,9.1,2026-10-05T08:05:00Z\nb,45.1,9.1,1759651200\n');
  const trips = parsePings(rows);
  assert.equal(trips.length, 1); // trip b has a single point
  assert.ok(trips[0].distance_m > 11000);
  const gj = parseGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { weight: 5, timestamps: [1, 2] }, geometry: { type: 'LineString', coordinates: [[9, 45], [9.01, 45]] } }] });
  assert.equal(gj.length, 1);
  assert.equal(gj[0].weight, 5);
});
