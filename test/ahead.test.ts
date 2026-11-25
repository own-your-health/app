// What is ahead of a person as lines, for Home's Do now and Coming up and the
// calendar's Ahead; and Home's bills, grouped and ordered.
import { describe, expect, it } from 'vitest';
import { aheadAll, aheadOf, type AheadLine } from '../src/next/ahead';
import { householdEvents } from '../src/next/calendar';
import { billGroups } from '../src/next/homeView';
import { openBills, type OpenBill } from '../src/next/money';
import { addDays } from '../src/next/needs';
import type { Privacy } from '../src/model/private';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const person = (first: string) => personNamed(household, `${first} Example`);
const index = (first: string): PersonIndex => indexes.get(person(first).id)!;
const of = (first: string, own = false, today = TODAY, idx = index(first)) => aheadOf(person(first), idx, today, own);
const said = (ls: AheadLine[]) => ls.map((l) => [l.day, l.now, l.title, l.tag, l.short]);

/** Sam's famotidine order and last fill, as another medicine whose fill runs out on this day. */
const [order, fill] = ['2026-08-03', '2026-10-29'].map((d) => index('Sam').records.find((r) => r.display === 'Famotidine 20 mg tablet' && r.date === d)!) as [MedRecord, MedRecord];
const medicine = (name: string, runsOut: string): MedRecord[] =>
  [order, fill].map((r, i) => {
    const date = i ? addDays(runsOut, -30) : r.date!;
    return { ...r, id: `r_${name}${i}`, key: `medication|${name}|${date}`, code: undefined, display: name, date, fields: { ...r.fields, when: date } };
  });
/** Alex with these medicines. Alex has none of their own. */
const taking = (...meds: [string, string][]): PersonIndex => ({ ...index('Alex'), records: [...index('Alex').records, ...meds.flatMap(([n, d]) => medicine(n, d))] });
/** A Sunday. */
const SUNDAY = '2026-10-11';
const refills = (idx: PersonIndex, today = SUNDAY) => aheadOf({ ...person('Alex'), birth_date: undefined }, idx, today, true);

describe('what is ahead of a person', () => {
  it('is what is due, then what is coming up, soonest first', () => {
    expect(said(of('Alex'))).toEqual([['2026-07-01', true, 'Flu vaccine, 2026–27 season', 'Due', 'Flu due']]);
    expect(said(of('Drew'))).toEqual([['2026-12-14', false, '48-month vaccines', 'Dec 14', 'Dec 14']]);
    expect(of('Drew')[0]).toMatchObject({ text: 'from Dec 14 · DTaP, Polio, MMR, Chickenpox', brief: '4 vaccines, from then', late: false });
    expect(of('Robin')).toEqual([]);
  });

  it('leaves a private refill off a shared list, and marks it on the person’s own', () => {
    expect(said(of('Sam'))).toEqual([['2026-11-28', false, 'Famotidine 20 mg tablet', 'Nov 28', 'Nov 28']]);
    expect(of('Sam', true).map((l) => [l.title, l.private])).toEqual([
      ['Famotidine 20 mg tablet', undefined],
      ['Emtricitabine-tenofovir 200-300 mg tablet', 'sexual_health'],
    ]);
  });

  it('is nothing on a shared list for someone whose items are held back', () => {
    const held: PersonIndex = { ...index('Sam'), privacy: { kind: 'held', why: 'unreadable', text: 'Not read.' } };
    expect(of('Sam', false, TODAY, held)).toEqual([]);
    expect(of('Sam', true, TODAY, held)).toHaveLength(2);
  });

  it('is everyone’s, or one person’s with what is theirs alone', () => {
    const get = (id: string) => indexes.get(id);
    expect(aheadAll(household.people, get, TODAY).map((l) => l.title)).toEqual(['Flu vaccine, 2026–27 season', 'Famotidine 20 mg tablet', '48-month vaccines']);
    expect(aheadAll(household.people, get, TODAY, person('Sam').id).map((l) => l.title)).toEqual(['Famotidine 20 mg tablet', 'Emtricitabine-tenofovir 200-300 mg tablet']);
    // A person whose records are not read yet has none, and what is due comes first whoever's it is.
    expect(aheadAll(household.people, (id) => (id === person('Alex').id ? undefined : get(id)), TODAY).map((l) => l.person.name)).toEqual(['Sam Example', 'Drew Example']);
    expect(aheadAll([...household.people].reverse(), get, TODAY).map((l) => l.now)).toEqual([true, false, false]);
  });
});

