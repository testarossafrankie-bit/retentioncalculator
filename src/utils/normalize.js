// Sales-log-side prefixes that don't appear on the Policy Master. Progressive
// Property policies show up in the sales log with a "PGR" (Progressive ticker)
// prefix — the EZLynx master stores the bare policy number. "Q" is
// Progressive's Quote letter; sales log sometimes retains it even after bind.
// Longest prefixes first so a "PGRQ..." style doesn't shave only one letter.
const STRIPPABLE_PREFIXES = ['pgr', 'prg', 'q'];

export function normalizePolicyNum(v) {
  if (v == null) return '';
  let s = String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const prefix of STRIPPABLE_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  return s;
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

// Produce candidate names for a joint-applicant string.
// "Jason Macsherry & Kathellen Robinson" → ["jason macsherry kathellen robinson",
//   "jason macsherry", "kathellen robinson"].
// " and " / "&" are the common joiners. The full normalized string is kept first
// so single-applicant names (no splits) still work.
export function nameAliases(v) {
  if (v == null) return [];
  const full = normalizeName(v);
  if (!full) return [];
  const aliases = new Set([full]);
  // Split on " and " / "&" in the raw string before normalize so we don't
  // split real names that happen to contain "and" as a substring (e.g.,
  // "Andrea Smith"). Use word-boundary " and " / " & ".
  const parts = String(v).split(/\s+(?:&|and)\s+/i);
  if (parts.length > 1) {
    for (const p of parts) {
      const n = normalizeName(p);
      if (n) aliases.add(n);
    }
  }
  return [...aliases];
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

// Carriers not present in the EZLynx book of business — sales with these
// carriers are dropped from the retention calc entirely (don't count as
// written OR retained OR lost). Add more here as they come up.
const DISREGARDED_CARRIERS = new Set(['cure']);

export function isDisregardedCarrier(v) {
  if (v == null) return false;
  const s = String(v).toLowerCase().trim();
  for (const d of DISREGARDED_CARRIERS) {
    if (s.includes(d)) return true;
  }
  return false;
}

export function canonicalCarrier(v) {
  if (v == null) return '';
  const s = String(v).toLowerCase().trim();
  if (!s) return '';
  // Safeco rebranded to Liberty Mutual in our sales log (2026-09-23) but EZLynx
  // still writes "Safeco Insurance". Collapse both into one bucket so pre- and
  // post-rebrand business line up with the Master.
  if (s.includes('safeco') || s.includes('liberty mutual') || s === 'liberty') return 'Safeco';
  if (s.includes('progressive')) return 'Progressive';
  if (s.includes('travelers')) return 'Travelers';
  if (s.includes('nationwide')) return 'Nationwide';
  if (s.includes('geico')) return 'Geico';
  // AMIG = American Modern Insurance Group. Sales log uses "Amig" / "AMIG".
  if (s.includes('amig') || s.includes('american modern')) return 'American Modern';
  if (s.includes('hagerty')) return 'Hagerty';
  if (s.includes('foremost')) return 'Foremost';
  // "NatGen 360" and "NatGenValue" are National General sub-brands.
  if (s.includes('national general') || s.includes('natgen')) return 'National General';
  if (s.includes('msa') || s.includes('main street america')) return 'MSA';
  if (s.includes('metlife') || s.includes('met life')) return 'MetLife';
  if (s.includes('openly')) return 'Openly';
  if (s.includes('bristol')) return 'Bristol West';
  if (s.includes('capitol')) return 'Capitol';
  if (s.includes('utica')) return 'Utica First';
  if (s.includes('western world')) return 'Western World';
  if (s.includes('fire insurance exchange') || s.includes('farmers')) return 'Farmers';
  if (s.includes('mercury')) return 'Mercury';
  if (s.includes('branch')) return 'Branch';
  if (s.includes('kemper')) return 'Kemper';
  return String(v).trim();
}
