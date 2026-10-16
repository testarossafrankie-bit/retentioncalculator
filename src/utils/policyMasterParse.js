import * as XLSX from 'xlsx';
import { canonicalCarrier, canonicalLOB, normalizeName, normalizePhone, normalizePolicyNum, normalizeProducer } from './normalize.js';

const CANCEL_TX_TYPES = new Set([
  'cancel confirmation',
  'cancel conf',
  'cancel rewrite',
  'cancel req',
  'non-renewal',
  'nonrenewal',
]);

// EZLynx headers occasionally arrive with trailing spaces. Grab a value by
// looking up any header whose trimmed form matches.
function pickCol(row, name) {
  const target = name.trim().toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.trim().toLowerCase() === target) return row[k];
  }
  return undefined;
}

function excelSerialToISO(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const utcDays = Math.floor(v - 25569);
    const utcMs = utcDays * 86400 * 1000;
    return new Date(utcMs).toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// "12 Months" / "6 Months" → 12 / 6. Anything else → null so we can decide
// whether to treat unknown terms conservatively (we choose: include).
function parseTermMonths(v) {
  const m = String(v || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Renewal date = eff + termMonths. Uses UTC math so we don't skew across
// timezones. Month-end overflow (e.g. Jan 31 + 1mo) rolls forward like JS Date
// (Feb 31 → Mar 3) — negligible for a "did the policy get past renewal" check.
function computeRenewalDate(effIso, termMonths) {
  if (!effIso || !termMonths) return null;
  const [y, mo, d] = effIso.split('-').map(Number);
  const target = new Date(Date.UTC(y, mo - 1 + termMonths, d));
  return target.toISOString().slice(0, 10);
}

export function parsePolicyMaster(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const detail = wb.Sheets['Detail'] || wb.Sheets[wb.SheetNames[0]];
  const filters = wb.Sheets['Filters'];
  const rawRows = XLSX.utils.sheet_to_json(detail, { defval: '' });

  const policies = rawRows.map(r => {
    const policyNumberRaw = pickCol(r, 'Policy Number') || '';
    const txType = String(pickCol(r, 'Transaction Type') || '').trim();
    const applicantStatus = String(pickCol(r, 'Applicant Status') || '').trim();
    const policyStatus = String(pickCol(r, 'Policy Status') || '').trim();
    const cancellationDate = excelSerialToISO(
      pickCol(r, 'Cancellation Date') ?? pickCol(r, 'Policy Cancellation Date')
    );
    // Authoritative cancellation signal: Policy Cancellation Date is populated,
    // OR Policy Status / Applicant Status reads cancelled/lost/non-renew,
    // OR Transaction Type matches a known cancel txn. Previously we trusted
    // only Transaction Type, which misses rows whose latest txn is something
    // else (NOC, Endorsement) even though the policy is dead.
    const statusCancelled = /cancel|lost|non.?renew|inactive/i.test(policyStatus)
      || /cancel|lost|non.?renew|inactive/i.test(applicantStatus);
    const isCancelled = !!cancellationDate
      || statusCancelled
      || CANCEL_TX_TYPES.has(txType.toLowerCase());
    const effectiveDate = excelSerialToISO(pickCol(r, 'Policy Effective Date'));
    const termMonths = parseTermMonths(pickCol(r, 'Policy Term'));
    // Prefer EZLynx's Policy Expiration Date column when present — it's the
    // authoritative renewal boundary. Fall back to eff + term for old exports
    // that didn't include the column.
    const expirationDateRaw = pickCol(r, 'Policy Expiration Date') ?? pickCol(r, 'Expiration Date');
    const expirationDate = excelSerialToISO(expirationDateRaw) || computeRenewalDate(effectiveDate, termMonths);
    return {
      applicantId: String(pickCol(r, 'Applicant ID') || '').trim(),
      accountName: String(pickCol(r, 'Account Name') || '').trim(),
      accountNameNorm: normalizeName(pickCol(r, 'Account Name')),
      phone: normalizePhone(pickCol(r, 'Phone - Home')),
      producer: String(pickCol(r, 'Assigned Producer') || '').trim(),
      producerNorm: normalizeProducer(pickCol(r, 'Assigned Producer')),
      lob: canonicalLOB(pickCol(r, 'Line Of Business')),
      lobRaw: pickCol(r, 'Line Of Business') || '',
      carrier: canonicalCarrier(pickCol(r, 'Master Company')),
      policyNumber: String(policyNumberRaw).trim(),
      policyNumberNorm: normalizePolicyNum(policyNumberRaw),
      policyType: pickCol(r, 'Policy Type') || '',
      effectiveDate,
      cancellationDate,
      termMonths,
      expirationDate,
      renewalDate: computeRenewalDate(effectiveDate, termMonths),
      annualPremium: Number(pickCol(r, 'Premium - Annualized')) || 0,
      writtenPremium: Number(pickCol(r, 'Premium - Written')) || 0,
      transactionType: txType,
      applicantStatus,
      policyStatus,
      isCancelled,
      isActive: !isCancelled,
    };
  }).filter(p => p.policyNumberNorm || p.accountNameNorm);

  // Parse Filters sheet so we can warn if the sales-log range doesn't match.
  let filterMeta = { dateField: null, dateRange: null };
  if (filters) {
    const filterRows = XLSX.utils.sheet_to_json(filters, { header: 1, defval: '' });
    for (const row of filterRows) {
      if (!row || !row[0]) continue;
      const key = String(row[0]).toLowerCase().trim();
      if (key === 'date select') filterMeta.dateField = row[1] || null;
      if (key === 'date range') filterMeta.dateRange = row[1] || null;
    }
  }

  // Build Applicant ID → policies index for customer-level rollups.
  const byApplicantId = new Map();
  for (const p of policies) {
    if (!p.applicantId) continue;
    if (!byApplicantId.has(p.applicantId)) byApplicantId.set(p.applicantId, []);
    byApplicantId.get(p.applicantId).push(p);
  }

  // Diagnostic: expose column headers + cancellation-signal distribution so we
  // can tell why isCancelled is or isn't firing. Readable in DevTools console.
  if (typeof window !== 'undefined') {
    const headerSample = rawRows[0] ? Object.keys(rawRows[0]) : [];
    const uniq = (field) => {
      const m = new Map();
      for (const p of policies) m.set(p[field] || '(empty)', (m.get(p[field] || '(empty)') || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    };
    window.__pmDiag = {
      rowCount: policies.length,
      headers: headerSample,
      cancellationDatePopulated: policies.filter(p => p.cancellationDate).length,
      cancelledCount: policies.filter(p => p.isCancelled).length,
      transactionTypes: uniq('transactionType'),
      applicantStatuses: uniq('applicantStatus'),
      policyStatuses: uniq('policyStatus'),
    };
    console.log('[PolicyMaster diag]', window.__pmDiag);
  }

  return { policies, filterMeta, byApplicantId };
}
