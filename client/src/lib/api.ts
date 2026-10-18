import type { Billboard, Company, Flow, Gap, Meta, Metrics, Summary, Trip } from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type Hours = { hourFrom?: number; hourTo?: number };

export const api = {
  meta: () => req<Meta>('/api/meta'),
  companies: () => req<Company[]>('/api/companies'),
  createCompany: (c: Partial<Company>) => req<Company>('/api/companies', json('POST', c)),

  billboards: (companyId?: number | null) => req<Billboard[]>(`/api/billboards${qs({ companyId })}`),
  billboard: (id: number) => req<Billboard>(`/api/billboards/${id}`),
  createBillboard: (companyId: number, b: Partial<Billboard>) => req<Billboard>(`/api/billboards${qs({ companyId })}`, json('POST', b)),
  updateBillboard: (id: number, b: Partial<Billboard>) => req<Billboard>(`/api/billboards/${id}`, json('PUT', b)),
  deleteBillboard: (id: number) => req<void>(`/api/billboards/${id}`, { method: 'DELETE' }),
  importBillboards: (companyId: number, csv: string) =>
    req<{ created: number; errors: { row: number; errors: string[] }[] }>(`/api/billboards/import${qs({ companyId })}`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv }),
  addCampaign: (billboardId: number, c: Record<string, unknown>) => req(`/api/billboards/${billboardId}/campaigns`, json('POST', c)),
  deleteCampaign: (id: number) => req<void>(`/api/campaigns/${id}`, { method: 'DELETE' }),

  trips: (o: { limit?: number; ids?: number[] } = {}) => req<Trip[]>(`/api/trips${qs({ limit: o.limit, ids: o.ids?.join(',') })}`),
  tripStats: () => req<{ trips: number; weighted_trips: number; distance_m: number; first: string; last: string }>('/api/trips/stats'),
  importTrips: (text: string, isCsv: boolean) =>
    req<{ imported: number }>('/api/trips/import', { method: 'POST', headers: { 'Content-Type': isCsv ? 'text/csv' : 'application/json' }, body: text }),
  clearTrips: () => req<void>('/api/trips', { method: 'DELETE' }),

  metrics: (companyId?: number | null, h: Hours = {}) => req<Metrics[]>(`/api/analytics/billboards${qs({ companyId, ...h })}`),
  summary: (companyId?: number | null, h: Hours = {}) => req<Summary>(`/api/analytics/summary${qs({ companyId, ...h })}`),
  gaps: (companyId?: number | null, scope?: 'market') => req<Gap[]>(`/api/analytics/gaps${qs({ companyId, scope })}`),
  flows: () => req<Flow[]>('/api/analytics/flows'),
};
