import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { documentSays, errorsIndex, errorsOf, inErrorIds, isInError, recordSays, saysError, withoutErrors } from '../src/model/inError';
import { billList } from '../src/model/billing';
import { latestResults } from '../src/model/overview';
import { vaccineList } from '../src/model/lists';
import { parseIndex } from '../src/model/parse';
import { HELD, studyPrivate } from '../src/model/private';
import { findItem, isWithdrawn } from '../src/model/records';
import { find } from '../src/model/search';
import type { ImagingStudy, Person, PersonIndex } from '../src/model/types';
import { differs, billErrorsText, keptText } from '../src/ui/inError';
import { parseBills } from '../src/model/bills';
import { parseMedrecEvents, type MedrecEvents } from '../src/model/events';
import { errorsLeft } from '../src/next/calendar';
import { personEvents } from '../src/next/load';
import { eventInError } from '../src/next/medrecEvents';
import { demo } from './demo-data';
import { demoFolderWith, demoJson, fixture } from './helpers';
import { ROBIN, SAM } from './sample';

// What is entered in error, over medrec's own fixture for it
// (test/fixtures/errors/medrec/, an invented person's records and papers).
const raw = fixture<{ person: string }>('errors/medrec/index.json');
const index = parseIndex(raw, raw.person);
const id = (stem: string) => [...index.records, ...index.documents].find((x) => x.id.startsWith(stem))!.id;
const record = (stem: string) => index.records.find((r) => r.id.startsWith(stem))!;
const paper = (stem: string) => index.documents.find((d) => d.id.startsWith(stem))!;

const WRONG = ['r_eyevisit', 'r_footvisit', 'r_levelerror', 'r_doseerror', 'r_checkerror', 'd_skinbill', 'd_footbill', 'd_letter'].map(id);
const left = withoutErrors(index, new Set(WRONG));

describe('what views.json says is entered in error', () => {
  const MD5 = '0123456789abcdef0123456789abcdef';
  const views = (p: object, medrec: unknown = '0.9.9') => ({ medrec, people: { p_a: { index: MD5, ...p } } });

  it('is every id it lists, of any kind, for the index it was made from', () => {
    expect([...inErrorIds(views({ in_error: { result: ['r_1', 7, 'r_2'], document: ['d_1'], claim: 'r_3' } }), 'p_a', MD5)!]).toEqual(['r_1', 'r_2', 'd_1']);
    expect(inErrorIds(views({}), 'p_a', MD5)!.size).toBe(0);
    expect(inErrorIds(views({ in_error: ['r_1'] }, '0.10.0'), 'p_a', MD5)).toBeDefined();
  });

  it('is not known of another index, an earlier medrec’s views, or none', () => {
    const says = { in_error: { result: ['r_1'] } };
    expect([
      inErrorIds(views(says), 'p_a', MD5.replace('0', '1')),
      inErrorIds(views(says), 'p_a', undefined),
      inErrorIds(views(says), 'p_a', null),
      inErrorIds(views({ ...says, index: null }), 'p_a', null),
      inErrorIds(views(says), 'p_b', MD5),
      inErrorIds(views(says, '0.9.8'), 'p_a', MD5),
      inErrorIds(views(says, null), 'p_a', MD5),
      inErrorIds(null, 'p_a', MD5),
    ]).toEqual(Array(8).fill(undefined));
  });
});

