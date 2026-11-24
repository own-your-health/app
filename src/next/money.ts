// Bills against what the claims say (?next), for Home now and Money next.
// A provider's newest statement with no receipt filed after it is open. It
// is to pay when it asks what the claims say that provider is owed for the
// visit, and worth a call when it asks something else or no claim in these
// records backs it. Receipts carry no amount yet, so a payment above what
// the claims say cannot be found here.

import { billList, owedByProvider, type Bill } from '../model/billing';
import { sameProvider } from '../model/providers';
import { claimLines, type ClaimLine } from '../model/claims';
import { str, toCents } from '../model/records';
import type { MedDocument, MedRecord, PersonIndex } from '../model/types';
import type { PersonEvent } from './calendar';
import { eventOf, paidAtCounter } from './event';

export type BillVerdict =
  /** The bill asks what the claims say. */
  | 'matches'
  /** The bill asks something else. */
  | 'differs'
  /** No claim in these records is for it. */
  | 'no_claim';

export interface OpenBill {
  bill: Bill;
  cents: number;
  /** The visit the bill is for, when it was tied to one. */
  event?: PersonEvent;
  /** What the claims say you owe: the provider's own share, or the visit's when no claim is theirs (a billing company's statement). */
  claimSays?: number;
  /** Whether claimSays is the whole visit's share rather than this provider's. */
  claimSaysVisit: boolean;
  verdict: BillVerdict;
  /** Past its due date with no receipt filed after it. */
  overdue: boolean;
  /** Why it is private, from the bill or its visit; undefined when it is not. */
  private?: string;
}

/** Why a bill is private: its own marker, else its visit's; undefined when neither is. */
export function billPrivateArea(doc: MedDocument, event?: PersonEvent): string | undefined {
  return doc.private ? (doc.private_area ?? 'household') : event?.private;
}

/** Open bills in the order they are listed: overdue first, then by due date. */
export function byDue(a: OpenBill, b: OpenBill): number {
  return Number(b.overdue) - Number(a.overdue) || (a.bill.due ?? '9999').localeCompare(b.bill.due ?? '9999');
}

/** The person's open bills, overdue first, then by due date. `events` are all of the person's, private ones too. */
export function openBills(idx: PersonIndex, events: PersonEvent[], today: string): OpenBill[] {
  return owedByProvider(idx)
    .due.map(({ provider, bill }): OpenBill => {
      const cents = toCents(bill.amount) ?? 0;
      const event = events.find((x) => eventOf([x.event], bill.doc.id));
      const own = event?.money.charges.find((c) => sameProvider(c.provider, provider));
      const shares = event?.money.charges.filter((c) => (c.share ?? 0) > 0) ?? [];
      const claimSays = own ? (own.share ?? 0) : shares.length ? shares.reduce((t, c) => t + c.share!, 0) : undefined;
      const area = billPrivateArea(bill.doc, event);
      return {
        bill,
        cents,
        ...(event ? { event } : {}),
        ...(claimSays !== undefined ? { claimSays } : {}),
        claimSaysVisit: !own && claimSays !== undefined,
        verdict: claimSays === undefined ? 'no_claim' : claimSays === cents ? 'matches' : 'differs',
        overdue: !!bill.due && bill.due < today,
        ...(area ? { private: area } : {}),
      };
    })
    .sort(byDue);
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
 * the visit's shares, as does a receipt from the provider on or after it.
 */
export function unbilledShares(idx: PersonIndex, events: PersonEvent[]): Unbilled[] {
  const receipts = idx.documents.filter((d) => d.doc_type === 'receipt');
  return events.flatMap((x): Unbilled[] => {
    const e = x.event;
    if (paidAtCounter(e)) return [];
    const papers = e.papers.map((p) => p.doc).filter((d) => d.doc_type === 'bill' || d.doc_type === 'receipt');
    if (papers.some((d) => d.doc_type === 'bill' && !x.money.charges.some((c) => sameProvider(c.provider, d.organization)))) return [];
    return x.money.charges
      .filter((c) => (c.share ?? 0) > 0)
      .filter((c) => !papers.some((d) => sameProvider(c.provider, d.organization)))
      .filter((c) => !receipts.some((r) => sameProvider(c.provider, r.organization) && !!r.date && r.date >= e.start))
      .map((c) => ({ event: x, provider: c.provider, cents: c.share!, ...(x.private ? { private: x.private } : {}) }));
  });
}

/** A bill with a receipt from its provider filed after it. */
export interface PaidBill {
  bill: Bill;
  cents?: number;
  event?: PersonEvent;
  private?: string;
}

/** Bills paid by a receipt, newest first. */
export function paidBills(idx: PersonIndex, events: PersonEvent[]): PaidBill[] {
  return billList(idx)
    .filter((b) => b.receipt)
    .map((bill): PaidBill => {
      const event = events.find((x) => eventOf([x.event], bill.doc.id));
      const area = billPrivateArea(bill.doc, event);
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

/** Splits the open bills that don't match their claims; `bill` reads the OpenBill from an item (a person's, say). */
export function callsSummary<T>(items: T[], bill: (x: T) => OpenBill): CallsSummary<T> {
  const asksMore = items.filter((x) => {
    const b = bill(x);
    return b.verdict === 'no_claim' || (b.verdict === 'differs' && b.cents > b.claimSays!);
  });
  const asksLess = items.filter((x) => {
    const b = bill(x);
    return b.verdict === 'differs' && b.cents < b.claimSays!;
  });
  return {
    asksMore,
    asksLess,
    overCents: asksMore.reduce((t, x) => t + Math.max(0, bill(x).cents - (bill(x).claimSays ?? bill(x).cents)), 0),
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
export function explainedLines(events: PersonEvent[], today: string): Explained[] {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - EXPLAINED_DAYS * 86_400_000).toISOString().slice(0, 10);
  return events
    .filter((x) => x.event.start >= since)
    .flatMap((x) =>
      x.event.claims.flatMap((c) =>
        claimLines(c.record)
          .filter((l) => !l.counted)
          .map((line): Explained => {
            const share = x.money.charges.find((ch) => sameProvider(ch.provider, c.provider))?.share;
            return {
              event: x,
              claim: c.record,
              ...(c.provider ? { provider: c.provider } : {}),
              insurer: str(c.record.fields.insurer) ?? 'The plan',
              line,
              ...(share !== undefined ? { share } : {}),
              ...(x.private ? { private: x.private } : {}),
            };
          }),
      ),
    );
}
