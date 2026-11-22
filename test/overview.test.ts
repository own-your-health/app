import { describe, expect, it } from 'vitest';
import {
  activeConditions,
  currentAllergies,
  currentMedicines,
  immunizationsGiven,
  isOutOfRange,
  latestResults,
  newInLatestLoads,
  recentVisits,
  resultFlag,
  RECENT_LOAD_MS,
} from '../src/model/overview';
import { organizationName, originNames } from '../src/model/records';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

// The sample folder's times are anchored here (scripts/demo-folder.mjs).
const ANCHOR = new Date('2026-11-22T20:00:00Z');
const { household, indexes } = demo();
const index = (name: string) => indexes.get(personNamed(household, name).id)!;

describe('a result against its range', () => {
  it('takes the source’s own interpretation first', () => {
    expect(resultFlag({ interpretation: 'High', value: 1, range: '3.5-5.1' })).toMatchObject({ level: 'high', critical: false, from: 'source', label: 'High' });
    expect(resultFlag({ interpretation: 'L' })).toMatchObject({ level: 'low', label: 'Low' });
    expect(resultFlag({ interpretation: 'Abnormal' })).toMatchObject({ level: 'abnormal', label: 'Abnormal' });
    expect(resultFlag({ interpretation: 'Normal', value: 9, range: '3.5-5.1' })).toMatchObject({ level: 'normal', from: 'source' });
    expect(resultFlag({ interpretation: 'N' })).toMatchObject({ level: 'normal' });
  });

  it('marks a critical value, and which way it went', () => {
    expect(resultFlag({ interpretation: 'HH' })).toMatchObject({ level: 'high', critical: true, label: 'Critical high' });
    expect(resultFlag({ interpretation: 'Critical low' })).toMatchObject({ level: 'low', critical: true, label: 'Critical low' });
    expect(resultFlag({ interpretation: 'AA' })).toMatchObject({ level: 'abnormal', critical: true, label: 'Critical' });
  });

  it('reads the range when the source gave no interpretation it can read', () => {
    expect(resultFlag({ value: 5.4, range: '3.5-5.1 mmol/L', unit: 'mmol/L' })).toMatchObject({ level: 'high', from: 'range', label: 'Above range' });
    expect(resultFlag({ value: 10, range: '11 g/dL – 15 g/dL', unit: 'g/dL' })).toMatchObject({ level: 'low', label: 'Below range' });
    expect(resultFlag({ value: 12, range: '11 g/dL – 15 g/dL', unit: 'g/dL' })).toMatchObject({ level: 'normal', label: 'In range' });
    expect(resultFlag({ value: 130, range: '<130 mg/dL', unit: 'mg/dL' })).toMatchObject({ level: 'high' });
    expect(resultFlag({ value: 130, range: '≤ 130 mg/dL', unit: 'mg/dL' })).toMatchObject({ level: 'normal' });
    expect(resultFlag({ value: 40, range: '> 40 mg/dL', unit: 'mg/dL' })).toMatchObject({ level: 'low' });
    expect(resultFlag({ value: 40, range: '≥ 40', unit: 'mg/dL' })).toMatchObject({ level: 'normal' });
    expect(resultFlag({ value: 15, range: '10 to 20' })).toMatchObject({ level: 'normal' });
    expect(resultFlag({ interpretation: 'Susceptible', value: 6, range: '1-5' })).toMatchObject({ level: 'high', from: 'range' });
  });

  it('says nothing when it cannot tell', () => {
    expect(resultFlag({ value: 5, range: 'Negative' })).toBeUndefined();
    expect(resultFlag({ value: 5.4, range: '3.5-5.1 mmol/L', unit: 'mg/dL' })).toBeUndefined();
    expect(resultFlag({ range: '3.5-5.1' })).toBeUndefined();
    expect(resultFlag({ value: 5 })).toBeUndefined();
    expect(isOutOfRange(undefined)).toBe(false);
    expect(isOutOfRange(resultFlag({ interpretation: 'Normal' }))).toBe(false);
  });
});

describe('the latest results', () => {
  it('put each test once, out of range first, then newest first', () => {
    const latest = latestResults(index('Robin Example'));
    expect(latest.map((r) => r.series.name)).toEqual(['Potassium', 'Creatinine', 'Glucose', 'Hemoglobin A1c', 'LDL cholesterol', 'Hemoglobin']);
    expect(latest[0]!.flag).toMatchObject({ level: 'high', from: 'source' });
    expect(latest.filter((r) => isOutOfRange(r.flag))).toHaveLength(1);
    expect(latest.find((r) => r.series.name === 'LDL cholesterol')!.latest.text).toBe('104 mg/dL');
  });

  it('put a critical result before a merely high one', () => {
    const idx = index('Robin Example');
    const critical = { ...idx.records.find((r) => r.display === 'Glucose' && r.date === '2026-10-01')! };
    critical.fields = { ...critical.fields, interpretation: 'HH' };
    const latest = latestResults({ ...idx, records: idx.records.map((r) => (r.id === critical.id ? critical : r)) });
    expect(latest.slice(0, 2).map((r) => [r.series.name, r.flag?.label])).toEqual([
      ['Glucose', 'Critical high'],
      ['Potassium', 'High'],
    ]);
  });
});

