// Money's year: a period's four figures, the months, each
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
    expect(yearMoney(plan)).toEqual({ charged: 519960, discount: 303005, planPaid: 167169, share: 49786, adds: true, claims: 13, first: '2026-07-09', last: '2026-11-20' });
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
    // Sam's endoscopy ($1,025.10 paid, $213.90 Sam's) and Robin's fill ($6.35 and $5.00).
    expect(monthMoney(plan, ['2026-06', '2026-09'])).toEqual([
      { ym: '2026-06', planPaid: 0, share: 0 },
      { ym: '2026-09', planPaid: 103145, share: 21890 },
    ]);
  });
});

describe('deductibles and out-of-pocket limits', () => {
  it('are what each plan printed on its newest claim, with what these records’ claims put toward a deductible', () => {
    expect(planLimits(plan, records).map((l) => [household.people.find((p) => p.id === l.person)?.name, l.kind, l.used, l.limit, l.asOf, l.fromClaims, l.metOn])).toEqual([
      ['Alex Example', 'deductible', 0, 75000, '2026-11-20', 0, undefined],
      ['Alex Example', 'out_of_pocket', 3000, 300000, '2026-11-20', undefined, undefined],
      ['Sam Example', 'deductible', 22100, 75000, '2026-11-03', 22100, undefined],
      ['Sam Example', 'out_of_pocket', 35490, 300000, '2026-11-03', undefined, undefined],
      ['Robin Example', 'deductible', 112040, 150000, '2026-10-01', 0, undefined],
      ['Robin Example', 'out_of_pocket', 135610, 400000, '2026-10-01', undefined, undefined],
    ]);
  });

  it('name the claim that met a deductible, when these records’ claims add up to it', () => {
    // Sam's deductible parts: $50.70 on Jul 9, $100.00 on Sep 16, $70.30 on Oct 12. A $140 deductible is met on Sep 16.
    const lower = (limit: string) =>
      new Map(
        [...records].map(([k, r]): [string, MedRecord] => {
          const bal = r.fields.benefit_balance;
          if (!Array.isArray(bal) || r.fields.provider !== 'Example Sexual Health Clinic') return [k, r];
          const changed = bal.map((b) => {
            const o = b as { [k: string]: Json };
            return { ...o, financial: (o.financial as { [k: string]: Json }[]).map((f) => (f.type === 'Deductible' ? { ...f, allowed: { amount: limit, currency: 'USD' } } : f)) };
          });
          return [k, { ...r, fields: { ...r.fields, benefit_balance: changed } }];
        }),
      );
    const sam = (m: Map<string, MedRecord>) => planLimits(plan, m).find((l) => l.person === id('Sam Example') && l.kind === 'deductible')!;
    expect([sam(lower('140.00')).metOn, sam(lower('221.00')).metOn]).toEqual(['2026-09-16', '2026-10-12']);
    // What the plan printed is more than these records' claims add up to: met, with no claim to name.
    const robin = planLimits(plan, records).find((l) => l.person === id('Robin Example') && l.kind === 'deductible')!;
    expect(robin.fromClaims).not.toBe(robin.used);
  });
});

describe('the visits by cost', () => {
  it('lists this plan year’s by network price, a private one and fills among them', () => {
    const costs = eventCosts(events, plan, 'plan');
    expect(costs.map((c) => [c.event.person.name, c.event.event.start, c.price, c.fill, c.event.private ?? null])).toEqual([
      ['Sam Example', '2026-09-16', 123900, false, null],
      ['Robin Example', '2026-10-01', 26840, false, null],
      ['Alex Example', '2026-11-20', 15310, false, null],
      ['Sam Example', '2026-11-03', 14510, false, 'sexual_health'],
      ['Robin Example', '2026-11-18', 11250, false, null],
      ['Robin Example', '2026-10-03', 9640, false, null],
      ['Sam Example', '2026-10-12', 7030, false, null],
      ['Sam Example', '2026-07-09', 5070, false, null],
      ...costs.filter((c) => c.fill).map((c) => [c.event.person.name, c.event.event.start, c.price, true, null]),
    ]);
    expect(costs.filter((c) => c.fill).map((c) => c.event.person.name)).toEqual(['Robin Example', 'Robin Example', 'Robin Example']);
  });

  it('orders them by your share, and keeps to the period', () => {
    const shares = eventCosts(events, plan, 'plan', 'share').map((c) => c.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    const last = eventCosts(events, all.filter((l) => inPeriod(l, 'plan-1', TODAY)), 'plan-1');
    expect(last.every((c) => c.event.event.start < '2026-07-01')).toBe(true);
    expect(last.some((c) => c.event.event.start === '2026-05-20')).toBe(true);
  });

  it('orders them by what the network took off, each with what was charged', () => {
    const cuts = eventCosts(events, plan, 'plan', 'discount');
    const said = cuts.filter((c) => c.discount !== undefined);
    expect(said.map((c) => c.discount)).toEqual([...said.map((c) => c.discount!)].sort((a, b) => b - a));
    expect(said.every((c) => c.charged! - c.discount! === c.price)).toBe(true);
    expect(cuts.slice(said.length).every((c) => c.discount === undefined)).toBe(true);
    expect([said[0]!.event.event.start, said[0]!.charged, said[0]!.discount]).toEqual(['2026-09-16', 338000, 214100]);
  });

  it('says no discount when a claim does not say what was charged, or the charge is below the price', () => {
    const visit = events.find((x) => x.event.start === '2026-09-16' && x.money.billed !== undefined)!;
    const claim = visit.event.claims[0]!;
    // One more claim with no totals: the visit's charge would leave it out and look like a smaller discount.
    const silent = { ...visit, event: { ...visit.event, claims: [...visit.event.claims, { ...claim, record: { ...claim.record, fields: {} } }] } };
    const under = { ...visit, money: { ...visit.money, billed: visit.money.price! - 100, discount: -100 } };
    const costs = eventCosts([silent, under], plan, 'plan', 'discount');
    expect(costs.map((c) => [c.charged, c.discount])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});
