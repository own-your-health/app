// Bills against what the claims say, for Home and Money.
// A bill with something left to pay is open: to pay, or worth a call when it
// asks something else than its claim says or no claim in these records backs
// it. One with a receipt whose amount did not read may be paid, and one whose
// payment is marked and waits for the Mac is marked; neither is asked for.
// medrec's list says what is left and what is worth a call, when it is here.
// Without it, a provider's newest statement that no receipt's amount
// covers is open, and is put beside what the claims say that provider is owed
// for the visit.

import { billList, openList, receiptDay, type Bill, type BillPayment } from '../model/billing';
import type { BillState } from '../model/bills';
import { sameProvider } from '../model/providers';
import { claimLines, type ClaimLine } from '../model/claims';
import { inVisit, paperPrivate, recordPrivate, recordsPrivate, takenOut } from '../model/private';
import { formatMoney, fromCents, str, toCents } from '../model/records';
import { marksOn, marksTotal } from '../model/requests';
import type { MedDocument, MedRecord, PendingMark, PersonIndex } from '../model/types';
import { count, dateText } from '../ui/format';
import type { PersonEvent } from './calendar';
import { eventOf, paidAtCounter } from './event';

export type BillVerdict =
  /** The bill asks what the claims say. */
  | 'matches'
  /** The bill asks something else. */
  | 'differs'
  /** No claim in these records is for it. */
  | 'no_claim'
  /** No claim is to come: no insurer is billed for it. */
  | 'self_pay'
  /** No one claim is for it and medrec does not list it as worth a call: several claims are its visit's, or a later statement repeats an earlier one's balance. */
  | 'unmatched';

export interface OpenBill {
  bill: Bill;
  /** What is left to pay. */
  cents: number;
  /** What the bill asked: all it was due, before any payment. */
  asked: number;
  /** The visit the bill is for, when it was tied to one. */
  event?: PersonEvent;
  /** What the claims say you owe: the claim medrec matched, else the provider's own share, or the visit's when no claim is theirs (a billing company's statement). */
  claimSays?: number;
  /** Whether claimSays is the whole visit's share rather than this provider's. */
  claimSaysVisit: boolean;
  verdict: BillVerdict;
  /** Past its due date, with something left to pay. */
  overdue: boolean;
  /** The payments marked on it that wait for the Mac. */
  marks: PendingMark[];
  /** Those come to all that is left. */
  marked: boolean;
  /** Why it is private, from the bill or its visit; undefined when it is not. */
  private?: string;
}

/**
 * Why a bill is private: as any paper is, else as its visit is. medrec judged
 * a bill its events hold with that visit, so one it left out, the household
 * took out, and only its visit stays private.
 */
export function billPrivate(idx: PersonIndex, doc: MedDocument, event?: PersonEvent): string | undefined {
  return paperPrivate(idx, doc.id) ?? (event && (inVisit(idx, doc.id) || takenOut(idx, doc.id)) ? undefined : event?.private);
}

/** What a shared screen shows of some bills: those not private, without the visit of one whose visit is, or a receipt that is. */
export function forShared<T extends { private?: string; event?: PersonEvent; bill?: Bill }>(idx: PersonIndex, bills: T[]): T[] {
  const isPrivate = (receipt: MedDocument) => !!paperPrivate(idx, receipt.id);
  return bills.flatMap((b) => {
    if (b.private) return [];
    const shown = { ...b };
    if (b.event?.private) delete shown.event;
    if (b.bill) shown.bill = { ...b.bill, unread: b.bill.unread.filter((r) => !isPrivate(r)), payments: b.bill.payments.map((p) => (p.receipt && isPrivate(p.receipt) ? { from: p.from } : p)) };
    return [shown];
  });
}

/** Whether a page may speak of a person's bills: a shared one only of those that are not private. */
export function anyBill(idx: PersonIndex, events: PersonEvent[], shared: boolean): boolean {
  return idx.documents.some((d) => d.doc_type === 'bill' && !(shared && billPrivate(idx, d, events.find((x) => eventOf([x.event], d.id)))));
}

/** Open bills in the order they are listed: overdue first, then by due date. */
export function byDue(a: OpenBill, b: OpenBill): number {
  return Number(b.overdue) - Number(a.overdue) || (a.bill.due ?? '9999').localeCompare(b.bill.due ?? '9999');
}

/** A bill's own id, and those of its copies. */
export const copiesOf = (idx: PersonIndex, bill: Bill): Set<string> => new Set([bill.doc.id, ...idx.documents.filter((d) => d.same_statement_as === bill.doc.id).map((d) => d.id)]);

