const API_BASE = 'https://fbi-portal-source.vercel.app/api';
const BYPASS_STORAGE_KEY = 'retention-vercel-bypass';

export function getBypassToken() {
  const env = import.meta.env.VITE_VERCEL_BYPASS;
  if (env) return env;
  try { return localStorage.getItem(BYPASS_STORAGE_KEY) || ''; } catch { return ''; }
}

export function setBypassToken(v) {
  try {
    if (v) localStorage.setItem(BYPASS_STORAGE_KEY, v);
    else localStorage.removeItem(BYPASS_STORAGE_KEY);
  } catch {}
}

function buildUrl(table) {
  const params = new URLSearchParams({ table, _t: String(Date.now()) });
  const token = getBypassToken();
  if (token) {
    // Vercel accepts both a header and a query param; the query param works
    // even when CORS ACL:* forbids sending custom headers preflight-free.
    params.set('x-vercel-protection-bypass', token);
    params.set('x-vercel-set-bypass-cookie', 'true');
  }
  return `${API_BASE}/data?${params.toString()}`;
}

async function get(table) {
  const res = await fetch(buildUrl(table), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${table} fetch failed: ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(`${table} returned non-JSON — Vercel auth likely intercepted. Set your bypass token.`);
  }
  return res.json();
}

export async function fetchSales() {
  return get('sales');
}

export async function fetchTeamMembers() {
  return get('team_members');
}
