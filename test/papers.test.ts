// Papers: every file with the visit it belongs to (held by the visit, linked
// by one of its records, or the receipt for its bill), or why it has none.
import { describe, expect, it } from 'vitest';
import { parseIndex } from '../src/model/parse';
import type { MedrecRule } from '../src/model/events';
import { documentTitle } from '../src/model/records';
import type { PersonIndex } from '../src/model/types';
import { papersOf, sharedPapers } from '../src/next/papers';
import { demo, personNamed } from './demo-data';
import { demoJson } from './helpers';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const id = (name: string) => personNamed(household, name).id;
const papers = (name: string, all = indexes) => papersOf(all.get(id(name))!, household, TODAY, all);
const titled = (name: string, title: string, date?: string) => papers(name).find((p) => documentTitle(p.doc) === title && (!date || p.doc.date === date))!;

describe('where each paper belongs', () => {
  it('lists everyone’s papers newest first, each with its visit or why it has none', () => {
    const all = sharedPapers(household, indexes, TODAY);
    expect(all).toHaveLength(19);
    expect(all.map((p) => p.doc.date)).toEqual([...all.map((p) => p.doc.date)].sort().reverse());
    expect(all.filter((p) => !p.with).map((p) => [documentTitle(p.doc), p.why])).toEqual([
      // Sam has private visits, so a shared screen says what is listed there, not that there was none.
      ['Referral to digestive health', 'No visit listed here is on or near Aug 3, 2026.'],
      ['scan_0007.png', 'A vaccine record covers many visits.'],
    ]);
  });

  it('puts a paper with the visit that holds it, at the visit’s sureness', () => {
    const summary = titled('Sam Example', 'After your upper endoscopy.pdf');
    expect([summary.with?.event.kind, summary.with?.how, summary.with?.confidence]).toEqual(['outpatient', 'event', 'sure']);
    expect(titled('Sam Example', 'Statement from Example Billing.pdf').with?.confidence).toBe('likely');
  });

  it('puts an explanation of benefits with the visit of the claim that links it, and a receipt with its bill’s', () => {
    const eob = titled('Robin Example', 'Explanation of Benefits');
    expect([eob.with?.how, eob.with?.event.start]).toEqual(['claim', '2026-10-01']);
    const receipt = titled('Robin Example', 'Payment receipt.pdf');
    expect([receipt.with?.how, receipt.with?.event.start, receipt.with?.confidence]).toEqual(['bill', '2025-03-10', 'likely']);
  });

  it('says which visits a paper could be part of when medrec puts it with none of several', () => {
    const robin = structuredClone(indexes.get(id('Robin Example'))!);
    const [a, b] = robin.events!.events.filter((e) => e.kind === 'office');
    const card = robin.documents.find((d) => d.doc_type === 'immunization_record')!;
    robin.events!.pending.push({ document: card.id, could_join: [a!.id, b!.id], rule: 'D4' as MedrecRule });
    const p = papersOf(robin, household, TODAY, new Map([...indexes, [robin.person, robin]])).find((x) => x.doc.id === card.id)!;
    expect(p.why).toBe('It fits 2 visits, so medrec puts it with none of them.');
    expect(p.could?.map((e) => e.id)).toEqual([a!.id, b!.id]);
    expect(p.private).toBeUndefined();
  });

  it('keeps a paper private when a visit it could be part of is, since its line names that visit', () => {
    const sam = structuredClone(indexes.get(id('Sam Example'))!);
    const clinic = sam.events!.events.find((e) => e.start === '2026-11-03')!;
    const other = sam.events!.events.find((e) => e.kind === 'outpatient')!;
    const doc = sam.documents.find((d) => d.title === 'Sports medicine visit note')!;
    // The note fits the clinic visit or the endoscopy, and neither holds nor links it.
    for (const e of sam.events!.events) e.members = e.members.filter((m) => m.document !== doc.id);
    for (const r of sam.records) r.documents = r.documents.filter((d) => d !== doc.id);
    sam.events!.pending.push({ document: doc.id, could_join: [other.id, clinic.id], rule: 'D4' as MedrecRule });
    const p = papersOf(sam, household, TODAY, new Map([...indexes, [sam.person, sam]])).find((x) => x.doc.id === doc.id)!;
    expect([p.with, p.could?.length, p.private]).toEqual([undefined, 2, 'sexual_health']);
  });

  it('says why a paper is with no visit: no date, none near its date, or a kind about no one visit', () => {
    const robin = structuredClone(indexes.get(id('Robin Example'))!);
    const [first] = robin.documents;
    robin.documents.push(
      { ...first!, id: 'd_undated', title: 'Undated letter', doc_type: 'letter', date: undefined },
      { ...first!, id: 'd_far', title: 'Old letter', doc_type: 'letter', date: '2019-06-01' },
      { ...first!, id: 'd_card', title: 'Plan card', doc_type: 'insurance_card', date: '2026-01-01' },
    );
    const why = (doc: string) => papersOf(robin, household, TODAY, indexes).find((p) => p.doc.id === doc)!.why;
    expect(why('d_undated')).toBe('It has no date to match a visit by.');
    expect(why('d_far')).toBe('No visit in these records is on or near Jun 1, 2019.');
    expect(why('d_card')).toBe('An insurance card is about no one visit.');
  });

  it('shows a parent’s paper in a child’s visit as with that visit (X2)', () => {
    const drew = structuredClone(indexes.get(id('Drew Example'))!);
    const robin = indexes.get(id('Robin Example'))!;
    const scan = robin.documents.find((d) => d.doc_type === 'immunization_record')!;
    const visit = drew.events!.events[0]!;
    visit.members.push({ document: scan.id, person: robin.person, kind: 'immunization_record', role: 'paper', rule: 'X2' as MedrecRule, confidence: 'likely' });
    drew.events!.papers.set(scan.id, { person: robin.person, doc: scan });
    const all = new Map([...indexes, [drew.person, drew]]);
    const p = papersOf(robin, household, TODAY, all).find((x) => x.doc.id === scan.id)!;
    expect([p.with?.person, p.with?.event.id, p.with?.how]).toEqual([drew.person, visit.id, 'event']);
  });
});

describe('papers without medrec’s events', () => {
  it('uses the app’s own grouping, which holds a paper a record links', () => {
    const p = personNamed(household, 'Robin Example');
    const index: PersonIndex = parseIndex(demoJson(`${p.folder}/index.json`), p.id);
    const own = papersOf(index, household, TODAY, new Map([[p.id, index]]));
    expect(own).toHaveLength(9);
    expect(own.find((x) => x.doc.title === 'Explanation of Benefits')!.with?.event.start).toBe('2026-10-01');
    expect(own.every((x) => !x.with || x.with.event.id.startsWith('r_'))).toBe(true);
  });
});
