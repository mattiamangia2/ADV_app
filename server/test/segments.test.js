import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insert, setSetting } from '../src/db.js';
import { computeExposure, invalidate, reachSummary, findGaps, loadBillboards } from '../src/analytics.js';
import { parseSegments, billboardsFromGeoJson, normaliseBillboardRow } from '../src/ingest.js';

const line = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });

test('road volumes: direction, facing and no double counting along the same road', () => {
  invalidate();
  const db = openDb(':memory:');
  const c = insert(db, 'companies', { name: 'T' });
  // "Viale Test" drawn northwards, split into two pieces meeting next to the billboard.
  const fc = { type: 'FeatureCollection', features: [
    line([[9.19, 45.460], [9.19, 45.465]], { name: 'Viale Test', matrix_ab: 1000, matrix_ba: 400 }),
    line([[9.19, 45.465], [9.19, 45.470]], { name: 'Viale Test', matrix_ab: 900, matrix_ba: 380 }),
    // A cross street, east-west, two-way total volume, should add when visible
    line([[9.188, 45.4651], [9.192, 45.4651]], { nome: 'Via Traversa', tgm: 600 }),
  ] };
  const parsed = parseSegments(fc);
  assert.deepEqual(parsed.used, { ab: 'matrix_ab', ba: 'matrix_ba' });
  // matrix columns only exist on the first two features, so the cross street has 0 -> skipped
  assert.equal(parsed.rows.length, 2);
  const all = parseSegments(fc, { volumeField: 'tgm' });
  assert.equal(all.rows.length, 1);
  for (const r of [...parsed.rows, ...all.rows]) insert(db, 'road_segments', r);

  const base = { company_id: c, format: 'poster_6x3', lat: 45.465, lon: 9.1902, visibility_m: 100, price_month: 1000 };
  const facesSouth = insert(db, 'billboards', { ...base, name: 's', facing_azimuth: 180 }); // seen by northbound
  const facesNorth = insert(db, 'billboards', { ...base, name: 'n', facing_azimuth: 0 });   // seen by southbound
  const facesEast = insert(db, 'billboards', { ...base, name: 'e', facing_azimuth: 90 });   // seen by westbound
  const far = insert(db, 'billboards', { ...base, name: 'far', lat: 45.5, lon: 9.3 });

  const e = computeExposure(db);
  assert.equal(e.mode, 'segments');
  const m = Object.fromEntries(e.perBillboard.map((p) => [p.billboard_id, p]));
  assert.equal(m[facesSouth].vehicles_per_day, 1000); // max of 1000/900, not the sum
  assert.equal(m[facesNorth].vehicles_per_day, 400);
  assert.equal(m[facesEast].vehicles_per_day, 300);   // half of the 600 two-way cross street
  assert.equal(m[far].route_fit, 'off-route');
  assert.equal(m[facesSouth].people_per_day, 1300);
  assert.ok(m[facesSouth].cpm > 0);
  assert.equal(Math.round(m[facesSouth].hourly_people.reduce((a, b) => a + b, 0)), 1300);
  // Reach can't be measured from road volumes
  assert.equal(reachSummary(e, [facesSouth]).reach_pct, null);
  // Peak-hour filter reduces the volume
  const am = computeExposure(db, { hourFrom: 7, hourTo: 9 });
  assert.ok(am.perBillboard.find((p) => p.billboard_id === facesSouth).vehicles_per_day < 1000);
  // Gaps come from segments
  assert.ok(findGaps(db, loadBillboards(db).filter((b) => b.id === far)).length > 0);
  // Forcing GPS-trip mode switches back
  setSetting(db, 'traffic_source', 'trips'); invalidate();
  assert.equal(computeExposure(db).mode, 'trips');
});

test('oneway attribute and multiplier', () => {
  const r = parseSegments({ type: 'FeatureCollection', features: [line([[9, 45], [9, 45.01]], { volume: 100, oneway: 'yes' })] }, { multiplier: 10 });
  assert.equal(r.rows[0].vol_ab, 1000);
  assert.equal(r.rows[0].vol_ba, 0);
});

test('projected coordinates are rejected with a helpful message', () => {
  const fc = { type: 'FeatureCollection', features: [line([[514000, 5034000], [514100, 5034100]], { volume: 10 })] };
  assert.throws(() => parseSegments(fc), /EPSG:4326/);
  assert.throws(() => parseSegments({ ...fc, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32632' } } }), /32632/);
});

test('billboards from QuickOSM GeoJSON and QGIS CSV X/Y', () => {
  const rows = billboardsFromGeoJson({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { full_id: 'n123', advertising: 'billboard', lit: 'yes', direction: '270' }, geometry: { type: 'Point', coordinates: [9.2, 45.47] } },
    { type: 'Feature', properties: { highway: 'bus_stop', shelter: 'yes', name: 'Loreto' }, geometry: { type: 'Point', coordinates: [9.21, 45.48] } },
  ] });
  assert.equal(rows[0].format, 'poster_6x3');
  assert.equal(rows[0].illuminated, 1);
  assert.equal(rows[0].facing_azimuth, 270);
  assert.equal(rows[0].lat, 45.47);
  assert.match(rows[0].name, /OSM billboard/);
  assert.equal(rows[1].format, 'bus_shelter');
  assert.equal(rows[1].name, 'Loreto');
  const csv = normaliseBillboardRow({ X: '9,19', Y: '45.46', Name: 'From QGIS' });
  assert.equal(csv.lon, 9.19);
  assert.equal(csv.lat, 45.46);
  assert.equal(csv.format_assumed, 'yes');
});
