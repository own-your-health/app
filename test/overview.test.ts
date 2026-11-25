import { describe, expect, it } from 'vitest';
import { latestResults } from '../src/model/overview';
import { isOutOfRange, parseRange, resultFlag } from '../src/model/flags';
import { recentVisits } from '../src/model/visits';
import { practiceName, practiceOrId } from '../src/model/practices';
import { originNames } from '../src/model/records';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const index = (name: string) => indexes.get(personNamed(household, name).id)!;

describe('a result against its range', () => {
  it('takes the source’s own interpretation first', () => {
    expect(resultFlag({ interpretation: 'High', value: 2, range: '20.5-55.5' })).toMatchObject({ level: 'high', critical: false, from: 'source', label: 'High' });
    expect(resultFlag({ interpretation: 'L' })).toMatchObject({ level: 'low', label: 'Low' });
    expect(resultFlag({ interpretation: 'Abnormal' })).toMatchObject({ level: 'abnormal', label: 'Abnormal' });
    expect(resultFlag({ interpretation: 'Normal', value: 83, range: '20.5-55.5' })).toMatchObject({ level: 'normal', from: 'source' });
    expect(resultFlag({ interpretation: 'N' })).toMatchObject({ level: 'normal' });
  });

  it('marks a critical value, and which way it went', () => {
    expect(resultFlag({ interpretation: 'HH' })).toMatchObject({ level: 'high', critical: true, label: 'Critical high' });
    expect(resultFlag({ interpretation: 'Critical low' })).toMatchObject({ level: 'low', critical: true, label: 'Critical low' });
    expect(resultFlag({ interpretation: 'AA' })).toMatchObject({ level: 'abnormal', critical: true, label: 'Critical' });
  });

  it('reads the range when the source gave no interpretation it can read', () => {
    expect(resultFlag({ value: 24.1, range: '10.5-20.5 mm Hg', unit: 'mm Hg' })).toMatchObject({ level: 'high', from: 'range', label: 'Above range' });
    expect(resultFlag({ value: 66, range: '75 ug/dL – 140 ug/dL', unit: 'ug/dL' })).toMatchObject({ level: 'low', label: 'Below range' });
    expect(resultFlag({ value: 98, range: '75 ug/dL – 140 ug/dL', unit: 'ug/dL' })).toMatchObject({ level: 'normal', label: 'In range' });
    expect(resultFlag({ value: 85, range: '<85 kU/L', unit: 'kU/L' })).toMatchObject({ level: 'high' });
    expect(resultFlag({ value: 85, range: '≤ 85 kU/L', unit: 'kU/L' })).toMatchObject({ level: 'normal' });
    expect(resultFlag({ value: 6, range: '> 6 mg/L', unit: 'mg/L' })).toMatchObject({ level: 'low' });
    expect(resultFlag({ value: 6, range: '≥ 6', unit: 'mg/L' })).toMatchObject({ level: 'normal' });
    expect(resultFlag({ value: 37, range: '25 to 45' })).toMatchObject({ level: 'normal' });
    expect(resultFlag({ interpretation: 'Indeterminate', value: 14, range: '3-9' })).toMatchObject({ level: 'high', from: 'range' });
  });

  it('reads a range as numbers, with which bounds count as out', () => {
    expect(parseRange('24-61 U/mL')).toEqual({ low: 24, high: 61, unit: 'U/mL' });
    expect(parseRange('75 ug/dL – 140 ug/dL')).toEqual({ low: 75, high: 140, unit: 'ug/dL' });
    expect(parseRange('<85 kU/L')).toEqual({ high: 85, highStrict: true, unit: 'kU/L' });
    expect(parseRange('≤ 9')).toEqual({ high: 9, highStrict: false, unit: undefined });
    expect(parseRange('> 6 mg/L')).toEqual({ low: 6, lowStrict: true, unit: 'mg/L' });
    expect(parseRange('Not detected')).toBeUndefined();
  });

  it('says nothing when it cannot tell', () => {
    expect(resultFlag({ value: 14, range: 'Not detected' })).toBeUndefined();
    expect(resultFlag({ value: 24.1, range: '10.5-20.5 mm Hg', unit: 'kPa' })).toBeUndefined();
    expect(resultFlag({ range: '20.5-55.5' })).toBeUndefined();
    expect(resultFlag({ value: 14 })).toBeUndefined();
    expect(isOutOfRange(undefined)).toBe(false);
    expect(isOutOfRange(resultFlag({ interpretation: 'Normal' }))).toBe(false);
  });
});

describe('the latest results', () => {
  it('put each test once, out of range first, then newest first', () => {
    const latest = latestResults(index('Robin Example'));
    expect(latest.map((r) => r.series.name)).toEqual([
      'Potassium',
      'Creatinine',
      // The rest by date, then by name (each test's plain name, labtests.ts).
      'A1c',
      'Glucose',
      'HDL cholesterol',
      'LDL cholesterol',
      'Sodium',
      'Total cholesterol',
      'Triglycerides',
      'Hemoglobin',
      'Calcium',
    ]);
    expect(latest[0]!.flag).toMatchObject({ level: 'high', from: 'source' });
    expect(latest.filter((r) => isOutOfRange(r.flag))).toHaveLength(1);
    expect(latest.find((r) => r.series.name === 'LDL cholesterol')!.latest.text).toBe('104 mg/dL');
  });

  it('put a critical result before a merely high one', () => {
    const idx = index('Robin Example');
    const critical = { ...idx.records.find((r) => r.display === 'Sodium' && r.date === '2026-10-01')! };
    critical.fields = { ...critical.fields, interpretation: 'HH' };
    const latest = latestResults({ ...idx, records: idx.records.map((r) => (r.id === critical.id ? critical : r)) });
    expect(latest.slice(0, 2).map((r) => [r.series.name, r.flag?.label])).toEqual([
      ['Sodium', 'Critical high'],
      ['Potassium', 'High'],
    ]);
  });
});

function withRecords(idx: PersonIndex, extra: Partial<MedRecord>[]): PersonIndex {
  const base = idx.records[0]!;
  return { ...idx, records: [...idx.records, ...extra.map((x, i) => ({ ...base, id: `r_extra${i}`, code: undefined, fields: {}, documents: [], ...x }) as MedRecord)] };
}

describe('what is current', () => {
  it('lists visits that happened, not planned or future ones', () => {
    const idx = withRecords(index('Alex Example'), [
      { kind: 'encounter', display: 'Dental cleaning', date: '2027-03-08', status: 'planned' },
      { kind: 'encounter', display: 'Glasses fitting', date: '2026-12-15', status: 'finished' },
    ]);
    expect(recentVisits(idx, '2026-11-22').map((r) => r.display).slice(0, 2)).toEqual(['Sick visit', 'Well child visit, 8 years']);
  });
});

describe('where a record came from', () => {
  it('names the household’s source for the organization, or says how it was filed', () => {
    const robin = personNamed(household, 'Robin Example');
    expect(practiceName(household, robin.id, { organization_id: 'example-health' })).toBe('Example Health');
    expect(practiceOrId(household, robin.id, { organization_id: 'unknown-slug' })).toBe('unknown-slug');
    const scan = { source: { kind: 'scan' }, method: 'scan', filed_at: '2026-01-01T00:00:00Z', filed_by: 'medrec' };
    const fhir = index('Robin Example').records[0]!.provenance[0]!;
    expect(originNames([fhir, fhir, scan], household, robin.id)).toEqual(['Example Health', 'Scanned']);
  });
});
