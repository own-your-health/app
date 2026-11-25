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
      ['Example Surgery Center', 17500, 'matches', 17500, false, true],
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

  it('have no claim behind them when no visit takes them and medrec lists no claim', () => {
    const bare: PersonIndex = { ...index('Robin Example'), bills: undefined };
    expect(openBills(bare, [], TODAY).map((b) => b.verdict)).toEqual(['no_claim', 'no_claim']);
    expect(openBills(index('Robin Example'), [], TODAY).map((b) => b.verdict)).toEqual(['matches', 'matches']);
  });

  it('read the same from medrec’s list and, without it, from their visits’ claims', () => {
    for (const name of ['Robin Example', 'Sam Example']) {
      const bare: PersonIndex = { ...index(name), bills: undefined };
      const read = (idx: PersonIndex) => openBills(idx, events(name), TODAY).map(({ bill, ...b }) => ({ ...b, id: bill.doc.id, event: b.event?.event.id }));
      expect(read(bare)).toEqual(read(index(name)));
    }
  });

  it('carry no private area when neither they nor their visits are private', () => {
    expect(['Robin Example', 'Sam Example'].flatMap((n) => openBills(index(n), events(n), TODAY)).map((b) => b.private)).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('refills', () => {
  it('show from two weeks before a supply runs out to two weeks after, soonest first, private ones marked', () => {
    const sam = refillsDue(index('Sam Example'), TODAY);
    expect(sam.map((r) => [r.medicine.name, r.runsOut, r.days, r.private])).toEqual([
      ['Loratadine 10 mg tablet', '2026-11-24', 2, undefined],
      ['Nicotine 14 mg/24 hour patch', '2026-11-28', 6, 'substance_use'],
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
      ['2026-11-28', 6, 4, ['dtap', 'hib', 'ipv', 'pcv', 'rota']],
      ['2027-01-28', 67, 6, ['hepb']],
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
    const on = '2026-03-20';
    expect([ageWords('2026-03-10', on), ageWords('2026-03-06', on), ageWords('2025-10-30', on), ageWords('2018-01-01', on), ageWords('2026-03-29', on)]).toEqual([
      '10 days old',
      '2 weeks old',
      '4 months old',
      '8 years old',
      null,
    ]);
  });
});
