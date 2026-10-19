import { useEffect, useMemo, useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../lib/api';
import type { Billboard } from '../lib/types';
import { OWNERSHIP, compact, money, nf } from '../lib/format';
import BillboardForm from '../components/BillboardForm';
import BulkEditModal from '../components/BulkEditModal';
import RouteFitBadge from '../components/RouteFitBadge';

type SortKey = 'name' | 'format' | 'surface' | 'price' | 'imp' | 'cpm' | 'campaign' | 'remaining';

const CSV_COLUMNS = ['code', 'name', 'format', 'media_type', 'status', 'ownership', 'operator_name', 'lat', 'lon', 'address', 'city', 'road_name', 'road_type', 'facing_azimuth',
  'visibility_m', 'width_m', 'height_m', 'surface_m2', 'faces', 'illuminated', 'material', 'resolution', 'slot_seconds', 'loop_seconds',
  'currency', 'price_week', 'price_month', 'price_year', 'production_cost', 'min_booking_days', 'installed_at', 'permit_number', 'permit_expires_at', 'notes'];

export default function InventoryPage({ meta, companies, companyId, version, bump, reloadCompanies }: Ctx) {
  const [rows, setRows] = useState<Billboard[]>([]);
  const [q, setQ] = useState('');
  const [fmt, setFmt] = useState('');
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['imp', -1]);
  const [editing, setEditing] = useState<Billboard | 'new' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [own, setOwn] = useState('');
  const [status, setStatus] = useState('');
  const [importAs, setImportAs] = useState('owned');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => { api.billboards(companyId).then(setRows); }, [companyId, version]);
  useEffect(() => { setSel(new Set()); }, [companyId]);

  const val = (b: Billboard, k: SortKey): string | number => ({
    name: b.name, format: b.format, surface: b.surface_m2 ?? 0, price: b.price_month ?? 0, imp: b.metrics.impressions_per_month ?? 0,
    cpm: b.metrics.cpm ?? Infinity, campaign: b.current_campaign?.advertiser ?? '', remaining: b.current_campaign?.timing.remaining_days ?? -1,
  })[k];
  const shown = useMemo(() => rows
    .filter((b) => !fmt || b.format === fmt)
    .filter((b) => !own || (b.ownership ?? 'owned') === own)
    .filter((b) => !status || b.status === status)
    .filter((b) => !q || `${b.name} ${b.code} ${b.address} ${b.current_campaign?.advertiser ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => { const x = val(a, sort[0]), y = val(b, sort[0]); return (x < y ? -1 : x > y ? 1 : 0) * sort[1]; }), [rows, q, fmt, own, status, sort]);

  const th = (k: SortKey, label: string, num = false) => (
    <th className={num ? 'num' : ''} onClick={() => setSort([k, sort[0] === k ? (-sort[1] as 1 | -1) : -1])} aria-sort={sort[0] === k ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort[0] === k ? (sort[1] === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const importCsv = async (file: File) => {
    if (!companyId) return;
    try {
      const res = await api.importBillboards(companyId, await file.text(), file.name.toLowerCase().endsWith('.csv'), importAs);
      setMsg(`Imported ${res.created} billboards${res.assumed_format ? ` (${res.assumed_format} without a known format were set to 6×3 — check them)` : ''}${res.errors.length ? `, ${res.errors.length} rows rejected (first: row ${res.errors[0].row}: ${res.errors[0].errors.join(', ')})` : ''}.`);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
    bump(); reloadCompanies();
  };
  const exportCsv = () => {
    const esc = (v: unknown) => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const list = sel.size ? shown.filter((b) => sel.has(b.id)) : shown;
    const lines = [CSV_COLUMNS.join(','), ...list.map((b) => CSV_COLUMNS.map((c) => esc((b as any)[c])).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'billboards.csv';
    a.click();
  };
  const template = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${CSV_COLUMNS.join(',')}\nMI-001,Viale Monza 6x3,poster_6x3,static,available,45.4950,9.2190,"Viale Monza 120",Milano,Viale Monza,arterial,200,150,6,3,18,1,1,paper,,,,EUR,250,900,9500,220,14,2022-03-01,MI-PUB-2022-1234,2027-03-01,\n`], { type: 'text/csv' }));
    a.download = 'billboards_template.csv';
    a.click();
  };

  const companyName = (id: number) => companies.find((c) => c.id === id)?.name;

  // Selection: only sites of the selected company can be changed.
  const selectable = (b: Billboard) => !!companyId && b.company_id === companyId;
  const shownSelectable = shown.filter(selectable);
  const allShownSelected = shownSelectable.length > 0 && shownSelectable.every((b) => sel.has(b.id));
  const toggle = (id: number) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allShownSelected ? new Set() : new Set(shownSelectable.map((b) => b.id)));
  const selected = rows.filter((b) => sel.has(b.id));
  const bulkDelete = async () => {
    if (!companyId || !confirm(`Delete ${selected.length} billboards? This cannot be undone.`)) return;
    const r = await api.bulk(companyId, { ids: selected.map((b) => b.id), delete: true });
    setMsg(`Deleted ${r.deleted} billboards.`); setSel(new Set()); bump(); reloadCompanies();
  };
  const quick = async (set: Record<string, unknown>, label: string) => {
    if (!companyId) return;
    const r = await api.bulk(companyId, { ids: selected.map((b) => b.id), set });
    setMsg(`${label}: ${r.updated} billboards.`); bump();
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Inventory {companyId ? `· ${companyName(companyId)}` : '· all companies'}</h2>
        <div className="row">
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          {companyId ? (
            <>
              <button className="btn" onClick={template}>CSV template</button>
              <select value={importAs} onChange={(e) => setImportAs(e.target.value)} title="What the imported sites are" aria-label="Import as">
                <option value="owned">Import as: our sites</option>
                <option value="unknown">Import as: sites that aren't ours</option>
              </select>
              <label className="btn" title="CSV, or GeoJSON exported from QGIS / QuickOSM (EPSG:4326)">Import CSV / GeoJSON<input type="file" accept=".csv,.geojson,.json,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label>
              <button className="btn primary" onClick={() => setEditing('new')}>+ New billboard</button>
            </>
          ) : <span className="hint">Pick a company (top right) to add or import billboards.</span>}
        </div>
      </div>
      {msg && <p className="hint">{msg}</p>}
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Search name, code, address, advertiser…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
        <select value={fmt} onChange={(e) => setFmt(e.target.value)}>
          <option value="">All formats</option>
          {Object.entries(meta.formats).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
        <select value={own} onChange={(e) => setOwn(e.target.value)} aria-label="Ownership filter">
          <option value="">Ours and not ours</option>
          {Object.entries(OWNERSHIP).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option>
          {meta.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="hint">{shown.length} billboards</span>
      </div>
      {sel.size > 0 && (
        <div className="card bulk-bar">
          <b>{sel.size} selected</b>
          <button className="btn primary" onClick={() => setBulkOpen(true)}>Edit selected…</button>
          <button className="btn" onClick={() => quick({ status: 'available' }, 'Set to available')}>Set available</button>
          <button className="btn" onClick={() => quick({ status: 'inactive' }, 'Set to inactive')}>Set inactive</button>
          <button className="btn" onClick={() => quick({ ownership: 'unknown' }, 'Marked as not ours')}>Mark not ours</button>
          <button className="btn" onClick={() => quick({ ownership: 'owned' }, 'Marked as ours')}>Mark ours</button>
          <button className="btn" onClick={exportCsv}>Export selected</button>
          <button className="btn danger" onClick={bulkDelete}>Delete</button>
          <button className="btn" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 32 }} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={allShownSelected} disabled={!shownSelectable.length} onChange={toggleAll} aria-label="Select all shown" title={companyId ? 'Select all shown' : 'Pick a company to select'} />
              </th>
              {th('name', 'Billboard')}
              {th('format', 'Format')}
              {th('surface', 'Surface m²', true)}
              {th('price', 'Price / month', true)}
              {th('imp', 'Impressions / month', true)}
              {th('cpm', 'CPM', true)}
              <th>Route fit</th>
              {th('campaign', 'Current campaign')}
              {th('remaining', 'Days left', true)}
              <th>Status</th>
              <th>Ownership</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id} className={sel.has(b.id) ? 'selected' : ''} onClick={() => (!companyId || b.company_id === companyId) && setEditing(b)} style={{ cursor: 'pointer' }}>
                <td onClick={(e) => e.stopPropagation()}>
                  {selectable(b) && <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} aria-label={`Select ${b.name}`} />}
                </td>
                <td>{b.name}<div className="hint">{b.code}{!companyId ? ` · ${companyName(b.company_id)}` : ''}</div></td>
                <td>{meta.formats[b.format]?.label ?? b.format}</td>
                <td className="num">{nf(b.surface_m2, 1)}</td>
                <td className="num">{money(b.price_month, b.currency)}</td>
                <td className="num">{compact(b.metrics.impressions_per_month)}</td>
                <td className="num">{money(b.metrics.cpm, b.currency, 2)}</td>
                <td><RouteFitBadge fit={b.metrics.route_fit} /></td>
                <td>{b.current_campaign ? b.current_campaign.advertiser : <span className="hint">free</span>}</td>
                <td className="num">{b.current_campaign ? b.current_campaign.timing.remaining_days : '—'}</td>
                <td>{b.status}</td>
                <td>{(b.ownership ?? 'owned') === 'owned' ? 'ours' : <span className="badge"><span className="dot" style={{ background: OWNERSHIP[b.ownership].color }} />{OWNERSHIP[b.ownership].short}{b.operator_name ? ` · ${b.operator_name}` : ''}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bulkOpen && companyId && (
        <BulkEditModal
          meta={meta}
          companyId={companyId}
          selected={selected}
          onClose={() => setBulkOpen(false)}
          onDone={(m) => { setBulkOpen(false); setMsg(m); bump(); }}
        />
      )}
      {editing && (
        <BillboardForm
          meta={meta}
          companyId={editing === 'new' ? companyId! : (editing as Billboard).company_id}
          initial={editing === 'new' ? {} : (editing as Billboard)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); bump(); reloadCompanies(); }}
        />
      )}
    </div>
  );
}
