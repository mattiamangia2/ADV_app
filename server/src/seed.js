// Synthetic demo data for Milan. NOT real traffic or real inventory.
// Builds a radio-centric road graph (rings + radial avenues, like Milan's layout),
// simulates a week of car trips with morning/evening commuting peaks, and places
// billboards for three fictional media owners — most on busy roads, some off-route.

import { fileURLToPath } from 'node:url';
import { destination, bearing, haversine } from './geo.js';
import { FORMATS } from './domain.js';
import { insert, openDb } from './db.js';

const CENTER = [45.4642, 9.19];
const RINGS = [
  { r: 1000, speed: 25, type: 'urban', name: 'Cerchia interna' },
  { r: 2100, speed: 35, type: 'urban', name: 'Bastioni' },
  { r: 3600, speed: 45, type: 'arterial', name: 'Circonvallazione' },
  { r: 7500, speed: 80, type: 'motorway', name: 'Tangenziale' },
];
const RADIALS = 16;
const OUTER = 10500;
// Some corridors carry more commuters than others.
const RADIAL_DEMAND = [3, 1, 2, 1, 2.5, 1, 1, 1.5, 3, 1, 1.5, 1, 2, 1, 1, 2];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function buildNetwork(rand) {
  const nodes = []; // {id, lat, lon, ring, radial}
  const id = (ring, k) => ring * RADIALS + k;
  const radii = [...RINGS.map((r) => r.r), OUTER];
  radii.forEach((r, ri) => {
    for (let k = 0; k < RADIALS; k++) {
      const ang = (360 / RADIALS) * k + (rand() - 0.5) * 6;
      const [lat, lon] = destination(CENTER[0], CENTER[1], ang, r * (1 + (rand() - 0.5) * 0.06));
      nodes[id(ri, k)] = { id: id(ri, k), lat, lon, ring: ri, radial: k, ang };
    }
  });
  const edges = [];
  const addEdge = (a, b, speed, type, name, shape) => {
    const pts = shape || [[nodes[a].lon, nodes[a].lat], [nodes[b].lon, nodes[b].lat]];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    edges.push({ a, b, speed, type, name, pts, len });
  };
  // Ring arcs (curved) between adjacent radials.
  RINGS.forEach((ring, ri) => {
    for (let k = 0; k < RADIALS; k++) {
      const a = id(ri, k), b = id(ri, (k + 1) % RADIALS);
      const a0 = nodes[a].ang, a1 = nodes[b].ang < a0 ? nodes[b].ang + 360 : nodes[b].ang;
      const shape = [];
      const steps = 6;
      for (let s = 0; s <= steps; s++) {
        if (s === 0) shape.push([nodes[a].lon, nodes[a].lat]);
        else if (s === steps) shape.push([nodes[b].lon, nodes[b].lat]);
        else {
          const [lat, lon] = destination(CENTER[0], CENTER[1], a0 + ((a1 - a0) * s) / steps, ring.r);
          shape.push([lon, lat]);
        }
      }
      addEdge(a, b, ring.speed, ring.type, `${ring.name} ${k + 1}`, shape);
    }
  });
  // Radial avenues between consecutive rings.
  for (let k = 0; k < RADIALS; k++) {
    for (let ri = 0; ri < radii.length - 1; ri++) {
      const speed = ri === 0 ? 25 : ri >= 3 ? 70 : 40;
      addEdge(id(ri, k), id(ri + 1, k), speed, ri >= 3 ? 'arterial' : 'urban', `Radiale ${k + 1}`);
    }
  }
  const adj = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e, i) => {
    adj.get(e.a).push({ to: e.b, e: i, fwd: true });
    adj.get(e.b).push({ to: e.a, e: i, fwd: false });
  });
  return { nodes, edges, adj, radii };
}

function shortestPath(net, from, to, noise) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  while (true) {
    let u = null, best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; u = n; }
    if (u == null || u === to) break;
    done.add(u);
    for (const { to: v, e, fwd } of net.adj.get(u)) {
      const edge = net.edges[e];
      const cost = (edge.len / edge.speed) * noise(e);
      const nd = best + cost;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { u, e, fwd }); }
    }
  }
  const steps = [];
  for (let v = to; v !== from;) {
    const p = prev.get(v);
    if (!p) return null;
    steps.unshift(p);
    v = p.u;
  }
  return steps;
}

