import { normalizeName, normalizePolicyNum } from '../utils/normalize.js';

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

function buildUrl(table, extra = {}) {
  const params = new URLSearchParams({ table, _t: String(Date.now()), ...extra });
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

export async function fetchOverrides() {
  const data = await get('retention_overrides');
  return Array.isArray(data) ? data : [];
}

export async function saveMatchDecisions(decisions) {
  const res = await fetch(buildUrl('retention_match_decisions', { mode: 'replace' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decisions),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}

export async function fetchMatchDecisions() {
  const data = await get('retention_match_decisions');
  return Array.isArray(data) ? data : [];
}

// Persist the current Policy Master to KV under `retention_policy_master` so
// Frank doesn't re-upload each visit. The full parsed structure is ~3MB per
// 5,400 policies (too big for one KV value), so we trim to just the fields
// used downstream and use short keys to squeeze under Upstash's ~1MB limit.
const SLIM_KEYS = { a: 'applicantId', n: 'accountName', p: 'policyNumber', c: 'carrier', l: 'lob', ap: 'annualPremium', wp: 'writtenPremium', ed: 'effectiveDate', cd: 'cancellationDate', x: 'isCancelled', ph: 'phone' };

function trimPolicy(p) {
  return { a: p.applicantId, n: p.accountName, p: p.policyNumber, c: p.carrier, l: p.lob, ap: p.annualPremium, wp: p.writtenPremium, ed: p.effectiveDate, cd: p.cancellationDate, x: p.isCancelled, ph: p.phone };
}

function expandPolicy(s) {
  const out = {};
  for (const k of Object.keys(s)) out[SLIM_KEYS[k] || k] = s[k];
  out.isActive = !out.isCancelled;
  // Rehydrate the normalized keys the matcher relies on. Not stored because
  // they're cheap to recompute and would ~double the KV payload.
  out.policyNumberNorm = normalizePolicyNum(out.policyNumber);
  out.accountNameNorm = normalizeName(out.accountName);
  return out;
}

export async function fetchPolicyMaster() {
  const data = await get('retention_policy_master');
  if (!data || !data.slim) return null;
  return {
    fileName: data.fileName,
    uploadedAt: data.uploadedAt,
    filterMeta: data.filterMeta,
    slimPolicies: data.slim, // caller re-hydrates via expandPolicyMaster()
  };
}

export function expandPolicyMaster(saved) {
  const policies = saved.slimPolicies.map(expandPolicy);
  return { policies, fileName: saved.fileName, uploadedAt: saved.uploadedAt, filterMeta: saved.filterMeta };
}

export async function savePolicyMaster({ fileName, filterMeta, policies }) {
  const payload = {
    fileName,
    uploadedAt: new Date().toISOString(),
    policyCount: policies.length,
    filterMeta,
    slim: policies.map(trimPolicy),
  };
  const res = await fetch(buildUrl('retention_policy_master', { mode: 'replace' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}

// Atomic-replace the whole overrides list. Uses api/data.js's `mode=replace`
// path so we don't have to worry about the generic-branch push behavior
// duplicating rows by id.
export async function saveOverrides(overrides) {
  const res = await fetch(buildUrl('retention_overrides', { mode: 'replace' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}
