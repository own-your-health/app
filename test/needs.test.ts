// What Home lists: open bills against the claims, refills by
// days' supply, and a child's vaccine doses grouped into visits.
import { describe, expect, it } from 'vitest';
import { householdEvents } from '../src/next/calendar';
import { ageWords } from '../src/next/homeView';
import { openBills } from '../src/next/money';
import { refillsDue, vaccineNeeds } from '../src/next/needs';
import type { PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const person = (name: string) => personNamed(household, name);
const index = (name: string) => indexes.get(person(name).id)!;
const events = (name: string) => householdEvents(household, (id) => indexes.get(id), TODAY).filter((x) => x.person.id === person(name).id);

describe('open bills', () => {
  it('match the claim, or are worth a call when a billing company asks more than the visit’s claims', () => {
    const sam = openBills(index('Sam Example'), events('Sam Example'), TODAY);
    expect(sam.map((b) => [b.bill.provider, b.cents, b.verdict, b.claimSays, b.claimSaysVisit, b.overdue])).toEqual([
      ['Example Billing', 12000, 'differs', 5070, true, true],
      ['Example General Hospital', 25000, 'matches', 25000, false, true],
    ]);
    expect(sam[0]!.event?.event.title).toBe('Lab tests');
  });

  it('come overdue first, then by due date', () => {
    const robin = openBills(index('Robin Example'), events('Robin Example'), TODAY);
    expect(robin.map((b) => [b.bill.provider, b.bill.due, b.overdue, b.verdict])).toEqual([
      ['Example Health', '2026-11-19', true, 'matches'],
      ['Example Lab', '2026-11-27', false, 'matches'],
    ]);
  });

  it('have no claim behind them when no visit takes them', () => {
    expect(openBills(index('Robin Example'), [], TODAY).map((b) => b.verdict)).toEqual(['no_claim', 'no_claim']);
  });

  it('carry a private marker from the bill', () => {
    const idx = index('Robin Example');
    const marked: PersonIndex = { ...idx, documents: idx.documents.map((d) => (d.organization === 'Example Lab' && d.doc_type === 'bill' ? { ...d, private: true, private_area: 'reproductive' } : d)) };
    expect(openBills(marked, events('Robin Example'), TODAY).map((b) => b.private)).toEqual([undefined, 'reproductive']);
  });
});

describe('refills', () => {
  it('show from two weeks before a supply runs out to two weeks after, soonest first, private ones marked', () => {
    const sam = refillsDue(index('Sam Example'), TODAY);
    expect(sam.map((r) => [r.medicine.name, r.runsOut, r.days, r.private])).toEqual([
      ['Sertraline 50 mg tablet', '2026-11-27', 5, 'mental_health'],
      ['Vitamin D3 2,000 unit capsule', '2026-11-28', 6, undefined],
    ]);
    expect(refillsDue(index('Sam Example'), '2026-12-12').map((r) => r.days)).toEqual([-14]);
    expect(refillsDue(index('Sam Example'), '2026-12-13')).toEqual([]);
  });

  it('wait until the last fill nears its end', () => {
    expect(refillsDue(index('Robin Example'), TODAY)).toEqual([]);
    expect(refillsDue(index('Robin Example'), '2027-02-01').map((r) => [r.medicine.name, r.runsOut, r.days])).toEqual([['Lisinopril 10 mg tablet', '2027-02-10', 9]]);
  });
});

describe('vaccine doses', () => {
  it('group a baby’s coming doses into the visits that give them', () => {
    const jamie = person('Jamie Example');
    const v = vaccineNeeds(jamie.birth_date, index('Jamie Example'), TODAY)!;
    expect(v.due).toEqual([]);
    expect(v.flu).toBeUndefined();
    expect(v.visits.map((x) => [x.from, x.days, x.months, x.doses.map((d) => d.id).sort()])).toEqual([
      ['2026-12-08', 16, 1, ['hepb']],
      ['2027-01-08', 47, 2, ['dtap', 'hib', 'ipv', 'pcv', 'rota']],
    ]);
  });

  it('say this season’s flu dose is missing for a child, and nothing for an adult', () => {
    const alex = person('Alex Example');
    expect(vaccineNeeds(alex.birth_date, index('Alex Example'), TODAY)).toMatchObject({ due: [], flu: { season: '2026–27', missing: true } });
    expect(vaccineNeeds(person('Robin Example').birth_date, index('Robin Example'), TODAY)).toBeUndefined();
    expect(vaccineNeeds(undefined, index('Alex Example'), TODAY)).toBeUndefined();
  });
});

describe('an age', () => {
  it('reads in days, weeks, months, then years', () => {
    expect([ageWords('2026-11-12', TODAY), ageWords('2026-11-08', TODAY), ageWords('2026-06-30', TODAY), ageWords('2018-01-01', TODAY), ageWords('2026-12-01', TODAY)]).toEqual([
      '10 days old',
      '2 weeks old',
      '4 months old',
      '8 years old',
      null,
    ]);
  });
});