describe('refills', () => {
  it('of one week share a line, from its Sunday, and say each medicine and its day', () => {
    // Sunday Oct 11 to Saturday Oct 17; Oct 18 starts the next week.
    const lines = refills(taking(['Baclofen', '2026-10-14'], ['Levothyroxine', '2026-10-17'], ['Timolol', '2026-10-18']));
    expect(said(lines)).toEqual([
      ['2026-10-14', false, '2 refills', 'Oct 14', 'Oct 14'],
      ['2026-10-18', false, 'Timolol', 'Oct 18', 'Oct 18'],
    ]);
    expect([lines[0]!.brief, lines[0]!.text]).toEqual(['Baclofen, Levothyroxine', 'Baclofen runs out about Oct 14 · Levothyroxine runs out about Oct 17']);
    expect(lines[0]!.route).toEqual({ name: 'health', who: person('Alex').id });
    expect([lines[1]!.brief, lines[1]!.text]).toEqual(['runs out about then', 'refill: runs out about Oct 18 · 30 days filled Sep 18 at Example Pharmacy']);
    expect(lines[1]!.route).toMatchObject({ name: 'item', person: person('Alex').id });
  });

  it('that have run out, or do today, are due, apart from the week’s others', () => {
    const lines = refills(taking(['Baclofen', '2026-10-08'], ['Levothyroxine', '2026-10-11'], ['Timolol', '2026-10-15']));
    expect(said(lines)).toEqual([
      ['2026-10-08', true, 'Baclofen', 'Oct 8', 'Refill due'],
      ['2026-10-11', true, 'Levothyroxine', 'Today', 'Refill due'],
      ['2026-10-15', false, 'Timolol', 'Oct 15', 'Oct 15'],
    ]);
    expect(lines.map((l) => l.late)).toEqual([true, false, false]);
    expect(lines.map((l) => l.brief)).toEqual(['ran out about then', 'runs out about then', 'runs out about then']);
    const two = refills(taking(['Baclofen', '2026-10-06'], ['Levothyroxine', '2026-10-09']));
    expect(said(two)).toEqual([['2026-10-06', true, '2 refills', 'Oct 6', '2 refills']]);
  });

  it('that are private share no line with those that are not', () => {
    const idx = taking(['Baclofen', '2026-10-13'], ['Levothyroxine', '2026-10-14'], ['Timolol', '2026-10-16']);
    const p = idx.privacy as Extract<Privacy, { kind: 'known' }>;
    const marked: PersonIndex = { ...idx, privacy: { ...p, records: new Map([...p.records, ['r_Levothyroxine1', 'household'], ['r_Timolol1', 'household']]) } };
    expect(refills(marked).map((l) => [l.title, l.brief, l.private])).toEqual([
      ['Baclofen', 'runs out about then', undefined],
      ['2 refills', 'Levothyroxine, Timolol', 'household'],
    ]);
    expect(aheadOf({ ...person('Alex'), birth_date: undefined }, marked, SUNDAY, false).map((l) => l.title)).toEqual(['Baclofen']);
  });
});

describe('doses', () => {
  /** Drew's as of a day. */
  const drew = (today: string) => of('Drew', false, today, { ...index('Drew'), records: index('Drew').records.filter((r) => r.date! <= today) });

  it('due together are one line', () => {
    const lines = drew('2026-12-14');
    expect(said(lines)).toEqual([['2026-12-14', true, '4 vaccine doses', 'Due', '4 doses due']]);
    expect(lines[0]).toMatchObject({ brief: 'DTaP, dose 5, Polio, dose 4, MMR, dose 2, Chickenpox, dose 2', late: true });
    expect(lines[0]!.text).toMatch(/ · the schedule places them by now, and these records don’t show them$/);
  });

  it('coming up at one visit are one line, named for the child’s age where every dose is', () => {
    expect(drew('2023-11-30')).toMatchObject([{ title: '12-month vaccines', brief: '5 vaccines, from then', text: 'from Dec 14 · Hib, Pneumococcal conjugate, MMR, Chickenpox, Hepatitis A', now: false }]);
    const one = { ...index('Drew'), records: index('Drew').records.filter((x) => x.date! <= '2023-01-03') };
    expect(of('Drew', false, '2023-01-03', one).map((l) => [l.title, l.brief, l.text, l.now, l.tag, l.short])).toEqual([
      ['Hepatitis B vaccine, dose 1', 'not in these records', 'the schedule places it by now, and these records don’t show it', true, 'Due', 'Vaccine due'],
      ['2-month vaccines', '5 vaccines, from then', 'from Feb 14 · Rotavirus, DTaP, Hib, Pneumococcal conjugate, Polio', false, 'Feb 14', 'Feb 14'],
    ]);
    // One dose is named, with when it is given.
    expect(drew('2024-04-01').map((l) => [l.title, l.brief, l.text])).toEqual([['Hepatitis A vaccine, dose 2', 'from then, 6–18 months after dose 1', 'from Jun 19 · 6–18 months after dose 1']]);
  });

  it('coming up in one week are one line, whichever visit gives them', () => {
    const hepA = (day: string): PersonIndex => {
      const records = index('Drew').records;
      const doses = records.filter((x) => x.kind === 'immunization' && /hepatitis a|hep a/i.test(x.display ?? ''));
      return { ...index('Drew'), records: [...records.filter((x) => !doses.includes(x)), { ...doses[0]!, date: day, fields: { ...doses[0]!.fields, when: day } }] };
    };
    // Six months after the first is a Wednesday, of the week the 48-month doses start on Monday.
    expect(of('Drew', false, TODAY, hepA('2026-06-16')).map((l) => [l.title, l.brief, l.tag])).toEqual([['5 vaccine doses', 'DTaP, Polio, MMR, Chickenpox, Hepatitis A', 'Dec 14']]);
    // The next week's is its own.
    expect(of('Drew', false, TODAY, hepA('2026-06-20')).map((l) => [l.title, l.tag])).toEqual([
      ['48-month vaccines', 'Dec 14'],
      ['Hepatitis A vaccine, dose 2', 'Dec 20'],
    ]);
  });
});

