import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Billboard, BulkRequest, Meta } from '../lib/types';
import { OWNERSHIP } from '../lib/format';

type Kind = 'text' | 'number' | 'date' | 'select' | 'textarea';
type Field = { k: string; label: string; kind: Kind; options?: [string, string][]; hint?: string };

/** Change the same fields on many billboards at once. Only ticked fields are changed. */
export default function BulkEditModal({ meta, companyId, selected, onClose, onDone }: {
  meta: Meta; companyId: number; selected: Billboard[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [val, setVal] = useState<Record<string, any>>({});
  const [pct, setPct] = useState<number | ''>('');
  const [extraKey, setExtraKey] = useState('');
  const [extraVal, setExtraVal] = useState('');
  const [cp, setCp] = useState<Record<string, any>>({});
  const [addCp, setAddCp] = useState(false);
  const [endCp, setEndCp] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups: [string, Field[]][] = useMemo(() => [
    ['Status & ownership', [
      { k: 'status', label: 'Status', kind: 'select', options: meta.statuses.map((s) => [s, s]) },
      { k: 'ownership', label: 'Ownership', kind: 'select', options: meta.ownerships.map((o) => [o, OWNERSHIP[o]?.label ?? o]), hint: 'Not-ours sites stay on the map in grey and are left out of your totals' },
      { k: 'operator_name', label: 'Operator (who runs it)', kind: 'text' },
    ]],
    ['Pricing', [
      { k: 'currency', label: 'Currency', kind: 'text' },
      { k: 'price_week', label: 'Price / week', kind: 'number' },
      { k: 'price_month', label: 'Price / month', kind: 'number' },
      { k: 'price_year', label: 'Price / year', kind: 'number' },
      { k: 'production_cost', label: 'Production cost', kind: 'number' },
      { k: 'min_booking_days', label: 'Minimum booking (days)', kind: 'number' },
    ]],
    ['Format & physical', [
      { k: 'format', label: 'Format', kind: 'select', options: Object.entries(meta.formats).map(([k, f]) => [k, f.label]) },
      { k: 'media_type', label: 'Media type', kind: 'select', options: [['static', 'Static'], ['digital', 'Digital']] },
      { k: 'width_m', label: 'Width (m)', kind: 'number' },
      { k: 'height_m', label: 'Height (m)', kind: 'number' },
      { k: 'surface_m2', label: 'Surface (m²)', kind: 'number' },
      { k: 'faces', label: 'Faces', kind: 'number' },
      { k: 'illuminated', label: 'Illuminated', kind: 'select', options: [['1', 'Yes'], ['0', 'No']] },
      { k: 'material', label: 'Material', kind: 'text' },
      { k: 'visibility_m', label: 'Readable from (m)', kind: 'number' },
      { k: 'viewing_angle_deg', label: 'Viewing half-angle (°)', kind: 'number' },
    ]],
    ['Digital', [
      { k: 'resolution', label: 'Resolution', kind: 'text' },
      { k: 'slot_seconds', label: 'Spot length (s)', kind: 'number' },
      { k: 'loop_seconds', label: 'Loop length (s)', kind: 'number' },
      { k: 'operating_hours', label: 'Operating hours', kind: 'text' },
    ]],
    ['Location & admin', [
      { k: 'city', label: 'City', kind: 'text' },
      { k: 'road_type', label: 'Road type', kind: 'select', options: meta.roadTypes.map((r) => [r, r]) },
      { k: 'installed_at', label: 'Installed on', kind: 'date' },
      { k: 'permit_expires_at', label: 'Permit expires', kind: 'date' },
      { k: 'notes', label: 'Notes (replaces existing)', kind: 'textarea' },
    ]],
  ], [meta]);

  /** What the selected billboards currently have, e.g. "available ×3 · inactive ×1". */
  const current = (k: string) => {
    const counts = new Map<string, number>();
    for (const b of selected) {
      const v = (b as any)[k];
      const key = v == null || v === '' ? '—' : String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const shown = parts.slice(0, 3).map(([v, n]) => (parts.length === 1 ? v : `${v} ×${n}`)).join(' · ');
    return parts.length > 3 ? `${shown} · +${parts.length - 3} more` : shown;
  };

  const changes = Object.keys(on).filter((k) => on[k]).length + (pct !== '' && pct !== 0 ? 1 : 0) + (extraKey.trim() ? 1 : 0) + (addCp ? 1 : 0) + (endCp ? 1 : 0);

  const apply = async () => {
    setErr(null);
    const body: BulkRequest = { ids: selected.map((b) => b.id) };
    const set: Record<string, unknown> = {};
    for (const [k, enabled] of Object.entries(on)) if (enabled) set[k] = val[k] ?? null;
    if (Object.keys(set).length) body.set = set;
    if (pct !== '' && pct !== 0) body.price_adjust_pct = Number(pct);
    if (extraKey.trim()) body.extra_set = { [extraKey.trim()]: extraVal };
    if (endCp) body.end_running_campaigns = true;
    if (addCp) {
      if (!cp.advertiser || !cp.start_date || !cp.end_date) { setErr('The new campaign needs advertiser, start and end date.'); return; }
      body.add_campaign = cp;
    }
    setBusy(true);
    try {
      const r = await api.bulk(companyId, body);
      onDone(`Updated ${r.updated} billboards${r.campaigns_ended ? ` · ended ${r.campaigns_ended} running campaigns` : ''}${r.campaigns_added ? ` · added ${r.campaigns_added} campaigns` : ''}.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const input = (f: Field) => {
    const v = val[f.k] ?? '';
    const set = (x: unknown) => { setVal({ ...val, [f.k]: x }); setOn({ ...on, [f.k]: true }); };
    if (f.kind === 'select') return <select value={v} onChange={(e) => set(f.k === 'illuminated' ? Number(e.target.value) : e.target.value)}><option value="">—</option>{f.options!.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>;
    if (f.kind === 'textarea') return <textarea rows={2} value={v} onChange={(e) => set(e.target.value)} />;
    return <input type={f.kind} step={f.kind === 'number' ? 'any' : undefined} value={v} onChange={(e) => set(f.kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />;
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Edit selected billboards">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Edit {selected.length} selected billboards</h3>
          <button className="btn small" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="hint">Tick the fields to change. Unticked fields stay as they are. “Now” shows the values the selected sites currently have.</div>

        {groups.map(([title, fields]) => (
          <fieldset key={title}>
            <legend>{title}</legend>
            <table className="data bulk">
              <tbody>
                {fields.map((f) => (
                  <tr key={f.k} className={on[f.k] ? 'on' : ''}>
                    <td style={{ width: 28 }}><input type="checkbox" checked={!!on[f.k]} onChange={(e) => setOn({ ...on, [f.k]: e.target.checked })} aria-label={`Change ${f.label}`} /></td>
                    <td style={{ width: 190 }}>{f.label}{f.hint && <div className="hint">{f.hint}</div>}</td>
                    <td>{input(f)}</td>
                    <td className="hint" style={{ width: '30%' }}>Now: {current(f.k)}</td>
                  </tr>
                ))}
                {title === 'Pricing' && (
                  <tr className={pct !== '' && pct !== 0 ? 'on' : ''}>
                    <td />
                    <td>Adjust all prices by %<div className="hint">e.g. 5 = +5%, −10 = −10% (week, month, year)</div></td>
                    <td><input type="number" step="any" value={pct} onChange={(e) => setPct(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" /></td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </fieldset>
        ))}

        <fieldset>
          <legend>Campaigns</legend>
          <label className="toggle"><input type="checkbox" checked={endCp} onChange={(e) => setEndCp(e.target.checked)} /> End running campaigns now (sites become free)</label>
          <label className="toggle"><input type="checkbox" checked={addCp} onChange={(e) => setAddCp(e.target.checked)} /> Add the same campaign to all selected sites</label>
          {addCp && (
            <div className="grid-form" style={{ marginTop: 8 }}>
              {([['advertiser', 'Advertiser *', 'text'], ['title', 'Campaign title', 'text'], ['start_date', 'Start *', 'date'], ['end_date', 'End *', 'date'], ['price_paid', 'Price paid (per site)', 'number']] as const).map(([k, l, t]) => (
                <label key={k} className="field">{l}<input type={t} value={cp[k] ?? ''} onChange={(e) => setCp({ ...cp, [k]: t === 'number' ? Number(e.target.value) : e.target.value })} /></label>
              ))}
              <label className="field">Category
                <select value={cp.category ?? ''} onChange={(e) => setCp({ ...cp, category: e.target.value })}><option value="">—</option>{meta.categories.map((c) => <option key={c}>{c}</option>)}</select>
              </label>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Custom field</legend>
          <div className="row">
            <input placeholder="Field name (e.g. landlord)" value={extraKey} onChange={(e) => setExtraKey(e.target.value)} />
            <input placeholder="Value (empty = remove the field)" value={extraVal} onChange={(e) => setExtraVal(e.target.value)} style={{ flex: 1 }} />
          </div>
        </fieldset>

        {err && <p className="error">{err}</p>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <span className="hint">{changes} change{changes === 1 ? '' : 's'} on {selected.length} billboards</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || changes === 0} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</button>
        </div>
      </div>
    </div>
  );
}
