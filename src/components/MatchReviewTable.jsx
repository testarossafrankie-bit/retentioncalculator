import { useMemo, useState } from 'react';

const REVIEWABLE_METHODS = new Set([
  'applicant-id-via-name',
  'name-normalized',
  'name+carrier+lob',
  'household',
]);

const METHOD_LABELS = {
  'applicant-id-via-name': 'Applicant ID (via name)',
  'name-normalized': 'Name only',
  'name+carrier+lob': 'Name + Carrier + LOB',
  'household': 'Household (phone + last name)',
};

const FILTERS = [
  { id: 'unreviewed', label: 'Unreviewed' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

function fuzzyLabel(method) { return method?.startsWith('fuzzy-policy') ? `Fuzzy policy ${method.match(/d=(\d)/)?.[0] || ''}` : null; }

export default function MatchReviewTable({ matchResults, decisions, onSetDecision, saveState }) {
  const [filter, setFilter] = useState('unreviewed');

  const rows = useMemo(() => {
    const all = matchResults.filter(r => {
      if (!r.matchMethod) return false;
      if (r.status === 'unmatched') return false;
      if (r.matchMethod === 'policy-exact') return false;
      return REVIEWABLE_METHODS.has(r.matchMethod) || r.matchMethod.startsWith('fuzzy-policy');
    });
    if (filter === 'all') return all;
    if (filter === 'unreviewed') return all.filter(r => !decisions[r.sale.id]);
    return all.filter(r => decisions[r.sale.id] === filter);
  }, [matchResults, decisions, filter]);

  const counts = useMemo(() => {
    const c = { unreviewed: 0, confirmed: 0, rejected: 0, all: 0 };
    for (const r of matchResults) {
      if (!r.matchMethod || r.status === 'unmatched' || r.matchMethod === 'policy-exact') continue;
      if (!(REVIEWABLE_METHODS.has(r.matchMethod) || r.matchMethod.startsWith('fuzzy-policy'))) continue;
      c.all++;
      const dec = decisions[r.sale.id];
      if (!dec) c.unreviewed++;
      else c[dec] = (c[dec] || 0) + 1;
    }
    return c;
  }, [matchResults, decisions]);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="section-header p-4 flex justify-between items-center">
        <div>
          <h3 className="text-white font-semibold">Match Reviews</h3>
          <div className="text-xs text-slate-300 mt-1">
            Loose matches (anything looser than an exact policy #) surface here. Confirm the ones that look right; reject bad matches so they flow back to Unmatched.
          </div>
        </div>
        <div className="text-sm text-slate-200 flex items-center gap-3">
          {saveState === 'saving' && <span className="text-blue-300">saving…</span>}
          {saveState === 'error' && <span className="text-rose-300">save failed</span>}
        </div>
      </div>

      <div className="flex gap-1 p-3 border-b border-slate-200 bg-slate-50">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1 rounded text-xs font-medium ${filter === f.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
          >
            {f.label} <span className="opacity-60">({counts[f.id]})</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-700 text-left">
            <tr>
              <th className="px-3 py-2">Sale (Customer / Policy)</th>
              <th className="px-3 py-2">Matched Master Row</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const dec = decisions[r.sale.id];
              const label = METHOD_LABELS[r.matchMethod] || fuzzyLabel(r.matchMethod) || r.matchMethod;
              const bg = dec === 'confirm' ? 'bg-emerald-50' : dec === 'reject' ? 'bg-rose-50' : '';
              return (
                <tr key={r.sale.id} className={`border-t border-slate-100 ${bg}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.sale.customerName}</div>
                    <div className="text-xs text-slate-500 font-mono">{r.sale.policyNum} · {r.sale.carrier} · {r.sale.policyType}</div>
                    <div className="text-xs text-slate-400">Agent: {r.sale.agent} · Eff {r.sale.effDate}</div>
                  </td>
                  <td className="px-3 py-2">
                    {r.policyMatch ? (
                      <>
                        <div className="font-medium">{r.policyMatch.accountName}</div>
                        <div className="text-xs text-slate-500 font-mono">{r.policyMatch.policyNumber} · {r.policyMatch.carrier} · {r.policyMatch.lob}</div>
                        <div className="text-xs text-slate-400">
                          {r.policyMatch.isActive ? 'Active' : 'Cancelled'} · Prem ${r.policyMatch.annualPremium?.toLocaleString?.() || r.policyMatch.annualPremium}
                        </div>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{label}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.status === 'retained' && <span className="text-emerald-700">retained</span>}
                    {r.status === 'cancelled' && <span className="text-rose-700">cancelled</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => onSetDecision(r.sale.id, dec === 'confirm' ? null : 'confirm')}
                        className={`px-2 py-1 rounded text-xs font-semibold ${dec === 'confirm' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                        title="Confirm this match"
                      >
                        ✓ Confirm
                      </button>
                      <button
                        onClick={() => onSetDecision(r.sale.id, dec === 'reject' ? null : 'reject')}
                        className={`px-2 py-1 rounded text-xs font-semibold ${dec === 'reject' ? 'bg-rose-600 text-white' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}
                        title="Reject — treat as unmatched"
                      >
                        ✗ Reject
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-6">No matches in this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
