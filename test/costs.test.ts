import { describe, expect, it } from 'vitest';
import { balances, breakdown, codeLines, comparableCodes, costLines, csvText, dayInPeriod, householdLines, inPeriod, monthsSpanned, periods, planYearOf, toCsv, totals, type CostLine } from '../src/model/costs';
import { parseIndex } from '../src/model/parse';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';
import { fixture } from './helpers';

const { household, indexes } = demo();
const names = new Map(household.people.map((p) => [p.id, p.name]));
const all = householdLines(household.people.map((p) => ({ id: p.id, index: indexes.get(p.id) })));
const records = new Map([...indexes.values()].flatMap((i) => i.records.map((r) => [r.id, r] as const)));
const TODAY = '2026-11-22';
const id = (name: string) => personNamed(household, name).id;
const usd = (amount: string) => ({ amount, currency: 'USD' });
const inPlanYear = all.filter((l) => inPeriod(l, 'plan', TODAY));

describe('plan years', () => {
  it('run from the anniversary to the day before the next', () => {
    expect(planYearOf('07-01', '2026-06-30')).toEqual({ anniversary: '07-01', start: '2025-07-01', end: '2026-06-30' });
    expect(planYearOf('07-01', '2026-07-01')).toEqual({ anniversary: '07-01', start: '2026-07-01', end: '2027-06-30' });
    expect(planYearOf('01-01', '2026-03-05')).toEqual({ anniversary: '01-01', start: '2026-01-01', end: '2026-12-31' });
    expect(planYearOf('03-01', '2028-02-29')).toEqual({ anniversary: '03-01', start: '2027-03-01', end: '2028-02-29' });
  });

  it('start when the plan’s claims say; a plan whose claims do not, on January 1', () => {
    const year = (name: string, date: string) => all.find((l) => l.person === id(name) && l.date === date)!;
    // Sam's plan prints a July-to-June benefit period, so May and July fall in different plan years.
    expect([year('Sam Example', '2026-05-20'), year('Sam Example', '2026-07-09')].map((l) => [l.planYear.start, l.planBasis])).toEqual([
      ['2025-07-01', 'claims'],
      ['2026-07-01', 'claims'],
    ]);
    // Robin's plans print none.
    expect([year('Robin Example', '2026-08-14'), year('Robin Example', '2026-10-01')].map((l) => [l.planYear.start, l.planBasis])).toEqual([
      ['2026-01-01', 'calendar'],
      ['2026-01-01', 'calendar'],
    ]);
  });

  // A coverage that took effect mid-year (a birth, a new job), claims under
  // the same plan by another spelling, a plan that prints its benefit period
  // on one claim only, and one whose "benefit period" is a single day.
  const planYears = parseIndex(fixture('folder/index-plan-years.json'), 'p_aaaaaaaaaaaaaaaaaaaa');
  const yearsOf = (opts?: { planStart?: string }) =>
    Object.fromEntries(costLines('p_x', planYears, opts).map((l) => [`${l.insurer} ${l.date}`, `${l.planYear.start} to ${l.planYear.end}, ${l.planBasis}`]));

  it('never start on the day a coverage took effect', () => {
    expect(yearsOf()).toEqual({
      'Example Health Plan 2026-03-10': '2026-01-01 to 2026-12-31, calendar',
      'Example Health Plan 2026-11-20': '2026-01-01 to 2026-12-31, calendar',
      'Example Care Plan 2026-05-01': '2025-07-01 to 2026-06-30, claims',
      'Example Care Plan 2026-08-01': '2026-07-01 to 2027-06-30, claims',
      'Example Dental 2026-09-15': '2026-01-01 to 2026-12-31, calendar',
    });
  });

  it('take the start set in Settings for a plan whose claims do not say, and only for that', () => {
    expect(yearsOf({ planStart: '04-01' })).toMatchObject({
      'Example Health Plan 2026-03-10': '2025-04-01 to 2026-03-31, setting',
      'Example Health Plan 2026-11-20': '2026-04-01 to 2027-03-31, setting',
      'Example Care Plan 2026-08-01': '2026-07-01 to 2027-06-30, claims',
    });
  });
});

describe('a day in a period', () => {
  it('is in a person’s plan year, the calendar year, or any day for every year', () => {
    const sam = inPlanYear.filter((l) => l.person === id('Sam Example'));
    expect([dayInPeriod('2026-07-01', 'plan', sam), dayInPeriod('2027-06-30', 'plan', sam), dayInPeriod('2026-06-30', 'plan', sam)]).toEqual([true, true, false]);
    expect([dayInPeriod('2026-11-08', '2026', []), dayInPeriod('2025-12-31', '2026', [])]).toEqual([true, false]);
    expect(dayInPeriod('1999-01-01', 'all', [])).toBe(true);
  });
});