/** The payments marked on a bill, or a copy of it, that wait for the Mac. */
export function billMarks(idx: PersonIndex, bill: Bill, marks: readonly PendingMark[]): PendingMark[] {
  return marksOn(marks, idx.person, copiesOf(idx, bill));
}

/** What of a bill no payment is known or marked for. */
export const unmarkedCents = (bill: Bill, marks: readonly PendingMark[]): number => Math.max(0, (toCents(bill.left) ?? 0) - marksTotal(marks, bill.left?.currency ?? 'USD'));

/** The person's open bills, overdue first, then by due date. `events` are all of the person's, private ones too; `marks`, every payment that waits for the Mac. */
export function openBills(idx: PersonIndex, events: PersonEvent[], today: string, waiting: readonly PendingMark[] = []): OpenBill[] {
  return openList(idx)
    .map((bill): OpenBill => {
      const asked = toCents(bill.amount) ?? 0;
      const marks = billMarks(idx, bill, waiting);
      const event = events.find((x) => eventOf([x.event], bill.doc.id));
      const area = billPrivate(idx, bill.doc, event);
      const against = bill.medrec ? medrecSays(idx, bill, bill.medrec, event, asked) : claimsSay(bill, event, asked);
      return {
        bill,
        cents: toCents(bill.left) ?? 0,
        asked,
        ...(event ? { event } : {}),
        ...against,
        overdue: !!bill.due && bill.due < today,
        marks,
        marked: marks.length > 0 && unmarkedCents(bill, marks) === 0,
        ...(area ? { private: area } : {}),
      };
    })
    .sort(byDue);
}

type Against = Pick<OpenBill, 'claimSays' | 'claimSaysVisit' | 'verdict'>;

/** A bill against what its visit's claims say, without medrec's list. */
function claimsSay(bill: Bill, event: PersonEvent | undefined, asked: number): Against {
  const own = event?.money.charges.find((c) => sameProvider(c.provider, bill.provider));
  const shares = event?.money.charges.filter((c) => (c.share ?? 0) > 0) ?? [];
  const claimSays = own ? (own.share ?? 0) : shares.length ? shares.reduce((t, c) => t + c.share!, 0) : undefined;
  return { ...(claimSays !== undefined ? { claimSays } : {}), claimSaysVisit: !own && claimSays !== undefined, verdict: claimSays === undefined ? 'no_claim' : claimSays === asked ? 'matches' : 'differs' };
}

/** A bill as medrec's list has it: worth a call for the reason it gives, and otherwise not, whatever else the claims say. */
function medrecSays(idx: PersonIndex, bill: Bill, state: BillState, event: PersonEvent | undefined, asked: number): Against {
  if (state.selfPay) return { claimSaysVisit: false, verdict: 'self_pay' };
  const call = idx.bills?.calls.find((c) => c.document === bill.doc.id);
  const owed = toCents(call?.owed ?? state.owed);
  // A claim from another provider is the visit's: the bill is a billing company's.
  const claimSaysVisit = !!event && !event.money.charges.some((c) => sameProvider(c.provider, bill.provider));
  if (call) return owed === undefined ? { claimSaysVisit: false, verdict: 'no_claim' } : { claimSays: owed, claimSaysVisit, verdict: 'differs' };
  const said: Against = owed === undefined ? claimsSay(bill, event, asked) : { claimSays: owed, claimSaysVisit, verdict: owed === asked ? 'matches' : 'unmatched' };
  return said.verdict === 'matches' ? said : { claimSaysVisit: false, verdict: 'unmatched' };
}

type Judged = Pick<OpenBill, 'verdict' | 'marked'> & { bill: Pick<Bill, 'unread'> };

/** Whether no insurer is billed for what a bill charges for, as medrec has it. A copy's is its first's. */
export const selfPay = (idx: PersonIndex, d: MedDocument): boolean => !!(idx.bills?.states.get(d.id) ?? idx.bills?.states.get(d.same_statement_as ?? ''))?.selfPay;

/** Whether a bill or receipt can be for a share the claims give: not a bill no insurer is billed for, nor a receipt that paid one. */
export const billsShares = (idx: PersonIndex, d: MedDocument): boolean => (d.doc_type === 'bill' ? !selfPay(idx, d) : ![...(idx.bills?.states.values() ?? [])].some((s) => s.selfPay && s.payments.some((p) => p.document === d.id)));

/** What no claim is set beside a bill for, in words. */
export const NO_CLAIM_EXPECTED = 'No claim expected';

/** Whether a bill may be paid: a receipt that can be for it is here, its amount could not be read, and no payment is known or marked. */
export const mayBePaid = (b: Pick<Judged, 'bill' | 'marked'>): boolean => !b.marked && b.bill.unread.length > 0;

