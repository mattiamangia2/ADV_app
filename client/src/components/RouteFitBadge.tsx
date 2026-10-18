import { ROUTE_FIT } from '../lib/format';

export default function RouteFitBadge({ fit }: { fit?: string }) {
  const f = fit ? ROUTE_FIT[fit] : null;
  if (!f) return <span className="badge">—</span>;
  return (
    <span className="badge" title="Based on market-wide traffic percentile of people passing per day">
      <span style={{ color: f.color }}>{f.icon}</span>
      {f.label}
    </span>
  );
}
