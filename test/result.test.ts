import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/model/flags';
import { rangeWords, resultContext, unitText, verdict } from '../src/model/result';
import { recordTitle } from '../src/model/titles';
import { demo, personNamed } from './demo-data';

describe('a result’s reading', () => {
  it('says where the value sits against a range in its unit', () => {
    expect(verdict({ value: 49, unit: 'cells/uL', range: '15 - 500 cells/uL' })).toMatchObject({ text: 'Within the lab’s range of 15–500 cells/µL.', outOfRange: false });
    expect(verdict({ value: 11.2, unit: 'g/dL', range: '12.0-15.5 g/dL' })).toMatchObject({ text: 'Below the lab’s range of 12–15.5 g/dL.', outOfRange: true });
    expect(verdict({ value: 162, unit: 'mg/dL', range: '<130 mg/dL' }).text).toBe('Above the lab’s range (under 130 mg/dL).');
    expect(verdict({ value: 55, unit: 'mg/dL', range: '>=40 mg/dL' }).text).toBe('Within the lab’s range (40 mg/dL or more).');
  });

  it('takes the lab’s mark as the reading, by the range when they agree', () => {
    expect(verdict({ value: 162, unit: 'mg/dL', range: '<130 mg/dL', interpretation: 'High' }).text).toBe('Above the lab’s range (under 130 mg/dL).');
    expect(verdict({ value: 5.6, unit: 'mmol/L', range: '3.5-5.1 mmol/L', interpretation: 'Critical high' }).text).toBe('Above the lab’s range of 3.5–5.1 mmol/L. The lab marked it critical.');
    // A mark that disagrees with the range is the lab's to make; say what it said.
    expect(verdict({ value: 120, unit: 'mg/dL', range: '<130 mg/dL', interpretation: 'High' })).toMatchObject({ text: 'The lab marked it high. Its range is under 130 mg/dL.', outOfRange: true });
    expect(verdict({ text: 'Positive', interpretation: 'Abnormal' } as never).text).toBe('The lab marked it abnormal.');
  });

  it('says when there is no range, or one in another unit', () => {
    expect(verdict({ value: 3 })).toMatchObject({ text: 'The lab gave no range for this result.', outOfRange: false });
    expect(verdict({ value: 3, unit: 'mg/dL', range: '1-5 mmol/L' }).text).toBe('The lab’s range is 1-5 mmol/L.');
  });

  it('writes ranges and units as a lab report prints them', () => {
    expect(rangeWords(parseRange('<=5')!, 'ug/mL')).toBe('5 µg/mL or less');
    expect(rangeWords(parseRange('>40')!, undefined)).toBe('over 40');
    expect(unitText('10*3/uL')).toBe('10*3/µL');
    expect(unitText('uIU/mL')).toBe('µIU/mL');
    expect(unitText('umol/L')).toBe('µmol/L');
    expect(unitText('U/L')).toBe('U/L');
    expect(unitText('mL/min/{1.73_m2}')).toBe('mL/min/{1.73_m2}');
  });
});

describe('a result in context', () => {
  const { household, indexes } = demo();
  const robin = personNamed(household, 'Robin Example');
  const idx = indexes.get(robin.id)!;
  const ldl = idx.records.filter((r) => r.kind === 'result' && r.code?.code === '13457-7').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!;
  const c = resultContext(idx, household, robin.id, '2026-11-22', ldl);

  it('has its history and its panel', () => {
    expect(c.series?.points).toHaveLength(4);
    expect(c.point?.id).toBe(ldl.id);
    expect(c.panel).toBe('Cholesterol (lipid panel)');
  });

  it('lists the rest of the draw, its own panel first, and never itself', () => {
    expect(c.sameDraw.map((g) => g.panel)).toEqual(['Cholesterol (lipid panel)', 'Metabolic panel', 'Blood sugar (A1c)']);
    expect(c.sameDraw[0]!.records.map(recordTitle)).toEqual(['Total cholesterol', 'Triglycerides', 'HDL cholesterol']);
    expect(c.sameDraw.flatMap((g) => g.records)).not.toContain(ldl);
  });

  it('came with its visit and lab report', () => {
    expect(c.visit?.record.kind).toBe('encounter');
    expect(c.documents.map((d) => d.title)).toEqual(['Lipid panel']);
  });
});
