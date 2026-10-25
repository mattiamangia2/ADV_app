import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { Company, Meta } from './lib/types';
import MapPage from './pages/MapPage';
import InventoryPage from './pages/InventoryPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DataPage from './pages/DataPage';

type Tab = 'map' | 'inventory' | 'analytics' | 'data';
const TABS: [Tab, string][] = [['map', 'Map'], ['inventory', 'Inventory'], ['analytics', 'Analytics'], ['data', 'Mobility data']];

const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export type Ctx = { meta: Meta; companies: Company[]; companyId: number | null; reloadCompanies: () => void; version: number; bump: () => void };

export default function App() {
  const [tab, setTab] = useState<Tab>((stored('tab') as Tab) || 'map');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(Number(stored('companyId')) || null);
  const [version, setVersion] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const reloadCompanies = useCallback(() => { api.companies().then(setCompanies).catch((e) => setErr(e.message)); }, []);
  // Keep trying until the server is up (on the first start it prepares demo data for a minute or two).
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tryLoad = () => api.meta()
      .then((m) => { if (stop) return; setErr(null); setMeta(m); reloadCompanies(); })
      .catch((e) => { if (stop) return; setErr(e.message); timer = setTimeout(tryLoad, 3000); });
    tryLoad();
    return () => { stop = true; clearTimeout(timer); };
  }, [reloadCompanies]);
  useEffect(() => store('tab', tab), [tab]);
  useEffect(() => store('companyId', String(companyId ?? '')), [companyId]);

  const addCompany = async () => {
    const name = prompt('Company name');
    if (!name) return;
    try {
      const c = await api.createCompany({ name });
      reloadCompanies();
      setCompanyId(c.id);
    } catch (e) { alert((e as Error).message); }
  };

  if (err && !meta) {
    const preparing = /preparing/i.test(err);
    return (
      <div className="page">
        <h2>{preparing ? 'Preparing data…' : 'Starting the server…'}</h2>
        <p className="hint">{preparing ? err : 'Waiting for the server. If this lasts more than a minute, check the terminal running "npm run dev".'}</p>
        <p className="hint">This page retries by itself every few seconds.</p>
      </div>
    );
  }
  if (!meta) return <div className="page hint">Loading…</div>;
  const ctx: Ctx = { meta, companies, companyId, reloadCompanies, version, bump: () => setVersion((v) => v + 1) };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ADV<span>·</span>Flow</div>
        <nav className="nav">
          {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
        <div className="spacer" />
        <label className="row hint">
          Company
          <select value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All companies (market view)</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.billboard_count})</option>)}
          </select>
        </label>
        <button className="btn small" onClick={addCompany}>+ Company</button>
      </header>
      <main className="main">
        {tab === 'map' && <MapPage {...ctx} />}
        {tab === 'inventory' && <InventoryPage {...ctx} />}
        {tab === 'analytics' && <AnalyticsPage {...ctx} />}
        {tab === 'data' && <DataPage {...ctx} />}
      </main>
    </div>
  );
}
