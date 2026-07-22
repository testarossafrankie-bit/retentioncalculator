import { useMemo, useState } from 'react';

const COLUMNS = [
  { id: 'canonical', label: 'Producer', numeric: false },
  { id: 'eligibleCustomers', label: 'Customers', numeric: true },
  { id: 'writtenPremium', label: 'Written Prem', numeric: true },
  { id: 'writtenAnnualized', label: 'Written Ann', numeric: true },
  { id: 'activePremium', label: 'Active Prem', numeric: true },
  { id: 'custRetention', label: 'Cust Ret', numeric: true },
  { id: 'writtenPremRetention', label: 'Wr Prem Ret', numeric: true },
  { id: 'annualizedPremRetention', label: 'Ann Prem Ret', numeric: true },
  { id: 'avgPremium', label: 'Avg Prem', numeric: true },
  { id: 'bundlePct', label: 'Bundle %', numeric: true },
  { id: 'score', label: 'Score', numeric: true },
];

function fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }
function fmt$(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function scoreTone(score) {
  if (score >= 90) return { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' };
  if (score >= 80) return { bg: 'bg-amber-100', text: 'text-amber-900', dot: 'bg-amber-500' };
  if (score >= 70) return { bg: 'bg-orange-100', text: 'text-orange-900', dot: 'bg-orange-500' };
  return { bg: 'bg-rose-100', text: 'text-rose-900', dot: 'bg-rose-500' };
}

function retentionTone(rate) {
  const pct = rate * 100;
  if (pct >= 90) return 'text-emerald-700';
  if (pct >= 80) return 'text-amber-800';
  if (pct >= 70) return 'text-orange-800';
  return 'text-rose-700';
}

function DetailPanel({ producer }) {
  const rows = [...producer.customers].sort((a, b) => b.writtenPremium - a.writtenPremium);
  return (
    <div className="bg-slate-50 border-t border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-600 mb-2">Customers ({rows.length})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left px-2 py-1">Customer</th>
              <th className="text-left px-2 py-1">First Eff</th>
              <th className="text-right px-2 py-1">Tenure (d)</th>
              <th className="text-right px-2 py-1">Written</th>
              <th className="text-right px-2 py-1">Written Ann</th>
              <th className="text-right px-2 py-1">Active Wr</th>
              <th className="text-right px-2 py-1">Active Ann</th>
              <th className="text-right px-2 py-1">Active Polys</th>
              <th className="text-center px-2 py-1">Rewrite?</th>
              <th className="text-center px-2 py-1">Eligible?</th>
              <th className="text-center px-2 py-1">Retained?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.key} className="border-t border-slate-200">
                <td className="px-2 py-1 font-medium">{c.displayName}</td>
                <td className="px-2 py-1">{c.firstEffDate}</td>
                <td className="text-right px-2 py-1">{c.tenureDays}</td>
                <td className="text-right px-2 py-1">{fmt$(c.writtenPremium)}</td>
                <td className="text-right px-2 py-1">{fmt$(c.writtenAnnualized)}</td>
                <td className="text-right px-2 py-1">{fmt$(c.activeWritten)}</td>
                <td className="text-right px-2 py-1">{fmt$(c.activePremium)}</td>
                <td className="text-right px-2 py-1">{c.activePolicyCount}</td>
                <td className="text-center px-2 py-1">{c.hasRewriteInPeriod ? '✓' : ''}</td>
                <td className="text-center px-2 py-1">{c.eligible ? '✓' : <span className="text-slate-400">no</span>}</td>
                <td className="text-center px-2 py-1">{c.retained ? <span className="text-emerald-700">✓</span> : <span className="text-rose-700">✗</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProducerLeaderboard({ producers, showAdmins, onToggleAdmins }) {
  const [expanded, setExpanded] = useState(null);
  const [sortField, setSortField] = useState('score');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Numeric columns default to desc (bigger-is-better), text to asc
      const col = COLUMNS.find(c => c.id === field);
      setSortDir(col?.numeric ? 'desc' : 'asc');
    }
  };

  const rows = useMemo(() => {
    const filtered = showAdmins ? producers : producers.filter(p => !p.isAdmin);
    const col = COLUMNS.find(c => c.id === sortField);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (col?.numeric) return ((av ?? 0) - (bv ?? 0)) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
  }, [producers, showAdmins, sortField, sortDir]);

  const arrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="section-header p-4 flex justify-between items-center">
        <h2 className="text-white font-semibold tracking-wide">PRODUCER LEADERBOARD</h2>
        <label className="text-xs text-slate-200 flex items-center gap-2">
          <input type="checkbox" checked={showAdmins} onChange={e => onToggleAdmins(e.target.checked)} />
          include admins
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="text-left px-3 py-2">#</th>
              {COLUMNS.map(c => (
                <th
                  key={c.id}
                  onClick={() => handleSort(c.id)}
                  className={`px-3 py-2 cursor-pointer select-none hover:bg-slate-200 ${c.numeric ? 'text-right' : 'text-left'} ${sortField === c.id ? 'text-blue-700' : ''}`}
                  title="Click to sort"
                >
                  {c.label}{arrow(c.id)}
                </th>
              ))}
            </tr>
            <tr className="text-[10px] text-slate-500 border-t border-slate-200">
              <th colSpan={3}></th>
              <th className="text-right px-3 py-1 font-normal">same-term</th>
              <th className="text-right px-3 py-1 font-normal">12mo</th>
              <th className="text-right px-3 py-1 font-normal">12mo</th>
              <th></th>
              <th className="text-right px-3 py-1 font-normal">same-term</th>
              <th className="text-right px-3 py-1 font-normal">12mo both sides</th>
              <th colSpan={3}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const tone = scoreTone(p.score);
              const isOpen = expanded === p.canonical;
              return (
                <>
                  <tr
                    key={p.canonical}
                    onClick={() => setExpanded(isOpen ? null : p.canonical)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2 font-semibold">
                      {p.canonical}
                      {p.isAdmin && <span className="ml-2 text-xs text-slate-500">(admin)</span>}
                    </td>
                    <td className="text-right px-3 py-2" title={`Eligible ${p.eligibleCustomers} · <31d ${p.excludedNew} · unmatched ${p.excludedUnmatched}`}>
                      {p.eligibleCustomers}
                      {(p.excludedNew + p.excludedUnmatched) > 0 && <span className="text-slate-400 text-xs"> +{p.excludedNew + p.excludedUnmatched}</span>}
                    </td>
                    <td className="text-right px-3 py-2">{fmt$(p.writtenPremium)}</td>
                    <td className="text-right px-3 py-2">{fmt$(p.writtenAnnualized)}</td>
                    <td className="text-right px-3 py-2">{fmt$(p.activePremium)}</td>
                    <td className={`text-right px-3 py-2 font-semibold ${retentionTone(p.custRetention)}`}>{fmtPct(p.custRetention)}</td>
                    <td className={`text-right px-3 py-2 ${retentionTone(p.writtenPremRetention)}`}>{fmtPct(p.writtenPremRetention)}</td>
                    <td className={`text-right px-3 py-2 ${retentionTone(p.annualizedPremRetention)}`}>{fmtPct(p.annualizedPremRetention)}</td>
                    <td className="text-right px-3 py-2">{fmt$(p.avgPremium)}</td>
                    <td className="text-right px-3 py-2">{fmtPct(p.bundlePct)}</td>
                    <td className="text-right px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded font-bold ${tone.bg} ${tone.text}`}>
                        <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                        {p.score}
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={12} className="p-0">
                        <DetailPanel producer={p} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={12} className="text-center text-slate-500 py-6">No producers.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
        Score = 30% Written Prem + 30% Cust Retention + 20% Annualized Prem Retention + 10% Bundle % + 10% Avg Prem.
        <strong>Wr Prem Ret</strong> compares same-term dollars (like-to-like, matches your production reports). <strong>Ann Prem Ret</strong> normalizes both sides to 12mo so carrier mix doesn't distort. Written / Avg premium are scaled to the top peer. "+N" next to Customers = excluded from retention (&lt;31d tenure OR unmatched in master); hover the number for the split.
      </div>
    </div>
  );
}
