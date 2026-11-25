import { describe, expect, it } from 'vitest';
import { documentTitle } from '../src/model/records';
import { visitKind, visitOf, visitTimeline } from '../src/model/visits';
import type { MedDocument, MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const person = (name: string) => personNamed(household, name).id;
const index = (name: string) => indexes.get(person(name))!;
const timeline = (name: string, idx: PersonIndex = index(name)) => visitTimeline(idx, household, person(name), TODAY);
/** A person's index with the paper of that title linked to their visit of that name, as a record that names its papers links them. */
function linking(name: string, visit: string, title: string): PersonIndex {
  const idx = index(name);
  const doc = idx.documents.find((d) => d.title === title)!;
  return { ...idx, records: idx.records.map((r) => (r.kind === 'encounter' && r.display === visit ? { ...r, documents: [doc.id] } : r)) };
}
const docTitles = (v: { documents: { doc: MedDocument; linked: boolean }[] }) => v.documents.map((d) => `${d.linked ? 'linked ' : ''}${documentTitle(d.doc)}`);

describe('visits with their documents', () => {
  it('puts medrec’s linked documents first, then the same day’s from the same organization', () => {
    const { visits, loose } = timeline('Robin Example', linking('Robin Example', 'Office visit', 'Lipid panel'));
    expect(visits.map((v) => [v.start, v.record.fields.reason])).toEqual([
      ['2026-11-18', 'Cholesterol and potassium recheck'],
      ['2026-10-01', 'Annual physical'],
      ['2025-09-15', 'Follow-up'],
      ['2025-03-10', 'Annual physical'],
    ]);
    expect(visits.map(docTitles)).toEqual([['Basic metabolic panel'], ['linked Lipid panel', 'After visit summary', 'Statement from Example Health'], [], []]);
    // A statement from another provider, an insurer's EOB, a receipt and a scan from days with no visit stay out.
    expect(loose.map(documentTitle)).toEqual(['Statement from Example Lab', 'Explanation of Benefits', 'Payment receipt', 'Statement from Example Health, April', 'scan_0007']);
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
    expect(docTitles(sick)).toEqual(['Care instructions', 'School note']);
    expect(sick.recorded.map((g) => [g.kind, g.records.map((r) => r.display)])).toEqual([
      ['condition', ['Ear infection']],
      ['medication', ['Amoxicillin 400 mg/5 mL suspension']],
    ]);
  });

  it('spans a visit’s days, and names its kind only when its name does not', () => {
    // Sam's May visit made five days long, in a home nurse's words, with a medicine given on its last day.
    const idx = linking('Sam Example', 'Sports medicine visit', 'Sports medicine visit note');
    const visit = idx.records.find((r) => r.display === 'Sports medicine visit')!;
    const long: MedRecord = { ...visit, display: 'Nurse home visit', fields: { ...visit.fields, class: 'home health', period: { start: '2026-05-20', end: '2026-05-24' } } };
    const given: MedRecord = { ...idx.records.find((r) => r.kind === 'medication' && r.date === '2026-05-20')!, id: 'r_given', date: '2026-05-24' };
    const span = timeline('Sam Example', { ...idx, records: [...idx.records.map((r) => (r === visit ? long : r)), given] }).visits.find((v) => v.record.id === visit.id)!;
    expect([span.start, span.end]).toEqual(['2026-05-20', '2026-05-24']);
    expect(docTitles(span)).toEqual(['linked Sports medicine visit note']);
    expect(span.recorded.map((g) => [g.kind, g.records.length])).toEqual([['condition', 1], ['medication', 2]]);
    expect(visitKind(span)).toBeUndefined();
    const robin = timeline('Robin Example').visits;
    expect(visitKind(robin.find((v) => v.record.display === 'Office visit')!)).toBeUndefined();
    // Robin's 2025 physical, which its portal names by a billing descriptor.
    expect(visitKind(robin.find((v) => v.start === '2025-03-10')!)).toBe('Office visit');
    expect(visitKind(timeline('Alex Example').visits[0]!)).toBe('Office visit');
  });

  it('takes imaging from the visit’s days', () => {
    const v = timeline('Sam Example').visits.find((x) => x.record.display === 'Sports medicine visit')!;
    expect(docTitles(v)).toEqual(['Sports medicine visit note']);
    expect(v.studies.map((s) => s.description)).toEqual(['XR ankle, 3 views']);
  });

  it('gives a document to one visit only, and never takes one medrec linked to another', () => {
    const idx = index('Robin Example');
    const october = idx.records.find((r) => r.kind === 'encounter' && r.date === '2026-10-01')!;
    // A second visit the same day, at the same place, with the lab report linked to it.
    const lab = idx.documents.find((d) => d.title === 'Lipid panel')!;
    const second: MedRecord = { ...october, id: 'r_second', key: 'encounter|x|2026-10-01', display: 'Diet visit', documents: [lab.id] };
    const { visits } = timeline('Robin Example', { ...idx, records: [...idx.records, second] });
    const byName = (n: string) => visits.find((v) => v.record.display === n && v.start === '2026-10-01')!;
    expect(docTitles(byName('Diet visit'))).toEqual(['linked Lipid panel']);
    expect(docTitles(byName('Office visit'))).toEqual(['After visit summary', 'Statement from Example Health']);
  });

  it('leaves out withdrawn records, and visits not yet happened or cancelled', () => {
    const idx = index('Robin Example');
    const withdrawn = idx.records.map((r) => (r.kind === 'immunization' && r.date === '2026-10-01' ? { ...r, status: 'entered-in-error' } : r));
    expect(timeline('Robin Example', { ...idx, records: withdrawn }).visits[1]!.recorded.map((g) => g.kind)).toEqual(['result']);
    const october = idx.records.find((r) => r.kind === 'encounter' && r.date === '2026-10-01')!;
    const later = [{ ...october, id: 'r_planned', date: '2027-02-09', status: 'planned' }, { ...october, id: 'r_future', date: '2027-02-17' }];
    expect(timeline('Robin Example', { ...idx, records: [...idx.records, ...later] }).visits).toHaveLength(4);
  });

  it('finds the visit a record is', () => {
    const idx = index('Drew Example');
    const visit = idx.records.find((r) => r.display === 'Well child visit, 3 years')!;
    expect(visitOf(idx, household, person('Drew Example'), TODAY, visit.id)?.end).toBe('2025-12-16');
    expect(visitOf(idx, household, person('Drew Example'), TODAY, idx.records.find((r) => r.kind === 'result')!.id)).toBeUndefined();
  });
});
