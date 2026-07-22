import { useState } from 'react';

export default function UnmatchedTable({ results, salesOverrides, onApplyOverride, onClearOverride, saveState }) {
  const rows = results.filter(r => r.status === 'unmatched');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});

  // Every result whose sale.id has an override applied — regardless of whether
  // the correction is still unmatched or now matches. Lets the user revert
  // wrong corrections that already flowed out of the unmatched queue.
  // Capped to the 5 most-recent corrections (sorted by override.updatedAt);
  // older ones are still saved in KV but not surfaced here so the section
  // doesn't grow unbounded.
  const RECENT_LIMIT = 5;
  const correctedRows = results
    .filter(r => salesOverrides?.[r.sale.id])
    .map(r => ({ r, ts: salesOverrides[r.sale.id]?.updatedAt || '' }))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, RECENT_LIMIT)
    .map(x => x.r);

  const overrideCountTotal = Object.keys(salesOverrides || {}).length;

  const startEdit = (sale) => {
    setEditingId(sale.id);
    setDraft({
      policyNum: sale.policyNum || '',
      customerName: sale.customerName || '',
      carrier: sale.carrier || '',
    });
  };

  const cancel = () => { setEditingId(null); setDraft({}); };

  const apply = (id) => {
    onApplyOverride(id, {
      policyNum: draft.policyNum.trim(),
      customerName: draft.customerName.trim(),
      carrier: draft.carrier.trim(),
    });
    cancel();
  };

  const overrideCount = Object.keys(salesOverrides || {}).length;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="section-header p-4 flex justify-between items-center">
        <h3 className="text-white font-semibold">Unmatched Sales — Cleanup Queue</h3>
        <div className="text-sm text-slate-200 flex items-center gap-3">
          <span>{rows.length} unmatched</span>
          {overrideCount > 0 && (
            <span className="text-emerald-300">· {overrideCount} correction{overrideCount === 1 ? '' : 's'} saved</span>
          )}
          {saveState === 'saving' && <span className="text-blue-300">· saving…</span>}
          {saveState === 'error' && <span className="text-rose-300">· save failed — check console</span>}
        </div>
      </div>
      <div className="p-4 text-sm text-slate-600 bg-amber-50 border-b border-amber-200">
        Click the pencil to edit a row's Policy #, Customer Name, or Carrier. Corrections save to the shared KV (persist across sessions and users) as override records — the underlying sales log entry stays untouched. Use ↺ to revert.
      </div>

      {correctedRows.length > 0 && (
        <div className="p-4 border-b border-slate-200">
          <div className="text-xs font-semibold text-slate-600 mb-2">
            RECENT CORRECTIONS ({correctedRows.length}
            {overrideCountTotal > RECENT_LIMIT && <span className="text-slate-400 font-normal"> of {overrideCountTotal} saved</span>})
          </div>
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="px-2 py-1">Customer</th>
                <th className="px-2 py-1">Corrected Policy #</th>
                <th className="px-2 py-1">Carrier</th>
                <th className="px-2 py-1">Current Status</th>
                <th className="px-2 py-1">Matched Master Row</th>
                <th className="px-2 py-1 text-right">Revert</th>
              </tr>
            </thead>
            <tbody>
              {correctedRows.map(r => (
                <tr key={r.sale.id} className="border-t border-slate-100">
                  <td className="px-2 py-1">{r.sale.customerName}</td>
                  <td className="px-2 py-1 font-mono">{r.sale.policyNum}</td>
                  <td className="px-2 py-1">{r.sale.carrier}</td>
                  <td className="px-2 py-1">
                    {r.status === 'retained' && <span className="text-emerald-700">retained</span>}
                    {r.status === 'cancelled' && <span className="text-rose-700">cancelled</span>}
                    {r.status === 'unmatched' && <span className="text-amber-700">still unmatched</span>}
                  </td>
                  <td className="px-2 py-1">
                    {r.policyMatch ? `${r.policyMatch.accountName} · ${r.policyMatch.lob}` : '—'}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      onClick={() => onClearOverride(r.sale.id)}
                      className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded hover:bg-rose-200 text-xs"
                      title="Revert this correction"
                    >
                      ↺ Revert
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-700 text-left">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Policy #</th>
              <th className="px-3 py-2">Carrier</th>
              <th className="px-3 py-2">LOB</th>
              <th className="px-3 py-2">Producer</th>
              <th className="px-3 py-2">Eff Date</th>
              <th className="px-3 py-2">Premium</th>
              <th className="px-3 py-2">Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sale = r.sale;
              const isEditing = editingId === sale.id;
              const isOverridden = salesOverrides && salesOverrides[sale.id];
              return (
                <tr key={sale.id} className={`border-t border-slate-100 ${isOverridden ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <button onClick={() => apply(sale.id)} className="text-emerald-700 hover:text-emerald-900" title="Apply">✓</button>
                        <button onClick={cancel} className="text-slate-500 hover:text-slate-700" title="Cancel">✕</button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <button onClick={() => startEdit(sale)} className="text-slate-500 hover:text-blue-600" title="Edit">✎</button>
                        {isOverridden && (
                          <button onClick={() => onClearOverride(sale.id)} className="text-slate-400 hover:text-rose-600 text-xs" title="Clear correction">↺</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        value={draft.customerName}
                        onChange={e => setDraft({ ...draft, customerName: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                      />
                    ) : sale.customerName}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {isEditing ? (
                      <input
                        value={draft.policyNum}
                        onChange={e => setDraft({ ...draft, policyNum: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono"
                      />
                    ) : sale.policyNum}
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        value={draft.carrier}
                        onChange={e => setDraft({ ...draft, carrier: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                      />
                    ) : sale.carrier}
                  </td>
                  <td className="px-3 py-2">{sale.policyType}</td>
                  <td className="px-3 py-2">{sale.agent}</td>
                  <td className="px-3 py-2">{sale.effDate}</td>
                  <td className="px-3 py-2">${sale.premium}</td>
                  <td className="px-3 py-2">{sale.isRewrite ? 'Rewrite' : 'NB'}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={9} className="text-center text-slate-500 py-6">Nothing unmatched — nice.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