function withRecords(idx: PersonIndex, extra: Partial<MedRecord>[]): PersonIndex {
  const base = idx.records[0]!;
  return { ...idx, records: [...idx.records, ...extra.map((x, i) => ({ ...base, id: `r_extra${i}`, fields: {}, documents: [], ...x }) as MedRecord)] };
}

describe('what is current', () => {
  it('lists active conditions and counts the rest', () => {
    const c = activeConditions(index('Robin Example'));
    expect(c.active.map((r) => r.display)).toEqual(['High blood pressure']);
    expect(c.other).toBe(1);
  });

  it('takes a condition’s newest record, and leaves out one entered in error', () => {
    const idx = index('Robin Example');
    const htn = idx.records.find((r) => r.display === 'High blood pressure')!;
    const later = withRecords(idx, [{ kind: 'condition', code: htn.code, display: 'High blood pressure', date: '2026-11-01', status: 'resolved' }]);
    expect(activeConditions(later).active).toEqual([]);
    const mistaken = withRecords(idx, [{ kind: 'condition', display: 'Asthma', date: '2026-11-01', status: 'entered-in-error' }]);
    expect(activeConditions(mistaken).active.map((r) => r.display)).toEqual(['High blood pressure']);
  });

  it('shows an allergy without a status, and not a resolved one', () => {
    const idx = withRecords(index('Sam Example'), [
      { kind: 'allergy', display: 'Penicillin', date: '2020-01-01' },
      { kind: 'allergy', display: 'Latex', date: '2020-01-01', status: 'resolved' },
    ]);
    expect(currentAllergies(idx).map((r) => r.display)).toEqual(['Penicillin']);
    expect(currentAllergies(index('Robin Example')).map((r) => r.display)).toEqual(['Sulfa drugs']);
  });

  it('lists the active medicines', () => {
    expect(currentMedicines(index('Robin Example')).map((g) => g.name)).toEqual(['Lisinopril 10 mg tablet']);
    expect(currentMedicines(index('Alex Example')).map((g) => g.name)).toEqual(['Amoxicillin 400 mg/5 mL suspension']);
  });

  it('lists doses given, newest first, and not one not given', () => {
    const idx = withRecords(index('Alex Example'), [{ kind: 'immunization', display: 'Hep A', date: '2026-11-01', status: 'not-done' }]);
    const given = immunizationsGiven(idx);
    expect(given[0]!.display).toBe('Influenza, seasonal, injectable');
    expect(given.map((r) => r.display)).not.toContain('Hep A');
  });

  it('lists visits that happened, not planned or future ones', () => {
    const idx = withRecords(index('Alex Example'), [
      { kind: 'encounter', display: 'Well child visit, 9 years', date: '2027-01-11', status: 'planned' },
      { kind: 'encounter', display: 'Follow-up', date: '2026-12-01', status: 'finished' },
    ]);
    expect(recentVisits(idx, '2026-11-22').map((r) => r.display).slice(0, 2)).toEqual(['Sick visit', 'Well child visit, 8 years']);
  });
});

describe('new in the latest loads', () => {
  it('lists what each source’s newest import added', () => {
    const loads = newInLatestLoads(index('Robin Example'), ANCHOR);
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ cli: 'mychart', organization: 'example-health', at: '2026-11-22T17:00:00Z' });
    expect(loads[0]!.records.map((r) => r.display).sort()).toEqual(['Creatinine', 'Potassium']);
    expect(loads[0]!.documents.map((d) => d.title)).toEqual(['Basic metabolic panel']);
  });

  it('leaves out a load older than the window, and one that added nothing', () => {
    const alex = index('Alex Example');
    expect(newInLatestLoads(alex, ANCHOR)[0]!.records).toHaveLength(3);
    expect(newInLatestLoads(alex, new Date(ANCHOR.getTime() + RECENT_LOAD_MS))).toEqual([]);
    // Sam's newest loads added no record: their records were filed earlier.
    expect(newInLatestLoads(index('Sam Example'), ANCHOR)).toEqual([]);
  });

  it('counts a record only from the source whose import first filed it', () => {
    const idx = index('Robin Example');
    const run = idx.imports.find((i) => i.cli === 'mychart' && i.imported_at === '2026-11-22T17:00:00Z')!;
    const other = { ...run, cli: 'oneblood', organization: 'example-blood-center', imported_at: run.imported_at, id: 'i_other' };
    const loads = newInLatestLoads({ ...idx, imports: [...idx.imports.filter((i) => i.cli !== 'oneblood'), other] }, ANCHOR);
    expect(loads.find((l) => l.cli === 'oneblood')).toBeUndefined();
  });
});

describe('where a record came from', () => {
  it('names the household’s source for the organization, or says how it was filed', () => {
    const robin = personNamed(household, 'Robin Example');
    expect(organizationName(household, robin.id, 'example-health')).toBe('Example Health');
    expect(organizationName(household, robin.id, 'unknown-slug')).toBe('unknown-slug');
    const scan = { source: { kind: 'scan' }, method: 'scan', filed_at: '2026-01-01T00:00:00Z', filed_by: 'medrec' };
    const fhir = index('Robin Example').records[0]!.provenance[0]!;
    expect(originNames([fhir, fhir, scan], household, robin.id)).toEqual(['Example Health', 'Scanned']);
  });
});
