import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header.jsx';
import Controls from '../components/Controls.jsx';
import AgencyKPIs from '../components/AgencyKPIs.jsx';
import ProducerLeaderboard from '../components/ProducerLeaderboard.jsx';
import UnmatchedTable from '../components/UnmatchedTable.jsx';
import BypassTokenPanel from '../components/BypassTokenPanel.jsx';
import { fetchSales, fetchTeamMembers } from '../services/api.js';
import { parsePolicyMaster } from '../utils/policyMasterParse.js';
import { computeRetention } from '../utils/retentionCalc.js';
import { buildProducerResolver } from '../utils/producerAliases.js';
import { inRange, priorMonthRange, parseFilterDateRange, iso } from '../utils/dateRange.js';

const TABS = [
  { id: 'leaderboard', label: 'Producer Leaderboard' },
  { id: 'unmatched', label: 'Unmatched Cleanup' },
];

function presetRange(preset, today = new Date()) {
  if (preset === 'last-full-month') return priorMonthRange(today);
  if (preset === 'ytd') return { start: `${today.getFullYear()}-01-01`, end: iso(today) };
  if (preset === 'l12m') {
    const start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1);
    return { start: iso(start), end: iso(today) };
  }
  return null;
}

export default function Retention() {
  const [sales, setSales] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [policyMaster, setPolicyMaster] = useState(null);
  const [fileName, setFileName] = useState('');

  const [dateField, setDateField] = useState('effDate');
  const [preset, setPreset] = useState('last-full-month');
  const initRange = priorMonthRange();
  const [start, setStart] = useState(initRange.start);
  const [end, setEnd] = useState(initRange.end);

  const [tab, setTab] = useState('leaderboard');
  const [showAdmins, setShowAdmins] = useState(false);

  // Session-only corrections for unmatched sales — keyed by sale.id, values
  // are partial sale overrides ({ policyNum, customerName, carrier }). Applied
  // before the match runs so a corrected row can move out of "unmatched".
  const [salesOverrides, setSalesOverrides] = useState({});
  const applyOverride = (id, patch) => setSalesOverrides(o => ({ ...o, [id]: patch }));
  const clearOverride = (id) => setSalesOverrides(o => { const n = { ...o }; delete n[id]; return n; });

  const loadRemote = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [salesData, teamData] = await Promise.all([fetchSales(), fetchTeamMembers()]);
      setSales(Array.isArray(salesData) ? salesData.filter(s => !s.deleted) : []);
      setTeam(Array.isArray(teamData) ? teamData : []);
    } catch (e) {
      setLoadError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRemote(); }, []);

  const handlePreset = (id) => {
    setPreset(id);
    const range = presetRange(id);
    if (range) {
      setStart(range.start);
      setEnd(range.end);
    }
  };

  const handleFileUpload = async (file) => {
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    setPolicyMaster(parsePolicyMaster(buf));
  };

  const policyMasterMeta = useMemo(() => {
    if (!policyMaster) return null;
    return { dateRange: parseFilterDateRange(policyMaster.filterMeta.dateRange) };
  }, [policyMaster]);

  const salesInRange = useMemo(() => {
    const filtered = sales.filter(s => inRange(s[dateField], start, end));
    // Apply session-only corrections from the Unmatched cleanup UI
    return filtered.map(s => salesOverrides[s.id] ? { ...s, ...salesOverrides[s.id] } : s);
  }, [sales, dateField, start, end, salesOverrides]);

  const resolveProducer = useMemo(() => buildProducerResolver(team), [team]);

  const computation = useMemo(() => {
    if (!policyMaster) return null;
    return computeRetention({
      sales: salesInRange,
      policies: policyMaster.policies,
      byApplicantId: policyMaster.byApplicantId,
      resolveProducer,
    });
  }, [policyMaster, salesInRange, resolveProducer]);

  const showResults = computation && !loading;

  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-7xl mx-auto p-6">
        <Controls
          start={start} end={end}
          onStartChange={v => { setStart(v); setPreset('custom'); }}
          onEndChange={v => { setEnd(v); setPreset('custom'); }}
          dateField={dateField} onDateFieldChange={setDateField}
          onFileUpload={handleFileUpload}
          policyMasterMeta={policyMasterMeta}
          salesCount={salesInRange.length}
          policyCount={policyMaster?.policies.length || 0}
          fileName={fileName}
          loading={loading}
          error={loadError}
          onPresetSelect={handlePreset}
          activePreset={preset}
          teamLoaded={!loading && team.length > 0}
        />

        {loadError && (
          <BypassTokenPanel onSaved={loadRemote} />
        )}

        {!policyMaster && !loading && !loadError && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-slate-600">
            <div className="text-4xl mb-3">📊</div>
            <div className="font-semibold text-slate-800 mb-1">Upload the current Book of Business to begin</div>
            <div className="text-sm max-w-md mx-auto">
              Use the EZLynx Policy Master export with <strong>"No Date Filter"</strong> — that's the full current book.
              Any filtered file will produce misleading unmatched rates.
            </div>
          </div>
        )}

        {showResults && (
          <>
            <AgencyKPIs agency={computation.agency} />

            <div className="mb-6 flex gap-1 border-b border-slate-300">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'leaderboard' && (
              <ProducerLeaderboard
                producers={computation.producerRows}
                showAdmins={showAdmins}
                onToggleAdmins={setShowAdmins}
              />
            )}
            {tab === 'unmatched' && (
              <UnmatchedTable
                results={computation.matchResults}
                salesOverrides={salesOverrides}
                onApplyOverride={applyOverride}
                onClearOverride={clearOverride}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