describe('an index without it', () => {
  it('has none of it in its lists, and keeps it aside', () => {
    expect([left.records.map((r) => r.id), left.documents.map((d) => d.id)].map((xs) => xs.filter((x) => WRONG.includes(x)))).toEqual([[], []]);
    expect([left.records.length, left.documents.length]).toEqual([index.records.length - 5, index.documents.length - 3]);
    expect([...left.inError!.records, ...left.inError!.documents].map((x) => x.id).sort()).toEqual([...WRONG].sort());
    expect([latestResults(left).map((t) => t.series.name), vaccineList(left).given, billList(left).map((b) => b.doc.id)]).toEqual([['Sample level'], [], [id('d_eyebill')]]);
    expect([errorsOf(left, { record: (r) => r.kind === 'result' }), errorsOf(left, { document: () => true }), errorsOf(left, { record: () => true, document: () => true }), errorsOf(left, {})]).toEqual([1, 3, 8, 0]);
    expect(errorsOf(index, { record: () => true, document: () => true })).toBe(0);
  });

  it('goes by the words the index keeps, where no list is of it: the same items, by the same rule', () => {
    expect(withoutErrors(index, undefined)).toEqual(left);
    // A source that says otherwise, or whose word is not kept, stands by it.
    const changed = { ...index, records: index.records.map((r) => (r.id === id('r_levelerror') ? { ...r, provenance: [...r.provenance, { ...r.provenance[0]!, raw_path: 'other' }] } : r)) };
    const some = withoutErrors(changed, undefined);
    expect([isInError(some, id('r_levelerror')), isInError(some, id('r_doseerror')), isWithdrawn(some.records.find((r) => r.id === id('r_levelerror'))!)]).toEqual([false, true, false]);
  });

  it('is the index itself where nothing says, and has nothing aside where none is', () => {
    const bare = { ...index, records: index.records.map((r) => ({ ...r, words: undefined })), documents: index.documents.map((d) => ({ ...d, words: undefined })) };
    expect(withoutErrors(bare, undefined)).toBe(bare);
    expect(withoutErrors(index, new Set()).inError).toEqual({ records: [], documents: [] });
  });

  it('finds one by its id, as entered in error', () => {
    expect([findItem(left, WRONG[0]!), findItem(left, WRONG[5]!), findItem(left, id('r_skinvisit'))].map((x) => [x!.type, 'inError' in x!])).toEqual([['record', true], ['document', true], ['record', false]]);
    expect([isInError(left, WRONG[0]!), isInError(left, WRONG[7]!), isInError(left, id('r_skinvisit')), isInError(index, WRONG[0]!)]).toEqual([true, true, false, false]);
  });

  it('keeps a record some source stands by, whatever its status says', () => {
    const one = { ...record('r_leveldiffers'), status: 'entered-in-error' };
    const stands = withoutErrors({ ...index, records: [one] }, new Set()).records[0]!;
    expect([isWithdrawn(one), isWithdrawn(stands), isWithdrawn(record('r_levelerror')), isWithdrawn(record('r_leveldiffers'))]).toEqual([true, false, true, false]);
  });

  it('gives a statement whose first paper is in error to its next copy', () => {
    const bill = (name: string, of?: string) => ({ ...paper('d_eyebill'), id: `d_${name}`, ...(of ? { same_statement_as: of } : {}) });
    const copies = { ...index, documents: [bill('first'), bill('second', 'd_first'), bill('third', 'd_first'), bill('other'), bill('copy', 'd_other')] };
    const of = (gone: string[]) => Object.fromEntries(withoutErrors(copies, new Set(gone)).documents.map((d) => [d.id, d.same_statement_as]));
    expect(of(['d_first'])).toEqual({ d_second: undefined, d_third: 'd_second', d_other: undefined, d_copy: 'd_other' });
    expect(of(['d_second'])).toEqual({ d_first: undefined, d_third: 'd_first', d_other: undefined, d_copy: 'd_other' });
    expect(billList(withoutErrors(copies, new Set(['d_first']))).map((b) => b.doc.id).sort()).toEqual(['d_other', 'd_second']);
  });

  it('is no paper’s likely duplicate', () => {
    const [one, two] = index.documents.map((d) => ({ ...d, words: undefined }));
    const near = { ...two!, near_duplicates: [{ document: one!.id, similarity: 0.9 }, { document: 'd_other', similarity: 0.8 }] };
    const made = withoutErrors({ ...index, documents: [one!, near] }, new Set([one!.id]));
    expect(made.documents).toEqual([{ ...near, near_duplicates: [{ document: 'd_other', similarity: 0.8 }] }]);
  });

  it('has no report of a study’s that is in error, and judges the study by medrec’s list', () => {
    const study = { id: 's_1', report: id('r_levelerror') } as ImagingStudy;
    const other = { id: 's_2', report: id('r_leveldiffers') } as ImagingStudy;
    const made = withoutErrors({ ...index, studies: [study, other] }, new Set(WRONG));
    expect(made.studies.map((s) => [s.report, s.reportInError])).toEqual([[undefined, true], [id('r_leveldiffers'), undefined]]);
    const known = (more: object): PersonIndex => ({ ...made, privacy: { kind: 'known', records: new Map(), documents: new Map(), events: new Map(), studies: new Map(), unreported: new Set(), ties: true, ...more } as PersonIndex['privacy'] });
    const says = (more: object) => studyPrivate(known(more), made.studies[0]!);
    expect([says({}), says({ studies: new Map([['s_1', 'mental_health']]) }), says({ unreported: new Set(['s_1']) }), says({ studies: null })]).toEqual([undefined, 'mental_health', HELD, HELD]);
    expect(studyPrivate(known({}), { id: 's_3' } as ImagingStudy)).toBe(HELD);
  });

  it('is searched apart, for how many the words would have found', () => {
    const hits = (x: PersonIndex, q: string) => find([{ person: 'p', index: x, text: null }], q).hits.map((h) => h.id);
    expect(hits(left, 'level')).toEqual([id('r_leveldiffers')]);
    expect(hits(errorsIndex(left), 'level')).toEqual([id('r_levelerror')]);
    expect(hits(errorsIndex(left), 'letter')).toEqual([id('d_letter')]);
    expect(errorsIndex(left)).toBe(errorsIndex(left));
    expect([errorsIndex(index).records, errorsIndex(left).studies]).toEqual([[], []]);
    expect(errorsIndex({ ...left, studies: [{ id: 's_1' }] as ImagingStudy[] }).studies).toEqual([]);
  });
});

