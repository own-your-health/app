import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { parseProviderLabels } from '../src/model/providerLabels';
import { billsInError, documentSays, errorsIndex, errorsOf, inErrorIds, isInError, recordSays, saysError, withoutErrors } from '../src/model/inError';
import { billList } from '../src/model/billing';
import { costLines, errorLines } from '../src/model/costs';
import { latestResults } from '../src/model/overview';
import { vaccineList } from '../src/model/lists';
import { parseIndex } from '../src/model/parse';
import { HELD, itemPrivate, paperPrivate, recordPrivate, studyPrivate } from '../src/model/private';
import { findItem, isWithdrawn } from '../src/model/records';
import { find } from '../src/model/search';
import type { Household, ImagingStudy, MedRecord, PersonIndex } from '../src/model/types';
import { differs, billErrorsText, keptText } from '../src/ui/inError';
import { parseBills } from '../src/model/bills';
import { parseMedrecEvents, type MedrecEvents } from '../src/model/events';
import { errorsLeft } from '../src/next/calendar';
import { quietClaims } from '../src/next/shared';
import { personEvents } from '../src/next/load';
import { eventInError } from '../src/next/medrecEvents';
import { demo } from './demo-data';
import { demoFolderWith, demoJson, errorsFolder, fixture } from './helpers';
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
    expect([...inErrorIds(views({ in_error: { result: ['r_1', 'r_2'], document: ['d_1'], claim: [] } }), 'p_a', MD5)!]).toEqual(['r_1', 'r_2', 'd_1']);
    expect([inErrorIds(views({}), 'p_a', MD5), inErrorIds(views({ in_error: {} }, '0.10.0'), 'p_a', MD5)]).toEqual([new Set(), new Set()]);
  });

  it('is not known where it is not lists of ids', () => {
    for (const in_error of [['r_1'], 'r_1', null, { result: 'r_1' }, { result: ['r_1'], claim: { r_2: {} } }, { result: ['r_1', 7] }]) expect(inErrorIds(views({ in_error }), 'p_a', MD5), JSON.stringify(in_error)).toBeUndefined();
  });

  it('is not known of another index, or of none', () => {
    const says = { in_error: { result: ['r_1'] } };
    expect([
      inErrorIds(views(says), 'p_a', MD5.replace('0', '1')),
      inErrorIds(views(says), 'p_a', undefined),
      inErrorIds(views(says), 'p_a', null),
      inErrorIds(views({ ...says, index: null }), 'p_a', null),
      inErrorIds(views(says), 'p_b', MD5),
      inErrorIds(views(says, '0.9.8'), 'p_a', MD5.replace('0', '1')),
      inErrorIds(null, 'p_a', MD5),
    ]).toEqual(Array(7).fill(undefined));
    // Those of an earlier medrec are made of the whole index.
    expect([inErrorIds(views(says, '0.9.8'), 'p_a', MD5), inErrorIds(views(says, null), 'p_a', MD5)]).toEqual(['unsaid', 'unsaid']);
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

  it('goes by what the index keeps of each source, where no list is of it: the same items, by the same rule', () => {
    expect(withoutErrors(index, undefined)).toEqual(left);
    // A source that says otherwise, or whose word is not kept, stands by it.
    const wrong = record('r_levelerror');
    const twice = { ...wrong, provenance: [...wrong.provenance, { ...wrong.provenance[0]!, raw_path: 'other' }] };
    const of = (r: MedRecord, listed?: ReadonlySet<string>) => withoutErrors({ ...index, records: [r, record('r_doseerror')] }, listed);
    const worded = of({ ...twice, words: [{ raw_path: twice.provenance[0]!.raw_path, status: 'entered-in-error' }] });
    expect([worded.records.map((r) => [r.id, isWithdrawn(r)]), isInError(worded, id('r_doseerror'))]).toEqual([[[wrong.id, false]], true]);
    // With the word of none it stands by a list alone: an earlier medrec's index keeps none of any, and its own status withdraws it.
    expect([of(twice), of(twice, new Set([id('r_doseerror')]))].map((x) => x.records.map(isWithdrawn))).toEqual([[true], [false]]);
  });

  it('is made item by item, whatever is kept of the others', () => {
    const bare = { ...index, records: index.records.filter((r) => !r.words), documents: [] };
    expect(withoutErrors(bare, undefined).inError!.records.map((r) => r.id)).toEqual(WRONG.filter((x) => x.startsWith('r_')));
  });

  it('is the index itself beside an earlier medrec’s views, and has nothing aside where none is', () => {
    expect(withoutErrors(index, 'unsaid')).toBe(index);
    expect(withoutErrors(index, new Set()).inError).toEqual({ records: [], documents: [], carried: new Set() });
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
    // Without medrec's list of bills, one is in error where none of its papers stands.
    const wrong = (gone: string[], more: Partial<PersonIndex> = {}) => billsInError({ ...withoutErrors(copies, new Set(gone)), ...more });
    const unmarked = (...ids: string[]) => ids.map((x) => ({ document: x, marked: 0 }));
    expect([wrong(['d_first']), wrong(['d_second']), wrong(['d_first', 'd_second']), wrong(['d_first', 'd_second', 'd_third']), wrong(['d_other', 'd_copy', 'd_second'])]).toEqual([[], [], [], unmarked('d_first'), unmarked('d_other')]);
    const letter = { ...copies, documents: copies.documents.map((d) => ({ ...d, doc_type: d.id === 'd_other' ? 'other' : d.doc_type, ...(d.id === 'd_first' ? { same_statement_as: 'd_gone' } : {}) })) };
    expect(billsInError(withoutErrors(letter, new Set(letter.documents.map((d) => d.id))))).toEqual(unmarked('d_first'));
    expect([wrong(['d_first', 'd_second', 'd_third'], { bills: { errors: unmarked('d_9') } as PersonIndex['bills'] }), billsInError(copies)]).toEqual([unmarked('d_9'), []]);
  });

  it('keeps what reads of an index that does not all read', () => {
    const odd = { ...raw, records: [{ ...record('r_leveldiffers'), words: 'none' }, { ...record('r_filldiffers'), words: [null, 'x', { raw_path: 7, status: 8, verification: null, read: 'x' }, ...record('r_filldiffers').words!] }, { ...record('r_levelerror'), status: 7 }], documents: [{ ...paper('d_eyebill'), also_from: {}, words: {}, near_duplicates: 'none' }, { ...paper('d_skinbill'), id: 'd_near', near_duplicates: [null, 'x', {}, { document: 7 }, { document: 'd_2', similarity: 0.9 }] }, { ...paper('d_skinbill'), also_from: [null, {}, { source: 'x', method: 'y' }, ...paper('d_eyebill').also_from!] }] };
    const read = parseIndex(odd, raw.person);
    expect([read.records.map((r) => r.words), read.documents.map((d) => d.also_from), read.documents.map((d) => d.words)]).toEqual([
      [undefined, [{ read: 'x' }, ...record('r_filldiffers').words!], undefined],
      [undefined, paper('d_skinbill').also_from, paper('d_eyebill').also_from],
      [undefined, paper('d_skinbill').words, paper('d_skinbill').words],
    ]);
    expect(read.documents.map((d) => d.near_duplicates)).toEqual([undefined, [{ document: 'd_2', similarity: 0.9 }], paper('d_skinbill').near_duplicates]);
    expect(withoutErrors(read, undefined).inError!.records).toEqual([]);
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
    // One an earlier medrec's status withdraws does not stay, and one medrec says stands does.
    const { words, ...none } = { ...record('r_leveldiffers'), status: 'entered-in-error', fields_from: undefined };
    const as = (more: Partial<MedRecord>) => differs({ type: 'record', record: { ...none, ...more } });
    expect([as({}), as({ words }), as({ stands: true }), as({ words, status: 'final' }), as({ words, stands: true })]).toEqual([false, false, true, true, true]);
    // Nor is one of an earlier medrec's that says it by its verification.
    expect([undefined, words].map((w) => as({ words: w, status: 'active', fields: { verification_status: 'entered-in-error' } }))).toEqual([false, true]);
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
    expect([...events({ in_error: { r_2: { event: 'e_1' }, r_3: { event: 7 }, r_4: {}, r_5: 'x', r_6: null } }).errorAt]).toEqual([['r_2', 'e_1']]);
    const none = parseMedrecEvents({ schema: 'medrec-events/v1', person: 'p_a', events: [{ ...event, in_error: undefined }] }, 'p_a');
    expect([none.events[0]!.inError, none.errors, none.notApplied.size, none.errorAt.size]).toEqual([[], [], 0, 0]);
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
    const one = { kind: 'wrong', printed: ['A'], item: 'd_1' };
    const labels = parseProviderLabels({ schema: 'medrec-providers/v1', person: 'p_a', overrides: [{ ...one, id: 'o_1', applied: false }, { ...one, id: 'o_2' }, { ...one, id: 'o_3', item: 'd_2', applied: false }], private: { overrides: [{ ...one, id: 'o_4', applied: false }] } }, 'p_a');
    expect([keptText(idx({ events: kept }), 'r_2'), keptText(idx({ events: kept }), 'r_3'), keptText(idx({ events: kept, bills: paid, providerLabels: labels }), 'd_1'), keptText(idx({ providerLabels: labels }), 'd_2'), keptText(idx({ bills: paid }), 'd_2'), keptText(idx({}), 'r_2')]).toEqual([
      'Kept and not applied: 1 decision about its visit.',
      'Kept and not applied: 2 decisions about its visit.',
      'Kept and not applied: 2 payments on it, 2 corrections of a provider it names.',
      'Kept and not applied: 1 correction of a provider it names.',
      undefined,
      undefined,
    ]);
  });

  it('are counted on everyone’s calendar by those that are not private, and on one person’s all of them', () => {
    const household = { people: [{ id: 'p_a' }, { id: 'p_b' }], sources: [], organizations: [] } as unknown as Household;
    const wrong = { ...record('r_levelerror'), id: 'r_1' };
    const of = (events: MedrecEvents, privacy: PersonIndex['privacy']): PersonIndex => ({ ...left, events, privacy, inError: { records: [wrong], documents: [] } });
    const known = (...ids: string[]): PersonIndex['privacy'] => ({ kind: 'known', records: new Map(), documents: new Map(), events: new Map(ids.map((x) => [x, 'household'])), studies: new Map(), unreported: new Set(), ties: true });
    const two = events({ events_in_error: [{ ...event, id: 'e_2' }, { ...event, id: 'e_3' }] });
    const at = (a: PersonIndex | undefined, who?: string, b?: PersonIndex) => errorsLeft(household, (x) => (x === 'p_a' ? a : b), who);
    expect([at(of(two, known())), at(of(two, known('e_3'))), at(of(two, known('e_3')), 'p_a'), at(of(two, known()), 'p_b'), at(of(two, known()), undefined, of(two, known('e_2')))]).toEqual([2, 1, 2, 0, 3]);
    // Of someone whose private items are not known, none on a shared screen.
    expect([at(of(two, { kind: 'held', why: 'none', text: '' })), at(of(two, undefined)), at(undefined)]).toEqual([0, 0, 0]);
    // Nor one nothing of which is here to judge it by, and a fill is judged by its records too.
    const fill = events({ events_in_error: [{ ...event, id: 'e_2', kind: 'fill' }, { ...event, id: 'e_3', members: [{ record: 'r_9' }] }] });
    const wrongItem = { ...known(), records: new Map([['r_1', 'household']]) } as PersonIndex['privacy'];
    expect([at(of(fill, known())), at(of(fill, wrongItem)), at(of(two, wrongItem)), at(of(fill, wrongItem), 'p_a')]).toEqual([1, 0, 2, 2]);
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
    expect([isInError(read.index(ROBIN)!, result), read.index(SAM)!.inError]).toEqual([true, { records: [], documents: [], carried: new Set() }]);
    const behind = await load((v, p) => Object.assign(v, { medrec: '0.9.9' }) && Object.assign(p, { in_error: wrong, index: '0'.repeat(32) }));
    expect([isInError(behind.index(ROBIN)!, result), findItem(behind.index(ROBIN)!, result)?.type]).toEqual([false, 'record']);
    expect((await load(() => undefined)).index(ROBIN)!.inError).toBeUndefined();
  });
});

