import { useEffect, useMemo, useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../lib/api';
import type { Billboard } from '../lib/types';
import { compact, money, nf } from '../lib/format';
import BillboardForm from '../components/BillboardForm';
import RouteFitBadge from '../components/RouteFitBadge';

type SortKey = 'name' | 'format' | 'surface' | 'price' | 'imp' | 'cpm' | 'campaign' | 'remaining';

const CSV_COLUMNS = ['code', 'name', 'format', 'media_type', 'status', 'lat', 'lon', 'address', 'city', 'road_name', 'road_type', 'facing_azimuth',
  'visibility_m', 'width_m', 'height_m', 'surface_m2', 'faces', 'illuminated', 'material', 'resolution', 'slot_seconds', 'loop_seconds',
  'currency', 'price_week', 'price_month', 'price_year', 'production_cost', 'min_booking_days', 'installed_at', 'permit_number', 'permit_expires_at', 'notes'];

export default function InventoryPage({ meta, companies, companyId, version, bump, reloadCompanies }: Ctx) {
  const [rows, setRows] = useState<Billboard[]>([]);
  const [q, setQ] = useState('');
  const [fmt, setFmt] = useState('');
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['imp', -1]);
  const [editing, setEditing] = useState<Billboard | 'new' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.billboards(companyId).then(setRows); }, [companyId, version]);

  const val = (b: Billboard, k: SortKey): string | number => ({
    name: b.name, format: b.format, surface: b.surface_m2 ?? 0, price: b.price_month ?? 0, imp: b.metrics.impressions_per_month ?? 0,
    cpm: b.metrics.cpm ?? Infinity, campaign: b.current_campaign?.advertiser ?? '', remaining: b.current_campaign?.timing.remaining_days ?? -1,
  })[k];
  const shown = useMemo(() => rows
    .filter((b) => !fmt || b.format === fmt)
    .filter((b) => !q || `${b.name} ${b.code} ${b.address} ${b.current_campaign?.advertiser ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => { const x = val(a, sort[0]), y = val(b, sort[0]); return (x < y ? -1 : x > y ? 1 : 0) * sort[1]; }), [rows, q, fmt, sort]);

  const th = (k: SortKey, label: string, num = false) => (
    <th className={num ? 'num' : ''} onClick={() => setSort([k, sort[0] === k ? (-sort[1] as 1 | -1) : -1])} aria-sort={sort[0] === k ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort[0] === k ? (sort[1] === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const importCsv = async (file: File) => {
    if (!companyId) return;
    const res = await api.importBillboards(companyId, await file.text());
    setMsg(`Imported ${res.created} billboards${res.errors.length ? `, ${res.errors.length} rows rejected (first: row ${res.errors[0].row}: ${res.errors[0].errors.join(', ')})` : ''}.`);
    bump(); reloadCompanies();
  };
  const exportCsv = () => {
    const esc = (v: unknown) => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [CSV_COLUMNS.join(','), ...shown.map((b) => CSV_COLUMNS.map((c) => esc((b as any)[c])).join(','))];
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

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Inventory {companyId ? `· ${companyName(companyId)}` : '· all companies'}</h2>
        <div className="row">
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          {companyId ? (
            <>
              <button className="btn" onClick={template}>CSV template</button>
              <label className="btn">Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label>
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
        <span className="hint">{shown.length} billboards</span>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
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
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id} onClick={() => (!companyId || b.company_id === companyId) && setEditing(b)} style={{ cursor: 'pointer' }}>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
