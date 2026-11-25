// Bills and claims. What is open is what medrec says is left of each bill, and
// without its list what the newest statement of each account asks, the way a
// bill reads it. Each insurer claim is put beside the bill for it: a statement
// from the same provider after the date of service, preferring one whose
// amount is the claim's share. Money stays in whole cents, never floats.

import type { BillState, Payment } from './bills';
import { claimAmounts, type ClaimAmounts, type ClaimPart, claimProvider, isPharmacyClaim } from './claims';
import { providerKey, sameProvider } from './providers';
import { fromCents, isWithdrawn, sortByDateDesc, str, toCents, type Money } from './records';
import type { MedDocument, MedRecord, PersonIndex } from './types';

// ---- Bills ----

export interface Bill {
  doc: MedDocument;
  provider?: string;
  /** The statement date, else the document's. */
  date?: string;
  amount?: Money;
  due?: string;
  account?: string;
  /** What was paid on it: receipts, and payments the household marked. */
  payments: BillPayment[];
  /** The receipts that can be for it whose amounts did not read, oldest first, when no payment is known. */
  unread: MedDocument[];
  /** What is left to pay of its amount; none once it is settled, or when it gives no amount. */
  left?: Money;
  /** Nothing is left to pay. */
  settled: boolean;
  /** The later statement from the same biller that stands for it. */
  replacedBy?: string;
  /** What medrec says of it; without it, the receipts say what is paid. */
  medrec?: BillState;
}

export interface BillPayment extends Payment {
  receipt?: MedDocument;
}

/** The days after a bill in which medrec takes a receipt as one for it. */
const RECEIPT_DAYS = 120;

/** The day a receipt says it was paid, else its own. */
export const receiptDay = (receipt: MedDocument): string | undefined => receipt.statement?.paid_on ?? receipt.date;

/** The bills a receipt can be for, by medrec's rule: from its provider, or for its account where both give one, and dated in the RECEIPT_DAYS before it. */
function couldPay(receipt: MedDocument, bills: Bill[]): Bill[] {
  const [on, account] = [receiptDay(receipt), receipt.statement?.account];
  if (!on) return [];
  const since = addDays(on, -RECEIPT_DAYS);
  return bills.filter((b) => !!b.date && b.date <= on && b.date >= since && (account && b.account ? account === b.account : sameProvider(receipt.organization, b.provider)));
}

const currencyOf = (m: Money) => m.currency ?? 'USD';

/** The bill a receipt's amount pays, by medrec's rule: the only one that asks just that, else the only one it can be for. */
function paidBill(receipt: MedDocument, bills: Bill[]): Bill | undefined {
  const paid = receipt.statement!.amount_paid!;
  const could = couldPay(receipt, bills);
  const equal = could.filter((b) => b.amount && toCents(b.amount) === toCents(paid) && currencyOf(b.amount) === currencyOf(paid));
  return equal.length === 1 ? equal[0] : could.length === 1 ? could[0] : undefined;
}

/**
 * Every bill, newest first. A copy medrec found to be the same statement as
 * another (a scan and the portal's PDF) is left out for the one it copies.
 * medrec's list alone says what was paid and whether a bill is settled.
 * Without it, what the receipts' amounts come to does, by medrec's rule for
 * which bill a receipt pays. A receipt whose amount did not read settles
 * nothing either way: the bills it can be for name it, until a payment is
 * known.
 */
export function billList(index: PersonIndex): Bill[] {
  const docs = new Map(index.documents.map((d) => [d.id, d]));
  const receipts = index.documents.filter((d) => d.doc_type === 'receipt').sort((a, b) => (receiptDay(a) ?? '').localeCompare(receiptDay(b) ?? '') || a.id.localeCompare(b.id));
  const bills = sortByDateDesc(
    index.documents
      .filter((d) => d.doc_type === 'bill' && !(d.same_statement_as && docs.has(d.same_statement_as)))
      .map((doc): Bill => {
        const bill: Bill = { doc, provider: doc.organization, date: doc.statement?.statement_date ?? doc.date, amount: doc.statement?.amount_due, due: doc.statement?.due_date, account: doc.statement?.account, payments: [], unread: [], settled: false };
        const medrec = index.bills?.states.get(doc.id);
        if (!medrec) return bill;
        const payments = medrec.payments.map((p) => ({ ...p, ...(p.document && docs.has(p.document) ? { receipt: docs.get(p.document)! } : {}) }));
        return { ...bill, medrec, payments, settled: medrec.settled, left: medrec.left, ...(medrec.replacedBy && docs.has(medrec.replacedBy) ? { replacedBy: medrec.replacedBy } : {}) };
      }),
  );
  const read = receipts.filter((r) => toCents(r.statement?.amount_paid) !== undefined);
  const unread = receipts.filter((r) => !read.includes(r));
  const newest = new Map<string, string>();
  return bills.map((b) => {
    const known = b.medrec ? b : paidBy(b, read.filter((r) => paidBill(r, bills) === b));
    const out: Bill = known.settled ? { ...known, left: undefined } : { ...known, unread: known.payments.length ? [] : unread.filter((r) => couldPay(r, bills).includes(b)) };
    // Without medrec's list, the newest statement of a provider and account stands for the earlier ones.
    if (b.medrec || !b.amount || !b.provider) return out;
    const k = `${providerKey(b.provider)}|${b.account ?? ''}`;
    const by = newest.get(k);
    if (by === undefined) newest.set(k, b.doc.id);
    return by === undefined ? out : { ...out, replacedBy: by };
  });
}

/** A bill with the receipts that pay it, as medrec would list them. */
function paidBy(b: Bill, receipts: MedDocument[]): Bill {
  const payments = receipts.map((r): BillPayment => {
    const amount = r.statement!.amount_paid!;
    const on = receiptDay(r);
    return { from: 'receipt', document: r.id, receipt: r, ...(on ? { on } : {}), amount, ...(b.amount && currencyOf(amount) !== currencyOf(b.amount) ? { apart: true } : {}) };
  });
  const due = toCents(b.amount);
  if (due === undefined) return { ...b, payments };
  const rest = Math.max(0, due - payments.reduce((t, p) => t + (p.apart ? 0 : toCents(p.amount)!), 0));
  return { ...b, payments, settled: rest === 0, left: fromCents(rest, currencyOf(b.amount!)) };
}

/** The statement that stands for a bill now: the last of those that replace it. */
export function standsFor(bill: Bill, bills: Bill[]): Bill {
  let at = bill;
  for (let n = 0; at.replacedBy && n < bills.length; n++) {
    const next = bills.find((b) => b.doc.id === at.replacedBy);
    if (!next) break;
    at = next;
  }
  return at;
}

/** The bills with something left to pay, soonest due first. */
export function openList(index: PersonIndex): Bill[] {
  return billList(index)
    .filter((b) => !b.replacedBy && (toCents(b.left) ?? 0) > 0 && (b.medrec || b.provider))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.provider ?? '').localeCompare(b.provider ?? ''));
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
      return { record, service: (start ?? record.date)?.slice(0, 10), provider: claimProvider(record), insurer: str(record.fields.insurer), ...claimAmounts(record) };
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
