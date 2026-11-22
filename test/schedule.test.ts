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

describe('ages and dates', () => {
  it('counts whole months', () => {
    expect(monthsBetween('2026-11-08', '2026-11-22')).toBe(0);
    expect(monthsBetween('2026-11-08', '2027-01-07')).toBe(1);
    expect(monthsBetween('2026-11-08', '2027-01-08')).toBe(2);
    expect(monthsBetween('2018-01-01', TODAY)).toBe(106);
  });

  it('adds months, keeping to the end of a shorter month', () => {
    expect(addMonths('2026-11-08', 2)).toBe('2027-01-08');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});

describe('a newborn against the schedule', () => {
  const rows = byId(scheduleFor('2026-11-08', records('Jamie Example'), TODAY)!);

  it('has the birth dose of hepatitis B, and the second coming up at 1–2 months', () => {
    expect(rows.hepb!.given.map((g) => g.day)).toEqual(['2026-11-08']);
    expect(rows.hepb!.next).toEqual({ dose: 2, state: 'coming_up', from: '2026-12-08', when: 'at 1–2 months' });
  });

  it('has the 2-month doses coming up within 90 days', () => {
    for (const id of ['rota', 'dtap', 'hib', 'pcv', 'ipv']) expect(rows[id]!.next, id).toMatchObject({ dose: 1, state: 'coming_up', from: '2027-01-08', when: 'at 2 months' });
  });

  it('leaves the rotavirus and Hib counts open until a dose names the brand', () => {
    expect([rows.rota!.totalText, rows.hib!.totalText, rows.dtap!.totalText]).toEqual(['2 or 3', '3 or 4', '5']);
  });

  it('has the 12-month and school-age doses later', () => {
    for (const id of ['mmr', 'var', 'hepa', 'tdap', 'hpv', 'menacwy']) expect(rows[id]!.next?.state, id).toBe('later');
    expect(rows.mmr!.next).toMatchObject({ from: '2027-11-08', when: 'at 12–15 months' });
    expect(rows.tdap!.next).toMatchObject({ when: 'at 11–12 years' });
  });

  it('has no flu season before 6 months', () => {
    expect(fluSeason('2026-11-08', records('Jamie Example'), TODAY)).toBeUndefined();
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
    const rows = byId(scheduleFor('2026-08-01', [dose('2026-08-01', '08', 'Hep B')], TODAY)!);
    expect(rows.hepb!.next).toMatchObject({ dose: 2, state: 'not_recorded', from: '2026-09-01' });
    expect(rows.dtap!.next).toMatchObject({ dose: 1, state: 'not_recorded', from: '2026-10-01' });
  });

  it('stops listing rotavirus after 8 months, and Hib and pneumococcal after 5 years', () => {
    expect(byId(scheduleFor('2026-02-01', [], TODAY)!).rota!.next?.state).toBe('past_age');
    const six = byId(scheduleFor('2020-06-01', [], TODAY)!);
    expect(six.hib!.next?.state).toBe('past_age');
    expect(six.pcv!.next?.state).toBe('past_age');
    expect(six.dtap!.next?.state).toBe('not_recorded');
  });

  it('reads Rotarix and PedvaxHIB by name when a dose has no CVX code', () => {
    const rows = byId(scheduleFor('2026-07-01', [dose('2026-09-01', undefined, 'Rotarix oral'), dose('2026-09-01', undefined, 'PedvaxHIB')], TODAY)!);
    expect([rows.rota!.total, rows.hib!.total]).toEqual([2, 3]);
  });

  it('makes rotavirus 3 doses when any dose was RotaTeq or unknown, and Hib 3 with PedvaxHIB only', () => {
    const mixed = [dose('2026-09-01', '119', 'Rotarix'), dose('2026-11-01', '116', 'RotaTeq')];
    expect(byId(scheduleFor('2026-07-01', mixed, TODAY)!).rota).toMatchObject({ total: 3, next: { dose: 3 } });
    const pedvax = [dose('2026-09-01', '49', 'PedvaxHIB'), dose('2026-11-01', '49', 'PedvaxHIB')];
    expect(byId(scheduleFor('2026-07-01', pedvax, TODAY)!).hib).toMatchObject({ total: 3, next: { dose: 3, when: 'at 12–15 months', from: '2027-07-01' } });
  });

  it('times a second HPV dose from the first', () => {
    const rows = byId(scheduleFor('2014-03-15', [dose('2026-05-04', '165', 'HPV9')], TODAY)!);
    expect(rows.hpv!.next).toMatchObject({ dose: 2, from: '2026-11-04', when: '6–12 months after dose 1', state: 'not_recorded' });
  });

  it('reads a vaccine by name when it has no CVX code, and skips doses not given', () => {
    const rows = byId(scheduleFor('2026-07-01', [dose('2026-09-01', undefined, 'Pentacel (DTaP-IPV/Hib)'), dose('2026-11-01', '20', 'DTaP', 'not-done')], TODAY)!);
    expect([rows.dtap!.given.length, rows.ipv!.given.length, rows.hib!.given.length, rows.hepb!.given.length]).toEqual([1, 1, 1, 0]);
  });

  it('reads a CVX code written without its leading zero', () => {
    expect(byId(scheduleFor('2026-11-01', [dose('2026-11-01', '8', 'Hep B')], TODAY)!).hepb!.given).toHaveLength(1);
  });

  it('gives 2 flu doses in a first season under 9, and 1 after two before', () => {
    expect(fluSeason('2025-01-01', [dose('2026-10-01', '141', 'Influenza')], TODAY)).toMatchObject({ season: '2026–27', due: 2, missing: true });
    expect(fluSeason('2025-01-01', [dose('2026-09-01', '141', 'Influenza'), dose('2026-10-01', '141', 'Influenza')], TODAY)).toMatchObject({ due: 2, missing: false });
    const twice = [dose('2024-10-01', '141', 'Influenza'), dose('2024-11-01', '141', 'Influenza')];
    expect(fluSeason('2023-01-01', twice, TODAY)).toMatchObject({ due: 1, given: [] });
    expect(fluSeason('2010-01-01', [], TODAY)).toMatchObject({ due: 1 });
    expect(fluSeason('2023-01-01', twice, '2026-06-30')).toMatchObject({ season: '2025–26' });
  });
});

describe('the overview’s digest', () => {
  it('lists a newborn’s coming doses, soonest first, then in the table’s order', () => {
    const rows = scheduleFor('2026-11-08', records('Jamie Example'), TODAY)!;
    expect(digestIds(scheduleDigest(rows, undefined))).toEqual(['hepb:coming_up', 'rota:coming_up', 'dtap:coming_up', 'hib:coming_up', 'pcv:coming_up', 'ipv:coming_up']);
  });

  it('lists only the flu dose for a child with the full series', () => {
    const rows = scheduleFor('2018-01-01', records('Alex Example'), TODAY)!;
    expect(digestIds(scheduleDigest(rows, fluSeason('2018-01-01', records('Alex Example'), TODAY)))).toEqual(['flu']);
  });

  it('puts doses not in the records first, then the flu, then what is coming up', () => {
    const records = [dose('2026-04-01', '08', 'Hep B')];
    const rows = scheduleFor('2026-04-01', records, TODAY)!;
    expect(digestIds(scheduleDigest(rows, fluSeason('2026-04-01', records, TODAY)))).toEqual([
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

