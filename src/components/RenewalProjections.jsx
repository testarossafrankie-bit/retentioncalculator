import { useEffect, useMemo, useState } from 'react';

function fmt$(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Persist state under a stable key so the user's commission rates and assumed
// retention % don't reset on every page reload.
function useLocalStorageState(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored != null ? JSON.parse(stored) : defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* noop */ }
  }, [key, state]);
  return [state, setState];
}

function Card({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    blue: 'border-blue-300 bg-blue-50',
    green: 'border-emerald-300 bg-emerald-50',
    red: 'border-rose-300 bg-rose-50',
  };
  return (
    <div className={`rounded-lg border-2 p-4 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

// Reasonable defaults; user overrides via the commission-rates table.
const DEFAULT_COMMISSION = 12;
const COMMISSION_DEFAULTS = {
  Progressive: 12,
  Travelers: 14,
  Safeco: 15,
  Nationwide: 12,
  Geico: 10,
  'American Modern': 14,
  Hagerty: 15,
  Foremost: 14,
  'National General': 12,
  Mercury: 12,
  Branch: 12,
  Kemper: 12,
};

export default function RenewalProjections({ policyMaster, resolveProducer, carrierFilter, producerFilter, start, end }) {
  const [retentionPct, setRetentionPct] = useLocalStorageState('rp_retentionPct', 80);
  const [carrierCommissions, setCarrierCommissions] = useLocalStorageState('rp_carrierCommissions', {});

  const retMult = Math.max(0, Math.min(100, Number(retentionPct) || 0)) / 100;

  // All carriers ever seen in the Policy Master — this is the source of truth
  // for the editable commission-rates table. Sorted by policy count so the
  // biggest books float to the top.
  const allCarriers = useMemo(() => {
    if (!policyMaster) return [];
    const counts = new Map();
    for (const p of policyMaster.policies) {
      const c = p.carrier || '';
      if (!c) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([carrier, count]) => ({ carrier, count }));
  }, [policyMaster]);

  const commissionFor = (carrier) => {
    const stored = carrierCommissions[carrier];
    if (stored != null && stored !== '') return Number(stored);
    return COMMISSION_DEFAULTS[carrier] ?? DEFAULT_COMMISSION;
  };

  const setCommissionFor = (carrier, value) => {
    setCarrierCommissions(prev => ({ ...prev, [carrier]: value }));
  };

  const projection = useMemo(() => {
    if (!policyMaster) return null;
    // Prefer expirationDate (EZLynx-authoritative). Fall back to renewalDate
    // (eff + term) for policies where the export didn't include it.
    const dateOf = (p) => p.expirationDate || p.renewalDate;
    const active = policyMaster.policies.filter(p => p.isActive && dateOf(p));
    const filtered = active.filter(p => {
      const d = dateOf(p);
      if (d < start || d > end) return false;
      if (carrierFilter !== 'all' && p.carrier !== carrierFilter) return false;
      if (producerFilter !== 'all' && resolveProducer(p.producer || '').canonical !== producerFilter) return false;
      return true;
    });

    const commRateFor = (carrier) => {
      const stored = carrierCommissions[carrier];
      const pct = (stored != null && stored !== '') ? Number(stored) : (COMMISSION_DEFAULTS[carrier] ?? DEFAULT_COMMISSION);
      return (Number.isFinite(pct) ? pct : 0) / 100;
    };

    const byMonth = new Map();
    const byCarrier = new Map();
    const totals = { count: 0, writtenPrem: 0, annualPrem: 0, retainedWr: 0, commission: 0 };

    for (const p of filtered) {
      const commRate = commRateFor(p.carrier);
      const retained = p.writtenPremium * retMult;
      const commission = retained * commRate;

      totals.count++;
      totals.writtenPrem += p.writtenPremium;
      totals.annualPrem += p.annualPremium;
      totals.retainedWr += retained;
      totals.commission += commission;

      const ym = (p.expirationDate || p.renewalDate).slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, { count: 0, writtenPrem: 0, annualPrem: 0, retainedWr: 0, commission: 0 });
      const m = byMonth.get(ym);
      m.count++;
      m.writtenPrem += p.writtenPremium;
      m.annualPrem += p.annualPremium;
      m.retainedWr += retained;
      m.commission += commission;

      const c = p.carrier || '(unknown)';
      if (!byCarrier.has(c)) byCarrier.set(c, { count: 0, writtenPrem: 0, annualPrem: 0, retainedWr: 0, commission: 0, ratePct: commRate * 100 });
      const bc = byCarrier.get(c);
      bc.count++;
      bc.writtenPrem += p.writtenPremium;
      bc.annualPrem += p.annualPremium;
      bc.retainedWr += retained;
      bc.commission += commission;
    }

    const months = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, b]) => ({ ym, label: monthLabel(ym), ...b }));

    const carriers = [...byCarrier.entries()]
      .sort((a, b) => b[1].writtenPrem - a[1].writtenPrem)
      .map(([c, b]) => ({ carrier: c, ...b }));

    const activeAll = policyMaster.policies.filter(p => p.isActive);
    return { months, carriers, totals, untermed: activeAll.length - active.length, activeCount: activeAll.length };
  }, [policyMaster, resolveProducer, carrierFilter, producerFilter, start, end, carrierCommissions, retMult]);

  if (!projection) return null;

  return (
    <div>
      <div className="mb-4 grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="bg-white rounded-lg p-4 border border-slate-200">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Assumed retention %</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={retentionPct}
              onChange={e => setRetentionPct(e.target.value)}
              className="w-24 border border-slate-300 rounded px-3 py-2 text-lg font-semibold"
            />
            <span className="text-slate-500 text-sm">%</span>
          </div>
          <div className="text-xs text-slate-500 mt-2 max-w-xs">
            Applied uniformly across all carriers. Commission uses your per-carrier rates below.
          </div>
        </div>

        <div className="bg-white rounded-lg p-4 border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-600">Commission % by carrier</div>
            <button
              onClick={() => setCarrierCommissions({})}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Reset to defaults
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
            {allCarriers.map(({ carrier, count }) => (
              <label key={carrier} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-700 truncate" title={`${count.toLocaleString()} policies on file`}>
                  {carrier}
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={carrierCommissions[carrier] ?? (COMMISSION_DEFAULTS[carrier] ?? DEFAULT_COMMISSION)}
                    onChange={e => setCommissionFor(carrier, e.target.value)}
                    className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-right"
                  />
                  <span className="text-slate-400 text-xs">%</span>
                </div>
              </label>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-3">
            Values persist locally in your browser. Unlisted carriers default to {DEFAULT_COMMISSION}%.
          </div>
        </div>
      </div>

      {projection.untermed > 0 && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {projection.untermed.toLocaleString()} of {projection.activeCount.toLocaleString()} active policies have no expiration date on record and were excluded. Add the <strong>Policy Expiration Date</strong> column to your EZLynx export and re-upload.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card
          label="Expiring Policies"
          value={projection.totals.count.toLocaleString()}
          sub="in date range"
        />
        <Card
          label="Expiring Written Prem"
          value={fmt$(projection.totals.writtenPrem)}
          sub="same-term dollars"
          tone="blue"
        />
        <Card
          label="Projected Retained"
          value={fmt$(projection.totals.retainedWr)}
          sub={`@ ${retentionPct}% retention`}
          tone="green"
        />
        <Card
          label="Projected Commission"
          value={fmt$(projection.totals.commission)}
          sub="per-carrier rates × retained"
          tone="green"
        />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-700">
          By month
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="text-right px-3 py-2">Policies</th>
                <th className="text-right px-3 py-2">Expiring Wr Prem</th>
                <th className="text-right px-3 py-2">Expiring Ann Prem</th>
                <th className="text-right px-3 py-2">Retained (Wr)</th>
                <th className="text-right px-3 py-2">Commission</th>
              </tr>
            </thead>
            <tbody>
              {projection.months.length === 0 && (
                <tr><td colSpan="6" className="text-center text-slate-400 py-6">No renewals in this range</td></tr>
              )}
              {projection.months.map(m => (
                <tr key={m.ym} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium">{m.label}</td>
                  <td className="text-right px-3 py-2">{m.count.toLocaleString()}</td>
                  <td className="text-right px-3 py-2">{fmt$(m.writtenPrem)}</td>
                  <td className="text-right px-3 py-2 text-slate-500">{fmt$(m.annualPrem)}</td>
                  <td className="text-right px-3 py-2 text-emerald-700">{fmt$(m.retainedWr)}</td>
                  <td className="text-right px-3 py-2 text-emerald-700 font-semibold">{fmt$(m.commission)}</td>
                </tr>
              ))}
            </tbody>
            {projection.months.length > 0 && (
              <tfoot className="bg-slate-50">
                <tr>
                  <td className="px-3 py-2 font-semibold">Total</td>
                  <td className="text-right px-3 py-2 font-semibold">{projection.totals.count.toLocaleString()}</td>
                  <td className="text-right px-3 py-2 font-semibold">{fmt$(projection.totals.writtenPrem)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-500">{fmt$(projection.totals.annualPrem)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-emerald-700">{fmt$(projection.totals.retainedWr)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-emerald-700">{fmt$(projection.totals.commission)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-700">
          By carrier
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-3 py-2">Carrier</th>
                <th className="text-right px-3 py-2">Comm %</th>
                <th className="text-right px-3 py-2">Policies</th>
                <th className="text-right px-3 py-2">Expiring Wr Prem</th>
                <th className="text-right px-3 py-2">Retained (Wr)</th>
                <th className="text-right px-3 py-2">Commission</th>
              </tr>
            </thead>
            <tbody>
              {projection.carriers.map(c => (
                <tr key={c.carrier} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium">{c.carrier}</td>
                  <td className="text-right px-3 py-2 text-slate-500">{c.ratePct.toFixed(1)}%</td>
                  <td className="text-right px-3 py-2">{c.count.toLocaleString()}</td>
                  <td className="text-right px-3 py-2">{fmt$(c.writtenPrem)}</td>
                  <td className="text-right px-3 py-2 text-emerald-700">{fmt$(c.retainedWr)}</td>
                  <td className="text-right px-3 py-2 text-emerald-700 font-semibold">{fmt$(c.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
