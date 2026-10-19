import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { invalidate } from '../src/analytics.js';

const j = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('bulk edit, ownership and summary only counting owned sites', async () => {
  invalidate();
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}/api`;
  try {
    const a = await (await fetch(`${base}/companies`, j('POST', { name: 'A' }))).json();
    const b = await (await fetch(`${base}/companies`, j('POST', { name: 'B' }))).json();
    const mk = async (cid, extra = {}) => (await (await fetch(`${base}/billboards?companyId=${cid}`, j('POST', { name: 'x', format: 'poster_6x3', lat: 45.46, lon: 9.19, price_month: 1000, ...extra }))).json()).id;
    const ids = [await mk(a.id), await mk(a.id), await mk(a.id)];
    const other = await mk(b.id);

    // Another company's site can't be bulk-edited
    let r = await fetch(`${base}/billboards/bulk?companyId=${a.id}`, j('POST', { ids: [ids[0], other], set: { status: 'inactive' } }));
    assert.equal(r.status, 403);
    // Invalid value rejected
    r = await fetch(`${base}/billboards/bulk?companyId=${a.id}`, j('POST', { ids, set: { status: 'sleeping' } }));
    assert.equal(r.status, 400);

    r = await fetch(`${base}/billboards/bulk?companyId=${a.id}`, j('POST', {
      ids, set: { status: 'inactive', min_booking_days: '7', name: 'ignored' }, price_adjust_pct: 10,
      extra_set: { landlord: 'Rossi' },
      add_campaign: { advertiser: 'Acme', start_date: '2026-01-01', end_date: '2099-01-01' },
    }));
    assert.deepEqual(await r.json(), { updated: 3, campaigns_added: 3, campaigns_ended: 0 });
    let list = await (await fetch(`${base}/billboards?companyId=${a.id}`)).json();
    assert.ok(list.every((x) => x.status === 'inactive' && x.price_month === 1100 && x.min_booking_days === 7 && x.name === 'x'));
    assert.ok(list.every((x) => x.extra.landlord === 'Rossi' && x.current_campaign?.advertiser === 'Acme'));

    // End running campaigns
    r = await (await fetch(`${base}/billboards/bulk?companyId=${a.id}`, j('POST', { ids, end_running_campaigns: true }))).json();
    assert.equal(r.campaigns_ended, 3);
    list = await (await fetch(`${base}/billboards?companyId=${a.id}`)).json();
    assert.ok(list.every((x) => x.current_campaign === null));

    // Mark two as "not ours": they drop out of the company's totals
    await fetch(`${base}/billboards/bulk?companyId=${a.id}`, j('POST', { ids: ids.slice(0, 2), set: { ownership: 'competitor', operator_name: 'Other Media' } }));
    const sum = await (await fetch(`${base}/analytics/summary?companyId=${a.id}`)).json();
    assert.equal(sum.billboards, 1);
    assert.equal(sum.not_owned, 2);
    assert.equal(sum.monthly_list_price, 1100);

    // Import as "sites that aren't ours"; an operator column makes it a competitor
    r = await (await fetch(`${base}/billboards/import?companyId=${a.id}&ownership=unknown`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'name,format,lat,lon,operator\nP1,backlit,45.47,9.2,\nP2,backlit,45.48,9.21,IGP\n' })).json();
    assert.equal(r.created, 2);
    list = await (await fetch(`${base}/billboards?companyId=${a.id}`)).json();
    assert.equal(list.find((x) => x.name === 'P1').ownership, 'unknown');
    assert.equal(list.find((x) => x.name === 'P2').ownership, 'competitor');
    assert.equal(list.find((x) => x.name === 'P2').operator_name, 'IGP');

    // Bulk delete
    r = await (await fetch(`${base}/billboards/bulk?companyId=${a.id}`, j('POST', { ids, delete: true }))).json();
    assert.equal(r.deleted, 3);
  } finally {
    server.close();
  }
});

test('existing databases get new columns added on start', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adv-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE billboards (id INTEGER PRIMARY KEY, company_id INTEGER, name TEXT NOT NULL, format TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL); INSERT INTO billboards (company_id, name, format, lat, lon) VALUES (1, 'old', 'poster_6x3', 45, 9);");
  old.close();
  const db = openDb(file);
  const row = db.prepare('SELECT * FROM billboards').get();
  assert.equal(row.ownership, 'owned');
  assert.equal(row.status, 'available');
  assert.ok('operator_name' in row);
});
