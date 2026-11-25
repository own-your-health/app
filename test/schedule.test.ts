import { describe, expect, it } from 'vitest';
import { addMonths, fluSeason, monthsBetween, scheduleDigest, scheduleFor, type DigestEntry, type ScheduleRow } from '../src/model/schedule';
import type { MedRecord } from '../src/model/types';
import { demo, personNamed } from './demo-data';

// The sample folder's anchor day (scripts/demo-folder.mjs).
const TODAY = '2026-11-22';
const { household, indexes } = demo();
const records = (name: string) => indexes.get(personNamed(household, name).id)!.records;
const byId = (rows: ScheduleRow[]) => Object.fromEntries(rows.map((r) => [r.id, r]));
const digestIds = (d: DigestEntry[]) => d.map((e) => ('flu' in e ? 'flu' : `${e.row.id}:${e.row.next.state}`));

let n = 0;
function dose(date: string, code: string | undefined, display: string, status = 'completed'): MedRecord {
  n += 1;
  return {
    id: `r_dose${n}`,
    kind: 'immunization',
    key: `immunization|${code ?? display}|${date}`,
    date,
    ...(code ? { code: { system: 'http://hl7.org/fhir/sid/cvx', code, display } } : {}),
    display,
    status,
    fields: {},
    documents: [],
    provenance: [],
  };
}

const BORN = '2021-05-11';
const AT_THREE_WEEKS = '2021-06-01';
const birthDose = [dose(BORN, '08', 'Hep B')];
/** One visit's, at two months. */
const twoMonthDoses = [dose('2021-07-13', '110', 'DTaP-hepatitis B and poliovirus vaccine'), dose('2021-07-13', '48', 'Hib (PRP-T)'), dose('2021-07-13', '133', 'Pneumococcal conjugate PCV 13'), dose('2021-07-13', '116', 'Rotavirus, pentavalent')];

describe('ages and dates', () => {
  it('counts whole months', () => {
    expect(monthsBetween('2021-05-11', '2021-06-01')).toBe(0);
    expect(monthsBetween('2021-05-11', '2021-07-10')).toBe(1);
    expect(monthsBetween('2021-05-11', '2021-07-11')).toBe(2);
    expect(monthsBetween('2013-10-08', '2025-08-19')).toBe(142);
  });

  it('adds months, keeping to the end of a shorter month', () => {
    expect(addMonths('2019-11-06', 3)).toBe('2020-02-06');
    expect(addMonths('2029-01-30', 1)).toBe('2029-02-28');
    expect(addMonths('2032-01-30', 1)).toBe('2032-02-29');
  });
});

describe('a newborn against the schedule', () => {
  // Three weeks old, with the birth dose alone.
  const rows = byId(scheduleFor(BORN, birthDose, AT_THREE_WEEKS)!);

  it('has the birth dose of hepatitis B, and the second coming up at 1–2 months', () => {
    expect(rows.hepb!.given.map((g) => g.day)).toEqual([BORN]);
    expect(rows.hepb!.next).toEqual({ dose: 2, state: 'coming_up', from: '2021-06-11', when: 'at 1–2 months' });
  });

  it('has the 2-month doses coming up within 90 days', () => {
    for (const id of ['rota', 'dtap', 'hib', 'pcv', 'ipv']) expect(rows[id]!.next, id).toMatchObject({ dose: 1, state: 'coming_up', from: '2021-07-11', when: 'at 2 months' });
  });

  it('leaves the rotavirus and Hib counts open until a dose names the brand', () => {
    expect([rows.rota!.totalText, rows.hib!.totalText, rows.dtap!.totalText]).toEqual(['2 or 3', '3 or 4', '5']);
  });

  it('has the 12-month and school-age doses later', () => {
    for (const id of ['mmr', 'var', 'hepa', 'tdap', 'hpv', 'menacwy']) expect(rows[id]!.next?.state, id).toBe('later');
    expect(rows.mmr!.next).toMatchObject({ from: '2022-05-11', when: 'at 12–15 months' });
    expect(rows.tdap!.next).toMatchObject({ when: 'at 11–12 years' });
  });

  it('has no flu season before 6 months', () => {
    expect(fluSeason(BORN, birthDose, '2021-08-03')).toBeUndefined();
  });
});

