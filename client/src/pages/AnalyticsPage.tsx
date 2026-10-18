import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { api } from '../lib/api';
import type { Billboard, Gap, Summary } from '../lib/types';
import { ROUTE_FIT, compact, money, nf } from '../lib/format';
import RouteFitBadge from '../components/RouteFitBadge';

export default function AnalyticsPage({ meta, companies, companyId, version }: Ctx) {
  const [s, setS] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Billboard[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);

  useEffect(() => {
    api.summary(companyId).then(setS);
    api.billboards(companyId).then(setRows);
    api.gaps(companyId, companyId ? undefined : 'market').then(setGaps);
  }, [companyId, version]);

  if (!s) return <div className="page hint">Computing…</div>;
  const name = companyId ? companies.find((c) => c.id === companyId)?.name : 'All companies';
  const best = [...rows].filter((b) => b.metrics.cpm != null).sort((a, b) => a.metrics.cpm! - b.metrics.cpm!).slice(0, 10);
  const weak = [...rows].filter((b) => b.metrics.route_fit === 'off-route' || b.metrics.route_fit === 'marginal')
    .sort((a, b) => (a.metrics.people_per_day ?? 0) - (b.metrics.people_per_day ?? 0)).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const expiring = rows.filter((b) => b.current_campaign && b.current_campaign.timing.remaining_days <= 30)
    .sort((a, b) => a.current_campaign!.timing.remaining_days - b.current_campaign!.timing.remaining_days);
  const permits = rows.filter((b) => b.permit_expires_at && b.permit_expires_at <= in90).sort((a, b) => a.permit_expires_at!.localeCompare(b.permit_expires_at!));
  const fitCounts = Object.keys(ROUTE_FIT).map((k) => [k, rows.filter((b) => b.metrics.route_fit === k).length] as const);

  const kpi = (label: string, value: string, sub?: string) => (
    <div className="kpi"><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>
  );

  return (
    <div className="page">
      <h2>Analytics · {name}</h2>
      <div className="kpis">
        {kpi('Billboards', nf(s.billboards), `${s.digital} digital · ${nf(s.surface_m2)} m²`)}
        {kpi('Daily reach', `${nf(s.reach_pct, 1)}%`, `${compact(s.reached_trips_per_day)} of ${compact(s.vehicle_trips_per_day)} vehicle trips/day`)}
        {kpi('Avg. frequency', nf(s.avg_frequency, 2), 'billboards seen per reached trip')}
        {kpi('Impressions / month', compact(s.impressions_per_month))}
        {kpi('Avg. CPM', money(s.avg_cpm, 'EUR', 2), 'list price / 1000 impressions')}
        {kpi('Occupancy', `${s.occupancy_pct}%`, `${s.running_campaigns} running campaigns`)}
        {kpi('List value / month', money(s.monthly_list_price))}
        {kpi('Weak locations', nf(s.off_route), 'marginal or off-route')}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <b>Fit with traffic flows:</b>
          {fitCounts.map(([k, n]) => <span key={k} className="badge"><span style={{ color: ROUTE_FIT[k].color }}>{ROUTE_FIT[k].icon}</span>{ROUTE_FIT[k].label}: {n}</span>)}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>Ranked against every billboard in the market by people passing per day. Data covers {s.days} days.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Best value (lowest CPM)</h3>
          <table className="data"><thead><tr><th>Billboard</th><th className="num">Imp./month</th><th className="num">CPM</th></tr></thead>
            <tbody>{best.map((b) => <tr key={b.id}><td>{b.name}<div className="hint">{meta.formats[b.format]?.label}</div></td><td className="num">{compact(b.metrics.impressions_per_month)}</td><td className="num">{money(b.metrics.cpm, b.currency, 2)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Weakest locations</h3>
          <div className="hint" style={{ marginBottom: 8 }}>Few vehicles pass in the readable direction — consider repricing, re-orienting or relocating.</div>
          <table className="data"><thead><tr><th>Billboard</th><th>Fit</th><th className="num">People/day</th><th className="num">Price/month</th></tr></thead>
            <tbody>{weak.map((b) => <tr key={b.id}><td>{b.name}<div className="hint">{b.code}</div></td><td><RouteFitBadge fit={b.metrics.route_fit} /></td><td className="num">{nf(b.metrics.people_per_day)}</td><td className="num">{money(b.price_month, b.currency)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Opportunity spots</h3>
          <div className="hint" style={{ marginBottom: 8 }}>Busiest ~300 m cells with no {companyId ? 'own ' : ''}billboard within 350 m. Turn on “Opportunity spots” on the map to see them.</div>
          <table className="data"><thead><tr><th>#</th><th>Location</th><th className="num">Vehicles/day</th></tr></thead>
            <tbody>{gaps.slice(0, 10).map((g, i) => <tr key={i}><td>{i + 1}</td><td><a href={`https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=17/${g.lat}/${g.lon}`} target="_blank" rel="noreferrer">{g.lat.toFixed(5)}, {g.lon.toFixed(5)}</a></td><td className="num">{nf(g.vehicles_per_day)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Campaigns ending within 30 days</h3>
          <table className="data"><thead><tr><th>Billboard</th><th>Advertiser</th><th className="num">Days left</th></tr></thead>
            <tbody>{expiring.slice(0, 12).map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.current_campaign!.advertiser}</td><td className="num">{b.current_campaign!.timing.remaining_days}</td></tr>)}</tbody>
          </table>
          {expiring.length === 0 && <div className="hint">None.</div>}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Permits expired or expiring in 90 days</h3>
          <table className="data"><thead><tr><th>Billboard</th><th>Permit</th><th>Expires</th></tr></thead>
            <tbody>{permits.slice(0, 12).map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.permit_number}</td><td style={{ color: b.permit_expires_at! < today ? 'var(--critical)' : undefined }}>{b.permit_expires_at! < today ? '⚠ ' : ''}{b.permit_expires_at}</td></tr>)}</tbody>
          </table>
          {permits.length === 0 && <div className="hint">None.</div>}
        </div>
      </div>
    </div>
  );
}
