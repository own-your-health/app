// Bills against what the claims say (?next), for Home now and Money next.
// A provider's newest statement with no receipt filed after it is open. It
// is to pay when it asks what the claims say that provider is owed for the
// visit, and worth a call when it asks something else or no claim in these
// records backs it. Receipts carry no amount yet, so a payment above what
// the claims say cannot be found here.

import { owedByProvider, type Bill } from '../model/billing';
import { sameProvider } from '../model/providers';
import { toCents } from '../model/records';
import type { PersonIndex } from '../model/types';
import type { PersonEvent } from './calendar';
import { eventOf } from './event';

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

/** The person's open bills, overdue first, then by due date. `events` are all of the person's, private ones too. */
export function openBills(idx: PersonIndex, events: PersonEvent[], today: string): OpenBill[] {
  return owedByProvider(idx)
    .due.map(({ provider, bill }): OpenBill => {
      const cents = toCents(bill.amount) ?? 0;
      const event = events.find((x) => eventOf([x.event], bill.doc.id));
      const own = event?.money.charges.find((c) => sameProvider(c.provider, provider));
      const shares = event?.money.charges.filter((c) => (c.share ?? 0) > 0) ?? [];
      const claimSays = own ? (own.share ?? 0) : shares.length ? shares.reduce((t, c) => t + c.share!, 0) : undefined;
      const area = bill.doc.private ? (bill.doc.private_area ?? 'household') : event?.private;
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
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.bill.due ?? '9999').localeCompare(b.bill.due ?? '9999'));
}
