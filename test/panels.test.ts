import { describe, expect, it } from 'vitest';
import { panelOf, resultGroups } from '../src/model/panels';
import type { LatestResult } from '../src/model/overview';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const index = (name: string) => indexes.get(personNamed(household, name).id)!;
const shape = (idx: PersonIndex) => resultGroups(idx).map((g) => [g.name, g.outOfRange, g.tests.map((t) => t.series.name)]);

const LOINC = 'http://loinc.org';
let n = 0;
function result(code: string | undefined, display: string, date: string, value: number, unit: string, range?: string, extra: Record<string, string> = {}): MedRecord {
  n += 1;
  return {
    id: `r_res${n}`,
    kind: 'result',
    key: `result|${code ?? display}|${date}`,
    date,
    ...(code ? { code: { system: LOINC, code, display } } : {}),
    display,
    status: 'final',
    fields: { value: { value, unit }, ...(range ? { reference_range: range } : {}), ...extra },
    documents: [],
    provenance: [],
  };
}
const idx = (records: MedRecord[]) => ({ ...index('Robin Example'), records }) as PersonIndex;

describe('results by panel', () => {
  it('puts the panel with an out-of-range result first, and that result first in it', () => {
    expect(shape(index('Robin Example'))).toEqual([
      ['Metabolic panel', 1, ['Potassium', 'Glucose', 'Creatinine', 'Sodium', 'Calcium']],
      ['Cholesterol (lipid panel)', 0, ['Total cholesterol', 'Triglycerides', 'HDL cholesterol', 'LDL cholesterol']],
      ['Blood sugar (A1c)', 0, ['A1c']],
      ['Blood count (CBC)', 0, ['Hemoglobin']],
    ]);
  });

  it('flags a low result read from its range', () => {
    expect(shape(index('Sam Example'))).toEqual([
      ['Blood count (CBC)', 1, ['Hemoglobin', 'White blood cells', 'Platelets']],
      ['Vitamins and iron', 0, ['Vitamin D']],
      ['Thyroid', 0, ['TSH (thyroid)']],
    ]);
  });

  it('groups a child’s weights and heights as vital signs, a test with no panel apart, and bilirubin with the liver panel', () => {
    expect(shape(index('Drew Example'))).toEqual([['Vital signs', 0, ['Weight', 'Height']], ['Other tests', 0, ['Lead, blood']]]);
    expect(shape(idx([result('1975-2', 'Bilirubin, total', '2026-03-02', 0.7, 'mg/dL', '0.2-1.2 mg/dL')]))).toEqual([['Liver panel', 0, ['Bilirubin']]]);
  });

  it('puts a critical result’s panel ahead of one merely out of range, whatever the dates', () => {
    const records = [
      result('2823-3', 'Potassium', '2026-11-01', 5.6, 'mmol/L', '3.5-5.1 mmol/L', { interpretation: 'High' }),
      result('718-7', 'Hemoglobin', '2026-01-01', 6.1, 'g/dL', '12.0-15.5 g/dL', { interpretation: 'Critical low' }),
      result('2093-3', 'Cholesterol, total', '2026-11-10', 180, 'mg/dL', '<200 mg/dL'),
    ];
    expect(shape(idx(records)).map(([name]) => name)).toEqual(['Blood count (CBC)', 'Metabolic panel', 'Cholesterol (lipid panel)']);
  });

  it('falls back to the category, and to Other tests, for codes outside the table', () => {
    const records = [
      result('94500-6', 'SARS-CoV-2 RNA', '2026-03-01', 0, '', undefined, { category: 'Laboratory' }),
      result(undefined, 'Peak flow', '2026-03-01', 410, 'L/min', undefined, { category: 'Vital signs' }),
      result(undefined, 'Grip strength', '2026-03-01', 1, '', undefined, { category: 'Exam' }),
    ];
    expect(shape(idx(records)).map(([name]) => name).sort()).toEqual(['Exam', 'Other tests', 'Vital signs']);
  });

  it('places a known code by the table, before its category', () => {
    const t = { series: { key: `${LOINC}|2160-0`, name: 'Creatinine', points: [] }, latest: { id: 'x', text: '1' } } as unknown as LatestResult;
    expect(panelOf(t, 'Chemistry')).toMatchObject({ id: 'metabolic' });
  });
});
