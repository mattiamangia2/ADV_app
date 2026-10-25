// Real road network from OpenStreetMap (© OpenStreetMap contributors, ODbL).
// Downloaded once from the Overpass API and cached in server/data/, then turned
// into a routable graph used to simulate demo traffic on Milan's actual streets.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversine } from './geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OSM_CACHE = process.env.ADV_OSM_CACHE || path.join(__dirname, '..', 'data', 'osm-roads-milan.json');

// Greater Milan, roughly inside the Tangenziali.
export const MILAN_BBOX = { south: 45.39, west: 9.06, north: 45.54, east: 9.31 };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const ROAD_CLASSES = 'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link';

/** Default speeds (km/h) and our road_type for each OSM highway class. */
const CLASS_INFO = {
  motorway: [90, 'motorway'], motorway_link: [50, 'motorway'],
  trunk: [70, 'motorway'], trunk_link: [40, 'motorway'],
  primary: [50, 'arterial'], primary_link: [35, 'arterial'],
  secondary: [45, 'arterial'], secondary_link: [30, 'arterial'],
  tertiary: [35, 'urban'],
};

export async function downloadRoads(bbox = MILAN_BBOX, { log = console.log } = {}) {
  const q = `[out:json][timeout:180];way["highway"~"^(${ROAD_CLASSES})$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out body geom qt;`;
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      log(`Downloading Milan road network from ${new URL(url).host} (one time, may take a minute)…`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ADV-Flow/0.1 (demo data)' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const ways = compactWays(json);
      if (ways.length < 100) throw new Error(`only ${ways.length} roads returned`);
      fs.mkdirSync(path.dirname(OSM_CACHE), { recursive: true });
      fs.writeFileSync(OSM_CACHE, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', bbox, downloaded_at: new Date().toISOString(), ways }));
      log(`Saved ${ways.length} road segments to ${path.relative(process.cwd(), OSM_CACHE)}`);
      return ways;
    } catch (e) {
      lastErr = e;
      log(`  ${new URL(url).host} failed: ${e.message}`);
    }
  }
  throw lastErr;
}

/** Keep only what we need from the Overpass response. */
export function compactWays(json) {
  return (json.elements || [])
    .filter((e) => e.type === 'way' && Array.isArray(e.nodes) && Array.isArray(e.geometry) && e.nodes.length === e.geometry.length && e.nodes.length > 1)
    .map((e) => ({
      id: e.id,
      nodes: e.nodes,
      coords: e.geometry.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]),
      highway: e.tags?.highway,
      name: e.tags?.name || e.tags?.ref || null,
      maxspeed: parseInt(e.tags?.maxspeed, 10) || null,
      oneway: e.tags?.oneway === 'yes' || e.tags?.oneway === '1' || e.tags?.junction === 'roundabout' || e.tags?.highway === 'motorway' ? 1
        : e.tags?.oneway === '-1' ? -1 : 0,
    }));
}

/** Cached roads, downloading them if needed. Returns null when unavailable (offline). */
export async function loadRoads({ download = true, log = console.log } = {}) {
  if (fs.existsSync(OSM_CACHE)) {
    try { return JSON.parse(fs.readFileSync(OSM_CACHE, 'utf8')).ways; } catch { /* corrupt cache: re-download */ }
  }
  if (!download || process.env.ADV_OSM === '0') return null;
  try {
    return await downloadRoads(MILAN_BBOX, { log });
  } catch (e) {
    log(`Could not download OpenStreetMap roads (${e.message}). Falling back to a schematic network.`);
    return null;
  }
}

/**
 * Turn OSM ways into a routable graph: nodes are intersections/endpoints, edges
 * carry the street geometry between them. Same shape as the schematic network
 * in seed.js: { nodes[], edges[{a,b,pts,len,speed,type,name,oneway}], adj }.
 */
export function buildRoadGraph(ways) {
  const uses = new Map();
  for (const w of ways) for (const n of w.nodes) uses.set(n, (uses.get(n) || 0) + 1);

  const idx = new Map(); // osm node id -> graph index
  const nodes = [];
  const nodeOf = (osmId, [lon, lat]) => {
    if (!idx.has(osmId)) { idx.set(osmId, nodes.length); nodes.push({ id: nodes.length, lat, lon }); }
    return idx.get(osmId);
  };
  const edges = [];
  for (const w of ways) {
    const [defSpeed, type] = CLASS_INFO[w.highway] || [30, 'urban'];
    const speed = Math.min(130, w.maxspeed || defSpeed);
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const isCut = i === w.nodes.length - 1 || uses.get(w.nodes[i]) > 1;
      if (!isCut) continue;
      let pts = w.coords.slice(start, i + 1);
      let a = nodeOf(w.nodes[start], w.coords[start]);
      let b = nodeOf(w.nodes[i], w.coords[i]);
      let oneway = w.oneway;
      if (oneway === -1) { [a, b] = [b, a]; pts = [...pts].reverse(); oneway = 1; }
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += haversine(pts[k - 1][1], pts[k - 1][0], pts[k][1], pts[k][0]);
      if (len > 1 && a !== b) edges.push({ a, b, pts, len, speed, type, name: w.name || 'Unnamed road', oneway: !!oneway, highway: w.highway });
      start = i;
    }
  }
  const adj = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e, i) => {
    adj.get(e.a).push({ to: e.b, e: i, fwd: true });
    if (!e.oneway) adj.get(e.b).push({ to: e.a, e: i, fwd: false });
  });
  return { nodes, edges, adj, kind: 'osm' };
}

/** Nodes in the largest weakly connected component (so most trips can be routed). */
export function mainComponent(net) {
  const und = new Map(net.nodes.map((n) => [n.id, []]));
  for (const e of net.edges) { und.get(e.a).push(e.b); und.get(e.b).push(e.a); }
  const comp = new Int32Array(net.nodes.length).fill(-1);
  let best = [], c = 0;
  for (const n of net.nodes) {
    if (comp[n.id] !== -1) continue;
    const members = [n.id];
    comp[n.id] = c;
    for (let i = 0; i < members.length; i++) for (const m of und.get(members[i])) if (comp[m] === -1) { comp[m] = c; members.push(m); }
    if (members.length > best.length) best = members;
    c++;
  }
  return best;
}
