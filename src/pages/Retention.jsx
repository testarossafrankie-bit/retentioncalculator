import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header.jsx';
import Controls from '../components/Controls.jsx';
import AgencyKPIs from '../components/AgencyKPIs.jsx';
import ProducerLeaderboard from '../components/ProducerLeaderboard.jsx';
import UnmatchedTable from '../components/UnmatchedTable.jsx';
import MatchReviewTable from '../components/MatchReviewTable.jsx';
import BypassTokenPanel from '../components/BypassTokenPanel.jsx';
import { fetchSales, fetchTeamMembers, fetchOverrides, saveOverrides, fetchPolicyMaster, savePolicyMaster, expandPolicyMaster, fetchMatchDecisions, saveMatchDecisions } from '../services/api.js';
import { parsePolicyMaster } from '../utils/policyMasterParse.js';
import { matchSales } from '../utils/match.js';
import { computeRetention } from '../utils/retentionCalc.js';
import { buildProducerResolver } from '../utils/producerAliases.js';
import { inRange, priorMonthRange, parseFilterDateRange, iso } from '../utils/dateRange.js';
import { canonicalCarrier, isDisregardedCarrier } from '../utils/normalize.js';

const TABS = [
  { id: 'leaderboard', label: 'Producer Leaderboard' },
  { id: 'reviews', label: 'Match Reviews' },
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
  const [uploadedAt, setUploadedAt] = useState(null);
  const [pmSaveState, setPmSaveState] = useState('idle'); // 'idle' | 'saving' | 'error'

  const [dateField, setDateField] = useState('effDate');
  const [preset, setPreset] = useState('last-full-month');
  const initRange = priorMonthRange();
  const [start, setStart] = useState(initRange.start);
  const [end, setEnd] = useState(initRange.end);

  const [tab, setTab] = useState('leaderboard');
  const [showAdmins, setShowAdmins] = useState(false);
  const [carrierFilter, setCarrierFilter] = useState('all');
  const [producerFilter, setProducerFilter] = useState('all');

  // Corrections for unmatched sales — persisted to KV under `retention_overrides`.
  // Keyed by sale.id, applied before matching so a corrected row moves out of
  // "unmatched" as soon as the fix is saved.
  const [salesOverrides, setSalesOverrides] = useState({});
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'error'

  const persistOverrides = async (nextMap) => {
    setSaveState('saving');
    try {
      await saveOverrides(Object.values(nextMap));
      setSaveState('idle');
    } catch (e) {
      console.error('[overrides] save failed', e);
      setSaveState('error');
    }
  };

  // Confirm/reject decisions on loose matches (anything except policy-exact).
  // Rejected sales fall back to unmatched; confirmed ones get a badge but no
  // math change. Persisted under `retention_match_decisions`.
  const [matchDecisions, setMatchDecisions] = useState({}); // saleId → 'confirm'|'reject'
  const [decisionSaveState, setDecisionSaveState] = useState('idle');

  const persistDecisions = async (nextMap) => {
    setDecisionSaveState('saving');
    try {
      await saveMatchDecisions(Object.entries(nextMap).map(([id, decision]) => ({ id, decision, updatedAt: new Date().toISOString() })));
      setDecisionSaveState('idle');
    } catch (e) {
      console.error('[decisions] save failed', e);
      setDecisionSaveState('error');
    }
  };

  const setDecision = (saleId, decision) => {
    setMatchDecisions(m => {
      const next = { ...m };
      if (!decision) delete next[saleId];
      else next[saleId] = decision;
      persistDecisions(next);
      return next;
    });
  };

  const applyOverride = (id, patch) => {
    setSalesOverrides(o => {
      const next = { ...o, [id]: { id, ...patch, updatedAt: new Date().toISOString() } };
      persistOverrides(next);
      return next;
    });
  };

  const clearOverride = (id) => {
    setSalesOverrides(o => {
      const next = { ...o };
      delete next[id];
      persistOverrides(next);
      return next;
    });
  };

  const loadRemote = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [salesData, teamData, overridesData, savedMaster, decisionsData] = await Promise.all([
        fetchSales(), fetchTeamMembers(), fetchOverrides(), fetchPolicyMaster(), fetchMatchDecisions(),
      ]);
      setSales(Array.isArray(salesData) ? salesData.filter(s => !s.deleted) : []);
      setTeam(Array.isArray(teamData) ? teamData : []);
      const map = {};
      for (const o of overridesData) if (o?.id) map[o.id] = o;
      setSalesOverrides(map);
      const dmap = {};
      for (const d of decisionsData) if (d?.id && d?.decision) dmap[d.id] = d.decision;
      setMatchDecisions(dmap);
      if (savedMaster) {
        const expanded = expandPolicyMaster(savedMaster);
        // Rebuild the byApplicantId index (Maps don't survive JSON).
        const byApplicantId = new Map();
        for (const p of expanded.policies) {
          if (!p.applicantId) continue;
          if (!byApplicantId.has(p.applicantId)) byApplicantId.set(p.applicantId, []);
          byApplicantId.get(p.applicantId).push(p);
        }
        setPolicyMaster({ policies: expanded.policies, byApplicantId, filterMeta: expanded.filterMeta });
        setFileName(expanded.fileName || '');
        setUploadedAt(expanded.uploadedAt || null);
      }
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
    const parsed = parsePolicyMaster(buf);
    setPolicyMaster(parsed);
    // Persist to KV so refresh doesn't require re-upload. Save is fire-and-
    // forget from the user's POV — if it fails, the file still works this
    // session; a warning appears in the controls row.
    setPmSaveState('saving');
    const now = new Date().toISOString();
    setUploadedAt(now);
    try {
      await savePolicyMaster({
        fileName: file.name,
        filterMeta: parsed.filterMeta,
        policies: parsed.policies,
      });
      setPmSaveState('idle');
    } catch (e) {
      console.error('[policy master] save failed', e);
      setPmSaveState('error');
    }
  };

  const policyMasterMeta = useMemo(() => {
    if (!policyMaster) return null;
    // Only surface a range if the export was actually date-filtered. EZLynx
    // still fills in the Date Range cell (as the report-generation window)
    // even when Date Select is "No Date Filter" — don't warn in that case.
    const dateField = policyMaster.filterMeta?.dateField;
    const isFiltered = dateField && String(dateField).toLowerCase() !== 'no date filter';
    return { dateRange: isFiltered ? parseFilterDateRange(policyMaster.filterMeta.dateRange) : null };
  }, [policyMaster]);

  const resolveProducer = useMemo(() => buildProducerResolver(team), [team]);

  // Sales in the current date window (before carrier/producer filters). This
  // is the option universe for the dropdowns — narrowing the date range
  // refreshes the available carrier/producer options.
  const salesInDateRange = useMemo(() => {
    return sales.filter(s =>
      inRange(s[dateField], start, end) &&
      !isDisregardedCarrier(s.carrier)
    );
  }, [sales, dateField, start, end]);

  const availableCarriers = useMemo(() => {
    const set = new Set();
    for (const s of salesInDateRange) {
      const c = canonicalCarrier(s.carrier);
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [salesInDateRange]);

  const availableProducers = useMemo(() => {
    const set = new Set();
    for (const s of salesInDateRange) {
      const p = resolveProducer(s.agent || '').canonical;
      if (p && p !== '(unknown)') set.add(p);
    }
    return Array.from(set).sort();
  }, [salesInDateRange, resolveProducer]);

  const salesInRange = useMemo(() => {
    const filtered = salesInDateRange.filter(s => {
      if (carrierFilter !== 'all' && canonicalCarrier(s.carrier) !== carrierFilter) return false;
      if (producerFilter !== 'all' && resolveProducer(s.agent || '').canonical !== producerFilter) return false;
      return true;
    });
    // Apply session-only corrections from the Unmatched cleanup UI
    return filtered.map(s => salesOverrides[s.id] ? { ...s, ...salesOverrides[s.id] } : s);
  }, [salesInDateRange, salesOverrides, carrierFilter, producerFilter, resolveProducer]);

  // Raw match results — before user confirmations/rejections.
  const rawMatchResults = useMemo(() => {
    if (!policyMaster) return null;
    return matchSales(salesInRange, policyMaster.policies);
  }, [policyMaster, salesInRange]);

  // Applied decisions: 'reject' forces unmatched; 'confirm' just flags for UI.
  const matchResults = useMemo(() => {
    if (!rawMatchResults) return null;
    return rawMatchResults.map(r => {
      const decision = matchDecisions[r.sale.id];
      if (decision === 'reject') {
        return { ...r, status: 'unmatched', policyMatch: null, matchMethod: 'user-rejected', decision };
      }
      return { ...r, decision };
    });
  }, [rawMatchResults, matchDecisions]);

  const computation = useMemo(() => {
    if (!policyMaster || !matchResults) return null;
    return computeRetention({
      matchResults,
      byApplicantId: policyMaster.byApplicantId,
      resolveProducer,
    });
  }, [policyMaster, matchResults, resolveProducer]);

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
          uploadedAt={uploadedAt}
          pmSaveState={pmSaveState}
          carrierFilter={carrierFilter}
          onCarrierFilterChange={setCarrierFilter}
          availableCarriers={availableCarriers}
          producerFilter={producerFilter}
          onProducerFilterChange={setProducerFilter}
          availableProducers={availableProducers}
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
            {tab === 'reviews' && (
              <MatchReviewTable
                matchResults={computation.matchResults}
                decisions={matchDecisions}
                onSetDecision={setDecision}
                saveState={decisionSaveState}
              />
            )}
            {tab === 'unmatched' && (
              <UnmatchedTable
                results={computation.matchResults}
                salesOverrides={salesOverrides}
                onApplyOverride={applyOverride}
                onClearOverride={clearOverride}
                saveState={saveState}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
