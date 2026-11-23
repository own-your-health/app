import { describe, expect, it } from 'vitest';
import { connectOid, learnMore, searchable, VIS_BY_CVX } from '../src/model/learn';
import type { MedRecord } from '../src/model/types';

const rec = (kind: string, system: string | undefined, code: string | undefined, display = 'Something'): Pick<MedRecord, 'kind' | 'code' | 'display'> => ({ kind, display, code: system || code ? { system, code, display: `${display} (coded)` } : undefined }) as Pick<MedRecord, 'kind' | 'code' | 'display'>;

describe('learn more', () => {
  it('opens MedlinePlus Connect for a code it takes, with the code system’s OID', () => {
    const l = learnMore(rec('result', 'http://loinc.org', '711-2'), 'Eosinophils')!;
    expect(l.site).toBe('MedlinePlus');
    const u = new URL(l.url);
    expect(u.origin + u.pathname).toBe('https://connect.medlineplus.gov/application');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      'mainSearchCriteria.v.cs': '2.16.840.1.113883.6.1',
      'mainSearchCriteria.v.c': '711-2',
      'mainSearchCriteria.v.dn': 'Eosinophils',
      'informationRecipient.languageCode.c': 'en',
    });
  });

  it.each([
    ['http://www.nlm.nih.gov/research/umls/rxnorm', '2.16.840.1.113883.6.88'],
    ['http://hl7.org/fhir/sid/ndc', '2.16.840.1.113883.6.69'],
    ['http://hl7.org/fhir/sid/icd-10-cm', '2.16.840.1.113883.6.90'],
    ['http://hl7.org/fhir/sid/icd-9-cm', '2.16.840.1.113883.6.103'],
    ['http://snomed.info/sct', '2.16.840.1.113883.6.96'],
    ['http://www.ama-assn.org/go/cpt', '2.16.840.1.113883.6.12'],
    ['urn:oid:2.16.840.1.113883.6.88', '2.16.840.1.113883.6.88'],
    ['HTTP://LOINC.ORG/', '2.16.840.1.113883.6.1'],
  ])('takes %s as %s', (system, oid) => {
    expect(connectOid(system)).toBe(oid);
  });

  it('does not take WHO ICD-10, an unknown OID or nothing', () => {
    expect(connectOid('http://hl7.org/fhir/sid/icd-10')).toBeUndefined();
    expect(connectOid('urn:oid:1.2.3')).toBeUndefined();
    expect(connectOid(undefined)).toBeUndefined();
  });

  it('names a code only by this app’s own name for it, never by text from the records', () => {
    const l = learnMore(rec('condition', 'http://hl7.org/fhir/sid/icd-10-cm', 'I10', 'Follow up in 2 weeks'), 'Follow up in 2 weeks')!;
    expect(new URL(l.url).searchParams.has('mainSearchCriteria.v.dn')).toBe(false);
    expect(l.url).not.toMatch(/Follow|weeks|coded/);
    expect(l.carries).toEqual({ code: true, named: false });
    expect(learnMore(rec('result', 'http://loinc.org', '711-2', 'Eos, clinic text'), 'Eos')!.carries).toEqual({ code: true, named: true });
  });

  it('opens CDC’s statement for a vaccine’s CVX code, padded as CDC writes it', () => {
    expect(learnMore(rec('immunization', 'http://hl7.org/fhir/sid/cvx', '141'), 'Flu')).toEqual({ url: 'https://www.cdc.gov/vaccines/hcp/current-vis/influenza-inactivated.html', site: 'CDC', carries: { code: true, named: false, vaccine: true } });
    expect(learnMore(rec('immunization', 'http://hl7.org/fhir/sid/cvx', '3'), 'MMR')!.url).toBe('https://www.cdc.gov/vaccines/hcp/current-vis/mmr.html');
    for (const slug of Object.values(VIS_BY_CVX)) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('searches MedlinePlus by name when there is no code it takes', () => {
    const l = learnMore(rec('immunization', 'http://hl7.org/fhir/sid/cvx', '213'), 'COVID-19 vaccine')!;
    expect(l.url).toBe('https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&query=COVID-19+vaccine');
    expect(l.carries).toEqual({ search: 'COVID-19 vaccine' });
    expect(learnMore(rec('allergy', undefined, undefined), '  Latex \n')!.url).toContain('query=Latex');
  });

  it('searches by a name only when it reads as the name of a thing', () => {
    for (const ok of ['Latex', 'Amoxicillin 500 mg capsule', 'COVID-19 vaccine', 'Seasonal allergies (hay fever)', 'Vitamin D3 2,000 unit tablet']) expect(searchable(ok), ok).toBe(true);
    for (const no of [
      'Fell at home. Daughter to call back',
      'Rash after 3/14/2026 dose',
      'Seen 2026-03-14 for follow-up',
      'Call 5551234567',
      'Note from someone@example.com',
      'See https://example.com/x',
      'Allergy:\ncats',
      'One two three four five six seven eight nine',
      'x'.repeat(61),
      '   ',
    ])
      expect(searchable(no), no).toBe(false);
    expect(learnMore(rec('condition', undefined, undefined), 'Fell at home. Daughter to call back')).toBeUndefined();
  });

  it('offers nothing for a visit, a claim or a coverage', () => {
    for (const kind of ['encounter', 'claim', 'coverage']) expect(learnMore(rec(kind, 'http://www.ama-assn.org/go/cpt', '99213'), 'Office visit')).toBeUndefined();
  });
});