// medrec's own views of its fixture, as 0.9.9 writes them. One claim is marked
// private, and its bill, so the visit they would make is.
describe('medrec’s own views of the fixture', () => {
  const opened = async (change?: (files: Record<string, string>) => void) => {
    const s = new Store(errorsFolder(change));
    await s.load();
    return { store: s, idx: s.index(raw.person)! };
  };
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

  it('take out the same items as its rule does', async () => {
    const { idx } = await opened();
    expect(ids([...idx.inError!.records, ...idx.inError!.documents])).toEqual([...WRONG].sort());
    expect([idx.events!.errors.length, idx.events!.notApplied.get(id('d_letter')), idx.bills!.errors]).toEqual([
      4,
      1,
      [
        { document: id('d_footbill'), marked: 0 },
        { document: id('d_skinbill'), marked: 1 },
      ],
    ]);
    expect([keptText(idx, id('d_letter')), keptText(idx, id('d_skinbill'))]).toEqual(['Kept and not applied: 1 decision about its visit, 1 correction of a provider it names.', 'Kept and not applied: 1 payment on it.']);
    const its = personEvents(idx, (await opened()).store.household, '2026-11-22');
    expect(its.map((e) => [e.start, e.inError])).toEqual([
      ['2024-03-09', undefined],
      ['2024-03-05', 2],
    ]);
  });

  it('say which of them are private, so no shared screen counts those', async () => {
    const { store, idx } = await opened();
    expect([idx.privacy!.kind, recordPrivate(idx, id('r_footvisit')), paperPrivate(idx, id('d_footbill')), paperPrivate(idx, id('d_skinbill'))]).toEqual(['known', 'household', 'household', undefined]);
    const open = { record: (r: MedRecord) => !recordPrivate(idx, r.id), document: (d: { id: string }) => !paperPrivate(idx, d.id) };
    expect([errorsOf(idx, open), errorsLeft(store.household, (x) => store.index(x), undefined), errorsLeft(store.household, (x) => store.index(x), raw.person)]).toEqual([6, 3, 4]);
    expect(billsInError(idx).filter((b) => !paperPrivate(idx, b.document)).map((b) => b.document)).toEqual([id('d_skinbill')]);
    const wrong = { person: raw.person, index: errorsIndex(idx), text: null };
    const hits = (q: string) => [wrong, { ...wrong, leave: (kind: string, x: string) => !!itemPrivate(wrong.index, kind, x) }].map((s) => ids(find([s], q).hits));
    expect([hits('foot'), hits('eye')]).toEqual([
      [[id('d_footbill'), id('r_footvisit')].sort(), []],
      [[id('r_eyevisit')], [id('r_eyevisit')]],
    ]);
    const claims = (xs: { claim: string }[]) => [...new Set(xs.map((l) => l.claim))].sort();
    expect([claims(errorLines(raw.person, idx)), claims(costLines(raw.person, idx)), errorLines(raw.person, { ...idx, inError: undefined })]).toEqual([[id('r_eyevisit'), id('r_footvisit')], [id('r_skinvisit')], []]);
    // In the plan year the claims that stand give, not their own.
    const year = (rs: MedRecord[], start: string) => rs.map((r) => ({ ...r, fields: { ...r.fields, benefit_period: { start: `2023-${start}`, end: `2024-${start}` } } }));
    const planned = { ...idx, records: year(idx.records, '07-01'), inError: { ...idx.inError!, records: year(idx.inError!.records, '10-01') } };
    expect(new Set(errorLines(raw.person, planned).map((l) => l.planYear.start))).toEqual(new Set(['2023-07-01']));
    expect(errorLines(raw.person, idx, { planStart: '05-01' }).map((l) => [l.claim, l.planYear.start]).sort()).toEqual([[id('r_eyevisit'), '2023-05-01'], [id('r_footvisit'), '2024-05-01']]);
  });

  it('say which visit each would be in, so everyone’s costs count no claim of a private one', async () => {
    const { store, idx } = await opened();
    const [eye, foot, skin] = ['r_eyevisit', 'r_footvisit', 'r_skinvisit'].map(id) as [string, string, string];
    const at = (claim: string) => idx.events!.errorAt.get(claim)!;
    const stands = idx.events!.events.find((e) => e.members.some((m) => m.record === skin))!.id;
    const known = idx.privacy as Extract<NonNullable<PersonIndex['privacy']>, { kind: 'known' }>;
    // Of everyone's costs, what is left out. Robin alone has any.
    const quiet = (more: Partial<typeof known>, events: Partial<MedrecEvents> | null = {}) => {
      const its = { ...idx, privacy: { ...known, ...more }, events: events ? { ...idx.events!, ...events } : undefined };
      return Object.fromEntries(quietClaims({ household: store.household, index: () => its } as unknown as Store, '2026-11-22'));
    };
    expect(quiet({})).toEqual({ [foot]: 'household' });
    // Its visit alone says it.
    expect(quiet({ records: new Map(), documents: new Map() })).toEqual({ [foot]: known.events.get(at(foot)) });
    expect(quiet({ records: new Map(), events: new Map([[at(eye), 'mental_health']]) })).toEqual({ [eye]: 'mental_health' });
    expect(quiet({ records: new Map(), events: new Map() })).toEqual({});
    // A claim's own area is first, whatever its visit's is.
    expect(quiet({ records: new Map([[eye, 'sexual_health']]), events: new Map() })).toEqual({ [eye]: 'sexual_health' });
    expect(quiet({ records: new Map([[skin, 'sexual_health']]), events: new Map([[stands, 'mental_health']]) })).toEqual({ [skin]: 'sexual_health' });
    // A visit that stands, and has the rest of it.
    expect(quiet({ records: new Map(), events: new Map([[stands, 'mental_health']]) }, { errorAt: new Map([[eye, stands]]) })).toEqual({ [skin]: 'mental_health', [eye]: 'mental_health' });
    // In none, and not here to judge.
    expect(quiet({ records: new Map(), events: new Map() }, { errorAt: new Map([[eye, 'e_elsewhere']]) })).toEqual({ [eye]: HELD });
    expect(quiet({ records: new Map(), events: new Map() }, null)).toEqual({ [eye]: HELD, [foot]: HELD });
  });

  it('are not there yet: the index itself says it, and the app makes the visits and bills of what is left', async () => {
    const { store, idx } = await opened((files) => (files['views/views.json'] = files['views/views.json']!.replaceAll(/"index":"[0-9a-f]{32}"/g, `"index":"${'0'.repeat(32)}"`)));
    expect([ids([...idx.inError!.records, ...idx.inError!.documents]), idx.events, idx.bills, store.billsNotes.has(raw.person)]).toEqual([[...WRONG].sort(), undefined, undefined, true]);
    expect(billsInError(idx)).toEqual([{ document: id('d_skinbill'), marked: 0 }, { document: id('d_footbill'), marked: 0 }]);
    expect(errorsLeft(store.household, (x) => store.index(x), undefined)).toBe(0);
  });

  it('are an earlier medrec’s, made of the whole index: it is read whole', async () => {
    const { idx } = await opened((files) => (files['views/views.json'] = files['views/views.json']!.replace('"medrec":"0.9.9"', '"medrec":"0.9.8"')));
    expect([idx.inError, idx.records.length, idx.documents.length, !!idx.events, !!idx.bills]).toEqual([undefined, index.records.length, index.documents.length, true, true]);
  });
});