/** Hour-of-day demand profile (weekday). */
const HOURLY = [0.2, 0.1, 0.1, 0.1, 0.2, 0.6, 1.8, 4.5, 6, 4, 2.6, 2.5, 2.8, 2.6, 2.4, 2.6, 3.4, 5, 5.6, 4, 2.4, 1.6, 1, 0.5];

function pickWeighted(rand, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = rand() * sum;
  for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) <= 0) return i;
  return weights.length - 1;
}

export function simulateTrips(net, rand, { count = 2500, days = 7, startDate = '2026-10-05' } = {}) {
  const trips = [];
  const base = Date.parse(`${startDate}T00:00:00+02:00`) / 1000;
  const lastRing = net.radii.length - 1;
  for (let n = 0; n < count; n++) {
    const day = Math.floor(rand() * days);
    const weekend = day >= 5;
    const hour = weekend ? 9 + Math.floor(rand() * 12) : pickWeighted(rand, HOURLY);
    const t0 = base + day * 86400 + hour * 3600 + Math.floor(rand() * 3600);
    const k1 = pickWeighted(rand, RADIAL_DEMAND);
    const k2 = pickWeighted(rand, RADIAL_DEMAND);
    // Morning: suburbs -> centre. Evening: centre -> suburbs. Otherwise mixed.
    const outerRing = () => (rand() < 0.65 ? lastRing : 3 + Math.floor(rand() * 2) - 1);
    const innerRing = () => Math.floor(rand() * 3);
    let r1, r2;
    if (hour < 11) { r1 = outerRing(); r2 = innerRing(); }
    else if (hour >= 16 && hour < 21) { r1 = innerRing(); r2 = outerRing(); }
    else { r1 = Math.floor(rand() * 5); r2 = Math.floor(rand() * 5); }
    const from = Math.min(r1, lastRing) * RADIALS + k1;
    const to = Math.min(r2, lastRing) * RADIALS + k2;
    if (from === to) continue;
    const noiseMap = new Map();
    const noise = (e) => { if (!noiseMap.has(e)) noiseMap.set(e, 0.8 + rand() * 0.6); return noiseMap.get(e); };
    const steps = shortestPath(net, from, to, noise);
    if (!steps) continue;

    const coords = [];
    let t = t0;
    const congestion = HOURLY[hour] > 4 ? 0.6 : 1;
    for (const { e, fwd } of steps) {
      const edge = net.edges[e];
      const pts = fwd ? edge.pts : [...edge.pts].reverse();
      const v = (edge.speed * congestion * (0.8 + rand() * 0.4)) / 3.6; // m/s
      for (let i = 0; i < pts.length - 1; i++) {
        const [lon1, lat1] = pts[i], [lon2, lat2] = pts[i + 1];
        const d = haversine(lat1, lon1, lat2, lon2);
        const nSub = Math.max(1, Math.round(d / 120));
        for (let s = 0; s < nSub; s++) {
          const f = s / nSub;
          const jit = () => (rand() - 0.5) * 0.00008; // ~±4 m GPS noise
          coords.push([lon1 + (lon2 - lon1) * f + jit(), lat1 + (lat2 - lat1) * f + jit(), Math.round(t)]);
          t += d / nSub / v;
        }
      }
    }
    const last = net.edges[steps.at(-1).e];
    const end = steps.at(-1).fwd ? last.pts.at(-1) : last.pts[0];
    coords.push([end[0], end[1], Math.round(t)]);
    let dist = 0;
    for (let i = 1; i < coords.length; i++) dist += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    trips.push({
      source: 'synthetic',
      vehicle_type: rand() < 0.9 ? 'car' : 'van',
      weight: 400, // each simulated trip stands for ~400 real vehicles (panel expansion)
      occupancy: 1.3,
      started_at: new Date(t0 * 1000).toISOString(),
      ended_at: new Date(t * 1000).toISOString(),
      distance_m: Math.round(dist),
      coords: JSON.stringify(coords.map(([a, b, c]) => [+a.toFixed(6), +b.toFixed(6), c])),
    });
  }
  return trips;
}

