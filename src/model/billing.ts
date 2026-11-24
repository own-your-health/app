// Bills and claims. What is owed to each provider comes from the newest
// statement of each account, the way a bill reads it. Each insurer claim is
// put beside the bill for it: a statement from the same provider after the
// date of service, preferring one whose amount is the claim's share. Plan
// balances (the deductible and out-of-pocket limit so far) come from the
// newest claim that printed them. Money stays in whole cents, never floats.

import { claimAmounts, isPharmacyClaim, type ClaimAmounts, type ClaimPart } from './claims';
import { providerKey, sameProvider } from './providers';
import { asMoney, fromCents, isWithdrawn, sortByDateDesc, str, toCents, type Money } from './records';
import type { Json, MedDocument, MedRecord, PersonIndex } from './types';

// ---- Bills ----

export interface Bill {
  doc: MedDocument;
  provider?: string;
  /** The statement date, else the document's. */
  date?: string;
  amount?: Money;
  due?: string;
  account?: string;
  /** A receipt from the same provider filed on or after the statement. */
  receipt?: MedDocument;
}


/**
 * Every bill, newest first. A copy medrec found to be the same statement
 * as another (a scan and the portal's PDF) is left out for the one it
 * copies.
 */
export function billList(index: PersonIndex): Bill[] {
  const ids = new Set(index.documents.map((d) => d.id));
  const receipts = index.documents.filter((d) => d.doc_type === 'receipt');
  return sortByDateDesc(
    index.documents
      .filter((d) => d.doc_type === 'bill' && !(d.same_statement_as && ids.has(d.same_statement_as)))
      .map((doc): Bill => {
        const date = doc.statement?.statement_date ?? doc.date;
        const receipt = sortByDateDesc(receipts.filter((r) => sameProvider(r.organization, doc.organization) && !!date && !!r.date && r.date >= date)).pop();
        return { doc, provider: doc.organization, date, amount: doc.statement?.amount_due, due: doc.statement?.due_date, account: doc.statement?.account, receipt };
      }),
  );
}

export interface Owed {
  provider: string;
  bill: Bill;
}

/**
 * What each provider's newest statement says is due, one per provider and
 * account. A statement with a receipt filed after it is under `paid`; the
 * total is the rest. Soonest due first.
 */
export function owedByProvider(index: PersonIndex): { due: Owed[]; paid: Owed[]; total?: Money } {
  const newest = new Map<string, Bill>();
  for (const b of billList(index)) {
    if (!b.amount || !b.provider) continue;
    const k = `${providerKey(b.provider)}|${b.account ?? ''}`;
    if (!newest.has(k)) newest.set(k, b);
  }
  const rows = [...newest.values()].filter((b) => (toCents(b.amount) ?? 0) > 0).map((bill) => ({ provider: bill.provider!, bill }));
  const byDue = (a: Owed, b: Owed) => (a.bill.due ?? '9999').localeCompare(b.bill.due ?? '9999') || a.provider.localeCompare(b.provider);
  const due = rows.filter((r) => !r.bill.receipt).sort(byDue);
  const paid = rows.filter((r) => r.bill.receipt).sort(byDue);
  const currencies = new Set(due.map((r) => r.bill.amount!.currency));
  const total = due.length && currencies.size === 1 ? fromCents(due.reduce((s, r) => s + (toCents(r.bill.amount) ?? 0), 0), [...currencies][0]) : undefined;
  return { due, paid, total };
}

// ---- Claims ----

export interface BillMatch {
  bill: Bill;
  /** `amount`: the statement's amount is the claim's share. `next`: the provider's next statement after the service. */
  how: 'amount' | 'next';
}

export interface Claim extends ClaimAmounts {
  record: MedRecord;
  /** The date of service: the billable period's start, else the record's date. */
  service?: string;
  provider?: string;
  insurer?: string;
  /** Where your share comes from, when the claim says: deductible, copay, coinsurance, not covered. */
  parts: ClaimPart[];
  /** The bill for this claim, when your share is more than nothing. */
  bill?: BillMatch;
}

/** How long after a visit its bill can come. */
export const BILL_WINDOW_DAYS = 120;

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every claim, newest first, each with the bill for it, and the bills no
 * claim accounts for. A claim's bill is a statement from the same provider
 * dated within BILL_WINDOW_DAYS after the service: the one whose amount is
 * the claim's share if there is one, else the first.
 */
export function claimsWithBills(index: PersonIndex): { claims: Claim[]; otherBills: Bill[] } {
  const bills = billList(index).filter((b) => b.date);
  const used = new Set<string>();
  const claims = index.records
    .filter((r) => r.kind === 'claim' && !isWithdrawn(r))
    .map((record): Claim => {
      const period = record.fields.billable_period;
      const start = period && typeof period === 'object' && !Array.isArray(period) ? str(period.start) : undefined;
      return { record, service: (start ?? record.date)?.slice(0, 10), provider: str(record.fields.provider), insurer: str(record.fields.insurer), ...claimAmounts(record) };
    })
    .sort((a, b) => (b.service ?? '').localeCompare(a.service ?? ''));
  for (const c of claims) {
    const share = toCents(c.yourShare);
    // A fill's share is paid to the pharmacy, not billed by a statement.
    if (!share || share <= 0 || !c.service || isPharmacyClaim(c.record)) continue;
    const until = addDays(c.service, BILL_WINDOW_DAYS);
    const candidates = bills.filter((b) => sameProvider(b.provider, c.provider) && b.date! >= c.service! && b.date! <= until).sort((a, b) => a.date!.localeCompare(b.date!));
    const exact = candidates.find((b) => toCents(b.amount) === share);
    const bill = exact ?? candidates[0];
    if (bill) {
      c.bill = { bill, how: exact ? 'amount' : 'next' };
      used.add(bill.doc.id);
    }
  }
  return { claims, otherBills: billList(index).filter((b) => !used.has(b.doc.id)) };
}

// ---- Plan balances ----

export interface PlanBalance {
  /** "Deductible", "Out-of-pocket limit". */
  label: string;
  /** "in network, individual". */
  scope: string;
  used?: Money;
  limit?: Money;
  /** The claim that printed it, and its date of service. */
  claim: MedRecord;
  asOf?: string;
}

const NETWORK: Record<string, string> = { in: 'in network', out: 'out of network' };

/** The deductible and out-of-pocket limit so far, from the newest claim that carries plan balances. */
export function planBalances(index: PersonIndex): PlanBalance[] {
  const { claims } = claimsWithBills(index);
  const c = claims.find((x) => Array.isArray(x.record.fields.benefit_balance) && x.record.fields.benefit_balance.length);
  if (!c) return [];
  const out: PlanBalance[] = [];
  for (const b of c.record.fields.benefit_balance as Json[]) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const scope = [NETWORK[str(b.network) ?? ''] ?? str(b.network), str(b.unit)].filter(Boolean).join(', ');
    for (const f of Array.isArray(b.financial) ? b.financial : []) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
      out.push({ label: str(f.type) ?? 'Balance', scope, used: asMoney(f.used), limit: asMoney(f.allowed), claim: c.record, asOf: c.service });
    }
  }
  return out;
}
