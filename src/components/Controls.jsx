import { useRef, useState } from 'react';

const RANGE_PRESETS = [
  { id: 'last-full-month', label: 'Prior month' },
  { id: 'ytd', label: 'YTD' },
  { id: 'l12m', label: 'Last 12 months' },
  { id: 'custom', label: 'Custom…' },
];

export default function Controls({
  start, end, onStartChange, onEndChange,
  dateField, onDateFieldChange,
  onFileUpload,
  policyMasterMeta,
  salesCount, policyCount, fileName,
  loading, error,
  onPresetSelect, activePreset,
  teamLoaded,
  uploadedAt, pmSaveState,
  carrierFilter, onCarrierFilterChange, availableCarriers,
  producerFilter, onProducerFilterChange, availableProducers,
  sourceFilter, onSourceFilterChange, availableSources,
}) {
  const fileRef = useRef();
  const [dragOver, setDragOver] = useState(false);

  const masterIsFiltered = policyMasterMeta?.dateRange != null;

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) return;
    onFileUpload(file);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Range</label>
          <select
            value={activePreset}
            onChange={e => onPresetSelect(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          >
            {RANGE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Date Field</label>
          <select
            value={dateField}
            onChange={e => onDateFieldChange(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="effDate">Effective</option>
            <option value="bindDate">Bind</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Start</label>
          <input type="date" value={start} onChange={e => onStartChange(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">End</label>
          <input type="date" value={end} onChange={e => onEndChange(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Book of Business (.xlsx)
            {fileName && <span className="ml-2 font-normal text-slate-400">— {uploadedAt ? `saved ${new Date(uploadedAt).toLocaleString()}` : 'not yet saved'}</span>}
          </label>
          <input
            type="file"
            accept=".xlsx,.xls"
            ref={fileRef}
            onChange={e => e.target.files?.[0] && onFileUpload(e.target.files[0])}
            className="hidden"
          />
          <div
            onClick={() => fileRef.current?.click()}
            onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`w-full border-2 border-dashed rounded px-3 py-2 text-sm text-left truncate cursor-pointer transition ${
              dragOver
                ? 'border-blue-500 bg-blue-50'
                : fileName
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                  : 'border-slate-300 hover:bg-slate-50'
            }`}
            title="Click to choose or drop an .xlsx file to replace the current one"
          >
            {fileName ? `✓ ${fileName} · click to replace` : dragOver ? 'Drop the file to load…' : 'Click or drag & drop .xlsx'}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Carrier</label>
          <select
            value={carrierFilter}
            onChange={e => onCarrierFilterChange(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="all">All carriers</option>
            {availableCarriers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Producer</label>
          <select
            value={producerFilter}
            onChange={e => onProducerFilterChange(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="all">All producers</option>
            {availableProducers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Source</label>
          <select
            value={sourceFilter}
            onChange={e => onSourceFilterChange(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="all">All sources</option>
            {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {(carrierFilter !== 'all' || producerFilter !== 'all' || sourceFilter !== 'all') && (
          <div className="flex items-end">
            <button
              onClick={() => { onCarrierFilterChange('all'); onProducerFilterChange('all'); onSourceFilterChange('all'); }}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">
        <div><span className="font-semibold text-slate-800">{salesCount}</span> sales in range</div>
        <div><span className="font-semibold text-slate-800">{policyCount}</span> master policies</div>
        <div className={teamLoaded ? 'text-emerald-700' : 'text-slate-400'}>
          {teamLoaded ? '✓ team roster loaded' : 'loading team roster…'}
        </div>
        {loading && <div className="text-blue-600">Loading sales…</div>}
        {pmSaveState === 'saving' && <div className="text-blue-600">Saving Policy Master…</div>}
        {pmSaveState === 'error' && <div className="text-rose-700">Policy Master save failed — file usable this session, but won't persist</div>}
        {error && <div className="text-rose-700">Error: {error}</div>}
      </div>

      {masterIsFiltered && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-900">
          <strong>Heads up:</strong> the uploaded Policy Master has an EZLynx date filter of {policyMasterMeta.dateRange.start} → {policyMasterMeta.dateRange.end}.
          For accurate retention, use a Policy Master exported with <strong>"No Date Filter"</strong> — that's the full current book. A filtered file will make most sales look "unmatched."
        </div>
      )}
    </div>
  );
}