const COMPANIES = [
  { name: 'Urban Media Srl', contact_email: 'sales@urbanmedia.example', color: '#2a78d6' },
  { name: 'MetroBoard Italia', contact_email: 'info@metroboard.example', color: '#d6762a' },
  { name: 'Lombardia DOOH', contact_email: 'hello@lombardia-dooh.example', color: '#2aa876' },
];
const ADVERTISERS = [
  ['Nordic Coffee Co.', 'Food & Beverage'], ['Velo Bikes', 'Retail'], ['Aurora Telecom', 'Telecom'],
  ['Lumen Bank', 'Finance'], ['FreshMart', 'Retail'], ['Stellar Motors', 'Automotive'],
  ['Cinema Orione', 'Entertainment'], ['SkyLink Travel', 'Travel'], ['Moda Vera', 'Fashion'],
  ['Comune — Mobilità', 'Public sector'], ['Casa Nova Immobiliare', 'Real estate'], ['PixelSoft', 'Tech'],
];
const PRICE = { // monthly list price range, EUR
  poster_6x3: [700, 1400], poster_4x3: [500, 1000], street_poster: [120, 260], backlit: [600, 1100],
  trivision: [1200, 2000], maxi_wrap: [9000, 22000], motorway: [2500, 5000], digital_billboard: [2800, 6000],
  digital_totem: [500, 1200], bus_shelter: [300, 600],
};

