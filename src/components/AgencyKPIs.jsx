function fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }
function fmt$(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function Card({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200',
    green: 'border-emerald-300 bg-emerald-50',
    red: 'border-rose-300 bg-rose-50',
    amber: 'border-amber-300 bg-amber-50',
    blue: 'border-blue-300 bg-blue-50',
  };
  return (
    <div className={`rounded-lg border-2 p-4 bg-white ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function AgencyKPIs({ agency }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
      <Card
        label="Customer Retention"
        value={fmtPct(agency.custRetention)}
        sub={`${agency.retainedCustomers} of ${agency.eligibleCustomers} eligible`}
        tone="green"
      />
      <Card
        label="Written Prem Retention"
        value={fmtPct(agency.writtenPremRetention)}
        sub={`${fmt$(agency.activeWritten)} same-term active`}
        tone="blue"
      />
      <Card
        label="Annualized Prem Retention"
        value={fmtPct(agency.annualizedPremRetention)}
        sub={`${fmt$(agency.activePremium)} annualized active`}
        tone="blue"
      />
      <Card
        label="Written Premium"
        value={fmt$(agency.writtenPremium)}
        sub={`${agency.totalCustomers} unique customers · same-term`}
      />
      <Card
        label="Written Ann"
        value={fmt$(agency.writtenAnnualized)}
        sub="12mo annualized at bind"
      />
      <Card
        label="Excluded"
        value={agency.excludedNew + agency.excludedUnmatched}
        sub={`${agency.excludedNew} < 31 days · ${agency.excludedUnmatched} unmatched`}
        tone="amber"
      />
    </div>
  );
}
