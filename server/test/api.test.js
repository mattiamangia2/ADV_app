import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { invalidate } from '../src/analytics.js';

test('billboard CRUD, ownership and campaigns', async () => {
  invalidate();
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}/api`;
  const j = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const a = await (await fetch(`${base}/companies`, j('POST', { name: 'A' }))).json();
    const b = await (await fetch(`${base}/companies`, j('POST', { name: 'B' }))).json();

    let r = await fetch(`${base}/billboards?companyId=${a.id}`, j('POST', { name: 'X', format: 'poster_6x3' }));
    assert.equal(r.status, 400); // lat/lon missing

    r = await fetch(`${base}/billboards?companyId=${a.id}`, j('POST', {
      name: 'X', format: 'poster_6x3', lat: 45.46, lon: 9.19, price_month: '900', extra: { landlord: 'Rossi' },
      campaigns: [{ advertiser: 'Acme', start_date: '2026-01-01', end_date: '2099-01-01' }],
    }));
    assert.equal(r.status, 201);
    const bb = await r.json();
    assert.equal(bb.width_m, 6); // format default
    assert.equal(bb.surface_m2, 18);
    assert.equal(bb.price_month, 900);
    assert.equal(bb.extra.landlord, 'Rossi');
    assert.equal(bb.current_campaign.advertiser, 'Acme');

    r = await fetch(`${base}/billboards/${bb.id}?companyId=${b.id}`, j('PUT', { name: 'hijack' }));
    assert.equal(r.status, 403);
    r = await fetch(`${base}/billboards/${bb.id}?companyId=${a.id}`, j('PUT', { name: 'Y', facing_azimuth: 400 }));
    assert.equal(r.status, 400);
    r = await fetch(`${base}/billboards/${bb.id}?companyId=${a.id}`, j('PUT', { name: 'Y' }));
    assert.equal((await r.json()).name, 'Y');

    r = await fetch(`${base}/billboards/import?companyId=${b.id}`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'name,format,lat,lon,landlord\nP1,backlit,45.47,9.2,Bianchi\nbad,backlit,,\n' });
    const imp = await r.json();
    assert.equal(imp.created, 1);
    assert.equal(imp.errors.length, 1);
    const listB = await (await fetch(`${base}/billboards?companyId=${b.id}`)).json();
    assert.equal(listB[0].extra.landlord, 'Bianchi');

    r = await fetch(`${base}/trips/import`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'trip_id,lat,lon,timestamp\nt,45.455,9.19,1759651200\nt,45.465,9.19,1759651300\n' });
    assert.equal((await r.json()).imported, 1);
    const sum = await (await fetch(`${base}/analytics/summary?companyId=${a.id}`)).json();
    assert.equal(sum.billboards, 1);
    assert.equal(sum.reach_pct, 100);

    r = await fetch(`${base}/billboards/${bb.id}?companyId=${a.id}`, { method: 'DELETE' });
    assert.equal(r.status, 204);
  } finally {
    server.close();
  }
});