describe('what each source says', () => {
  const said = (xs: ReturnType<typeof recordSays>) => xs.map(({ provenance, ...rest }) => ({ from: provenance?.source.organization_id, ...rest }));

  it('is a record’s words, each with the day its source was last read', () => {
    expect(said(recordSays(record('r_leveldiffers')))).toEqual([
      { from: 'north', status: 'final', read: '2024-07-02' },
      { from: 'east', status: 'entered-in-error', read: '2024-07-03' },
    ]);
    // Of one with no words, the status is its only source's.
    expect(said(recordSays(record('r_levelerror')))).toEqual([{ from: 'east', status: 'entered-in-error', read: '2024-07-03' }]);
    expect(recordSays(record('r_skinvisit'))).toEqual([]);
  });

  it('is not heard of a source whose word is not kept', () => {
    const two = record('r_leveldiffers');
    const east = { from: 'east', status: 'entered-in-error', read: '2024-07-03' };
    const words = [{ ...two.words![1]!, read: undefined }];
    expect(said(recordSays({ ...two, words, fields_from: undefined }))).toEqual([{ from: 'north', unheard: true }, east]);
    // The one that wrote the fields says what the record does.
    expect(said(recordSays({ ...two, words, status: 'amended' }))).toEqual([{ from: 'north', status: 'amended', read: '2024-07-02' }, east]);
    // With no word of any, it is the word of one that is not known.
    expect(said(recordSays({ ...two, words: undefined, fields_from: undefined, status: 'entered-in-error' }))).toEqual([{ from: undefined, status: 'entered-in-error' }, { from: 'north', unheard: true }, { from: 'east', unheard: true }]);
    expect(said(recordSays({ ...two, words, provenance: two.provenance.map((p) => ({ ...p, fetched_at: undefined })) })).map((s) => s.read)).toEqual([undefined, undefined]);
    expect(said(recordSays({ ...record('r_levelerror'), status: 'active', fields: { verification_status: 'entered-in-error' } }))).toEqual([{ from: 'east', status: 'active', verification: 'entered-in-error', read: '2024-07-03' }]);
  });

  it('is a paper’s words, with those of where else it came from, and none of the household’s own file', () => {
    expect(said(documentSays(paper('d_eyebill')))).toEqual([
      { from: 'north', status: 'current', read: '2024-07-02' },
      { from: 'east', status: 'entered-in-error', read: '2024-07-03' },
    ]);
    const own = paper('d_skinbill');
    expect(said(documentSays({ ...own, also_from: [{ ...own.provenance, raw_path: undefined, source: { kind: 'manual' } }] }))).toEqual([{ from: 'east', status: 'entered-in-error', read: '2024-07-03' }, { from: undefined, household: true }]);
    expect(said(documentSays({ ...own, also_from: [{ ...own.provenance, raw_path: 'another.json' }] })).map((s) => s.unheard)).toEqual([undefined, true]);
    expect(documentSays({ ...own, words: undefined })).toEqual([]);
  });

  it('is read on the day its word was, else the day it was fetched', () => {
    const [p] = index.records[0]!.provenance;
    const of = (read?: string) => recordSays({ ...index.records[0]!, provenance: [{ ...p!, raw_path: 'a.json', fetched_at: '2024-01-02T10:00:00Z' }], words: [{ raw_path: 'a.json', status: 'entered-in-error', ...(read ? { read } : {}) }] })[0]!.read;
    expect([of('2024-03-04T10:00:00Z'), of()]).toEqual(['2024-03-04', '2024-01-02']);
  });

  it('is of no source whose file is not known, where nothing says which wrote it', () => {
    const [p] = index.records[0]!.provenance;
    const nowhere = { ...p!, raw_path: undefined };
    const r = { ...index.records[0]!, status: 'entered-in-error', fields_from: undefined, words: undefined, provenance: [nowhere, { ...p!, raw_path: 'b.json' }] };
    expect(recordSays(r).map((s) => [s.provenance === undefined, s.status, s.unheard])).toEqual([
      [true, 'entered-in-error', undefined],
      [false, undefined, true],
      [false, undefined, true],
    ]);
  });

  it('differs where some say it is in error and some do not', () => {
    const of = (stem: string) => (stem.startsWith('r_') ? differs({ type: 'record', record: record(stem) }) : differs({ type: 'document', document: paper(stem) }));
    expect(['r_leveldiffers', 'r_filldiffers', 'd_eyebill', 'r_levelerror', 'd_skinbill', 'r_skinvisit'].map(of)).toEqual([true, true, true, false, false, false]);
    expect(differs({ type: 'study', study: {} as ImagingStudy })).toBe(false);
  });

  it('is in error by the status or the verification, however it is written', () => {
    expect([{ status: 'entered-in-error' }, { status: 'Entered In_Error ' }, { verification: 'entered-in-error', status: 'active' }, { status: 'current' }, {}].map(saysError)).toEqual([true, true, true, false, false]);
  });
});

