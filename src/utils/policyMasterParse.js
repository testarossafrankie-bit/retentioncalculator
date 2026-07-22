import * as XLSX from 'xlsx';
import { canonicalCarrier, canonicalLOB, normalizeName, normalizePolicyNum, normalizeProducer } from './normalize.js';

const CANCEL_TX_TYPES = new Set(['cancel conf', 'cancel rewrite']);

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

export function parsePolicyMaster(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const detail = wb.Sheets['Detail'] || wb.Sheets[wb.SheetNames[0]];
  const filters = wb.Sheets['Filters'];
  const rawRows = XLSX.utils.sheet_to_json(detail, { defval: '' });

  const policies = rawRows.map(r => {
    const policyNumberRaw = pickCol(r, 'Policy Number') || '';
    const txType = String(pickCol(r, 'Transaction Type') || '').trim();
    const applicantStatus = String(pickCol(r, 'Applicant Status') || '').trim();
    const isCancelled = CANCEL_TX_TYPES.has(txType.toLowerCase());
    return {
      applicantId: String(pickCol(r, 'Applicant ID') || '').trim(),
      accountName: String(pickCol(r, 'Account Name') || '').trim(),
      accountNameNorm: normalizeName(pickCol(r, 'Account Name')),
      producer: String(pickCol(r, 'Assigned Producer') || '').trim(),
      producerNorm: normalizeProducer(pickCol(r, 'Assigned Producer')),
      lob: canonicalLOB(pickCol(r, 'Line Of Business')),
      lobRaw: pickCol(r, 'Line Of Business') || '',
      carrier: canonicalCarrier(pickCol(r, 'Master Company')),
      policyNumber: String(policyNumberRaw).trim(),
      policyNumberNorm: normalizePolicyNum(policyNumberRaw),
      policyType: pickCol(r, 'Policy Type') || '',
      effectiveDate: excelSerialToISO(pickCol(r, 'Policy Effective Date')),
      cancellationDate: excelSerialToISO(pickCol(r, 'Policy Cancellation Date')),
      annualPremium: Number(pickCol(r, 'Premium - Annualized')) || 0,
      writtenPremium: Number(pickCol(r, 'Premium - Written')) || 0,
      transactionType: txType,
      applicantStatus,
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

  return { policies, filterMeta, byApplicantId };
}