describe('Home’s bills', () => {
  const open = (first: string) => openBills(index(first), householdEvents(household, (id) => indexes.get(id), TODAY).filter((x) => x.person.id === person(first).id), TODAY);
  const owing = (change: (b: OpenBill) => OpenBill = (b) => b) => ['Robin', 'Sam', 'Alex'].map((p) => ({ person: person(p), idx: index(p), bills: open(p).map(change) }));
  const rows = (groups: ReturnType<typeof billGroups>) => groups.map((g) => [g.person.short, g.bills.map((b) => b.bill.provider), g.rank, g.day]);

  it('are those past due first, then those worth a call, then the others, each by due date', () => {
    expect(rows(billGroups(owing()))).toEqual([
      ['Sam', ['Example Billing'], 0, '2026-08-31'],
      ['Sam', ['Example Endoscopy Center'], 0, '2026-11-04'],
      ['Robin', ['Example Health'], 0, '2026-11-19'],
      ['Robin', ['Example Lab'], 2, '2026-11-27'],
    ]);
    // None past due: the one worth a call leads.
    expect(rows(billGroups(owing((b) => ({ ...b, overdue: false })))).map((r) => [r[1], r[2]])).toEqual([
      [['Example Billing'], 1],
      [['Example Endoscopy Center'], 2],
      [['Example Health'], 2],
      [['Example Lab'], 2],
    ]);
  });

  it('of one visit share a row, but for one worth a call', () => {
    const [visit] = open('Sam').map((b) => b.event!);
    const one = billGroups([{ person: person('Robin'), idx: index('Robin'), bills: open('Robin').map((b) => ({ ...b, event: visit! })) }]);
    expect(rows(one)).toEqual([['Robin', ['Example Health', 'Example Lab'], 0, '2026-11-19']]);
    const two = billGroups([{ person: person('Robin'), idx: index('Robin'), bills: open('Robin').map((b, i) => ({ ...b, event: visit!, ...(i ? { verdict: 'differs' as const } : {}) })) }]);
    expect(rows(two)).toEqual([
      ['Robin', ['Example Health'], 0, '2026-11-19'],
      ['Robin', ['Example Lab'], 1, '2026-11-27'],
    ]);
    // With no visit, each is its own.
    expect(billGroups([{ person: person('Robin'), idx: index('Robin'), bills: open('Robin').map((b) => ({ ...b, event: undefined })) }])).toHaveLength(2);
  });

  it('leave out one marked paid, and one a receipt may be for', () => {
    const receipt = index('Robin').documents.find((d) => d.doc_type === 'receipt')!;
    const groups = billGroups(owing((b) => (b.bill.provider === 'Example Health' ? { ...b, marked: true } : b.bill.provider === 'Example Lab' ? { ...b, bill: { ...b.bill, unread: [receipt] } } : b)));
    expect(rows(groups).map((r) => r[1])).toEqual([['Example Billing'], ['Example Endoscopy Center']]);
  });

  it('put one with no due date after those with one', () => {
    const groups = billGroups(owing((b) => (b.bill.provider === 'Example Health' ? { ...b, overdue: false, bill: { ...b.bill, due: undefined } } : b)));
    expect(rows(groups).at(-1)).toEqual(['Robin', ['Example Health'], 2, '9999']);
  });
});
