import { describe, expect, it } from 'vitest';
import { visitKind, visitOf, visitTimeline } from '../src/model/visits';
import type { MedDocument, MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const person = (name: string) => personNamed(household, name).id;
const index = (name: string) => indexes.get(person(name))!;
const timeline = (name: string, idx: PersonIndex = index(name)) => visitTimeline(idx, household, person(name), TODAY);
const docTitles = (v: { documents: { doc: MedDocument; linked: boolean }[] }) => v.documents.map((d) => `${d.linked ? 'linked ' : ''}${d.doc.title}`);

describe('visits with their documents', () => {
  it('puts medrec’s linked documents first, then the same day’s from the same organization', () => {
    const { visits, loose } = timeline('Robin Example');
    expect(visits.map((v) => [v.start, v.record.fields.reason])).toEqual([
      ['2026-11-18', 'Blood pressure follow-up'],
      ['2026-10-01', 'Annual physical'],
      ['2025-09-15', 'Follow-up'],
      ['2025-03-10', 'Annual physical'],
    ]);
    expect(visits.map(docTitles)).toEqual([['Basic metabolic panel'], ['linked After visit summary', 'Lipid panel', 'Statement from Example Health'], [], []]);
    // A statement from another provider, an insurer's EOB, a receipt and a scan from days with no visit stay out.
    expect(loose.map((d) => d.title)).toEqual(['Statement from Example Lab', 'Explanation of Benefits', 'Payment receipt from Example Health', 'Statement from Example Health', 'Vaccination card']);
  });

  it('lists what was recorded at the visit by kind, and its claim', () => {
    const october = timeline('Robin Example').visits[1]!;
    expect(october.recorded.map((g) => [g.kind, g.records.length])).toEqual([
      ['result', 9],
      ['immunization', 1],
    ]);
    expect(october.claims.map((c) => c.fields.provider)).toEqual(['Example Health']);
    expect(timeline('Robin Example').visits[0]!.recorded.map((g) => g.records.map((r) => r.display))).toEqual([['Potassium', 'Creatinine']]);
  });

  it('matches a document filed by hand by its day and the practice’s name', () => {
    const sick = timeline('Alex Example').visits[0]!;
    expect(sick.record.display).toBe('Sick visit');
    expect(docTitles(sick)).toEqual(['School note']);
    expect(sick.recorded.map((g) => [g.kind, g.records.map((r) => r.display)])).toEqual([
      ['condition', ['Ear infection']],
      ['medication', ['Amoxicillin 400 mg/5 mL suspension']],
    ]);
  });

  it('spans a stay’s days, and names its kind only when its name does not', () => {
    const stay = timeline('Jamie Example').visits.find((v) => v.record.display === 'Birth hospital stay')!;
    expect([stay.start, stay.end]).toEqual(['2026-07-28', '2026-07-30']);
    expect(docTitles(stay)).toEqual(['linked Newborn discharge summary']);
    expect(stay.recorded.map((g) => g.kind)).toEqual(['result', 'immunization']);
    expect(visitKind(stay)).toBeUndefined();
    const robin = timeline('Robin Example').visits;
    expect(visitKind(robin.find((v) => v.record.display === 'Office visit')!)).toBeUndefined();
    // Robin's 2025 physical, which its portal names by a billing descriptor.
    expect(visitKind(robin.find((v) => v.start === '2025-03-10')!)).toBe('Office visit');
    expect(visitKind(timeline('Alex Example').visits[0]!)).toBe('Office visit');
  });

  it('takes imaging from the visit’s days', () => {
    const v = timeline('Sam Example').visits.find((x) => x.record.display === 'Sports medicine visit')!;
    expect(docTitles(v)).toEqual(['linked Sports medicine visit note']);
    expect(v.studies.map((s) => s.description)).toEqual(['XR ankle, 3 views']);
  });

  it('gives a document to one visit only, and never takes one medrec linked to another', () => {
    const idx = index('Robin Example');
    const october = idx.records.find((r) => r.kind === 'encounter' && r.date === '2026-10-01')!;
    // A second visit the same day, at the same place, with the lab report linked to it.
    const lab = idx.documents.find((d) => d.title === 'Lipid panel')!;
    const second: MedRecord = { ...october, id: 'r_second', key: 'encounter|x|2026-10-01', display: 'Lab draw', documents: [lab.id] };
    const { visits } = timeline('Robin Example', { ...idx, records: [...idx.records, second] });
    const byName = (n: string) => visits.find((v) => v.record.display === n && v.start === '2026-10-01')!;
    expect(docTitles(byName('Lab draw'))).toEqual(['linked Lipid panel']);
    expect(docTitles(byName('Office visit'))).toEqual(['linked After visit summary', 'Statement from Example Health']);
  });

  it('leaves out withdrawn records, and visits not yet happened or cancelled', () => {
    const idx = index('Robin Example');
    const withdrawn = idx.records.map((r) => (r.kind === 'immunization' && r.date === '2026-10-01' ? { ...r, status: 'entered-in-error' } : r));
    expect(timeline('Robin Example', { ...idx, records: withdrawn }).visits[1]!.recorded.map((g) => g.kind)).toEqual(['result']);
    const october = idx.records.find((r) => r.kind === 'encounter' && r.date === '2026-10-01')!;
    const later = [{ ...october, id: 'r_planned', date: '2026-12-01', status: 'planned' }, { ...october, id: 'r_future', date: '2026-12-02' }];
    expect(timeline('Robin Example', { ...idx, records: [...idx.records, ...later] }).visits).toHaveLength(4);
  });

  it('finds the visit a record is', () => {
    const idx = index('Jamie Example');
    const stay = idx.records.find((r) => r.display === 'Birth hospital stay')!;
    expect(visitOf(idx, household, person('Jamie Example'), TODAY, stay.id)?.end).toBe('2026-07-30');
    expect(visitOf(idx, household, person('Jamie Example'), TODAY, idx.records.find((r) => r.kind === 'result')!.id)).toBeUndefined();
  });
});