describe('a baby with the two-month doses', () => {
  const rows = byId(scheduleFor(BORN, [...birthDose, ...twoMonthDoses], '2021-08-24')!);

  it('has the four-month doses coming up, and counts the combination vaccine toward hepatitis B', () => {
    for (const id of ['rota', 'dtap', 'hib', 'pcv', 'ipv']) expect(rows[id]!.next, id).toMatchObject({ dose: 2, state: 'coming_up', from: '2021-09-11', when: 'at 4 months' });
    expect(rows.hepb!.given.map((g) => g.day)).toEqual([BORN, '2021-07-13']);
    expect(rows.hepb!.next).toMatchObject({ dose: 3, state: 'coming_up', from: '2021-11-11' });
  });

  it('has the rotavirus and Hib counts the doses’ brands give', () => {
    expect([rows.rota!.totalText, rows.hib!.totalText]).toEqual(['3', '4']);
  });
});

describe('a school-age child with the full series', () => {
  const rows = byId(scheduleFor('2018-01-01', records('Alex Example'), TODAY)!);

  it('counts combination vaccines toward each part, one dose a day', () => {
    expect(rows.dtap!.given).toHaveLength(5);
    expect(rows.ipv!.given).toHaveLength(4);
    expect(rows.hib!.given).toHaveLength(4);
    expect(rows.hepb!.given).toHaveLength(3);
    for (const id of ['hepb', 'rota', 'dtap', 'hib', 'pcv', 'ipv', 'mmr', 'var', 'hepa']) expect(rows[id]!.next, id).toBeUndefined();
  });

  it('takes Rotarix as a 2-dose series', () => {
    expect(rows.rota).toMatchObject({ total: 2, totalText: '2' });
  });

  it('has this season’s flu dose not in these records', () => {
    expect(fluSeason('2018-01-01', records('Alex Example'), TODAY)).toMatchObject({ season: '2026–27', due: 1, given: [] });
  });
});

