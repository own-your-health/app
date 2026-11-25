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
      ['Example Endoscopy Center', 9050, 'matches', 9050, false, true],
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
    // Only medrec's list says which claim the figure is of.
    for (const name of ['Robin Example', 'Sam Example']) {
      const bare: PersonIndex = { ...index(name), bills: undefined };
      const read = (idx: PersonIndex) => openBills(idx, events(name), TODAY).map(({ bill, ...b }) => ({ ...b, saidBy: undefined, id: bill.doc.id, event: b.event?.event.id }));
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
      ['Famotidine 20 mg tablet', '2026-11-28', 6, undefined],
      ['Emtricitabine-tenofovir 200-300 mg tablet', '2026-12-04', 12, 'sexual_health'],
    ]);
    expect(refillsDue(index('Sam Example'), '2026-12-18').map((r) => r.days)).toEqual([-14]);
    expect(refillsDue(index('Sam Example'), '2026-12-19')).toEqual([]);
  });

  it('wait until the last fill nears its end', () => {
    expect(refillsDue(index('Robin Example'), TODAY)).toEqual([]);
    expect(refillsDue(index('Robin Example'), '2026-12-01').map((r) => [r.medicine.name, r.runsOut, r.days])).toEqual([['Atorvastatin 20 mg tablet', '2026-12-07', 6]]);
    expect(refillsDue(index('Robin Example'), '2027-02-01').map((r) => [r.medicine.name, r.runsOut, r.days])).toEqual([['Lisinopril 10 mg tablet', '2027-02-10', 9]]);
  });
});

describe('vaccine doses', () => {
  it('group a child’s coming doses into the visits that give them', () => {
    const drew = person('Drew Example');
    /** Drew's doses as of a day. */
    const asOf = (day: string) => {
      const idx = index('Drew Example');
      return vaccineNeeds(drew.birth_date, { ...idx, records: idx.records.filter((r) => r.date! <= day) }, day)!;
    };
    const visits = (day: string) => asOf(day).visits.map((x) => [x.from, x.days, x.months, x.doses.map((d) => d.id).sort()]);
    expect([asOf(TODAY).due, asOf(TODAY).flu]).toEqual([[], undefined]);
    expect(visits(TODAY)).toEqual([['2026-12-14', 22, 48, ['dtap', 'ipv', 'mmr', 'var']]]);
    expect(visits('2023-11-30')).toEqual([['2023-12-14', 14, 12, ['hepa', 'hib', 'mmr', 'pcv', 'var']]]);
    // Once the day comes, they are due.
    expect([asOf('2026-12-14').due.map((d) => d.id).sort(), visits('2026-12-14')]).toEqual([['dtap', 'ipv', 'mmr', 'var'], []]);
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
    const on = '2025-08-19';
    expect([ageWords('2025-08-14', on), ageWords('2025-08-05', on), ageWords('2025-01-27', on), ageWords('2011-04-06', on), ageWords('2025-08-31', on)]).toEqual([
      '5 days old',
      '2 weeks old',
      '6 months old',
      '14 years old',
      null,
    ]);
  });
});