/** Whether a bill is worth a call before it is paid: it asks something other than its claim says, or no claim backs it. */
export const worthACall = (b: Judged): boolean => !b.marked && !mayBePaid(b) && (b.verdict === 'differs' || b.verdict === 'no_claim');

/** Whether a bill is one to pay, with nothing to ask about first. */
export const toPay = (b: Judged): boolean => !b.marked && !mayBePaid(b) && !worthACall(b);

/** "Receipt filed Nov 1, 2026; its amount could not be read". */
export function unreadText(receipts: MedDocument[]): string | undefined {
  const last = receipts[receipts.length - 1];
  if (!last) return undefined;
  const day = dateText(receiptDay(last));
  return receipts.length === 1 ? `Receipt filed ${day}; its amount could not be read` : `${count(receipts.length, 'receipt')} filed, the last ${day}; their amounts could not be read`;
}

/** A payment at a visit above what its claims say you owe, as medrec's list has it. */
export interface DeskPayment {
  receipt: MedDocument;
  provider: string;
  cents: number;
  claimSays: number;
  event?: PersonEvent;
  private?: string;
}

export function deskPayments(idx: PersonIndex, events: PersonEvent[]): DeskPayment[] {
  return (idx.bills?.calls ?? []).flatMap((c): DeskPayment[] => {
    const receipt = c.reason === 'desk_copay' ? idx.documents.find((d) => d.id === c.document) : undefined;
    const [cents, claimSays] = [toCents(c.asked), toCents(c.owed)];
    if (!receipt || cents === undefined || claimSays === undefined) return [];
    const event = events.find((x) => eventOf([x.event], receipt.id));
    const area = billPrivate(idx, receipt, event);
    return [{ receipt, provider: receipt.organization ?? 'A provider', cents, claimSays, ...(event ? { event } : {}), ...(area ? { private: area } : {}) }];
  });
}

/** "Marked paid, Nov 20, 2026", or "receipt Nov 20, 2026"; with `amounts`, how much each paid. */
export function paymentText(p: BillPayment, amounts = false): string {
  const on = p.on ? dateText(p.on) : undefined;
  const sum = amounts || p.apart ? formatMoney(p.amount) : undefined;
  const what = p.from === 'household' ? [sum ? `${sum} marked paid` : 'Marked paid', on].filter(Boolean).join(', ') : [sum, `receipt${on ? ` ${on}` : ''}`].filter(Boolean).join(', ');
  return `${what}${p.from === 'receipt' && !p.amount && amounts ? ', amount not read' : ''}${p.apart ? ', in another currency' : ''}`;
}

/** How a bill with nothing left was paid: "paid, receipt Apr 20, 2025", "Marked paid, Nov 20, 2026". */
export function paidText(b: Pick<Bill, 'payments'>): string {
  const text = b.payments.map((p) => paymentText(p, b.payments.length > 1)).join(', ');
  return !text ? 'nothing to pay' : b.payments.some((p) => p.from === 'receipt') ? `paid, ${text}` : text;
}

/** What a past due bill is called while no payment, or only a part, is on file. */
export const overdueLabel = (b: OpenBill, unpaid = !b.bill.payments.length): string => (unpaid ? 'No payment on file' : 'Not all paid');
/** What is said beside it: the folder may not show a payment made elsewhere. */
export const PAID_ELSEWHERE = 'unless it was paid elsewhere';

/** What a bill that is only partly paid says of it: "$20.00 of $53.68 paid". */
export function partText(b: Pick<OpenBill, 'asked' | 'cents'>): string | undefined {
  return b.cents < b.asked ? `${formatMoney(fromCents(b.asked - b.cents))} of ${formatMoney(fromCents(b.asked))} paid` : undefined;
}

/** A share the claims say you owe a provider for a visit, with no bill or receipt from them in the folder yet. */
export interface Unbilled {
  event: PersonEvent;
  provider: string;
  cents: number;
  private?: string;
}

/**
 * The shares no paper accounts for yet, newest visit first. A pharmacy takes
 * its share at the counter, so a fill has none. A bill in the visit from a
 * provider with no claim of its own (a billing company) accounts for all of
 * the visit's shares, as does a receipt from the provider on or after it. A
 * bill no insurer is billed for, or a receipt that paid one, accounts for none,
 * whoever sent it. On a shared screen a private paper accounts for none: a
 * share it left out would say that there is one.
 */