describe('the sample household', () => {
  it('has a line for each thing each claim paid for, newest first', () => {
    expect(all).toHaveLength(22);
    expect(all.every((l) => l.split)).toBe(true);
    // Alex's sick visit, billed as a longer one, was paid as a routine one: that line counts nothing.
    expect(all.filter((l) => l.uncounted).map((l) => [l.date, l.code, l.cents, l.uncounted])).toEqual([['2026-11-20', '99215', {}, { billed: 24000, notCovered: 24000, youOwe: 24000 }]]);
    expect(all.map((l) => l.date)).toEqual([...all.map((l) => l.date)].sort().reverse());
    expect(all.find((l) => l.code === '00000-1111-90')).toMatchObject({ category: 'pharmacy', provider: 'Example Pharmacy', insurer: 'Example Pharmacy Benefits' });
  });

  it('offers this and last plan year, each calendar year, and every year', () => {
    expect(periods(all, TODAY).map((p) => p.id)).toEqual(['plan', 'plan-1', '2026', '2025', 'all']);
  });

  it('totals this plan year across everyone, each person in their own plan’s year', () => {
    expect(totals(inPlanYear)).toEqual({
      cents: { billed: 145800, allowed: 74240, planPaid: 47844, deductible: 12100, copay: 4500, coinsurance: 9796, youOwe: 26396 },
      claims: 8,
      lines: 14,
    });
    // Sam's May visit was last plan year; Robin's Oct 1 claim, this one.
    expect(inPlanYear.some((l) => l.date === '2026-05-20')).toBe(false);
    expect(all.filter((l) => inPeriod(l, 'plan-1', TODAY)).map((l) => l.date)).toEqual(['2026-05-20', '2026-05-20', '2025-10-20', '2025-10-20', '2025-09-15', '2025-03-10', '2025-03-10']);
    expect(all.filter((l) => inPeriod(l, '2025', TODAY))).toHaveLength(5);
  });

  it('breaks it down by provider, your share first, and by month in order', () => {
    expect(breakdown(inPlanYear, 'provider', names).map((g) => [g.label, g.cents.youOwe, g.claims])).toEqual([
      ['Example Lab', 14028, 3],
      ['Example Health', 7868, 2],
      ['Example Pediatrics', 2500, 1],
      ['Example Pharmacy', 2000, 2],
    ]);
    expect(breakdown(inPlanYear, 'month', names).map((g) => g.key)).toEqual(['2026-07', '2026-08', '2026-10', '2026-11']);
    expect(breakdown(inPlanYear, 'category', names).map((g) => g.label)).toEqual(['Lab tests', 'Visits', 'Pharmacy', 'Vaccines']);
  });

  it('spans every month of the period up to now, the quiet ones too', () => {
    // Robin's plan year starts in January; nothing was billed until July.
    expect(monthsSpanned(inPlanYear, 'plan', TODAY)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    const y2025 = all.filter((l) => inPeriod(l, '2025', TODAY));
    expect(monthsSpanned(y2025, '2025', TODAY)).toHaveLength(12);
    expect(monthsSpanned(all, 'all', TODAY)).toHaveLength(21);
    expect(monthsSpanned([], 'plan', TODAY)).toEqual([]);
  });

  it('compares a code billed more than once, across providers and dates', () => {
    const codes = comparableCodes(all);
    expect(codes[0]).toMatchObject({ key: 'CPT:99213', label: 'Office visit', count: 3, providers: 2, minAllowed: 9800, maxAllowed: 12110 });
    expect(codes.map((c) => c.key)).toContain('NDC:00000-1111-90');
    expect(codeLines(all, 'CPT:99213').map((l) => [l.date, l.provider, l.cents.billed, l.cents.allowed])).toEqual([
      ['2026-11-20', 'Example Pediatrics', 16500, 9800],
      ['2026-11-18', 'Example Health', 18000, 11250],
      ['2025-09-15', 'Example Health', 18900, 12110],
    ]);
  });

  it('reads each plan’s deductible and out-of-pocket limit from its newest claim in the plan year', () => {
    const got = balances(inPlanYear, records).map((b) => [names.get(b.person), b.insurer, b.planYear.start, b.asOf, b.items.map((i) => [i.label, i.used, i.limit])]);
    expect(got).toContainEqual(['Sam Example', 'Example Care Plan', '2026-07-01', '2026-10-12', [['Deductible', 12100, 75000], ['Out-of-pocket limit', 12100, 300000]]]);
    expect(got).toContainEqual(['Robin Example', 'Example Health Plan', '2026-01-01', '2026-10-01', [['Deductible', 112040, 150000], ['Out-of-pocket limit', 135610, 400000]]]);
    // The pharmacy benefit printed none.
    expect(got.some((b) => b[1] === 'Example Pharmacy Benefits')).toBe(false);
  });
});

function claim(fields: Record<string, unknown>): MedRecord {
  return { id: 'r_c1', kind: 'claim', key: 'k', date: '2026-03-02', display: 'Professional', status: 'active', fields: { provider: 'Example Clinic', insurer: 'Example Plan', billable_period: { start: '2026-03-02' }, ...fields }, documents: [], provenance: [] } as unknown as MedRecord;
}
const total = (pairs: [string, string][]) => pairs.map(([category, amount]) => ({ category, amount: usd(amount) }));
const indexOf = (records: MedRecord[]) => ({ ...indexes.get(id('Robin Example'))!, records }) as PersonIndex;

describe('a claim whose lines do not add up to its totals', () => {
  it('keeps the difference as a line of its own, so the totals stay the claim’s', () => {
    const r = claim({
      total: total([['Submitted Amount', '300.00'], ['Eligible Amount', '200.00'], ['Benefit Amount', '150.00'], ['Coinsurance', '50.00'], ['Member liability', '50.00']]),
      items: [{ sequence: 1, service: { system: 'http://www.ama-assn.org/go/cpt', code: '99213', display: 'Office visit' }, adjudication: total([['Submitted Amount', '200.00'], ['Eligible Amount', '120.00'], ['Benefit Amount', '90.00'], ['Coinsurance', '30.00']]) }],
    });
    const lines = costLines('p_x', indexOf([r]));
    expect(lines.map((l) => [l.service, l.split, l.cents])).toEqual([
      ['Office visit', true, { billed: 20000, allowed: 12000, planPaid: 9000, coinsurance: 3000, youOwe: 3000 }],
      ['Not split by line', false, { billed: 10000, allowed: 8000, planPaid: 6000, coinsurance: 2000, youOwe: 2000 }],
    ]);
    expect(totals(lines).cents).toEqual({ billed: 30000, allowed: 20000, planPaid: 15000, coinsurance: 5000, youOwe: 5000 });
    // A total-only line is never priced as the code.
    expect(comparableCodes([...lines, ...lines])).toHaveLength(1);
  });

  it('is one line, named for the claim, when it has no lines at all', () => {
    const fill = { ...claim({ type: 'Pharmacy', total: total([['Submitted Amount', '40.00'], ['Member liability', '10.00']]) }), display: 'Pharmacy' };
    const lines = costLines('p_x', indexOf([fill]));
    expect(lines.map((l) => [l.service, l.category, l.cents])).toEqual([['Claim from Example Clinic', 'pharmacy', { billed: 4000, youOwe: 1000 }]]);
  });

  it('leaves out a withdrawn claim', () => {
    expect(costLines('p_x', indexOf([{ ...claim({ total: total([['Member liability', '10.00']]) }), status: 'entered-in-error' }]))).toEqual([]);
  });
});

describe('the CSV', () => {
  const line = (over: Partial<CostLine>): CostLine => ({ ...all[0]!, ...over });

  it('has a row for each line, amounts in dollars', () => {
    const csv = toCsv([all.find((l) => l.code === '87880')!], names);
    const [head, row, end] = csv.split('\r\n');
    expect(head).toBe('Date,Person,Provider,Insurer,Plan year,Service,Code,Code system,Kind of care,Billed,Allowed,Plan paid,Deductible,Copay,Coinsurance,Not covered,You owe,Claim,Left out by the plan');
    expect(row).toMatch(/^2026-11-20,Alex Example,Example Pediatrics,Example Care Plan,2026-07-01 to 2027-06-30,Strep test,87880,CPT,Lab test,48\.00,21\.30,21\.30,0\.00,0\.00,0\.00,,0\.00,r_[a-z2-7]{20},$/);
    expect(end).toBe('');
  });

  it('quotes what must be quoted, and never lets a cell start a formula', () => {
    expect(csvText('Example Clinic, Suite 2')).toBe('"Example Clinic, Suite 2"');
    expect(csvText('=HYPERLINK("https://example.com")')).toBe('"\'=HYPERLINK(""https://example.com"")"');
    expect(['+1', '-1', '@x', '\tx'].map(csvText)).toEqual(["'+1", "'-1", "'@x", "'\tx"]);
    const row = toCsv([line({ provider: '=1+1', cents: { youOwe: -1250 } })], names).split('\r\n')[1]!;
    expect(row).toContain(",'=1+1,");
    expect(row).toContain(',-12.50,');
  });
});
