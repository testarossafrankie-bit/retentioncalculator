import { normalizeName } from './normalize.js';
import { toISO } from './dateRange.js';

const MIN_TENURE_DAYS = 31;

function daysBetween(aISO, bISO) {
  if (!aISO || !bISO) return 0;
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// One customer = one Applicant ID when we can match, otherwise fall back to
// normalized name+carrier bucketing. Guarantees a stable key even when the
// sales log has misspelled names but a valid policy #.
function customerKeyFor(matchResult) {
  const aid = matchResult.policyMatch?.applicantId;
  if (aid) return `aid:${aid}`;
  return `name:${normalizeName(matchResult.sale.customerName)}`;
}

function num(v) {
  const n = Number(String(v ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Compute per-producer + agency stats.
// Inputs:
//   matchResults    — output of matchSales(), post-processed by any user
//                     match decisions (confirm/reject) in the caller.
//   byApplicantId   — Applicant ID → policies map (from Policy Master).
//   resolveProducer — canonicalizer for producer names.
//   today           — reference date for tenure exclusion.
export function computeRetention({ matchResults, byApplicantId, resolveProducer, today = new Date() }) {
  const todayISO = toISO(today.toISOString());

  // Group matchResults by customer (across NB + rewrites for the same person).
  const customers = new Map();
  for (const r of matchResults) {
    const key = customerKeyFor(r);
    if (!customers.has(key)) {
      customers.set(key, {
        key,
        applicantId: r.policyMatch?.applicantId || null,
        displayName: r.sale.customerName || r.policyMatch?.accountName || '',
        salesRows: [],       // all sales-log rows for this customer in the period
      });
    }
    customers.get(key).salesRows.push(r);
  }

  // For each customer, determine: producer, tenure, retained-in-book, written prem, active prem
  const customerStats = [];
  for (const c of customers.values()) {
    // Producer attribution: use the FIRST sale (chronologically) for this customer in the period.
    const salesByDate = [...c.salesRows].sort((a, b) => {
      const ad = toISO(a.sale.effDate) || toISO(a.sale.bindDate) || '';
      const bd = toISO(b.sale.effDate) || toISO(b.sale.bindDate) || '';
      return ad.localeCompare(bd);
    });
    const firstSale = salesByDate[0];
    const firstEff = toISO(firstSale.sale.effDate) || toISO(firstSale.sale.bindDate) || todayISO;
    const tenureDays = daysBetween(firstEff, todayISO);
    const producerRaw = firstSale.sale.agent || '(unknown)';
    const producer = resolveProducer(producerRaw);

    // Written premium (raw) in period = sum of what agents entered in the sales
    // log. This is bound premium for the current term — 6mo for Progressive
    // Auto, 12mo for Travelers, etc. — so it's mixed units. Kept for display
    // because it's the production number Frank reports on.
    const writtenPremium = c.salesRows.reduce((s, r) => s + num(r.sale.premium), 0);

    // Written ANNUALIZED premium — for each sale we matched into the master,
    // use the master's annualPremium instead. This normalizes 6mo↔12mo so
    // premium retention (below) is apples-to-apples with active premium.
    // Unmatched sales contribute 0 here (they'll skew retention if included).
    const writtenAnnualized = c.salesRows.reduce((s, r) =>
      s + (r.policyMatch ? r.policyMatch.annualPremium : 0), 0);

    // Active premium — cohort-scoped.
    //   activePremium / activeWritten track ONLY the policies this producer
    //   wrote in the period (or their rewrites) that are still active today.
    //   NOT the customer's full book, because that would credit the producer
    //   for pre-existing or later-added policies they didn't write.
    //
    // Cohort rules:
    //   (1) Any period-matched policy that is still active → counted.
    //   (2) For each period-matched policy that was cancelled, look for an
    //       active policy tied to the same Applicant ID in the same LOB
    //       (rewrite candidate) and count that once as the replacement.
    const bookPolicies = c.applicantId ? (byApplicantId.get(c.applicantId) || []) : [];
    const activeBookPolicies = bookPolicies.filter(p => p.isActive);
    const activePolicyCount = activeBookPolicies.length; // used for bundle % (whole book)

    // Track which cohort-matched active policies we've already counted so a
    // rewrite candidate isn't double-attributed to two cancelled originals.
    const cohortMatchedNorms = new Set(
      c.salesRows.map(r => r.policyMatch?.policyNumberNorm).filter(Boolean)
    );
    const usedRewriteNorms = new Set();

    let activePremium = 0;
    let activeWritten = 0;
    for (const r of c.salesRows) {
      const pm = r.policyMatch;
      if (!pm) continue;
      if (pm.isActive) {
        activePremium += pm.annualPremium;
        activeWritten += pm.writtenPremium;
        continue;
      }
      // Cancelled period policy — search for a rewrite candidate. A true
      // rewrite: (1) same LOB, (2) effective date on or after the cancellation
      // date, (3) within 90 days of cancellation (otherwise it's likely
      // unrelated later business), (4) not one we already counted. When
      // multiple candidates exist, prefer the one with premium closest to the
      // cancelled policy — reduces the "grabbed an unrelated big policy"
      // inflation bug.
      if (!c.applicantId || !pm.cancellationDate) continue;
      const window = 90;
      const eligibleCandidates = activeBookPolicies.filter(p =>
        !cohortMatchedNorms.has(p.policyNumberNorm) &&
        !usedRewriteNorms.has(p.policyNumberNorm) &&
        p.lob === pm.lob &&
        p.effectiveDate &&
        p.effectiveDate >= pm.cancellationDate &&
        daysBetween(pm.cancellationDate, p.effectiveDate) <= window
      );
      if (!eligibleCandidates.length) continue;
      eligibleCandidates.sort((a, b) =>
        Math.abs(a.annualPremium - pm.annualPremium) - Math.abs(b.annualPremium - pm.annualPremium)
      );
      const candidate = eligibleCandidates[0];
      activePremium += candidate.annualPremium;
      activeWritten += candidate.writtenPremium;
      usedRewriteNorms.add(candidate.policyNumberNorm);
    }

    // Cohort-scoped retention: retained if the producer's period-written
    // policies (or their rewrites) still generate premium. NOT "does this
    // customer have any policy with the agency" — that would credit a producer
    // for coverage a different producer wrote or sold later.
    const retained = activePremium > 0
      || (!c.applicantId && c.salesRows.some(r => r.status === 'retained'));

    const eligible = tenureDays >= MIN_TENURE_DAYS;

    // Any sale in the period marked isRewrite=true means we should also flag
    // this customer as having received a rewrite treatment.
    const hasRewriteInPeriod = c.salesRows.some(r => {
      const v = r.sale.isRewrite;
      return v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';
    });

    customerStats.push({
      key: c.key,
      applicantId: c.applicantId,
      displayName: c.displayName,
      producerRaw,
      producerCanonical: producer.canonical,
      producerIsAdmin: producer.isAdmin,
      producerIsKnown: producer.isKnown,
      firstEffDate: firstEff,
      tenureDays,
      eligible,
      retained,
      hasRewriteInPeriod,
      writtenPremium,
      writtenAnnualized,
      activePremium,
      activeWritten,
      activePolicyCount,
      salesRowsCount: c.salesRows.length,
      allUnmatched: c.salesRows.every(r => r.status === 'unmatched'),
    });
  }

  // Roll up per producer (canonical name, excluding admins from leaderboard downstream).
  const producers = new Map();
  for (const c of customerStats) {
    const pkey = c.producerCanonical;
    if (!producers.has(pkey)) {
      producers.set(pkey, {
        canonical: pkey,
        isAdmin: c.producerIsAdmin,
        customers: [],
      });
    }
    producers.get(pkey).customers.push(c);
  }

  const producerRows = [];
  for (const p of producers.values()) {
    const eligible = p.customers.filter(c => c.eligible);
    const retained = eligible.filter(c => c.retained);
    const writtenPremium = p.customers.reduce((s, c) => s + c.writtenPremium, 0);
    const activePremium = eligible.reduce((s, c) => s + c.activePremium, 0);
    const activeWritten = eligible.reduce((s, c) => s + c.activeWritten, 0);
    const eligibleWritten = eligible.reduce((s, c) => s + c.writtenPremium, 0);
    // Annualized-at-bind denominator (from Policy Master via match). Used for
    // annualized retention so 6mo↔12mo term differences don't distort.
    const eligibleWrittenAnnualized = eligible.reduce((s, c) => s + c.writtenAnnualized, 0);

    // Bundle % on the CURRENT book — of eligible customers with a known Applicant
    // ID, what fraction have ≥2 active policies?
    const bundleUniverse = eligible.filter(c => c.applicantId);
    const bundled = bundleUniverse.filter(c => c.activePolicyCount >= 2);

    const custRetention = eligible.length ? retained.length / eligible.length : 0;
    // Two premium retention lenses:
    //   writtenPremRetention   — same-term dollars vs. same-term dollars,
    //                            answers "did the money I booked stick?"
    //   annualizedPremRetention — 12mo-normalized dollars both sides,
    //                            answers "did the annual value stick?" and
    //                            avoids overstating Prog-Auto-heavy books.
    const writtenPremRetention = eligibleWritten ? activeWritten / eligibleWritten : 0;
    const annualizedPremRetention = eligibleWrittenAnnualized ? activePremium / eligibleWrittenAnnualized : 0;
    const avgPremium = p.customers.length ? writtenPremium / p.customers.length : 0;
    const bundlePct = bundleUniverse.length ? bundled.length / bundleUniverse.length : 0;

    producerRows.push({
      canonical: p.canonical,
      isAdmin: p.isAdmin,
      totalCustomers: p.customers.length,
      eligibleCustomers: eligible.length,
      excludedNew: p.customers.length - eligible.length,
      retainedCustomers: retained.length,
      writtenPremium,
      activePremium,
      activeWritten,
      custRetention,
      writtenPremRetention,
      annualizedPremRetention,
      avgPremium,
      bundlePct,
      customers: p.customers,
    });
  }

  // Scale-normalize writtenPremium and avgPremium to 0-100 within the peer set
  // (excluding admins so their tiny numbers don't distort the scale).
  const peer = producerRows.filter(r => !r.isAdmin);
  const maxWritten = Math.max(0, ...peer.map(r => r.writtenPremium));
  const maxAvg = Math.max(0, ...peer.map(r => r.avgPremium));

  for (const r of producerRows) {
    const writtenScore = maxWritten ? (r.writtenPremium / maxWritten) * 100 : 0;
    const avgScore = maxAvg ? (r.avgPremium / maxAvg) * 100 : 0;
    // Score uses annualized premium retention (industry standard) so producers
    // aren't scored differently based on their carrier mix's average term.
    r.score = Math.round(
      0.30 * writtenScore +
      0.30 * (r.custRetention * 100) +
      0.20 * (r.annualizedPremRetention * 100) +
      0.10 * (r.bundlePct * 100) +
      0.10 * avgScore
    );
  }

  // Agency-level roll-up (excludes admins from leaderboard but the customers
  // are still real business — include them in the agency KPIs).
  const allEligible = customerStats.filter(c => c.eligible);
  const allRetained = allEligible.filter(c => c.retained);
  const agencyWritten = customerStats.reduce((s, c) => s + c.writtenPremium, 0);
  const agencyEligibleWritten = allEligible.reduce((s, c) => s + c.writtenPremium, 0);
  const agencyEligibleWrittenAnnualized = allEligible.reduce((s, c) => s + c.writtenAnnualized, 0);
  const agencyActive = allEligible.reduce((s, c) => s + c.activePremium, 0);
  const agencyActiveWritten = allEligible.reduce((s, c) => s + c.activeWritten, 0);

  const agency = {
    totalCustomers: customerStats.length,
    eligibleCustomers: allEligible.length,
    excludedNew: customerStats.length - allEligible.length,
    retainedCustomers: allRetained.length,
    custRetention: allEligible.length ? allRetained.length / allEligible.length : 0,
    writtenPremium: agencyWritten,
    activePremium: agencyActive,
    activeWritten: agencyActiveWritten,
    writtenPremRetention: agencyEligibleWritten ? agencyActiveWritten / agencyEligibleWritten : 0,
    annualizedPremRetention: agencyEligibleWrittenAnnualized ? agencyActive / agencyEligibleWrittenAnnualized : 0,
    unmatchedCustomers: customerStats.filter(c => c.allUnmatched).length,
  };

  return {
    matchResults,
    customerStats,
    producerRows: producerRows.sort((a, b) => b.score - a.score),
    agency,
  };
}
