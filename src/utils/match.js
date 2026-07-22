import { boundedLevenshtein } from './levenshtein.js';
import { canonicalCarrier, canonicalLOB, normalizeName, normalizePolicyNum, normalizeProducer } from './normalize.js';

const FUZZY_POLICY_MAX_EDITS = 2;

function buildPolicyIndex(policies) {
  const byPolicyNum = new Map();
  const byNameCarrier = new Map();
  const allPolicyNums = [];
  for (const p of policies) {
    if (p.policyNumberNorm) {
      if (!byPolicyNum.has(p.policyNumberNorm)) byPolicyNum.set(p.policyNumberNorm, []);
      byPolicyNum.get(p.policyNumberNorm).push(p);
      allPolicyNums.push(p.policyNumberNorm);
    }
    if (p.accountNameNorm && p.carrier) {
      const key = `${p.accountNameNorm}|${p.carrier.toLowerCase()}`;
      if (!byNameCarrier.has(key)) byNameCarrier.set(key, []);
      byNameCarrier.get(key).push(p);
    }
  }
  return { byPolicyNum, byNameCarrier, allPolicyNums };
}

function pickBestOfMatches(matches) {
  // If a customer has both a cancelled and an active version of the same policy
  // (e.g., cancel then rewrite), prefer the active one for retention purposes.
  const active = matches.find(m => !m.isCancelled);
  return active || matches[0];
}

function fuzzyPolicyMatch(needle, allPolicyNums, byPolicyNum) {
  if (!needle || needle.length < 6) return null;
  let best = null;
  let bestDist = FUZZY_POLICY_MAX_EDITS + 1;
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
  return { match: pickBestOfMatches(byPolicyNum.get(best)), method: `fuzzy-policy(d=${bestDist})` };
}

function nameCarrierMatch(sale, byNameCarrier) {
  const nameKey = normalizeName(sale.customerName);
  const carrierKey = canonicalCarrier(sale.carrier).toLowerCase();
  if (!nameKey || !carrierKey) return null;
  const bucket = byNameCarrier.get(`${nameKey}|${carrierKey}`);
  if (!bucket || !bucket.length) return null;
  // Prefer same LOB where possible
  const saleLob = canonicalLOB(sale.policyType);
  const byLob = bucket.filter(p => p.lob === saleLob);
  const chosen = byLob.length ? pickBestOfMatches(byLob) : pickBestOfMatches(bucket);
  return { match: chosen, method: 'name+carrier' };
}

export function matchSales(sales, policies) {
  const idx = buildPolicyIndex(policies);
  const results = [];

  for (const sale of sales) {
    const saleNorm = normalizePolicyNum(sale.policyNum);
    let matchResult = null;

    if (saleNorm) {
      const exact = idx.byPolicyNum.get(saleNorm);
      if (exact) matchResult = { match: pickBestOfMatches(exact), method: 'exact-policy' };
    }
    if (!matchResult && saleNorm) {
      matchResult = fuzzyPolicyMatch(saleNorm, idx.allPolicyNums, idx.byPolicyNum);
    }
    if (!matchResult) {
      matchResult = nameCarrierMatch(sale, idx.byNameCarrier);
    }

    let status;
    if (!matchResult) {
      status = 'unmatched';
    } else if (matchResult.match.isCancelled) {
      status = 'cancelled';
    } else {
      status = 'retained';
    }

    results.push({
      sale,
      status,
      policyMatch: matchResult ? matchResult.match : null,
      matchMethod: matchResult ? matchResult.method : null,
    });
  }

  return results;
}

// Customer-level rollup using Applicant ID from Policy Master where available,
// falling back to normalized customer name on the sales-log side.
export function rollupCustomers(matchResults, byApplicantId) {
  const customers = new Map();

  const bucketKey = (r) => {
    const applicantId = r.policyMatch?.applicantId;
    if (applicantId) return `aid:${applicantId}`;
    return `name:${normalizeName(r.sale.customerName)}`;
  };

  for (const r of matchResults) {
    const key = bucketKey(r);
    if (!customers.has(key)) {
      customers.set(key, {
        key,
        applicantId: r.policyMatch?.applicantId || null,
        displayName: r.sale.customerName || r.policyMatch?.accountName || '',
        salesRows: [],
        anyRetained: false,
      });
    }
    const c = customers.get(key);
    c.salesRows.push(r);
    if (r.status === 'retained') c.anyRetained = true;
  }

  // For customers matched into an Applicant ID, they're retained if ANY of that
  // Applicant ID's policies in the Policy Master is active — even ones not on
  // our sales log (renewals of pre-existing business we didn't write).
  for (const c of customers.values()) {
    if (c.applicantId && byApplicantId.has(c.applicantId)) {
      const anyPolicyActive = byApplicantId.get(c.applicantId).some(p => p.isActive);
      if (anyPolicyActive) c.anyRetained = true;
    }
    c.status = c.anyRetained ? 'retained' : 'lost';
  }

  return Array.from(customers.values());
}
