import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/model/flags';
import { rangeWords, resultContext, unitText, verdict } from '../src/model/result';
import { recordTitle } from '../src/model/titles';
import { demo, personNamed } from './demo-data';

describe('a result’s reading', () => {
  it('says where the value sits against a range in its unit', () => {
    expect(verdict({ value: 271, unit: 'K/uL', range: '160 - 435 K/uL' })).toMatchObject({ text: 'Within the lab’s range of 160–435 K/µL.', outOfRange: false });
    expect(verdict({ value: 30.7, unit: 'mm Hg', range: '34.0-46.5 mm Hg' })).toMatchObject({ text: 'Below the lab’s range of 34–46.5 mm Hg.', outOfRange: true });
    expect(verdict({ value: 47, unit: 'mm/h', range: '<22 mm/h' }).text).toBe('Above the lab’s range (under 22 mm/h).');
    expect(verdict({ value: 9, unit: 'mg/L', range: '>=4 mg/L' }).text).toBe('Within the lab’s range (4 mg/L or more).');
  });

  it('takes the lab’s mark as the reading, by the range when they agree', () => {
    expect(verdict({ value: 47, unit: 'mm/h', range: '<22 mm/h', interpretation: 'High' }).text).toBe('Above the lab’s range (under 22 mm/h).');
    expect(verdict({ value: 71.2, unit: 'mm Hg', range: '34.5-46.5 mm Hg', interpretation: 'Critical high' }).text).toBe('Above the lab’s range of 34.5–46.5 mm Hg. The lab marked it critical.');
    // A mark that disagrees with the range is the lab's to make; say what it said.
    expect(verdict({ value: 18, unit: 'mm/h', range: '<22 mm/h', interpretation: 'High' })).toMatchObject({ text: 'The lab marked it high. Its range is under 22 mm/h.', outOfRange: true });
    expect(verdict({ text: 'Cloudy', interpretation: 'Abnormal' } as never).text).toBe('The lab marked it abnormal.');
  });

  it('says when there is no range, or one in another unit', () => {
    expect(verdict({ value: 74 })).toMatchObject({ text: 'The lab gave no range for this result.', outOfRange: false });
    expect(verdict({ value: 26, unit: 'ng/mL', range: '12-40 nmol/L' }).text).toBe('The lab’s range is 12-40 nmol/L.');
  });

  it('writes ranges and units as a lab report prints them', () => {
    expect(rangeWords(parseRange('<=65')!, 'ug/g')).toBe('65 µg/g or less');
    expect(rangeWords(parseRange('>7')!, undefined)).toBe('over 7');
    expect(unitText('10*2/uL')).toBe('10*2/µL');
    expect(unitText('uIU/L')).toBe('µIU/L');
    expect(unitText('umol/d')).toBe('µmol/d');
    expect(unitText('U/h')).toBe('U/h');
    expect(unitText('mg/h/{70_kg}')).toBe('mg/h/{70_kg}');
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
