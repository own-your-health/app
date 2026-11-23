import { describe, expect, it } from 'vitest';
import { resultFlag } from '../src/model/flags';
import { parseIndex } from '../src/model/parse';
import { resultPoint, resultReading, resultSeries } from '../src/model/records';
import { verdict } from '../src/model/result';
import type { MedRecord } from '../src/model/types';
import { fixture } from './helpers';

// Results whose value came as text (a FHIR valueString), as some labs send
// them, next to one that came as a quantity: test/fixtures/folder/index-text-values.json.
const idx = parseIndex(fixture('folder/index-text-values.json'), 'p_aaaaaaaaaaaaaaaaaaaa');
const named = (display: string, date = '2026-10-15'): MedRecord => idx.records.find((r) => r.display === display && r.date === date)!;

describe('a result’s value sent as text', () => {
  it('reads a bare number as a number, in the unit its range names', () => {
    expect(resultReading(named('Glucose').fields)).toEqual({ value: 95, unit: 'mg/dL', text: '95 mg/dL' });
    expect(resultReading(named('Fasting glucose').fields)).toEqual({ value: 105, unit: 'mg/dL', text: '105 mg/dL' });
  });

  it('keeps a bare number with no range unitless', () => {
    expect(resultReading(named('Platelets').fields)).toEqual({ value: 7, unit: undefined, text: '7' });
    expect(verdict(resultPoint(named('Platelets'))).text).toBe('The lab gave no range for this result.');
  });

  it('reads it against the lab’s range, as a quantity would be', () => {
    expect(verdict(resultPoint(named('Glucose')))).toMatchObject({ text: 'Within the lab’s range of 65–99 mg/dL.', outOfRange: false, flag: { level: 'normal' } });
    expect(verdict(resultPoint(named('Fasting glucose')))).toMatchObject({ text: 'Above the lab’s range of 65–99 mg/dL.', outOfRange: true, flag: { level: 'high' } });
  });

  it('plots it with the series’ quantities, in one unit', () => {
    const glucose = resultSeries(idx).find((s) => s.name === 'Glucose')!;
    expect(glucose.unit).toBe('mg/dL');
    expect(glucose.points.map((p) => [p.date, p.value])).toEqual([
      ['2026-04-15', 88],
      ['2026-10-15', 95],
    ]);
  });

  it('keeps a bound as text, and reads it only when every value it allows sits on one side', () => {
    const bilirubin = resultPoint(named('Bilirubin, total'));
    expect(bilirubin).toMatchObject({ value: undefined, bound: { op: '<', n: 0.5 }, text: '<0.5 mg/dL' });
    // Under 0.5 could be in 0–1 or below it: no reading, only the range.
    expect(verdict(bilirubin)).toMatchObject({ text: 'The lab’s range is 0–1 mg/dL.', outOfRange: false });
    expect(verdict(resultPoint(named('eGFR')))).toMatchObject({ text: 'Within the lab’s range (60 mL/min/1.73m2 or more).', outOfRange: false });
    expect(verdict(resultPoint(named('Ferritin')))).toMatchObject({ text: 'Below the lab’s range of 1–5 ng/mL.', outOfRange: true });
  });

  it('keeps other text as the lab wrote it', () => {
    expect(resultReading(named('Urine color').fields)).toEqual({ text: 'Yellow' });
    expect(verdict(resultPoint(named('Urine color'))).outOfRange).toBe(false);
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
