import { describe, expect, it } from 'vitest';
import { LAB_TESTS, labTest, plainLoincName, resultName } from '../src/model/labtests';
import { PANELS } from '../src/model/panels';

const LOINC = 'http://loinc.org';

describe('the curated tests', () => {
  it('cover every code a panel lists', () => {
    const missing = PANELS.flatMap((p) => p.loinc).filter((c) => !Object.hasOwn(LAB_TESTS, c));
    expect(missing).toEqual([]);
  });

  it('cite a MedlinePlus page for every sentence they give', () => {
    for (const [code, t] of Object.entries(LAB_TESTS)) {
      if (t.about) expect(t.page, code).toMatch(/^https:\/\/medlineplus\.gov\//);
      // One or two sentences, ending as a sentence ends.
      if (t.about) expect(t.about.split(/(?<=\.)\s+/).length, code).toBeLessThanOrEqual(2);
    }
  });

  it('never read a person’s own result', () => {
    for (const t of Object.values(LAB_TESTS)) expect(t.about ?? '').not.toMatch(/\byour\b|\byou\b/i);
  });

  it('are found only by a LOINC code', () => {
    expect(labTest({ system: LOINC, code: '711-2' })?.name).toBe('Eosinophils');
    expect(labTest({ system: 'urn:oid:2.16.840.1.113883.6.1', code: '711-2' })).toBeUndefined();
    expect(labTest({ system: 'http://snomed.info/sct', code: '711-2' })).toBeUndefined();
    expect(labTest({ system: LOINC, code: 'constructor' })).toBeUndefined();
  });
});

describe('a result’s plain name', () => {
  it('is the curated name, then the source’s own, then the code’s', () => {
    expect(resultName({ display: 'Eosinophils [#/volume] in Blood by Automated count', code: { system: LOINC, code: '711-2' } })).toBe('Eosinophils');
    expect(resultName({ display: 'Peak flow' })).toBe('Peak flow');
    expect(resultName({ display: '', code: { system: LOINC, code: '0000-0', display: 'Protein [Mass/volume] in Urine' } })).toBe('Protein in urine');
    expect(resultName({})).toBe('Result');
  });

  it('reads a LOINC long name plainly', () => {
    expect(plainLoincName('Eosinophils [#/volume] in Blood by Automated count')).toBe('Eosinophils');
    expect(plainLoincName('Glucose [Mass/volume] in Serum or Plasma')).toBe('Glucose');
    expect(plainLoincName('Bilirubin.total [Mass/volume] in Blood')).toBe('Bilirubin total');
    expect(plainLoincName('Ketones [Presence] in Urine by Test strip')).toBe('Ketones in urine');
    expect(plainLoincName('LDL cholesterol')).toBeUndefined();
  });
});