describe('medrec’s views of what is entered in error', () => {
  const event = { id: 'e_1', start: '2024-03-04', end: '2024-03-04', kind: 'office', members: [{ record: 'r_1' }], in_error: ['r_2', 7] };
  const events = (more: object) => parseMedrecEvents({ schema: 'medrec-events/v1', person: 'p_a', events: [event], ...more }, 'p_a');

  it('are each visit’s own, the visits that are none without it, and the decisions kept of it', () => {
    const read = events({ events_in_error: [{ ...event, id: 'e_2' }, { id: 'no day' }], in_error: { r_2: { event: 'e_1', not_applied: [{ id: 'o_1' }, { id: 'o_2' }] }, r_3: { event: 'e_2' }, r_4: { not_applied: 'none' }, r_5: 'x' } });
    expect([read.events.map((e) => e.inError), read.errors.map((e) => e.id), [...read.notApplied]]).toEqual([[['r_2']], ['e_2'], [['r_2', 2]]]);
    const none = parseMedrecEvents({ schema: 'medrec-events/v1', person: 'p_a', events: [{ ...event, in_error: undefined }] }, 'p_a');
    expect([none.events[0]!.inError, none.errors, none.notApplied.size]).toEqual([[], [], 0]);
    expect(events({ events_in_error: 'none', in_error: [] }).errors).toEqual([]);
  });

  it('are the bills that are, with the payments the household marked on each', () => {
    const bills = (in_error: unknown) => parseBills({ schema: 'medrec-bills/v1', person: 'p_a', bills: {}, worth_a_call: [], in_error }, 'p_a').errors;
    const wrong = bills({ d_1: { as: 'bill', not_applied: [{ from: 'household' }, { from: 'receipt' }, null] }, d_2: { as: 'bill' }, d_3: { as: 'copy', bill: 'd_1' }, r_4: { as: 'claim' }, d_5: 'bill' });
    expect(wrong).toEqual([
      { document: 'd_1', marked: 1 },
      { document: 'd_2', marked: 0 },
    ]);
    expect([bills(undefined), bills([])]).toEqual([[], []]);
  });

  it('are in a visit’s count, and give a visit that is none its items', () => {
    const { household, indexes } = demo();
    const its = structuredClone(indexes.get(ROBIN)!);
    const [first, second] = its.events!.events.filter((e) => e.members.some((m) => m.record));
    first!.inError = ['r_1', 'r_2'];
    const all = personEvents(its, household, '2026-11-22');
    expect(all.flatMap((e) => (e.inError === undefined ? [] : [[e.id, e.inError]]))).toEqual([[first!.id, 2]]);
    its.events = { ...its.events!, events: its.events!.events.filter((e) => e !== second), errors: [second!] };
    const ids = new Set(second!.members.flatMap((m) => m.record ?? m.document ?? []));
    const cut = withoutErrors(its, ids);
    const event = eventInError(cut, household, second!.id)!;
    expect(event.claims.length + event.visits.length + event.recorded.length + event.papers.length).toBe(second!.members.length);
    expect([eventInError(cut, household, first!.id), eventInError({ ...cut, events: undefined }, household, second!.id)]).toEqual([undefined, undefined]);
  });

  it('keep and do not apply what the household decided of one', () => {
    const idx = (more: Partial<PersonIndex>): PersonIndex => ({ ...left, ...more });
    const kept = events({ in_error: { r_2: { not_applied: [{}] }, r_3: { not_applied: [{}, {}] } } });
    const paid = { errors: [{ document: 'd_1', marked: 2 }] } as PersonIndex['bills'];
    expect([keptText(idx({ events: kept }), 'r_2'), keptText(idx({ events: kept }), 'r_3'), keptText(idx({ events: kept, bills: paid }), 'd_1'), keptText(idx({ bills: paid }), 'd_2'), keptText(idx({}), 'r_2')]).toEqual([
      'Kept and not applied: 1 decision about its visit.',
      'Kept and not applied: 2 decisions about its visit.',
      'Kept and not applied: 2 payments on it.',
      undefined,
      undefined,
    ]);
  });

  it('are counted on everyone’s calendar by those that are not private, and on one person’s all of them', () => {
    const people = [{ id: 'p_a' }, { id: 'p_b' }] as Person[];
    const of = (events: MedrecEvents, privacy: PersonIndex['privacy']): PersonIndex => ({ ...left, events, privacy });
    const known = (...ids: string[]): PersonIndex['privacy'] => ({ kind: 'known', records: new Map(), documents: new Map(), events: new Map(ids.map((x) => [x, 'household'])), studies: new Map(), unreported: new Set(), ties: true });
    const two = events({ events_in_error: [{ ...event, id: 'e_2' }, { ...event, id: 'e_3' }] });
    const at = (a: PersonIndex | undefined, who?: string, b?: PersonIndex) => errorsLeft(people, (x) => (x === 'p_a' ? a : b), who);
    expect([at(of(two, known())), at(of(two, known('e_3'))), at(of(two, known('e_3')), 'p_a'), at(of(two, known()), 'p_b'), at(of(two, known()), undefined, of(two, known('e_2')))]).toEqual([2, 1, 2, 0, 3]);
    // Of someone whose private items are not known, none on a shared screen.
    expect([at(of(two, { kind: 'held', why: 'none', text: '' })), at(of(two, undefined)), at(undefined)]).toEqual([0, 0, 0]);
  });
});