export function unbilledShares(idx: PersonIndex, events: PersonEvent[], shared = false): Unbilled[] {
  const counts = (d: MedDocument) => billsShares(idx, d) && !(shared && paperPrivate(idx, d.id));
  const receipts = idx.documents.filter((d) => d.doc_type === 'receipt' && counts(d));
  return events.flatMap((x): Unbilled[] => {
    const e = x.event;
    if (paidAtCounter(e)) return [];
    const papers = e.papers.map((p) => p.doc).filter((d) => (d.doc_type === 'bill' || d.doc_type === 'receipt') && counts(d));
    if (papers.some((d) => d.doc_type === 'bill' && !x.money.charges.some((c) => sameProvider(c.provider, d.organization)))) return [];
    return x.money.charges
      .filter((c) => (c.share ?? 0) > 0)
      .filter((c) => !papers.some((d) => sameProvider(c.provider, d.organization)))
      .filter((c) => !receipts.some((r) => sameProvider(c.provider, r.organization) && !!r.date && r.date >= e.start))
      .map((c) => {
        const area = x.private ?? recordsPrivate(idx, c.claims.map((r) => r.id));
        return { event: x, provider: c.provider, cents: c.share!, ...(area ? { private: area } : {}) };
      });
  });
}

/** A bill with nothing left to pay: by its receipts, or the household's marks. */
export interface PaidBill {
  bill: Bill;
  cents?: number;
  event?: PersonEvent;
  private?: string;
}

/** Bills that are paid, newest first. One that asked for nothing is not. */
export function paidBills(idx: PersonIndex, events: PersonEvent[]): PaidBill[] {
  return billList(idx)
    .filter((b) => b.settled && b.payments.length)
    .map((bill): PaidBill => {
      const event = events.find((x) => eventOf([x.event], bill.doc.id));
      const area = billPrivate(idx, bill.doc, event);
      const cents = toCents(bill.amount);
      return { bill, ...(cents !== undefined ? { cents } : {}), ...(event ? { event } : {}), ...(area ? { private: area } : {}) };
    });
}

/** Worth a call's split of the open bills that don't match their claims. */
export interface CallsSummary<T> {
  /** Bills that ask more than the claims say, or that no claim backs: the ones to call about. */
  asksMore: T[];
  /** Bills that ask less than the claims say: worth a look. */
  asksLess: T[];
  /** How much more than the claims say the bills ask, in all. */
  overCents: number;
  /** Bills no claim backs; their amounts are not in overCents. */
  unbacked: number;
  providers: number;
}

/** How much of what is left is more than the claims say. */
export const overAsked = (b: OpenBill): number => Math.min(b.cents, Math.max(0, b.asked - (b.claimSays ?? b.asked)));

/** Splits the open bills that don't match their claims; `bill` reads the OpenBill from an item (a person's, say). */
export function callsSummary<T>(items: T[], bill: (x: T) => OpenBill): CallsSummary<T> {
  const asksMore = items.filter((x) => {
    const b = bill(x);
    return worthACall(b) && (b.verdict === 'no_claim' || b.asked > b.claimSays!);
  });
  const asksLess = items.filter((x) => {
    const b = bill(x);
    return worthACall(b) && b.verdict === 'differs' && b.asked < b.claimSays!;
  });
  return {
    asksMore,
    asksLess,
    overCents: asksMore.reduce((t, x) => t + overAsked(bill(x)), 0),
    unbacked: asksMore.filter((x) => bill(x).verdict === 'no_claim').length,
    providers: new Set(asksMore.map((x) => bill(x).bill.provider)).size,
  };
}

/** A line a claim's totals leave out: the plan replaced it or wrote it off, so none of it is owed. */
export interface Explained {
  event: PersonEvent;
  claim: MedRecord;
  provider?: string;
  insurer: string;
  line: Readonly<ClaimLine>;
  /** What the claims say you owe that provider for the visit, in all. */
  share?: number;
  private?: string;
}

/** How far back Worth a call explains what the plan changed. */
export const EXPLAINED_DAYS = 365;

/** The left-out lines of visits from the last EXPLAINED_DAYS, newest visit first. */
export function explainedLines(idx: PersonIndex, events: PersonEvent[], today: string): Explained[] {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - EXPLAINED_DAYS * 86_400_000).toISOString().slice(0, 10);
  return events
    .filter((x) => x.event.start >= since)
    .flatMap((x) =>
      x.event.claims.flatMap((c) =>
        claimLines(c.record)
          .filter((l) => !l.counted)
          .map((line): Explained => {
            const share = x.money.charges.find((ch) => sameProvider(ch.provider, c.provider))?.share;
            const area = x.private ?? recordPrivate(idx, c.record.id);
            return {
              event: x,
              claim: c.record,
              ...(c.provider ? { provider: c.provider } : {}),
              insurer: str(c.record.fields.insurer) ?? 'The plan',
              line,
              ...(share !== undefined ? { share } : {}),
              ...(area ? { private: area } : {}),
            };
          }),
      ),
    );
}
