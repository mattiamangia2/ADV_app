import { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ArcLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { HeatmapLayer, HexagonLayer } from '@deck.gl/aggregation-layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { MapController } from '@deck.gl/core';
import type { PickingInfo } from '@deck.gl/core';
import { Map } from 'react-map-gl/maplibre';
import type { Ctx } from '../App';
import { api } from '../lib/api';
import type { Billboard, Flow, Gap, Metrics, Segment, Trip } from '../lib/types';
import { ROUTE_FIT, SEQ_BLUE, SERIES, compact, hexToRgb, hourLabel, nf } from '../lib/format';
import BillboardDetails from '../components/BillboardDetails';
import BillboardForm from '../components/BillboardForm';

// Base maps: all real cartography of Milan from OpenStreetMap (via CARTO) or Esri satellite imagery.
const satellite = {
  version: 8 as const,
  sources: {
    esri: {
      type: 'raster' as const, tileSize: 256, maxzoom: 19,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    labels: {
      type: 'raster' as const, tileSize: 256,
      tiles: ['https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png'],
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'esri', type: 'raster' as const, source: 'esri' }, { id: 'labels', type: 'raster' as const, source: 'labels' }],
};
const BASEMAPS: Record<string, { label: string; style: any }> = {
  dark: { label: 'Dark (streets)', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  streets: { label: 'Streets (colour)', style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
  light: { label: 'Light', style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
  satellite: { label: 'Satellite', style: satellite },
};

/** Left-drag pans; middle-button (wheel click) drag tilts and rotates. Right-drag also tilts. */
class WheelTiltController extends MapController {
  _onPanStart(event: any) {
    if (event.middleButton) event.rightButton = true;
    return super._onPanStart(event);
  }
}
const CONTROLLER = { type: WheelTiltController, dragRotate: true, touchRotate: true };
const readPref = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const INITIAL_VIEW = { longitude: 9.19, latitude: 45.4642, zoom: 11.3, pitch: 35, bearing: 0 };

type Layers = { roads: boolean; heatmap: boolean; hexagons: boolean; trips: boolean; flows: boolean; billboards: boolean; gaps: boolean };
type ColorBy = 'company' | 'route_fit';
type Pt = { position: [number, number]; weight: number; hour: number };

const secOfDay = (t: number) => { const d = new Date(t * 1000); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };

/** Polygon approximating the readable cone in front of a billboard. */
function viewCone(b: Billboard): [number, number][] {
  const R = 6371008.8, toRad = Math.PI / 180;
  const pts: [number, number][] = [[b.lon, b.lat]];
  const az = b.facing_azimuth, half = az == null ? 180 : b.viewing_angle_deg;
  const center = az ?? 0;
  for (let a = -half; a <= half; a += half / 12) {
    const brng = (center + a) * toRad, d = b.visibility_m / R, la1 = b.lat * toRad, lo1 = b.lon * toRad;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brng));
    const lo2 = lo1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    pts.push([lo2 / toRad, la2 / toRad]);
  }
  return pts;
}

export default function MapPage({ meta, companies, companyId, version, bump }: Ctx) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  const [metrics, setMetrics] = useState<Metrics[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [mode, setMode] = useState<'trips' | 'segments'>('trips');
  const [basemap, setBasemap] = useState(() => readPref('basemap', 'dark'));
  useEffect(() => { try { localStorage.setItem('basemap', basemap); } catch { /* ignore */ } }, [basemap]);
  const [layers, setLayers] = useState<Layers>({ roads: true, heatmap: true, hexagons: false, trips: false, flows: false, billboards: true, gaps: false });
  const [colorBy, setColorBy] = useState<ColorBy>('route_fit');
  const [onlyMine, setOnlyMine] = useState(false);
  const [hours, setHours] = useState<[number, number]>([0, 23]);
  const [selected, setSelected] = useState<Billboard | null>(null);
  const [selectedTrips, setSelectedTrips] = useState<Trip[]>([]);
  const [editing, setEditing] = useState<Billboard | 'new' | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [newPos, setNewPos] = useState<[number, number] | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 760);
  const [hover, setHover] = useState<PickingInfo | null>(null);
  const [time, setTime] = useState(8 * 3600);
  const [playing, setPlaying] = useState(true);
  const raf = useRef<number>();

  useEffect(() => { api.trips({ limit: 5000 }).then(setTrips); api.flows().then((f) => setFlows(f.slice(0, 150))); }, [version]);
  useEffect(() => { api.billboards().then(setBillboards); }, [version]);
  useEffect(() => { api.segments().then(setSegments); api.segmentStats().then((st) => setMode(st.mode)); }, [version]);
  useEffect(() => { api.metrics(null, { hourFrom: hours[0], hourTo: hours[1] }).then(setMetrics); }, [version, hours]);
  useEffect(() => { api.gaps(companyId, companyId ? undefined : 'market').then(setGaps); }, [version, companyId]);

  // Animate trips over a 24h clock.
  useEffect(() => {
    if (!layers.trips || !playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      setTime((t) => (t + (now - last) * 0.6) % 86400); // ~40 s per simulated day
      last = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [layers.trips, playing]);

  // Load the trips that pass the selected billboard.
  useEffect(() => {
    if (!selected) { setSelectedTrips([]); return; }
    api.billboard(selected.id).then((b) => api.trips({ ids: b.sample_trip_ids?.slice(0, 300) })).then(setSelectedTrips);
  }, [selected?.id, version]);

  const inHours = (h: number) => (hours[0] <= hours[1] ? h >= hours[0] && h <= hours[1] : h >= hours[0] || h <= hours[1]);

  const allPoints = useMemo<Pt[]>(() => {
    const pts: Pt[] = [];
    for (const t of trips) for (let i = 0; i < t.path.length; i += 2) {
      const p = t.path[i];
      pts.push({ position: [p[0], p[1]], weight: t.weight, hour: new Date(p[2] * 1000).getHours() });
    }
    return pts;
  }, [trips]);
  // With imported road volumes, the heatmap samples points along each road weighted by its volume.
  const segmentPoints = useMemo<Pt[]>(() => {
    const pts: Pt[] = [];
    for (const s of segments) for (let i = 0; i < s.path.length - 1; i++) {
      const [a, b] = [s.path[i], s.path[i + 1]];
      const n = Math.max(1, Math.round(Math.hypot((b[0] - a[0]) * 78000, (b[1] - a[1]) * 111000) / 80));
      for (let k = 0; k < n; k++) pts.push({ position: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], weight: s.vehicles_per_day / 100, hour: -1 });
    }
    return pts;
  }, [segments]);
  const points = useMemo(() => (mode === 'segments' ? segmentPoints : allPoints.filter((p) => inHours(p.hour))), [mode, segmentPoints, allPoints, hours]);
  const maxSeg = Math.max(1, ...segments.map((s) => s.vehicles_per_day));

  const metricById = useMemo(() => new globalThis.Map(metrics.map((m) => [m.billboard_id, m])), [metrics]);
  const companyColor = useMemo(() => {
    const ids = [...companies].sort((a, b) => a.id - b.id).map((c) => c.id);
    return (id: number) => hexToRgb(SERIES[ids.indexOf(id) % SERIES.length] || SERIES[0]);
  }, [companies]);
  const companyName = (id: number) => companies.find((c) => c.id === id)?.name;
  const shownBillboards = useMemo(
    () => billboards.filter((b) => !onlyMine || !companyId || b.company_id === companyId).map((b) => ({ ...b, metrics: metricById.get(b.id) ?? b.metrics })),
    [billboards, metricById, onlyMine, companyId],
  );
  const maxFlow = Math.max(1, ...flows.map((f) => f.per_day));
  const maxImp = Math.max(1, ...shownBillboards.map((b) => b.metrics.impressions_per_day ?? 0));
  const tripData = useMemo(() => trips.map((t) => ({ path: t.path.map((p) => [p[0], p[1]] as [number, number]), ts: t.path.map((p) => secOfDay(p[2])) })), [trips]);

  const deckLayers = [
    layers.roads && segments.length > 0 && new PathLayer<Segment>({
      id: 'roads', data: segments, getPath: (d) => d.path,
      getColor: (d) => { const t = Math.sqrt(d.vehicles_per_day / maxSeg); const c = SEQ_BLUE[Math.min(SEQ_BLUE.length - 1, 1 + Math.floor(t * (SEQ_BLUE.length - 1)))]; return [...c, 230] as [number, number, number, number]; },
      getWidth: (d) => 1 + 7 * Math.sqrt(d.vehicles_per_day / maxSeg), widthUnits: 'pixels', capRounded: true, jointRounded: true, pickable: true,
      updateTriggers: { getColor: [maxSeg], getWidth: [maxSeg] },
    }),
    layers.heatmap && new HeatmapLayer<Pt>({
      id: 'heat', data: points, getPosition: (d) => d.position, getWeight: (d) => d.weight,
      radiusPixels: 28, intensity: 1, threshold: 0.04, colorRange: SEQ_BLUE, aggregation: 'SUM',
    }),
    layers.hexagons && new HexagonLayer<Pt>({
      id: 'hex', data: points, getPosition: (d) => d.position, getElevationWeight: (d) => d.weight, getColorWeight: (d) => d.weight,
      elevationAggregation: 'SUM', colorAggregation: 'SUM', radius: 200, extruded: true, elevationScale: 0.4,
      colorRange: SEQ_BLUE.slice(1), coverage: 0.9, opacity: 0.8, pickable: true,
    }),
    layers.flows && new ArcLayer<Flow>({
      id: 'flows', data: flows, getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to,
      getSourceColor: [57, 135, 229, 140], getTargetColor: [217, 89, 38, 140], getWidth: (d) => 0.5 + 4 * (d.per_day / maxFlow), widthUnits: 'pixels', greatCircle: false,
      pickable: true,
    }),
    layers.trips && new TripsLayer<(typeof tripData)[number]>({
      id: 'trips', data: tripData, getPath: (d) => d.path, getTimestamps: (d) => d.ts, getColor: [109, 167, 236],
      widthMinPixels: 2, trailLength: 600, currentTime: time, fadeTrail: true, capRounded: true, jointRounded: true,
    }),
    selected && new SolidPolygonLayer({
      id: 'cone', data: [{ polygon: viewCone(selected) }], getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
      getFillColor: [250, 178, 25, 60],
    }),
    selected && selectedTrips.length > 0 && new PathLayer<Trip>({
      id: 'sel-trips', data: selectedTrips, getPath: (d) => d.path.map((p) => [p[0], p[1]] as [number, number]),
      getColor: [250, 178, 25, 70], widthMinPixels: 2,
    }),
    layers.gaps && new ScatterplotLayer<Gap>({
      id: 'gaps', data: gaps, getPosition: (d) => [d.lon, d.lat], getRadius: 180, stroked: true, filled: true,
      getFillColor: [144, 133, 233, 40], getLineColor: [144, 133, 233, 255], lineWidthMinPixels: 2, pickable: true,
      parameters: { depthCompare: 'always' },
    }),
    layers.billboards && new ScatterplotLayer<Billboard>({
      id: 'billboards', data: shownBillboards, getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 5 + 9 * Math.sqrt((d.metrics.impressions_per_day ?? 0) / maxImp), radiusUnits: 'pixels',
      getFillColor: (d) => {
        const c = colorBy === 'company' ? companyColor(d.company_id) : hexToRgb(ROUTE_FIT[d.metrics.route_fit ?? 'off-route'].color);
        const dim = companyId && d.company_id !== companyId ? 90 : 255;
        return [...c, dim] as [number, number, number, number];
      },
      stroked: true, getLineColor: (d) => (selected?.id === d.id ? [255, 255, 255, 255] : [26, 26, 25, 255]), lineWidthMinPixels: 2,
      parameters: { depthCompare: 'always' }, pickable: true, updateTriggers: { getFillColor: [colorBy, companyId, companyColor], getLineColor: [selected?.id], getRadius: [maxImp] },
    }),
    newPos && new ScatterplotLayer({ id: 'newpos', data: [newPos], getPosition: (d: [number, number]) => d, getRadius: 8, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 255] }),
  ].filter(Boolean);

  const onClick = (info: PickingInfo) => {
    if (pickMode && info.coordinate) {
      setNewPos([info.coordinate[0], info.coordinate[1]]);
      setPickMode(false);
      setEditing('new');
      return;
    }
    if (info.layer?.id === 'billboards' && info.object) setSelected(info.object as Billboard);
    else if (!info.object) setSelected(null);
  };

  const tooltip = () => {
    if (!hover?.object || hover.x == null) return null;
    const o = hover.object as any;
    let body: React.ReactNode = null;
    if (hover.layer?.id === 'billboards') {
      const b = o as Billboard, f = ROUTE_FIT[b.metrics.route_fit ?? 'off-route'];
      body = <><b>{b.name}</b><div className="hint">{companyName(b.company_id)}</div>
        <div><span style={{ color: f.color }}>{f.icon}</span> {f.label} · {compact(b.metrics.impressions_per_month)} imp./month</div>
        {b.current_campaign && <div className="hint">Now: {b.current_campaign.advertiser}</div>}</>;
    } else if (hover.layer?.id === 'gaps') body = <><b>Opportunity spot</b><div>{nf(o.vehicles_per_day)} vehicles/day, no {companyId ? 'own ' : ''}billboard within 350 m</div></>;
    else if (hover.layer?.id === 'flows') body = <><b>Flow</b><div>{nf(o.per_day, 1)} vehicle trips/day (sample)</div></>;
    else if (hover.layer?.id === 'roads') body = <><b>{o.name || 'Road segment'}</b><div>{nf(o.vehicles_per_day)} vehicles/day</div><div className="hint">{nf(o.vol_ab)} one way · {nf(o.vol_ba)} the other</div></>;
    else if (hover.layer?.id === 'hex') body = <><b>Traffic cell</b><div>{nf(o.elevationValue)} weighted GPS points</div></>;
    if (!body) return null;
    return <div className="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>{body}</div>;
  };

  const toggle = (k: keyof Layers, label: string, hint?: string) => (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {label}
    </label>
  );

  const hourOpts = Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>);

  return (
    <div
      className="map-page"
      // Stop the browser's auto-scroll icon when the wheel button is pressed, so it can tilt the map.
      onMouseDownCapture={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClick={(e) => e.preventDefault()}
    >
      <DeckGL
        initialViewState={INITIAL_VIEW}
        controller={CONTROLLER}
        layers={deckLayers}
        onClick={onClick}
        onHover={setHover}
        getCursor={({ isDragging, isHovering }) => (pickMode ? 'crosshair' : isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
      >
        <Map mapStyle={BASEMAPS[basemap]?.style ?? BASEMAPS.dark.style} />
      </DeckGL>
      {tooltip()}

      {!panelOpen && <button className="btn panel-btn" onClick={() => setPanelOpen(true)}>☰ Layers</button>}
      {panelOpen && <div className="panel left">
        <section>
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>Layers</h3><button className="btn small" onClick={() => setPanelOpen(false)} aria-label="Hide panel">Hide</button></div>
          {segments.length > 0 && toggle('roads', 'Road traffic volumes', 'Imported vehicles per day on each road segment')}
          {toggle('heatmap', 'Traffic heatmap', mode === 'segments' ? 'From imported road volumes' : 'Density of vehicle GPS points, weighted by panel expansion')}
          {toggle('hexagons', '3D traffic hexagons')}
          {toggle('trips', 'Animated trips')}
          {toggle('flows', 'Origin → destination flows')}
          {toggle('billboards', 'Billboards')}
          {toggle('gaps', 'Opportunity spots', 'Busy places without a billboard nearby')}
        </section>
        {layers.trips && (
          <section>
            <h3>Clock</h3>
            <div className="row">
              <button className="btn small" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
              <b>{hourLabel(Math.floor(time / 3600)).slice(0, 2)}:{String(Math.floor((time % 3600) / 60)).padStart(2, '0')}</b>
            </div>
            <input type="range" min={0} max={86399} value={time} onChange={(e) => setTime(Number(e.target.value))} style={{ width: '100%' }} aria-label="Time of day" />
          </section>
        )}
        <section>
          <h3>Base map</h3>
          <select value={basemap} onChange={(e) => setBasemap(e.target.value)} aria-label="Base map" style={{ width: '100%' }}>
            {Object.entries(BASEMAPS).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
          </select>
          <div className="hint" style={{ marginTop: 6 }}>Drag: move · Wheel: zoom · Wheel-click drag (or right-drag): tilt &amp; rotate</div>
        </section>
        <section>
          <h3>Time of day</h3>
          <div className="row">
            <select value={hours[0]} onChange={(e) => setHours([Number(e.target.value), hours[1]])} aria-label="From hour">{hourOpts}</select>
            →
            <select value={hours[1]} onChange={(e) => setHours([hours[0], Number(e.target.value)])} aria-label="To hour">{hourOpts}</select>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {([['All day', 0, 23], ['AM peak', 7, 9], ['PM peak', 17, 19], ['Night', 21, 5]] as const).map(([l, a, b]) => (
              <button key={l} className="btn small" onClick={() => setHours([a, b])}>{l}</button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{mode === 'segments' ? 'Recomputes billboard exposure using a typical daily traffic profile.' : 'Filters the heatmap and recomputes billboard exposure.'}</div>
          <div className="hint" style={{ marginTop: 4 }}>Traffic source: <b>{mode === 'segments' ? 'road volumes' : 'GPS trips'}</b></div>
        </section>
        <section>
          <h3>Billboards</h3>
          <label className="field">Colour by
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
              <option value="route_fit">Fit with traffic flows</option>
              <option value="company">Company</option>
            </select>
          </label>
          {companyId && (
            <label className="toggle"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only my company</label>
          )}
          <div style={{ marginTop: 8 }}>
            {colorBy === 'route_fit'
              ? Object.values(ROUTE_FIT).map((f) => <div key={f.label} className="legend-row"><span style={{ color: f.color, fontSize: 14, width: 10 }}>{f.icon}</span>{f.label}</div>)
              : [...companies].sort((a, b) => a.id - b.id).map((c, i) => <div key={c.id} className="legend-row"><span className="dot" style={{ background: SERIES[i % SERIES.length] }} />{c.name}</div>)}
            <div className="hint" style={{ marginTop: 4 }}>Dot size = impressions per day.</div>
          </div>
          {(layers.heatmap || layers.hexagons || (layers.roads && segments.length > 0)) && (
            <div style={{ marginTop: 10 }}>
              <div className="hint">Traffic density</div>
              <div className="ramp" />
              <div className="row hint" style={{ justifyContent: 'space-between' }}><span>low</span><span>high</span></div>
            </div>
          )}
          {layers.gaps && <div className="legend-row" style={{ marginTop: 6 }}><span className="dot" style={{ border: '2px solid #9085e9' }} />Opportunity spot</div>}
          {companyId && (
            <div style={{ marginTop: 10 }}>
              <button className="btn small" onClick={() => setPickMode(true)} disabled={pickMode}>
                {pickMode ? 'Click on the map…' : '+ Add billboard on map'}
              </button>
            </div>
          )}
        </section>
      </div>}

      {selected && (
        <div className="panel right">
          <BillboardDetails
            b={{ ...selected, metrics: metricById.get(selected.id) ?? selected.metrics }}
            meta={meta}
            companyName={companyName(selected.company_id)}
            hours={hours}
            onClose={() => setSelected(null)}
            onEdit={!companyId || selected.company_id === companyId ? () => setEditing(selected) : undefined}
          />
        </div>
      )}

      {editing && (
        <BillboardForm
          meta={meta}
          companyId={editing === 'new' ? companyId! : (editing as Billboard).company_id}
          initial={editing === 'new' ? { lon: newPos?.[0], lat: newPos?.[1] } : (editing as Billboard)}
          onClose={() => { setEditing(null); setNewPos(null); }}
          onSaved={(b) => { setEditing(null); setNewPos(null); setSelected(b); bump(); }}
        />
      )}
    </div>
  );
}
