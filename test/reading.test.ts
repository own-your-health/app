import { describe, expect, it } from 'vitest';
import { resultFlag } from '../src/model/flags';
import { resultPoint, resultReading, resultSeries } from '../src/model/records';
import { verdict } from '../src/model/result';
import type { MedRecord } from '../src/model/types';
import { recordsOf } from './rules';

// Results whose value came as text (a FHIR valueString), as some labs send
// them, next to one that came as a quantity.
const idx = recordsOf('Riley');
const named = (display: string, date = '2026-03-24'): MedRecord => idx.records.find((r) => r.display === display && r.date === date)!;

describe('a result’s value sent as text', () => {
  it('reads a bare number as a number, in the unit its range names', () => {
    expect(resultReading(named('Magnesium').fields)).toEqual({ value: 2.1, unit: 'mg/dL', text: '2.1 mg/dL' });
    expect(resultReading(named('Phosphorus').fields)).toEqual({ value: 5.9, unit: 'mg/dL', text: '5.9 mg/dL' });
  });

  it('keeps a bare number with no range unitless', () => {
    expect(resultReading(named('Lymphocytes').fields)).toEqual({ value: 31, unit: undefined, text: '31' });
    expect(verdict(resultPoint(named('Lymphocytes'))).text).toBe('The lab gave no range for this result.');
  });

  it('reads it against the lab’s range, as a quantity would be', () => {
    expect(verdict(resultPoint(named('Magnesium')))).toMatchObject({ text: 'Within the lab’s range of 1.6–2.6 mg/dL.', outOfRange: false, flag: { level: 'normal' } });
    expect(verdict(resultPoint(named('Phosphorus')))).toMatchObject({ text: 'Above the lab’s range of 2.5–4.5 mg/dL.', outOfRange: true, flag: { level: 'high' } });
  });

  it('plots it with the series’ quantities, in one unit', () => {
    const magnesium = resultSeries(idx).find((s) => s.name === 'Magnesium')!;
    expect(magnesium.unit).toBe('mg/dL');
    expect(magnesium.points.map((p) => [p.date, p.value])).toEqual([
      ['2025-06-10', 1.9],
      ['2026-03-24', 2.1],
    ]);
  });

  it('keeps a bound as text, and reads it only when every value it allows sits on one side', () => {
    const crp = resultPoint(named('C-reactive protein'));
    expect(crp).toMatchObject({ value: undefined, bound: { op: '<', n: 0.3 }, text: '<0.3 mg/dL' });
    // Under 0.3 could be in 0–1 or below it: no reading, only the range.
    expect(verdict(crp)).toMatchObject({ text: 'The lab’s range is 0–1 mg/dL.', outOfRange: false });
    expect(verdict(resultPoint(named('Vitamin B12')))).toMatchObject({ text: 'Within the lab’s range (200 pg/mL or more).', outOfRange: false });
    expect(verdict(resultPoint(named('Iron')))).toMatchObject({ text: 'Below the lab’s range of 50–150 µg/dL.', outOfRange: true });
  });

  it('keeps other text as the lab wrote it', () => {
    expect(resultReading(named('Urine clarity').fields)).toEqual({ text: 'Clear' });
    expect(verdict(resultPoint(named('Urine clarity'))).outOfRange).toBe(false);
  });
});

describe('a bound against a range', () => {
  const flag = (op: '<' | '<=' | '>' | '>=', n: number, range: string) => resultFlag({ bound: { op, n }, range })?.level;

  it('decides at the range’s edges the way the range draws them', () => {
    expect(flag('<', 1, '1-5')).toBe('low');
    expect(flag('<=', 1, '1-5')).toBeUndefined();
    expect(flag('<', 1, '>1')).toBe('low');
    expect(flag('<=', 1, '>1')).toBe('low');
    expect(flag('>', 5, '1-5')).toBe('high');
    expect(flag('>=', 5, '1-5')).toBeUndefined();
    expect(flag('>=', 130, '<130')).toBe('high');
    expect(flag('<', 130, '<130')).toBe('normal');
    expect(flag('<=', 130, '<130')).toBeUndefined();
    expect(flag('>', 60, '>=60')).toBe('normal');
    expect(flag('>', 59, '>=60')).toBeUndefined();
  });

  it('says nothing when the bound reaches past the range on its open side', () => {
    expect(flag('<', 0.5, '0-1')).toBeUndefined();
    expect(flag('>', 60, '60-120')).toBeUndefined();
  });
});
