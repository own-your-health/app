// Papers: every file with the visit it belongs to (held by the visit, linked
// by one of its records, or the receipt for its bill), or why it has none.
import { describe, expect, it } from 'vitest';
import { parseIndex } from '../src/model/parse';
import type { MedrecRule } from '../src/model/events';
import type { PersonIndex } from '../src/model/types';
import { householdPapers, papersOf } from '../src/next/papers';
import { demo, personNamed } from './demo-data';
import { demoJson } from './helpers';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const id = (name: string) => personNamed(household, name).id;
const papers = (name: string, all = indexes) => papersOf(all.get(id(name))!, household, TODAY, all);
const titled = (name: string, title: string, date?: string) => papers(name).find((p) => p.doc.title === title && (!date || p.doc.date === date))!;

describe('where each paper belongs', () => {
  it('lists everyone’s papers newest first, each with its visit or why it has none', () => {
    const all = householdPapers(household, indexes, TODAY);
    expect(all).toHaveLength(16);
    expect(all.map((p) => p.doc.date)).toEqual([...all.map((p) => p.doc.date)].sort().reverse());
    expect(all.filter((p) => !p.with).map((p) => [p.doc.title, p.why])).toEqual([['Vaccination card', 'A vaccine record covers many visits.']]);
  });

  it('puts a paper with the visit that holds it, at the visit’s sureness', () => {
    const summary = titled('Sam Example', 'Emergency department discharge instructions');
    expect([summary.with?.event.kind, summary.with?.how, summary.with?.confidence]).toEqual(['er', 'event', 'sure']);
    expect(titled('Sam Example', 'Statement from Example Billing').with?.confidence).toBe('likely');
  });

  it('puts an explanation of benefits with the visit of the claim that links it, and a receipt with its bill’s', () => {
    const eob = titled('Robin Example', 'Explanation of Benefits');
    expect([eob.with?.how, eob.with?.event.start]).toEqual(['claim', '2026-10-01']);
    const receipt = titled('Robin Example', 'Payment receipt from Example Health');
    expect([receipt.with?.how, receipt.with?.event.start, receipt.with?.confidence]).toEqual(['bill', '2025-03-10', 'likely']);
  });

  it('says which visits a paper could be part of when medrec puts it with none of several', () => {
    const robin = structuredClone(indexes.get(id('Robin Example'))!);
    const [a, b] = robin.events!.events.filter((e) => e.kind === 'office');
    const card = robin.documents.find((d) => d.title === 'Vaccination card')!;
    robin.events!.pending.push({ document: card.id, could_join: [a!.id, b!.id], rule: 'D4' as MedrecRule });
    const p = papersOf(robin, household, TODAY, new Map([...indexes, [robin.person, robin]])).find((x) => x.doc.id === card.id)!;
    expect(p.why).toBe('It fits 2 visits, so medrec puts it with none of them.');
    expect(p.could?.map((e) => e.id)).toEqual([a!.id, b!.id]);
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

  it('shows a parent’s paper in the newborn’s visit as with that visit (X2)', () => {
    const jamie = structuredClone(indexes.get(id('Jamie Example'))!);
    const robin = indexes.get(id('Robin Example'))!;
    const scan = robin.documents.find((d) => d.title === 'Vaccination card')!;
    const stay = jamie.events!.events[0]!;
    stay.members.push({ document: scan.id, person: robin.person, kind: 'immunization_record', role: 'paper', rule: 'X2' as MedrecRule, confidence: 'likely' });
    jamie.events!.papers.set(scan.id, { person: robin.person, doc: scan });
    const all = new Map([...indexes, [jamie.person, jamie]]);
    const p = papersOf(robin, household, TODAY, all).find((x) => x.doc.id === scan.id)!;
    expect([p.with?.person, p.with?.event.id, p.with?.how]).toEqual([jamie.person, stay.id, 'event']);
  });

  it('marks a paper private when it or its visit is', () => {
    const sam = structuredClone(indexes.get(id('Sam Example'))!);
    const bill = sam.documents.find((d) => d.title === 'Statement from Example General Hospital')!;
    bill.private = true;
    bill.private_area = 'household';
    const own = papersOf(sam, household, TODAY, indexes);
    expect(own.find((p) => p.doc.id === bill.id)!.privateArea).toBe('household');
    // Its visit is private now, so the visit's other paper is too.
    expect(own.find((p) => p.doc.title === 'Emergency department discharge instructions')!.privateArea).toBe('household');
    expect(own.filter((p) => p.privateArea)).toHaveLength(2);
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
