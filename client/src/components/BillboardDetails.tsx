import { Fragment } from 'react';
import type { Billboard, Meta } from '../lib/types';
import { OWNERSHIP, compact, hourLabel, money, nf } from '../lib/format';
import HourlyChart from './HourlyChart';
import RouteFitBadge from './RouteFitBadge';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (a: number | null) => (a == null ? 'all directions' : `${DIRS[Math.round(a / 45) % 8]} (${Math.round(a)}°)`);

export default function BillboardDetails({ b, meta, companyName, hours, onEdit, onClose }: {
  b: Billboard; meta: Meta; companyName?: string; hours?: [number, number]; onEdit?: () => void; onClose?: () => void;
}) {
  const m = b.metrics;
  const cc = b.current_campaign;
  const cur = b.currency || 'EUR';
  const extra = Object.entries(b.extra || {}).filter(([k]) => k !== 'demo');
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{b.name}</div>
          <div className="hint">{b.code} · {companyName} · {meta.formats[b.format]?.label ?? b.format}</div>
        </div>
        {onClose && <button className="btn small" onClick={onClose} aria-label="Close">✕</button>}
      </div>
      {b.photo_url && <img src={b.photo_url} alt="" style={{ width: '100%', borderRadius: 8, marginTop: 8 }} />}

      <section>
        <div className="row" style={{ margin: '10px 0' }}>
          <RouteFitBadge fit={m.route_fit} />
          {(b.ownership ?? 'owned') !== 'owned' && (
            <span className="badge"><span className="dot" style={{ background: OWNERSHIP[b.ownership].color }} />{OWNERSHIP[b.ownership].label}{b.operator_name ? ` · ${b.operator_name}` : ''}</span>
          )}
          <span className="badge">{b.status}</span>
          {b.media_type === 'digital' && <span className="badge">digital</span>}
        </div>
        <dl className="kv">
          <dt>Impressions / month</dt><dd><b>{compact(m.impressions_per_month)}</b></dd>
          <dt>People passing / day</dt><dd>{nf(m.people_per_day)}</dd>
          <dt>Vehicles / day</dt><dd>{nf(m.vehicles_per_day)}</dd>
          <dt>CPM (cost / 1000 imp.)</dt><dd>{money(m.cpm, cur, 2)}</dd>
          <dt>Avg. time in view</dt><dd>{nf(m.avg_dwell_s, 1)} s</dd>
          <dt>Avg. speed passing</dt><dd>{nf(m.avg_speed_kmh)} km/h</dd>
          <dt>Visibility index</dt><dd>{nf(m.visibility_index, 2)}</dd>
          {b.media_type === 'digital' && <><dt>Share of voice</dt><dd>{nf((m.share_of_voice ?? 1) * 100)}%</dd></>}
          <dt>Traffic percentile</dt><dd>{nf(m.traffic_percentile)}</dd>
          <dt>Peak hour</dt><dd>{m.peak_hour != null ? hourLabel(m.peak_hour) : '—'}</dd>
        </dl>
      </section>

      {m.hourly_people && (
        <section>
          <h3>People passing by hour (avg. day)</h3>
          <HourlyChart values={m.hourly_people} highlight={hours} />
        </section>
      )}

      <section>
        <h3>Current campaign</h3>
        {cc ? (
          <div>
            <div style={{ fontWeight: 600 }}>{cc.title || cc.advertiser}</div>
            <div className="hint">{cc.advertiser}{cc.category ? ` · ${cc.category}` : ''}</div>
            <div className="hint" style={{ margin: '6px 0 4px' }}>
              {cc.start_date} → {cc.end_date} · day {cc.timing.elapsed_days} of {cc.timing.duration_days} · {cc.timing.remaining_days} days left
            </div>
            <div className="progress"><div style={{ width: `${cc.timing.progress * 100}%` }} /></div>
          </div>
        ) : <div className="hint">No running campaign — site is free to book.</div>}
        {b.campaigns.length > (cc ? 1 : 0) && (
          <div className="hint" style={{ marginTop: 6 }}>{b.campaigns.length} campaigns in history</div>
        )}
      </section>

      <section>
        <h3>Site</h3>
        <dl className="kv">
          <dt>Size</dt><dd>{nf(b.width_m, 2)} × {nf(b.height_m, 2)} m ({nf(b.surface_m2, 1)} m²)</dd>
          <dt>Faces</dt><dd>{b.faces ?? 1}</dd>
          <dt>Facing</dt><dd>{compass(b.facing_azimuth)}</dd>
          <dt>Readable from</dt><dd>{nf(b.visibility_m)} m</dd>
          <dt>Illuminated</dt><dd>{b.illuminated ? 'yes' : 'no'}</dd>
          <dt>Material</dt><dd>{b.material || '—'}</dd>
          {b.media_type === 'digital' && <><dt>Slot / loop</dt><dd>{b.slot_seconds}s / {b.loop_seconds}s</dd><dt>Resolution</dt><dd>{b.resolution || '—'}</dd><dt>Hours</dt><dd>{b.operating_hours || '—'}</dd></>}
          <dt>Road</dt><dd>{b.road_name || '—'} {b.road_type ? `(${b.road_type})` : ''}</dd>
          <dt>Address</dt><dd>{b.address || '—'}</dd>
          <dt>Installed</dt><dd>{b.installed_at || '—'}</dd>
          <dt>Permit</dt><dd>{b.permit_number || '—'}{b.permit_expires_at ? ` (exp. ${b.permit_expires_at})` : ''}</dd>
        </dl>
      </section>

      <section>
        <h3>Pricing</h3>
        <dl className="kv">
          <dt>Per week</dt><dd>{money(b.price_week, cur)}</dd>
          <dt>Per month</dt><dd>{money(b.price_month, cur)}</dd>
          <dt>Per year</dt><dd>{money(b.price_year, cur)}</dd>
          <dt>Production</dt><dd>{money(b.production_cost, cur)}</dd>
          <dt>Min. booking</dt><dd>{b.min_booking_days ? `${b.min_booking_days} days` : '—'}</dd>
        </dl>
      </section>

      {extra.length > 0 && (
        <section>
          <h3>Custom fields</h3>
          <dl className="kv">{extra.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}</dl>
        </section>
      )}
      {b.notes && <section><h3>Notes</h3><div className="hint">{b.notes}</div></section>}
      {onEdit && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={onEdit}>Edit billboard</button></div>}
    </div>
  );
}
