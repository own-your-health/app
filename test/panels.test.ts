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

  it('groups a child’s weights and heights as vital signs, a test with no panel apart, and urine pH with the urine and kidney panel', () => {
    expect(shape(index('Drew Example'))).toEqual([['Vital signs', 0, ['Weight', 'Height']], ['Other tests', 0, ['Lead, blood']]]);
    expect(shape(idx([result('5803-2', 'pH, urine', '2025-08-21', 6.4, 'pH', '4.8-7.9 pH')]))).toEqual([['Urine and kidney', 0, ['Urine pH']]]);
  });

  it('puts a critical result’s panel ahead of one merely out of range, whatever the dates', () => {
    const records = [
      result('5811-5', 'Specific gravity, urine', '2025-09-30', 1.041, '', '1.003-1.030', { interpretation: 'High' }),
      result('3024-7', 'T4, free', '2025-02-18', 0.2, 'ng/dL', '0.9-1.7 ng/dL', { interpretation: 'Critical low' }),
      result('2132-9', 'Cobalamin', '2025-10-21', 540, 'pg/mL', '>250 pg/mL'),
    ];
    expect(shape(idx(records)).map(([name]) => name)).toEqual(['Thyroid', 'Urine and kidney', 'Vitamins and iron']);
  });

  it('falls back to the category, and to Other tests, for codes outside the table', () => {
    const records = [
      result('1798-8', 'Amylase', '2025-06-12', 61, 'U/L', undefined, { category: 'Laboratory' }),
      result(undefined, 'Waist size', '2025-06-12', 94, 'cm', undefined, { category: 'Vital signs' }),
      result(undefined, 'Color vision plates', '2025-06-12', 11, '', undefined, { category: 'Exam' }),
    ];
    expect(shape(idx(records)).map(([name]) => name).sort()).toEqual(['Exam', 'Other tests', 'Vital signs']);
  });

  it('places a known code by the table, before its category', () => {
    const t = { series: { key: `${LOINC}|8310-5`, name: 'Temperature', points: [] }, latest: { id: 'x', text: '36.7' } } as unknown as LatestResult;
    expect(panelOf(index('Robin Example'), t, 'Chemistry')).toMatchObject({ id: 'vitals' });
  });
});
