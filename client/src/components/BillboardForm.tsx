import { useState } from 'react';
import { api } from '../lib/api';
import type { Billboard, Campaign, Meta } from '../lib/types';
import { OWNERSHIP, money } from '../lib/format';

type Draft = Record<string, any>;
type Field = { k: string; label: string; type?: 'number' | 'text' | 'date' | 'select' | 'textarea' | 'checkbox' | 'url'; options?: [string, string][]; hint?: string; step?: string };

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function BillboardForm({ meta, companyId, initial, onClose, onSaved }: {
  meta: Meta; companyId: number; initial: Partial<Billboard>; onClose: () => void; onSaved: (b: Billboard) => void;
}) {
  const isNew = !initial.id;
  const [d, setD] = useState<Draft>(() => ({ status: 'available', ownership: 'owned', currency: 'EUR', viewing_angle_deg: 60, faces: 1, ...initial }));
  const [extra, setExtra] = useState<[string, string][]>(() => Object.entries(initial.extra || {}).filter(([k]) => k !== 'demo').map(([k, v]) => [k, String(v)]));
  const [campaigns, setCampaigns] = useState<Campaign[]>(initial.campaigns || []);
  const [newCp, setNewCp] = useState<Draft>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setD((p) => ({ ...p, [k]: v }));

  const fmt = meta.formats[d.format];
  const applyFormat = (key: string) => {
    const f = meta.formats[key] as any;
    setD((p) => ({
      ...p, format: key,
      media_type: f?.media_type ?? p.media_type,
      width_m: p.width_m ?? f?.width_m, height_m: p.height_m ?? f?.height_m,
      visibility_m: p.visibility_m ?? f?.visibility_m, material: p.material ?? f?.material,
      illuminated: p.illuminated ?? f?.illuminated, slot_seconds: p.slot_seconds ?? f?.slot_seconds, loop_seconds: p.loop_seconds ?? f?.loop_seconds,
    }));
  };
  const surface = d.width_m && d.height_m ? +(Number(d.width_m) * Number(d.height_m)).toFixed(2) : null;

  const save = async () => {
    setErr(null);
    setSaving(true);
    const extraObj = Object.fromEntries(extra.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]));
    const payload: Draft = { ...d, surface_m2: d.surface_m2 || surface, extra: extraObj };
    delete payload.metrics; delete payload.current_campaign; delete payload.campaigns; delete payload.id; delete payload.company_id;
    try {
      let b: Billboard;
      if (isNew) {
        if (newCp.advertiser) payload.campaigns = [newCp];
        b = await api.createBillboard(companyId, payload);
      } else {
        b = await api.updateBillboard(initial.id!, payload);
        if (newCp.advertiser) { await api.addCampaign(b.id, newCp); b = await api.billboard(b.id); }
      }
      onSaved(b);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    await api.deleteBillboard(initial.id!);
    onSaved({ ...(initial as Billboard) });
  };

  const input = (f: Field) => {
    const v = d[f.k] ?? '';
    let el;
    if (f.type === 'select') el = <select value={v} onChange={(e) => set(f.k, e.target.value)}><option value="">—</option>{f.options!.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>;
    else if (f.type === 'textarea') el = <textarea rows={3} value={v} onChange={(e) => set(f.k, e.target.value)} />;
    else if (f.type === 'checkbox') return <label key={f.k} className="toggle"><input type="checkbox" checked={!!d[f.k]} onChange={(e) => set(f.k, e.target.checked ? 1 : 0)} />{f.label}</label>;
    else el = <input type={f.type || 'text'} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} value={v}
      onChange={(e) => set(f.k, f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />;
    return <label key={f.k} className="field" style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>{f.label}{el}{f.hint && <span className="hint">{f.hint}</span>}</label>;
  };
  const group = (title: string, fields: Field[], extraNode?: React.ReactNode) => (
    <fieldset><legend>{title}</legend><div className="grid-form">{fields.map(input)}{extraNode}</div></fieldset>
  );

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={isNew ? 'New billboard' : 'Edit billboard'}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>{isNew ? 'New billboard' : `Edit · ${initial.name}`}</h3>
          <button className="btn small" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="hint">Empty fields fall back to the defaults of the chosen format.</div>

        <fieldset>
          <legend>Identity</legend>
          <div className="grid-form">
            {input({ k: 'name', label: 'Name *' })}
            {input({ k: 'code', label: 'Internal code' })}
            <label className="field">Format *
              <select value={d.format ?? ''} onChange={(e) => applyFormat(e.target.value)}>
                <option value="">—</option>
                {Object.entries(meta.formats).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
              </select>
            </label>
            {input({ k: 'media_type', label: 'Media type', type: 'select', options: [['static', 'Static (paper/vinyl)'], ['digital', 'Digital (screen)']] })}
            {input({ k: 'status', label: 'Status', type: 'select', options: meta.statuses.map((s) => [s, s]) })}
            {input({ k: 'ownership', label: 'Ownership', type: 'select', options: meta.ownerships.map((o) => [o, OWNERSHIP[o]?.label ?? o]), hint: 'Not-ours sites show grey on the map and stay out of your totals' })}
            {d.ownership && d.ownership !== 'owned' && input({ k: 'operator_name', label: 'Operator (who runs it)' })}
          </div>
        </fieldset>

        {group('Location & visibility', [
          { k: 'lat', label: 'Latitude *', type: 'number' },
          { k: 'lon', label: 'Longitude *', type: 'number' },
          { k: 'address', label: 'Address' },
          { k: 'city', label: 'City' },
          { k: 'road_name', label: 'Road' },
          { k: 'road_type', label: 'Road type', type: 'select', options: meta.roadTypes.map((r) => [r, r]) },
          { k: 'speed_limit_kmh', label: 'Speed limit (km/h)', type: 'number' },
          { k: 'visibility_m', label: 'Readable from (m)', type: 'number', hint: fmt ? `default ${fmt.visibility_m} m` : undefined },
          { k: 'viewing_angle_deg', label: 'Viewing half-angle (°)', type: 'number', hint: 'how far off-axis drivers can still read it' },
          { k: 'height_above_ground_m', label: 'Height above ground (m)', type: 'number' },
        ], (
          <label className="field">Facing direction (°)
            <div className="row">
              <input type="range" min={0} max={359} value={d.facing_azimuth ?? 0} disabled={d.facing_azimuth == null} onChange={(e) => set('facing_azimuth', Number(e.target.value))} style={{ flex: 1 }} />
              <span style={{ width: 70 }}>{d.facing_azimuth == null ? 'any' : `${d.facing_azimuth}° ${DIRS[Math.round(d.facing_azimuth / 45) % 8]}`}</span>
            </div>
            <label className="toggle hint"><input type="checkbox" checked={d.facing_azimuth == null} onChange={(e) => set('facing_azimuth', e.target.checked ? null : 0)} />visible from all sides</label>
            <span className="hint">Direction the face points to. Drivers heading the opposite way see it.</span>
          </label>
        ))}

        {group('Physical', [
          { k: 'width_m', label: 'Width (m)', type: 'number' },
          { k: 'height_m', label: 'Height (m)', type: 'number' },
          { k: 'surface_m2', label: 'Surface (m²)', type: 'number', hint: surface ? `computed: ${surface} m²` : undefined },
          { k: 'faces', label: 'Faces', type: 'number', step: '1' },
          { k: 'material', label: 'Material' },
          { k: 'illuminated', label: 'Illuminated', type: 'checkbox' },
        ])}

        {d.media_type === 'digital' && group('Digital', [
          { k: 'resolution', label: 'Resolution (px)' },
          { k: 'slot_seconds', label: 'Spot length (s)', type: 'number' },
          { k: 'loop_seconds', label: 'Loop length (s)', type: 'number', hint: d.slot_seconds && d.loop_seconds ? `${Math.round(d.loop_seconds / d.slot_seconds)} advertisers per loop` : undefined },
          { k: 'operating_hours', label: 'Operating hours', hint: 'e.g. 06:00-24:00' },
        ])}

        {group('Pricing', [
          { k: 'currency', label: 'Currency' },
          { k: 'price_week', label: 'Price / week', type: 'number' },
          { k: 'price_month', label: 'Price / month', type: 'number' },
          { k: 'price_year', label: 'Price / year', type: 'number', hint: d.price_month && !d.price_year ? `12 × month = ${money(d.price_month * 12, d.currency)}` : undefined },
          { k: 'production_cost', label: 'Production / install cost', type: 'number' },
          { k: 'min_booking_days', label: 'Minimum booking (days)', type: 'number', step: '1' },
        ])}

        {group('Administration', [
          { k: 'installed_at', label: 'Installed on', type: 'date' },
          { k: 'permit_number', label: 'Permit number' },
          { k: 'permit_expires_at', label: 'Permit expires', type: 'date' },
          { k: 'photo_url', label: 'Photo URL', type: 'url' },
          { k: 'notes', label: 'Notes', type: 'textarea' },
        ])}

        <fieldset>
          <legend>Campaigns</legend>
          {campaigns.length > 0 && (
            <table className="data" style={{ marginBottom: 12 }}>
              <thead><tr><th>Advertiser</th><th>Category</th><th>Period</th><th>State</th><th className="num">Paid</th><th /></tr></thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title || c.advertiser}<div className="hint">{c.advertiser}</div></td>
                    <td>{c.category}</td>
                    <td>{c.start_date} → {c.end_date}</td>
                    <td>{c.timing.state}{c.timing.state === 'running' ? ` · ${c.timing.remaining_days}d left` : ''}</td>
                    <td className="num">{money(c.price_paid, d.currency)}</td>
                    <td><button className="btn small danger" onClick={async () => { await api.deleteCampaign(c.id); setCampaigns(campaigns.filter((x) => x.id !== c.id)); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="hint" style={{ marginBottom: 8 }}>Add a campaign (saved with the billboard):</div>
          <div className="grid-form">
            {([['advertiser', 'Advertiser', 'text'], ['title', 'Campaign title', 'text'], ['start_date', 'Start', 'date'], ['end_date', 'End', 'date'], ['price_paid', 'Price paid', 'number'], ['creative_url', 'Creative URL', 'url']] as const).map(([k, l, t]) => (
              <label key={k} className="field">{l}<input type={t} value={newCp[k] ?? ''} onChange={(e) => setNewCp({ ...newCp, [k]: t === 'number' ? Number(e.target.value) : e.target.value })} /></label>
            ))}
            <label className="field">Category
              <select value={newCp.category ?? ''} onChange={(e) => setNewCp({ ...newCp, category: e.target.value })}>
                <option value="">—</option>{meta.categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Custom fields</legend>
          <div className="hint" style={{ marginBottom: 8 }}>Anything else worth tracking: lighting type, landlord, energy use, nearby POIs…</div>
          {extra.map(([k, v], i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input placeholder="Field" value={k} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
              <input placeholder="Value" value={v} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} style={{ flex: 1 }} />
              <button className="btn small" onClick={() => setExtra(extra.filter((_, j) => j !== i))} aria-label="Remove field">✕</button>
            </div>
          ))}
          <button className="btn small" onClick={() => setExtra([...extra, ['', '']])}>+ Add field</button>
        </fieldset>

        {err && <p className="error">{err}</p>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
          <div>{!isNew && <button className="btn danger" onClick={remove}>Delete billboard</button>}</div>
          <div className="row">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
