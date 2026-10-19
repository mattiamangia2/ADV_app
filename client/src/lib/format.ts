export const nf = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });

export const money = (v: number | null | undefined, cur = 'EUR', d = 0) =>
  v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: d });

export const compact = (v: number | null | undefined) =>
  v == null ? '—' : Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Categorical slots (dark-surface steps), assigned in fixed order by company id. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };

export const ROUTE_FIT: Record<string, { color: string; icon: string; label: string }> = {
  'main flow': { color: STATUS.good, icon: '●', label: 'Main flow' },
  secondary: { color: STATUS.warning, icon: '◐', label: 'Secondary' },
  marginal: { color: STATUS.serious, icon: '◔', label: 'Marginal' },
  'off-route': { color: STATUS.critical, icon: '○', label: 'Off-route' },
};

/** Sequential blue ramp, dark (near zero, recedes into dark map) -> light (high). */
export const SEQ_BLUE: [number, number, number][] = [
  [13, 54, 107], [24, 79, 149], [37, 106, 191], [57, 135, 229], [109, 167, 236], [158, 197, 244], [205, 226, 251],
];

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Sites that exist but aren't the company's: drawn grey on the map. */
export const OWNERSHIP: Record<string, { label: string; short: string; color: string }> = {
  owned: { label: 'Ours', short: 'ours', color: '' },
  unknown: { label: 'Not ours: operator unknown', short: 'not ours', color: '#898781' },
  competitor: { label: 'Competitor site', short: 'competitor', color: '#5f5e5a' },
};
