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
    expect(labTest({ system: LOINC, code: '2132-9' })?.name).toBe('Vitamin B12');
    expect(labTest({ system: 'urn:oid:2.16.840.1.113883.6.1', code: '2132-9' })).toBeUndefined();
    expect(labTest({ system: 'http://snomed.info/sct', code: '2132-9' })).toBeUndefined();
    expect(labTest({ system: LOINC, code: 'constructor' })).toBeUndefined();
  });
});

describe('a result’s plain name', () => {
  it('is the curated name, then the source’s own, then the code’s', () => {
    expect(resultName({ display: 'Cobalamin (Vitamin B12) [Mass/volume] in Serum or Plasma', code: { system: LOINC, code: '2132-9' } })).toBe('Vitamin B12');
    expect(resultName({ display: 'Waist size' })).toBe('Waist size');
    expect(resultName({ display: '', code: { system: LOINC, code: '0000-0', display: 'Calprotectin [Mass/mass] in Stool' } })).toBe('Calprotectin in stool');
    expect(resultName({})).toBe('Result');
  });

  it('reads a LOINC long name plainly', () => {
    expect(plainLoincName('Selenium [Mass/volume] in Blood by Mass spectrometry')).toBe('Selenium');
    expect(plainLoincName('Caffeine [Mass/volume] in Serum or Plasma')).toBe('Caffeine');
    expect(plainLoincName('Magnesium.ionized [Moles/volume] in Blood')).toBe('Magnesium ionized');
    expect(plainLoincName('Yeast [#/area] in Sputum by Light microscopy')).toBe('Yeast in sputum');
    expect(plainLoincName('Bone density')).toBeUndefined();
  });
});
