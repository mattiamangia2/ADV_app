import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SegmentImportOptions, SegmentStats } from '../lib/types';
import { compact, nf } from '../lib/format';

type Parsed = { fc: any; name: string; count: number; numeric: string[]; text: string[] };

const guess = (fields: string[], cands: string[]) => fields.find((f) => cands.includes(f.toLowerCase())) ?? '';
const VOLUME = ['vehicles_per_day', 'veh_day', 'aadt', 'tgm', 'tgma', 'volume', 'flow', 'traffic', 'traffico', 'flusso', 'count', 'conteggio', 'matrix_tot', 'tot_flow', 'pce_tot', 'demand_tot'];

/** Upload road segments with traffic volumes (GeoJSON lines, e.g. from QGIS / AequilibraE). */
export default function SegmentImport({ onDone }: { onDone: () => void }) {
  const [stats, setStats] = useState<SegmentStats | null>(null);
  const [file, setFile] = useState<Parsed | null>(null);
  const [mode, setMode] = useState<'total' | 'directional'>('total');
  const [opt, setOpt] = useState<SegmentImportOptions>({ multiplier: 1, occupancy: 1.3, replace: true });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => api.segmentStats().then(setStats);
  useEffect(() => { refresh(); }, []);

  const read = async (f: File) => {
    setMsg(null);
    try {
      const fc = JSON.parse(await f.text());
      const feats = (fc.features ?? []).filter((x: any) => x?.geometry && /LineString/.test(x.geometry.type));
      if (!feats.length) throw new Error('no line features found — export the road layer as GeoJSON lines');
      const sample = feats.slice(0, 200);
      const keys = [...new Set(sample.flatMap((x: any) => Object.keys(x.properties ?? {})))] as string[];
      const isNum = (k: string) => sample.some((x: any) => x.properties?.[k] !== '' && x.properties?.[k] != null && Number.isFinite(Number(String(x.properties[k]).replace(',', '.'))));
      const numeric = keys.filter(isNum);
      const text = keys.filter((k) => !isNum(k));
      const ab = numeric.find((k) => /(^|_)ab$/i.test(k) && !/speed|time|cap|delay|voc/i.test(k));
      const ba = ab && numeric.find((k) => k.toLowerCase() === ab.toLowerCase().replace(/ab$/, 'ba'));
      setMode(ab && ba ? 'directional' : 'total');
      setOpt((o) => ({ ...o, abField: ab || '', baField: ba || '', volumeField: guess(numeric, VOLUME), nameField: guess(text, ['name', 'nome', 'road_name', 'denominazione', 'via', 'street']), speedField: guess(numeric, ['speed_kmh', 'speed', 'maxspeed', 'speed_ab', 'free_flow_speed']) }));
      setFile({ fc, name: f.name, count: feats.length, numeric, text });
    } catch (e) {
      setMsg(`Could not read the file: ${(e as Error).message}`);
      setFile(null);
    }
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true); setMsg(null);
    const options: SegmentImportOptions = { ...opt };
    if (mode === 'total') { delete options.abField; delete options.baField; } else delete options.volumeField;
    try {
      const r = await api.importSegments(file.fc, options);
      setMsg(`Imported ${nf(r.imported)} road segments${r.skipped ? ` (${nf(r.skipped)} skipped: no volume or no geometry)` : ''}. Volumes from ${Object.values(r.used).join(' / ')}.`);
      setFile(null); refresh(); onDone();
    } catch (e) { setMsg(`Import failed: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const setSource = async (v: 'auto' | 'trips' | 'segments') => { await api.setTrafficSource(v); refresh(); onDone(); };
  const clear = async () => { if (!confirm('Delete all imported road volumes?')) return; await api.clearSegments(); refresh(); onDone(); };
  const sel = (label: string, key: keyof SegmentImportOptions, fields: string[], hint?: string) => (
    <label className="field">{label}
      <select value={(opt[key] as string) ?? ''} onChange={(e) => setOpt({ ...opt, [key]: e.target.value })}>
        <option value="">—</option>{fields.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>{hint && <span className="hint">{hint}</span>}
    </label>
  );

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Road traffic volumes (vehicles per road segment)</h3>
      <p className="hint">GeoJSON lines with a traffic column — from QGIS (e.g. an AequilibraE traffic assignment), TomTom/HERE exports, ANAS or municipal counts. Export in <b>EPSG:4326</b>. See <code>docs/QGIS_GUIDE.md</code>.</p>

      <div className="row" style={{ marginBottom: 10 }}>
        <span className="hint">Loaded: <b>{nf(stats?.segments)}</b> segments{stats?.max_volume ? ` · busiest ${compact(stats.max_volume)} vehicles/day` : ''}</span>
        <label className="row hint">Analytics use
          <select value={stats?.source_setting ?? 'auto'} onChange={(e) => setSource(e.target.value as any)}>
            <option value="auto">Auto (road volumes if loaded)</option>
            <option value="trips">GPS trips</option>
            <option value="segments">Road volumes</option>
          </select>
        </label>
        <span className="badge">now: {stats?.mode === 'segments' ? 'road volumes' : 'GPS trips'}</span>
        {!!stats?.segments && <button className="btn small danger" onClick={clear}>Delete road volumes</button>}
      </div>

      <label className="btn">Choose GeoJSON…<input type="file" hidden accept=".geojson,.json" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} /></label>

      {file && (
        <div style={{ marginTop: 12 }}>
          <div className="hint" style={{ marginBottom: 8 }}><b>{file.name}</b>: {nf(file.count)} lines · numeric columns: {file.numeric.join(', ') || 'none'}</div>
          <div className="row" style={{ marginBottom: 8 }}>
            <label className="toggle"><input type="radio" checked={mode === 'total'} onChange={() => setMode('total')} /> One column with the total</label>
            <label className="toggle"><input type="radio" checked={mode === 'directional'} onChange={() => setMode('directional')} /> Two columns, one per direction (AB / BA)</label>
          </div>
          <div className="grid-form">
            {mode === 'total'
              ? sel('Traffic volume column *', 'volumeField', file.numeric, 'split 50/50 unless a “oneway” column says otherwise')
              : <>{sel('Volume A→B (drawing direction) *', 'abField', file.numeric)}{sel('Volume B→A *', 'baField', file.numeric)}</>}
            {sel('Road name column', 'nameField', file.text)}
            {sel('Speed column (km/h)', 'speedField', file.numeric, 'used for time in view; default 40')}
            <label className="field">The numbers are…
              <select value={String(opt.multiplier)} onChange={(e) => setOpt({ ...opt, multiplier: Number(e.target.value) })}>
                <option value="1">vehicles per day</option>
                <option value="10">vehicles in the peak hour (×10 ≈ day)</option>
                <option value={String(1 / 365)}>vehicles per year (÷365)</option>
              </select>
            </label>
            <label className="field">People per vehicle<input type="number" step="0.1" value={opt.occupancy} onChange={(e) => setOpt({ ...opt, occupancy: Number(e.target.value) })} /></label>
            <label className="toggle"><input type="checkbox" checked={!!opt.replace} onChange={(e) => setOpt({ ...opt, replace: e.target.checked })} /> Replace roads already loaded</label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy || (mode === 'total' ? !opt.volumeField : !(opt.abField && opt.baField))} onClick={submit}>{busy ? 'Importing…' : 'Import road volumes'}</button>
            <button className="btn" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p>{msg}</p>}
    </div>
  );
}