export function seed(db, { seedValue = 42, tripCount = 2500 } = {}) {
  const rand = rng(seedValue);
  const net = buildNetwork(rand);
  const trips = simulateTrips(net, rand, { count: tripCount });
  db.exec('BEGIN');
  for (const t of trips) insert(db, 'trips', t);

  const companyIds = COMPANIES.map((c) => insert(db, 'companies', c));
  const formatsByType = {
    motorway: ['motorway', 'digital_billboard', 'poster_6x3'],
    arterial: ['poster_6x3', 'digital_billboard', 'trivision', 'maxi_wrap', 'poster_4x3'],
    urban: ['street_poster', 'bus_shelter', 'digital_totem', 'backlit', 'poster_4x3', 'poster_6x3'],
  };
  const today = new Date('2026-10-18');
  const iso = (d) => d.toISOString().slice(0, 10);
  let n = 0;
  const TOTAL = 90;
  // Bias placement toward busy edges, the way a real network grows.
  const edgeWeight = net.edges.map((e) => (e.type === 'urban' ? 1 : 1.5) * e.len);
  for (let i = 0; i < TOTAL; i++) {
    const companyIdx = pickWeighted(rand, [0.45, 0.35, 0.2]);
    const companyId = companyIds[companyIdx];
    let lat, lon, facing, edge, format;
    const offRoute = rand() < 0.18;
    if (offRoute) {
      // Random point that is likely between roads — illustrates poorly placed sites.
      const [la, lo] = destination(CENTER[0], CENTER[1], rand() * 360, 1500 + rand() * 7000);
      lat = la; lon = lo; facing = Math.floor(rand() * 360);
      format = ['poster_6x3', 'poster_4x3', 'street_poster', 'backlit'][Math.floor(rand() * 4)];
    } else {
      edge = net.edges[pickWeighted(rand, edgeWeight)];
      const seg = Math.floor(rand() * (edge.pts.length - 1));
      const [lon1, lat1] = edge.pts[seg], [lon2, lat2] = edge.pts[seg + 1];
      const f = 0.1 + rand() * 0.8;
      const roadBearing = bearing(lat1, lon1, lat2, lon2);
      const side = rand() < 0.5 ? 90 : -90;
      [lat, lon] = destination(lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f, roadBearing + side, 12 + rand() * 15);
      // Face oncoming traffic of one direction (rotated slightly towards the road).
      const travel = rand() < 0.5 ? roadBearing : (roadBearing + 180) % 360;
      facing = Math.round((travel + 180 + (rand() - 0.5) * 30 + 360) % 360);
      const opts = formatsByType[edge.type] || formatsByType.urban;
      format = opts[Math.floor(rand() * opts.length)];
    }
    if (companyIdx === 2 && !offRoute) format = rand() < 0.6 ? 'digital_billboard' : 'digital_totem';
    const fmt = FORMATS[format];
    const [pmin, pmax] = PRICE[format];
    const priceMonth = Math.round((pmin + rand() * (pmax - pmin)) / 10) * 10;
    const installed = new Date(today.getTime() - (200 + rand() * 3000) * 86400000);
    const permitExp = new Date(today.getTime() + (-30 + rand() * 1500) * 86400000);
    n++;
    const bb = {
      company_id: companyId,
      code: `${COMPANIES[companyIdx].name.split(' ')[0].slice(0, 3).toUpperCase()}-${String(n).padStart(4, '0')}`,
      name: `${fmt.label.split(' (')[0]} — ${edge ? edge.name : 'Zona ' + n}`,
      format,
      media_type: fmt.media_type,
      status: rand() < 0.06 ? 'maintenance' : 'available',
      lat: +lat.toFixed(6), lon: +lon.toFixed(6),
      city: 'Milano',
      address: edge ? `${edge.name}, Milano` : `Via di quartiere ${n}, Milano`,
      road_name: edge ? edge.name : null,
      road_type: edge ? edge.type : 'local',
      speed_limit_kmh: edge ? (edge.type === 'motorway' ? 90 : edge.type === 'arterial' ? 50 : 30) : 30,
      facing_azimuth: format === 'bus_shelter' ? null : facing,
      width_m: fmt.width_m, height_m: fmt.height_m,
      surface_m2: +(fmt.width_m * fmt.height_m).toFixed(2),
      faces: fmt.faces || (rand() < 0.3 ? 2 : 1),
      illuminated: fmt.illuminated ?? (rand() < 0.4 ? 1 : 0),
      height_above_ground_m: format === 'maxi_wrap' ? 12 : format.startsWith('street') || format === 'bus_shelter' ? 0.5 : 3 + Math.round(rand() * 4),
      material: fmt.material,
      visibility_m: fmt.visibility_m,
      resolution: fmt.media_type === 'digital' ? (format === 'digital_totem' ? '1080x1920' : '1920x960') : null,
      slot_seconds: fmt.slot_seconds ?? null,
      loop_seconds: fmt.loop_seconds ?? null,
      operating_hours: fmt.media_type === 'digital' ? '06:00-24:00' : null,
      currency: 'EUR',
      price_month: priceMonth,
      price_week: Math.round((priceMonth / 4.33) * 1.1),
      price_year: Math.round(priceMonth * 12 * 0.85),
      production_cost: fmt.media_type === 'digital' ? 0 : Math.round(fmt.width_m * fmt.height_m * 12),
      min_booking_days: fmt.media_type === 'digital' ? 7 : 14,
      installed_at: iso(installed),
      permit_number: `MI-PUB-${2018 + Math.floor(rand() * 8)}-${1000 + Math.floor(rand() * 8999)}`,
      permit_expires_at: iso(permitExp),
      notes: offRoute ? 'Demo: deliberately placed away from main traffic flows.' : null,
      extra: JSON.stringify({ lighting: fmt.illuminated ? 'LED' : 'none', demo: true }),
    };
    const id = insert(db, 'billboards', bb);
    // Campaign history: one past campaign, ~65% have a running one.
    const addCampaign = (startOffset, length) => {
      const [adv, cat] = ADVERTISERS[Math.floor(rand() * ADVERTISERS.length)];
      const start = new Date(today.getTime() + startOffset * 86400000);
      const end = new Date(start.getTime() + length * 86400000);
      insert(db, 'campaigns', {
        billboard_id: id, advertiser: adv, brand: adv, category: cat,
        title: `${adv} — ${['Autumn', 'Launch', 'Brand', 'Promo', 'Awareness'][Math.floor(rand() * 5)]} campaign`,
        start_date: iso(start), end_date: iso(end),
        price_paid: Math.round(priceMonth * (length / 30) * (0.8 + rand() * 0.2)),
      });
    };
    addCampaign(-120 - Math.floor(rand() * 60), 28 + Math.floor(rand() * 30));
    if (rand() < 0.65) addCampaign(-Math.floor(rand() * 40), 14 + Math.floor(rand() * 75));
  }
  db.exec('COMMIT');
  return { trips: trips.length, billboards: TOTAL, companies: companyIds.length };
}

// CLI: `npm run seed` wipes and re-seeds the database.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  if (process.argv.includes('--reset')) db.exec('DELETE FROM campaigns; DELETE FROM billboards; DELETE FROM trips; DELETE FROM companies;');
  console.log('Seeded:', seed(db));
}