describe('a page of bills', () => {
  it('says how many are entered in error, and of how many a payment is marked', () => {
    expect([billErrorsText(1, 0), billErrorsText(2, 0), billErrorsText(1, 1), billErrorsText(2, 1), billErrorsText(2, 2)]).toEqual([
      '1 bill entered in error, not shown',
      '2 bills entered in error, not shown',
      '1 bill entered in error, with a payment you marked',
      '2 bills entered in error, 1 with a payment you marked',
      '2 bills entered in error, each with a payment you marked',
    ]);
  });
});

describe('a folder', () => {
  const result = demoJson<PersonIndex>('Robin Example/index.json').records.find((r) => r.kind === 'result')!.id;
  const load = async (change: (views: Record<string, unknown>, p: Record<string, unknown>) => void): Promise<Store> => {
    const views = demoJson<{ people: Record<string, Record<string, unknown>> }>('views/views.json');
    change(views, views.people[ROBIN]!);
    const s = new Store(demoFolderWith({ 'views/views.json': JSON.stringify(views) }));
    await s.load();
    return s;
  };

  it('is read without what its views say is in error, and only where they are of the index it has', async () => {
    const wrong = { result: [result] };
    const read = await load((v, p) => Object.assign(v, { medrec: '0.9.9' }) && Object.assign(p, { in_error: wrong }));
    expect([isInError(read.index(ROBIN)!, result), read.index(SAM)!.inError]).toEqual([true, { records: [], documents: [] }]);
    const behind = await load((v, p) => Object.assign(v, { medrec: '0.9.9' }) && Object.assign(p, { in_error: wrong, index: '0'.repeat(32) }));
    expect([behind.index(ROBIN)!.inError, findItem(behind.index(ROBIN)!, result)?.type]).toEqual([undefined, 'record']);
    expect((await load(() => undefined)).index(ROBIN)!.inError).toBeUndefined();
  });
});
