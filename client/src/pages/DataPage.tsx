import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../lib/api';
import { compact, nf } from '../lib/format';
import SegmentImport from '../components/SegmentImport';

export default function DataPage({ version, bump }: Ctx) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.tripStats>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.tripStats().then(setStats); }, [version]);

  const upload = async (file: File) => {
    setBusy(true); setMsg(null);
    try {
      const text = await file.text();
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const r = await api.importTrips(text, isCsv);
      setMsg(`Imported ${r.imported} trips.`);
      bump();
    } catch (e) { setMsg(`Error: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const clear = async () => {
    if (!confirm('Delete ALL trips (including demo data)? Billboards are kept.')) return;
    await api.clearTrips(); bump();
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h2>Mobility data</h2>
      <div className="kpis">
        <div className="kpi"><div className="label">Sample trips</div><div className="value">{nf(stats?.trips)}</div></div>
        <div className="kpi"><div className="label">Represented trips</div><div className="value">{compact(stats?.weighted_trips)}</div><div className="sub">after panel weights</div></div>
        <div className="kpi"><div className="label">Distance</div><div className="value">{compact((stats?.distance_m ?? 0) / 1000)} km</div></div>
        <div className="kpi"><div className="label">Period</div><div className="value" style={{ fontSize: 14 }}>{stats?.first?.slice(0, 10) ?? '—'} → {stats?.last?.slice(0, 10) ?? '—'}</div></div>
      </div>

      <SegmentImport onDone={bump} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Upload GPS trips</h3>
        <div className="row">
          <label className="btn primary">{busy ? 'Uploading…' : 'Choose file (.geojson / .json / .csv)'}
            <input type="file" hidden accept=".geojson,.json,.csv" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <button className="btn danger" onClick={clear}>Delete all trips</button>
        </div>
        {msg && <p>{msg}</p>}
        <h4>Accepted formats</h4>
        <p><b>CSV of GPS pings</b> — one row per position, grouped by <code>trip_id</code>:</p>
        <pre className="card" style={{ overflow: 'auto' }}>trip_id,lat,lon,timestamp,weight,vehicle_type{'\n'}a1,45.4781,9.2270,2026-10-06T07:45:00+02:00,150,car{'\n'}a1,45.4775,9.2241,2026-10-06T07:45:20+02:00,150,car</pre>
        <p><b>GeoJSON</b> — a FeatureCollection of LineStrings. Put the time of each vertex in <code>properties.timestamps</code> (ISO or Unix seconds) or as the 3rd coordinate value. Optional properties: <code>weight</code>, <code>occupancy</code>, <code>vehicle_type</code>.</p>
        <p className="hint"><b>weight</b> = how many real vehicles one sample trip stands for (the panel expansion factor from your data provider). <b>occupancy</b> = people per vehicle (default 1.3).</p>
        <p className="hint">Typical sources: connected-car / fleet telematics, navigation-app panels, mobile-location SDK data, or your own GPS loggers. Always use anonymised, aggregated data that you are allowed to process under GDPR.</p>
        <p className="hint">Sample files are in the repository’s <code>samples/</code> folder. Step-by-step QGIS instructions: <code>docs/QGIS_GUIDE.md</code>.</p>
      </div>
    </div>
  );
}