describe('the schedule’s own rules', () => {
  it('gives nothing for an adult', () => {
    expect(scheduleFor('1980-01-01', records('Robin Example'), TODAY)).toBeUndefined();
    expect(fluSeason('1980-01-01', records('Robin Example'), TODAY)).toBeUndefined();
  });

  it('says a dose is not in the records once its age has come', () => {
    const rows = byId(scheduleFor('2019-03-26', [dose('2019-03-26', '08', 'Hep B')], '2019-07-02')!);
    expect(rows.hepb!.next).toMatchObject({ dose: 2, state: 'not_recorded', from: '2019-04-26' });
    expect(rows.dtap!.next).toMatchObject({ dose: 1, state: 'not_recorded', from: '2019-05-26' });
  });

  it('stops listing rotavirus after 8 months, and Hib and pneumococcal after 5 years', () => {
    expect(byId(scheduleFor('2019-03-26', [], '2020-01-07')!).rota!.next?.state).toBe('past_age');
    const six = byId(scheduleFor('2013-08-20', [], '2019-11-19')!);
    expect(six.hib!.next?.state).toBe('past_age');
    expect(six.pcv!.next?.state).toBe('past_age');
    expect(six.dtap!.next?.state).toBe('not_recorded');
  });

  it('reads Rotarix and PedvaxHIB by name when a dose has no CVX code', () => {
    const rows = byId(scheduleFor('2019-03-26', [dose('2019-05-28', undefined, 'Rotarix oral'), dose('2019-05-28', undefined, 'PedvaxHIB')], '2019-08-20')!);
    expect([rows.rota!.total, rows.hib!.total]).toEqual([2, 3]);
  });

  it('makes rotavirus 3 doses when any dose was RotaTeq or unknown, and Hib 3 with PedvaxHIB only', () => {
    const mixed = [dose('2019-05-28', '119', 'Rotarix'), dose('2019-07-30', '116', 'RotaTeq')];
    expect(byId(scheduleFor('2019-03-26', mixed, '2019-08-20')!).rota).toMatchObject({ total: 3, next: { dose: 3 } });
    const pedvax = [dose('2019-05-28', '49', 'PedvaxHIB'), dose('2019-07-30', '49', 'PedvaxHIB')];
    expect(byId(scheduleFor('2019-03-26', pedvax, '2019-08-20')!).hib).toMatchObject({ total: 3, next: { dose: 3, when: 'at 12–15 months', from: '2020-03-26' } });
  });

  it('times a second HPV dose from the first', () => {
    const rows = byId(scheduleFor('2008-06-10', [dose('2019-10-08', '165', 'HPV9')], '2020-05-12')!);
    expect(rows.hpv!.next).toMatchObject({ dose: 2, from: '2020-04-08', when: '6–12 months after dose 1', state: 'not_recorded' });
  });

  it('reads a vaccine by name when it has no CVX code, and skips doses not given', () => {
    const rows = byId(scheduleFor('2019-03-26', [dose('2019-05-28', undefined, 'Pentacel (DTaP-IPV/Hib)'), dose('2019-07-30', '20', 'DTaP', 'not-done')], '2019-08-20')!);
    expect([rows.dtap!.given.length, rows.ipv!.given.length, rows.hib!.given.length, rows.hepb!.given.length]).toEqual([1, 1, 1, 0]);
  });

  it('reads a CVX code written without its leading zero', () => {
    expect(byId(scheduleFor('2019-03-26', [dose('2019-03-26', '8', 'Hep B')], '2019-04-16')!).hepb!.given).toHaveLength(1);
  });

  it('gives 2 flu doses in a first season under 9, and 1 after two before', () => {
    const on = '2019-11-19';
    expect(fluSeason('2018-02-20', [dose('2019-10-08', '141', 'Influenza')], on)).toMatchObject({ season: '2019–20', due: 2, missing: true });
    expect(fluSeason('2018-02-20', [dose('2019-09-10', '141', 'Influenza'), dose('2019-10-08', '141', 'Influenza')], on)).toMatchObject({ due: 2, missing: false });
    const twice = [dose('2017-10-03', '141', 'Influenza'), dose('2017-11-07', '141', 'Influenza')];
    expect(fluSeason('2016-05-17', twice, on)).toMatchObject({ due: 1, given: [] });
    expect(fluSeason('2006-09-12', [], on)).toMatchObject({ due: 1 });
    expect(fluSeason('2016-05-17', twice, '2019-06-30')).toMatchObject({ season: '2018–19' });
  });
});

describe('the overview’s digest', () => {
  it('lists a newborn’s coming doses, soonest first, then in the table’s order', () => {
    const rows = scheduleFor(BORN, birthDose, AT_THREE_WEEKS)!;
    expect(digestIds(scheduleDigest(rows, undefined))).toEqual(['hepb:coming_up', 'rota:coming_up', 'dtap:coming_up', 'hib:coming_up', 'pcv:coming_up', 'ipv:coming_up']);
  });

  it('lists only the flu dose for a child with the full series', () => {
    const rows = scheduleFor('2018-01-01', records('Alex Example'), TODAY)!;
    expect(digestIds(scheduleDigest(rows, fluSeason('2018-01-01', records('Alex Example'), TODAY)))).toEqual(['flu']);
  });

  it('puts doses not in the records first, then the flu, then what is coming up', () => {
    const records = [dose('2019-03-26', '08', 'Hep B')];
    const rows = scheduleFor('2019-03-26', records, '2019-11-19')!;
    expect(digestIds(scheduleDigest(rows, fluSeason('2019-03-26', records, '2019-11-19')))).toEqual([
      'hepb:not_recorded',
      'rota:not_recorded',
      'dtap:not_recorded',
      'hib:not_recorded',
      'pcv:not_recorded',
      'ipv:not_recorded',
      'flu',
    ]);
  });

  it('is empty when nothing is missing and nothing is near', () => {
    expect(scheduleDigest(scheduleFor('2018-01-01', records('Alex Example'), '2026-05-01')!, undefined)).toEqual([]);
  });
});

