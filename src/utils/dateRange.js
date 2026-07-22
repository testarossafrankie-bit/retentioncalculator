export function priorMonthRange(today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return { start: iso(first), end: iso(last) };
}

export function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Sales log stores dates as strings — accept common shapes and coerce to ISO.
export function toISO(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    // yyyy-mm-dd first (already ISO)
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    // mm/dd/yyyy or m/d/yy
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let [, mm, dd, yy] = m;
      if (yy.length === 2) yy = (Number(yy) < 50 ? '20' : '19') + yy;
      return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return iso(d);
}

export function inRange(dateStr, start, end) {
  const d = toISO(dateStr);
  if (!d) return false;
  return d >= start && d <= end;
}

// Parse EZLynx Filters sheet's "Date Range" cell — e.g., "6/1/2025 - 6/30/2025"
export function parseFilterDateRange(s) {
  if (!s || typeof s !== 'string') return null;
  const parts = s.split('-').map(x => x.trim());
  if (parts.length !== 2) return null;
  const start = toISO(parts[0]);
  const end = toISO(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}
