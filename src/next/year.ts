// Money's year: what a period's care cost (what the providers
// charged, what the network took off, what the plans paid and your share),
// each person's deductible and out-of-pocket limit as their plan printed
// them, and the visits by what they cost. The figures are the claims' own;
// medrec's bills.json will not change them.

import { claimCents } from '../model/claims';
import { balances, dayInPeriod, type CostLine, type PeriodId } from '../model/costs';
import type { MedRecord } from '../model/types';
import type { PersonEvent } from './calendar';
import { paidAtCounter } from './event';

/** A period's care in four figures, in cents; each is absent when no claim gives it. */
export interface YearMoney {
  charged?: number;
  /** What the network took off what was charged: charged less the network price, line by line. */
  discount?: number;
  planPaid?: number;
  share?: number;
  /** Whether charged, less the discount and what the plans paid, is your share, so the figures read as steps. */
  adds: boolean;
  claims: number;
  /** The first and last days of service. */
  first?: string;
  last?: string;
}

const add = (a: number | undefined, b: number | undefined) => (b === undefined ? a : (a ?? 0) + b);

/** A line's network price: what the plan allowed, else what it paid and your share; a negative allowed amount is not a price. */
function priceOf(l: CostLine): number | undefined {
  const c = l.cents;
  if (c.allowed !== undefined && c.allowed >= 0) return c.allowed;
  return c.planPaid !== undefined && c.youOwe !== undefined ? c.planPaid + c.youOwe : undefined;
}

/** What some lines cost, as the claims give it; a line the claim's totals leave out counts nothing. */
export function yearMoney(lines: CostLine[]): YearMoney {
  const counted = lines.filter((l) => !l.uncounted);
  const out: YearMoney = { adds: false, claims: new Set(counted.map((l) => l.claim)).size };
  for (const l of counted) {
    out.charged = add(out.charged, l.cents.billed);
    out.planPaid = add(out.planPaid, l.cents.planPaid);
    out.share = add(out.share, l.cents.youOwe);
    const price = priceOf(l);
    if (l.cents.billed !== undefined && price !== undefined) out.discount = add(out.discount, l.cents.billed - price);
  }
  const days = counted.map((l) => l.date).sort();
  if (days.length) {
    out.first = days[0];
    out.last = days[days.length - 1];
  }
  out.adds = out.charged !== undefined && out.discount !== undefined && out.planPaid !== undefined && out.share !== undefined && out.charged - out.discount - out.planPaid === out.share;
  return out;
}

/** What the plans paid and your share in each month, by day of service. */
export function monthMoney(lines: CostLine[], yms: string[]): { ym: string; planPaid: number; share: number }[] {
  return yms.map((ym) => {
    const mine = lines.filter((l) => !l.uncounted && l.date.startsWith(ym));
    return { ym, planPaid: mine.reduce((t, l) => t + (l.cents.planPaid ?? 0), 0), share: mine.reduce((t, l) => t + (l.cents.youOwe ?? 0), 0) };
  });
}

export type LimitKind = 'deductible' | 'out_of_pocket';

/** A deductible or out-of-pocket limit, as one person's plan printed it on its newest claim of a plan year. */
export interface Limit {
  person: string;
  insurer?: string;
  kind: LimitKind;
  /** "in network, individual". */
  scope: string;
  used: number;
  limit: number;
  /** The day of service of the claim that printed it, and its record. */
  asOf: string;
  claim: string;
  /** For a deductible: what the claims in these records put toward it. */
  fromClaims?: number;
  /** For a deductible that is met: the day of service of the claim that met it, when these records' claims add up to what the plan printed. */
  metOn?: string;
}

const KINDS: [RegExp, LimitKind][] = [
  [/deductible/i, 'deductible'],
  [/out.?of.?pocket/i, 'out_of_pocket'],
];

/** Each person's deductible and out-of-pocket limit in the lines' plan years, from the newest claim that printed them. */
export function planLimits(lines: CostLine[], records: Map<string, MedRecord>): Limit[] {
  const out: Limit[] = [];
  for (const b of balances(lines, records)) {
    const mine = lines
      .filter((l) => !l.uncounted && l.person === b.person && (l.insurer ?? '') === (b.insurer ?? '') && l.planYear.start === b.planYear.start)
      .sort((x, y) => x.date.localeCompare(y.date) || x.claim.localeCompare(y.claim));
    for (const item of b.items) {
      const kind = KINDS.find(([re]) => re.test(item.label))?.[1];
      if (!kind || item.used === undefined || item.limit === undefined) continue;
      const limit: Limit = { person: b.person, ...(b.insurer ? { insurer: b.insurer } : {}), kind, scope: item.scope, used: item.used, limit: item.limit, asOf: b.asOf, claim: b.claim };
      // A claim's deductible part is its own line; what counts toward an out-of-pocket limit is not, so only a deductible is traced to claims.
      if (kind === 'deductible') {
        limit.fromClaims = mine.reduce((t, l) => t + (l.cents.deductible ?? 0), 0);
        if (item.used >= item.limit && limit.fromClaims === item.used) {
          let run = 0;
          const met = mine.find((l) => (run += l.cents.deductible ?? 0) >= item.limit!);
          if (met) limit.metOn = met.claimDate;
        }
      }
      out.push(limit);
    }
  }
  return out;
}

/** A visit's cost: its network price (what the plan paid and your share), in cents, and what the network took off what was charged. */
export interface EventCost {
  event: PersonEvent;
  price: number;
  planPaid: number;
  share: number;
  /** What the providers charged, when every claim says and it is no less than the network price. */
  charged?: number;
  /** What the network took off: charged less the network price, when `charged` is known. */
  discount?: number;
  /** A pharmacy fill: paid at the counter. */
  fill: boolean;
}

export type CostOrder = 'price' | 'share' | 'discount';

/** What a visit's providers charged: only when every claim says, since one that does not would make the discount look smaller, and only when it covers the network price. */
function charged(x: PersonEvent): number | undefined {
  const { billed, discount } = x.money;
  return billed !== undefined && discount !== undefined && discount >= 0 && x.event.claims.every((c) => claimCents(c.record).billed !== undefined) ? billed : undefined;
}

/**
 * The visits of a period that carry a network price, most costly first, by
 * your share, or by what the network took off (those that say last). `lines` are the period's: a visit is in a plan year when it
 * falls in one of its person's plan years among them.
 */
export function eventCosts(events: PersonEvent[], lines: CostLine[], period: PeriodId, order: CostOrder = 'price'): EventCost[] {
  const byPerson = new Map<string, CostLine[]>();
  for (const l of lines) byPerson.set(l.person, [...(byPerson.get(l.person) ?? []), l]);
  return events
    .filter((x) => x.money.price !== undefined && dayInPeriod(x.event.start, period, byPerson.get(x.person.id) ?? []))
    .map((x): EventCost => ({
      event: x,
      price: x.money.price!,
      planPaid: x.money.planPaid ?? 0,
      share: x.money.share ?? 0,
      ...(charged(x) !== undefined ? { charged: x.money.billed!, discount: x.money.discount! } : {}),
      fill: paidAtCounter(x.event),
    }))
    .sort((a, b) => {
      const by = order === 'share' ? b.share - a.share || b.price - a.price : order === 'discount' ? (b.discount ?? -1) - (a.discount ?? -1) || b.price - a.price : b.price - a.price || b.share - a.share;
      return by || b.event.event.start.localeCompare(a.event.event.start);
    });
}
