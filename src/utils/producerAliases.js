// Explicit short-form → canonical first name.
// Add here when a producer's sales-log spelling deviates from their real first name.
const SHORT_FORMS = {
  jess: 'jessica',
  mandy: 'amanda',
  steve: 'stephen',
  mike: 'michael',
  barb: 'barbie',
  chris: 'christopher',
  matt: 'matthew',
  tom: 'thomas',
  tommy: 'thomas',
  bob: 'robert',
  rob: 'robert',
  liz: 'elizabeth',
};

// Names that should be excluded from the producer leaderboard (managers / admins
// who occasionally write policies but aren't being measured as producers).
const ADMIN_NAMES = new Set(['frank terragrossa', 'frank']);

function keyify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

// Build the resolver from the team_members list fetched from KV.
// Returns a function: rawAgent → { canonical: 'Full Name', isAdmin: bool, isKnown: bool }
export function buildProducerResolver(teamMembers = []) {
  const active = teamMembers.filter(m => (m.status || 'Active') !== 'Terminated');

  // Map first-name (lowercase) → full name (as stored in team_members)
  const byFirst = new Map();
  for (const m of active) {
    const parts = keyify(m.name).split(' ');
    if (!parts[0]) continue;
    if (!byFirst.has(parts[0])) byFirst.set(parts[0], m.name);
  }

  const cache = new Map();

  return function resolve(raw) {
    if (raw == null) return { canonical: '(unknown)', isAdmin: false, isKnown: false };
    const rawKey = keyify(raw);
    if (!rawKey) return { canonical: '(unknown)', isAdmin: false, isKnown: false };
    if (cache.has(rawKey)) return cache.get(rawKey);

    const isAdmin = ADMIN_NAMES.has(rawKey);

    // Two-token names (e.g. "Frank Terragrossa") — resolve by full match against team_members
    const tokens = rawKey.split(' ');
    if (tokens.length >= 2) {
      const fullMatch = active.find(m => keyify(m.name) === rawKey);
      if (fullMatch) {
        const out = { canonical: fullMatch.name, isAdmin: ADMIN_NAMES.has(keyify(fullMatch.name)) || isAdmin, isKnown: true };
        cache.set(rawKey, out);
        return out;
      }
      // fall through: use the raw string as canonical
      const out = { canonical: raw, isAdmin, isKnown: false };
      cache.set(rawKey, out);
      return out;
    }

    // Single-token (first-name-only): apply short-form + first-name lookup.
    // Fallback order: team_members full name → team_members via short-form →
    // titlecased canonical first name (so Jess and Jessica merge into "Jessica"
    // even when there's no matching team_members entry).
    const expanded = SHORT_FORMS[tokens[0]] || tokens[0];
    const titled = expanded.charAt(0).toUpperCase() + expanded.slice(1);
    const canonical = byFirst.get(expanded) || byFirst.get(tokens[0]) || titled;
    const finalAdmin = ADMIN_NAMES.has(keyify(canonical)) || isAdmin;
    const out = { canonical, isAdmin: finalAdmin, isKnown: byFirst.has(expanded) || byFirst.has(tokens[0]) };
    cache.set(rawKey, out);
    return out;
  };
}
