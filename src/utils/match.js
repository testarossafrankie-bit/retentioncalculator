import { boundedLevenshtein } from './levenshtein.js';
import { canonicalCarrier, canonicalLOB, lastNameOf, normalizeName, normalizePhone, normalizePolicyNum } from './normalize.js';

const FUZZY_POLICY_MAX_EDITS = 2;

function buildPolicyIndex(policies) {
  const byPolicyNum = new Map();
  const byName = new Map();               // nameNorm → policies[]
  const byNameToAids = new Map();         // nameNorm → Set<applicantId>
  const byNameCarrier = new Map();        // `${name}|${carrier}` → policies[]
  const byPhoneLastName = new Map();      // `${phone}|${lastName}` → policies[]
  const allPolicyNums = [];

  for (const p of policies) {
    if (p.policyNumberNorm) {
      if (!byPolicyNum.has(p.policyNumberNorm)) byPolicyNum.set(p.policyNumberNorm, []);
      byPolicyNum.get(p.policyNumberNorm).push(p);
      allPolicyNums.push(p.policyNumberNorm);
    }

    if (p.accountNameNorm) {
      if (!byName.has(p.accountNameNorm)) byName.set(p.accountNameNorm, []);
      byName.get(p.accountNameNorm).push(p);

      if (p.applicantId) {
        if (!byNameToAids.has(p.accountNameNorm)) byNameToAids.set(p.accountNameNorm, new Set());
        byNameToAids.get(p.accountNameNorm).add(p.applicantId);
      }

      if (p.carrier) {
        const nc = `${p.accountNameNorm}|${p.carrier.toLowerCase()}`;
        if (!byNameCarrier.has(nc)) byNameCarrier.set(nc, []);
        byNameCarrier.get(nc).push(p);
      }

      if (p.phone) {
        const ln = lastNameOf(p.accountNameNorm);
        if (ln) {
          const hk = `${p.phone}|${ln}`;
          if (!byPhoneLastName.has(hk)) byPhoneLastName.set(hk, []);
          byPhoneLastName.get(hk).push(p);
        }
      }
    }
  }
  return { byPolicyNum, byName, byNameToAids, byNameCarrier, byPhoneLastName, allPolicyNums };
}

// Score-and-pick: prefer active > same LOB > same carrier > first.
function pickBestMatch(candidates, { lob, carrier } = {}) {
  if (!candidates || !candidates.length) return null;
  let best = null, bestScore = -1;
  for (const p of candidates) {
    let s = 0;
    if (p.isActive) s += 100;
    if (lob && p.lob === lob) s += 10;
    if (carrier && String(p.carrier || '').toLowerCase() === carrier) s += 5;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

function fuzzyPolicyMatch(needle, allPolicyNums, byPolicyNum, ctx) {
  if (!needle || needle.length < 6) return null;
  let best = null, bestDist = FUZZY_POLICY_MAX_EDITS + 1;
  for (const cand of allPolicyNums) {
    if (Math.abs(cand.length - needle.length) > FUZZY_POLICY_MAX_EDITS) continue;
    const d = boundedLevenshtein(needle, cand, FUZZY_POLICY_MAX_EDITS);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
      if (d === 0) break;
    }
  }
  if (!best) return null;
  return { match: pickBestMatch(byPolicyNum.get(best), ctx), method: `fuzzy-policy(d=${bestDist})` };
}

export function matchSales(sales, policies) {
  const idx = buildPolicyIndex(policies);
  const results = [];

  for (const sale of sales) {
    const policyNorm = normalizePolicyNum(sale.policyNum);
    const nameKey = normalizeName(sale.customerName);
    const carrierKey = canonicalCarrier(sale.carrier).toLowerCase();
    const lobKey = canonicalLOB(sale.policyType);
    const phoneKey = normalizePhone(sale.phone);
    const ctx = { lob: lobKey, carrier: carrierKey };

    let matchResult = null;

    // 1. Exact policy #
    if (policyNorm && idx.byPolicyNum.has(policyNorm)) {
      matchResult = { match: pickBestMatch(idx.byPolicyNum.get(policyNorm), ctx), method: 'policy-exact' };
    }

    // 1b. Fuzzy policy # (kept between exact and applicant-id lookups — a
    //     typo in policy # is more informative than a name coincidence).
    if (!matchResult && policyNorm) {
      matchResult = fuzzyPolicyMatch(policyNorm, idx.allPolicyNums, idx.byPolicyNum, ctx);
    }

    // 2. Applicant ID via unique name — if the customer's name maps to exactly
    //    one Applicant ID in the master, use it. Rewrites and cross-carrier
    //    moves are common enough that policy # is often stale; name is stable.
    if (!matchResult && nameKey) {
      const aids = idx.byNameToAids.get(nameKey);
      if (aids && aids.size === 1) {
        const [onlyAid] = aids;
        const nameHits = idx.byName.get(nameKey) || [];
        const forAid = nameHits.filter(p => p.applicantId === onlyAid);
        const picked = pickBestMatch(forAid, ctx);
        if (picked) matchResult = { match: picked, method: 'applicant-id-via-name' };
      }
    }

    // 3. Customer name (normalized) alone. Falls through if name has multiple
    //    Applicant IDs — picks the best one by carrier/LOB/active heuristic.
    if (!matchResult && nameKey) {
      const nameHits = idx.byName.get(nameKey);
      if (nameHits && nameHits.length) {
        const picked = pickBestMatch(nameHits, ctx);
        if (picked) matchResult = { match: picked, method: 'name-normalized' };
      }
    }

    // 4. Name + Carrier + LOB — tightened version of the old name+carrier
    //    fallback. LOB-first pick gives the closest business match.
    if (!matchResult && nameKey && carrierKey) {
      const bucket = idx.byNameCarrier.get(`${nameKey}|${carrierKey}`);
      if (bucket && bucket.length) {
        const byLob = bucket.filter(p => p.lob === lobKey);
        const picked = pickBestMatch(byLob.length ? byLob : bucket, ctx);
        if (picked) matchResult = { match: picked, method: 'name+carrier+lob' };
      }
    }

    // 5. Household — same phone + same last name. Catches spouses/kids on
    //    the same policy where the sale is booked under a different first name.
    if (!matchResult && phoneKey && nameKey) {
      const ln = lastNameOf(nameKey);
      const bucket = ln ? idx.byPhoneLastName.get(`${phoneKey}|${ln}`) : null;
      if (bucket && bucket.length) {
        const picked = pickBestMatch(bucket, ctx);
        if (picked) matchResult = { match: picked, method: 'household' };
      }
    }

    let status;
    if (!matchResult) status = 'unmatched';
    else if (matchResult.match.isCancelled) status = 'cancelled';
    else status = 'retained';

    results.push({
      sale,
      status,
      policyMatch: matchResult ? matchResult.match : null,
      matchMethod: matchResult ? matchResult.method : null,
    });
  }

  return results;
}
