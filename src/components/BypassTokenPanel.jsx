import { useState } from 'react';
import { getBypassToken, setBypassToken } from '../services/api.js';

export default function BypassTokenPanel({ onSaved }) {
  const [value, setValue] = useState(getBypassToken());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setBypassToken(value.trim());
    setSaved(true);
    onSaved?.();
  };

  return (
    <div className="bg-rose-50 border-2 border-rose-300 rounded-lg p-6 mb-6">
      <div className="flex items-start gap-3">
        <div className="text-2xl">🔒</div>
        <div className="flex-1">
          <h3 className="font-bold text-rose-900 mb-1">Vercel Protection Bypass Required</h3>
          <p className="text-sm text-rose-800 mb-3">
            The FBI Portal API is behind Vercel Deployment Protection, so this dashboard can't read
            <code className="bg-white px-1 mx-1 rounded text-xs">sales</code> or
            <code className="bg-white px-1 mx-1 rounded text-xs">team_members</code> without a bypass token.
            Get it at: Vercel Dashboard → <em>fbi-portal-source</em> → Settings → Deployment Protection → <strong>Protection Bypass for Automation</strong>.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="paste bypass secret"
              className="flex-1 border border-rose-300 rounded px-3 py-2 text-sm bg-white"
            />
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-rose-600 text-white rounded text-sm font-semibold hover:bg-rose-700"
            >
              Save + retry
            </button>
          </div>
          {saved && <div className="text-xs text-emerald-700 mt-2">Saved to localStorage. Reload if the retry didn't kick.</div>}
          <div className="text-xs text-rose-700 mt-2">
            Stored in browser localStorage only — never sent anywhere but the FBI Portal API.
          </div>
        </div>
      </div>
    </div>
  );
}
