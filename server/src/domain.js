// Catalogue of out-of-home formats with sensible defaults.
// Defaults are used when a company leaves a field empty; every value can be overridden per billboard.

export const FORMATS = {
  poster_6x3:      { label: 'Billboard 6×3 m (paper)',        media_type: 'static',  width_m: 6,    height_m: 3,    visibility_m: 150, material: 'paper' },
  poster_4x3:      { label: 'Billboard 4×3 m (paper)',        media_type: 'static',  width_m: 4,    height_m: 3,    visibility_m: 120, material: 'paper' },
  street_poster:   { label: 'Street poster 1.4×2 m',          media_type: 'static',  width_m: 1.4,  height_m: 2,    visibility_m: 40,  material: 'paper' },
  backlit:         { label: 'Backlit light box',              media_type: 'static',  width_m: 3,    height_m: 2,    visibility_m: 80,  material: 'vinyl', illuminated: 1 },
  trivision:       { label: 'Trivision (rotating slats)',     media_type: 'static',  width_m: 6,    height_m: 3,    visibility_m: 150, material: 'aluminium' },
  maxi_wrap:       { label: 'Building wrap / maxi poster',    media_type: 'static',  width_m: 20,   height_m: 15,   visibility_m: 350, material: 'mesh' },
  motorway:        { label: 'Motorway billboard',             media_type: 'static',  width_m: 12,   height_m: 4,    visibility_m: 400, material: 'vinyl' },
  digital_billboard:{ label: 'Digital billboard (LED)',       media_type: 'digital', width_m: 6,    height_m: 3,    visibility_m: 200, material: 'led', illuminated: 1, slot_seconds: 10, loop_seconds: 60 },
  digital_totem:   { label: 'Digital totem / screen',         media_type: 'digital', width_m: 1.2,  height_m: 2,    visibility_m: 40,  material: 'lcd', illuminated: 1, slot_seconds: 10, loop_seconds: 60 },
  bus_shelter:     { label: 'Bus shelter panel',              media_type: 'static',  width_m: 1.2,  height_m: 1.76, visibility_m: 40,  material: 'paper', illuminated: 1, faces: 2 },
};

export const STATUSES = ['available', 'booked', 'maintenance', 'inactive'];
/** Whether a site belongs to the company. Not-ours sites are mapped for market knowledge only. */
export const OWNERSHIPS = ['owned', 'unknown', 'competitor'];
export const isOwned = (b) => (b.ownership ?? 'owned') === 'owned';
export const ROAD_TYPES = ['motorway', 'arterial', 'urban', 'local'];
export const CAMPAIGN_CATEGORIES = [
  'Automotive', 'Retail', 'Food & Beverage', 'Telecom', 'Finance', 'Fashion',
  'Entertainment', 'Travel', 'Health', 'Public sector', 'Real estate', 'Tech', 'Other',
];

/** Fill derived and default values; returns a new object. */
export function withDefaults(bb) {
  const f = FORMATS[bb.format] || {};
  const out = { ...bb };
  for (const k of ['media_type', 'width_m', 'height_m', 'visibility_m', 'material', 'illuminated', 'slot_seconds', 'loop_seconds', 'faces']) {
    if (out[k] == null && f[k] != null) out[k] = f[k];
  }
  if (out.surface_m2 == null && out.width_m && out.height_m) out.surface_m2 = +(out.width_m * out.height_m).toFixed(2);
  if (out.viewing_angle_deg == null) out.viewing_angle_deg = 60;
  if (out.visibility_m == null) out.visibility_m = 100;
  return out;
}

/** Campaign timing relative to `now`: elapsed / remaining days and progress. */
export function campaignTiming(c, now = new Date()) {
  const start = new Date(c.start_date);
  const end = new Date(c.end_date);
  const day = 86400000;
  const total = Math.max(1, Math.round((end - start) / day));
  const elapsed = Math.round((now - start) / day);
  const state = now < start ? 'upcoming' : now > end ? 'ended' : 'running';
  return {
    state,
    duration_days: total,
    elapsed_days: Math.max(0, Math.min(total, elapsed)),
    remaining_days: Math.max(0, Math.round((end - now) / day)),
    progress: Math.max(0, Math.min(1, elapsed / total)),
  };
}
