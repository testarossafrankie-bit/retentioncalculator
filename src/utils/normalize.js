export function normalizePolicyNum(v) {
  if (v == null) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Phone normalization for household matching. Strip everything but digits and
// keep the last 10 (drops leading 1 for US numbers). Returns '' if we can't
// get to 10 digits — matching on 7 digits gives too many false hits.
export function normalizePhone(v) {
  if (v == null) return '';
  const digits = String(v).replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

// Last "word" of a normalized name. "john q public" → "public". Used with
// phone for the household match — a spouse+kid usually share last name +
// phone but not first name.
export function lastNameOf(nameNorm) {
  if (!nameNorm) return '';
  const parts = String(nameNorm).trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}

export function normalizeName(v) {
  if (v == null) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Bridge "Last, First" (Policy Master) ↔ "First Last" (Sales Log).
// Returns canonical "first last" lowercase, whitespace-collapsed.
export function normalizeProducer(v) {
  if (v == null) return '';
  const raw = String(v).trim();
  if (!raw) return '';
  if (raw.includes(',')) {
    const [last, first] = raw.split(',').map(s => s.trim());
    return normalizeName(`${first} ${last}`);
  }
  return normalizeName(raw);
}

// Canonicalize LOB across systems.
// Sales Log values (from policyType field): 'Auto', 'Home', 'Renters', 'Life', 'Umbrella', 'Motorcycle', 'Boat', 'RV', 'Commercial'
// Policy Master values: 'Auto (Personal)', 'Homeowners', 'Dwelling fire', 'Personal pkg', 'Watercraft (small boat)', 'Auto (Commercial)', etc.
export function canonicalLOB(v) {
  if (v == null) return 'Other';
  const s = String(v).toLowerCase().trim();
  if (!s) return 'Other';
  if (s.includes('auto') && s.includes('commercial')) return 'Commercial Auto';
  if (s.includes('auto')) return 'Auto';
  if (s.includes('homeowner') || s.includes('dwelling') || s === 'home') return 'Home';
  if (s.includes('renter')) return 'Renters';
  if (s.includes('umbrella')) return 'Umbrella';
  if (s.includes('life')) return 'Life';
  if (s.includes('motorcycle') || s.includes('motor cycle')) return 'Motorcycle';
  if (s.includes('watercraft') || s.includes('boat')) return 'Boat';
  if (s.includes('rv') || s.includes('recreational')) return 'RV';
  if (s.includes('personal pkg') || s.includes('package')) return 'Package';
  if (s.includes('commercial')) return 'Commercial';
  return v;
}

export function canonicalCarrier(v) {
  if (v == null) return '';
  const s = String(v).toLowerCase().trim();
  if (!s) return '';
  if (s.includes('progressive')) return 'Progressive';
  if (s.includes('travelers')) return 'Travelers';
  if (s.includes('safeco')) return 'Safeco';
  if (s.includes('nationwide')) return 'Nationwide';
  if (s.includes('geico')) return 'Geico';
  if (s.includes('american modern')) return 'American Modern';
  if (s.includes('hagerty')) return 'Hagerty';
  if (s.includes('foremost')) return 'Foremost';
  if (s.includes('national general') || s === 'natgen') return 'National General';
  if (s.includes('mercury')) return 'Mercury';
  if (s.includes('branch')) return 'Branch';
  if (s.includes('kemper')) return 'Kemper';
  return String(v).trim();
}
