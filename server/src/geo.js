// Small geodesy helpers. Distances in metres, angles in degrees.

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Initial bearing from point 1 to point 2, 0..360 (0 = north). */
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two angles, 0..180. */
export function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Destination point given start, bearing and distance. */
export function destination(lat, lon, brng, dist) {
  const d = dist / R;
  const b = toRad(brng);
  const la1 = toRad(lat);
  const lo1 = toRad(lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 =
    lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [toDeg(la2), toDeg(lo2)];
}

/**
 * Distance from point P to segment AB using a local equirectangular projection
 * (accurate enough for the few-hundred-metre ranges we care about).
 * Returns { dist, t } where t in [0,1] is the position of the closest point on AB.
 */
export function pointToSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
  const kx = Math.cos(toRad(pLat)) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  const ax = (aLon - pLon) * kx, ay = (aLat - pLat) * ky;
  const bx = (bLon - pLon) * kx, by = (bLat - pLat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { dist: Math.sqrt(cx * cx + cy * cy), t };
}

/** Simple uniform grid spatial index for points (billboards). */
export class GridIndex {
  constructor(cellDeg = 0.005) {
    this.cell = cellDeg;
    this.cells = new Map();
  }
  key(i, j) {
    return `${i}:${j}`;
  }
  insert(lat, lon, item) {
    const k = this.key(Math.floor(lat / this.cell), Math.floor(lon / this.cell));
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push(item);
  }
  /** Items in cells overlapping the bbox (expanded by `padDeg`). */
  query(minLat, minLon, maxLat, maxLon, padDeg = 0) {
    const out = [];
    const i0 = Math.floor((minLat - padDeg) / this.cell), i1 = Math.floor((maxLat + padDeg) / this.cell);
    const j0 = Math.floor((minLon - padDeg) / this.cell), j1 = Math.floor((maxLon + padDeg) / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const c = this.cells.get(this.key(i, j));
        if (c) out.push(...c);
      }
    return out;
  }
}
