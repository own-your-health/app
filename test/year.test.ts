// Money's year under ?next: a period's four figures, the months, each
// person's deductible and out-of-pocket limit, and the visits by cost.
import { describe, expect, it } from 'vitest';
import { householdLines, inPeriod, type CostLine } from '../src/model/costs';
import type { Json, MedRecord } from '../src/model/types';
import { householdEvents } from '../src/next/calendar';
import { eventCosts, monthMoney, planLimits, yearMoney } from '../src/next/year';
import { demo, personNamed } from './demo-data';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const id = (name: string) => personNamed(household, name).id;
const all = householdLines(household.people.map((p) => ({ id: p.id, index: indexes.get(p.id) })));
const plan = all.filter((l) => inPeriod(l, 'plan', TODAY));
const records = new Map([...indexes.values()].flatMap((i) => i.records.map((r) => [r.id, r] as const)));
const events = householdEvents(household, (p) => indexes.get(p), TODAY);

describe('a period’s care in four figures', () => {
  it('adds the claims’ lines, so charged less the discount and what the plans paid is your share', () => {
    expect(yearMoney(plan)).toEqual({ charged: 641700, discount: 418140, planPaid: 159524, share: 64036, adds: true, claims: 14, first: '2026-07-09', last: '2026-11-20' });
  });

  it('takes what the plan paid and your share as the price of a line whose allowed amount is negative', () => {
    const line = plan.find((l) => l.cents.billed && l.cents.allowed)!;
    const odd: CostLine = { ...line, cents: { ...line.cents, allowed: -500 } };
    expect(yearMoney([odd]).discount).toBe(line.cents.billed! - line.cents.planPaid! - line.cents.youOwe!);
  });

  it('does not read as steps when a claim leaves a figure out', () => {
    const line = plan.find((l) => l.cents.billed && l.cents.allowed)!;
    const cents = { ...line.cents };
    delete cents.planPaid;
    expect(yearMoney([{ ...line, cents }]).adds).toBe(false);
  });

  it('sums each month by day of service', () => {
    // Sam's emergency room: the plans paid $1,036.80 and Sam's share is $346.40.
    expect(monthMoney(plan, ['2026-06', '2026-09'])).toEqual([
      { ym: '2026-06', planPaid: 0, share: 0 },
      { ym: '2026-09', planPaid: 103680, share: 34640 },
    ]);
  });
});

describe('deductibles and out-of-pocket limits', () => {
  it('are what each plan printed on its newest claim, with what these records’ claims put toward a deductible', () => {
    expect(planLimits(plan, records).map((l) => [household.people.find((p) => p.id === l.person)?.name, l.kind, l.used, l.limit, l.asOf, l.fromClaims, l.metOn])).toEqual([
      ['Alex Example', 'deductible', 0, 75000, '2026-11-20', 0, undefined],
      ['Alex Example', 'out_of_pocket', 2500, 300000, '2026-11-20', undefined, undefined],
      ['Sam Example', 'deductible', 21740, 75000, '2026-10-12', 21740, undefined],
      ['Sam Example', 'out_of_pocket', 46740, 300000, '2026-10-12', undefined, undefined],
      ['Robin Example', 'deductible', 112040, 150000, '2026-10-01', 0, undefined],
      ['Robin Example', 'out_of_pocket', 135610, 400000, '2026-10-01', undefined, undefined],
    ]);
  });

  it('name the claim that met a deductible, when these records’ claims add up to it', () => {
    // Sam's deductible parts: $50.70 on Jul 9, $96.40 on Sep 12, $70.30 on Oct 12. A $140 deductible is met on Sep 12.
    const lower = (limit: string) =>
      new Map(
        [...records].map(([k, r]): [string, MedRecord] => {
          const bal = r.fields.benefit_balance;
          if (!Array.isArray(bal) || r.fields.provider !== 'Example Lab' || r.date?.slice(0, 10) !== '2026-10-12') return [k, r];
          const changed = bal.map((b) => {
            const o = b as { [k: string]: Json };
            return { ...o, financial: (o.financial as { [k: string]: Json }[]).map((f) => (f.type === 'Deductible' ? { ...f, allowed: { amount: limit, currency: 'USD' } } : f)) };
          });
          return [k, { ...r, fields: { ...r.fields, benefit_balance: changed } }];
        }),
      );
    const sam = (m: Map<string, MedRecord>) => planLimits(plan, m).find((l) => l.person === id('Sam Example') && l.kind === 'deductible')!;
    expect(sam(lower('140.00')).metOn).toBe('2026-09-12');
    expect(sam(lower('217.40')).metOn).toBe('2026-10-12');
    // What the plan printed is more than these records' claims add up to: met, with no claim to name.
    const robin = planLimits(plan, records).find((l) => l.person === id('Robin Example') && l.kind === 'deductible')!;
    expect(robin.fromClaims).not.toBe(robin.used);
  });
});

describe('the visits by cost', () => {
  it('lists this plan year’s by network price, a private one and fills among them', () => {
    const costs = eventCosts(events, plan, 'plan');
    expect(costs.map((c) => [c.event.person.name, c.event.event.start, c.price, c.fill, c.event.private ?? null])).toEqual([
      ['Sam Example', '2026-09-12', 138320, false, null],
      ['Robin Example', '2026-10-01', 26840, false, null],
      ['Alex Example', '2026-11-20', 11930, false, null],
      ['Robin Example', '2026-11-18', 11250, false, null],
      ['Sam Example', '2026-10-27', 11000, false, 'mental_health'],
      ['Robin Example', '2026-10-03', 9640, false, null],
      ['Sam Example', '2026-10-12', 7030, false, null],
      ['Sam Example', '2026-07-09', 5070, false, null],
      ...costs.filter((c) => c.fill).map((c) => [c.event.person.name, c.event.event.start, c.price, true, null]),
    ]);
    expect(costs.filter((c) => c.fill).map((c) => c.event.person.name)).toEqual(['Robin Example', 'Robin Example']);
  });

  it('orders them by your share, and keeps to the period', () => {
    const shares = eventCosts(events, plan, 'plan', 'share').map((c) => c.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    const last = eventCosts(events, all.filter((l) => inPeriod(l, 'plan-1', TODAY)), 'plan-1');
    expect(last.every((c) => c.event.event.start < '2026-07-01')).toBe(true);
    expect(last.some((c) => c.event.event.start === '2026-05-20')).toBe(true);
  });
});
