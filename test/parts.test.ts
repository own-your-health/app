import { describe, expect, it } from 'vitest';
import { claimCents, claimLines, claimNotes } from '../src/model/claims';
import { diagnosisNames } from '../src/model/codeNames';
import { costLines, errorLines, totals } from '../src/model/costs';
import { parseIndex, parseText } from '../src/model/parse';
import { parseParts, partOf, partSays, sharedIndex, sharedRecord, sharedText, sharedTexts, textUnfit } from '../src/model/parts';
import { parsePrivate, type Privacy } from '../src/model/private';
import { recordTitle } from '../src/model/titles';
import { find } from '../src/model/search';
import type { Json, MedRecord, PersonIndex, PersonText } from '../src/model/types';
import { fixture } from './helpers';

// The private parts of open items, over medrec's own fixture for them
// (test/fixtures/parts/medrec/): what its private.json has, and its index and texts.
const raw = fixture<{ person: string }>('parts/medrec/index.json');
const text = { ...parseText(fixture('parts/medrec/text.json'))!, md5: 'a text' };
const given = fixture<Record<string, Record<string, unknown>>>('parts/medrec/parts.json');
const of = (parts: unknown, medrec = '0.9.9', more: object = {}) =>
  parsePrivate({ schema: 'medrec-private/v1', person: raw.person, records: {}, documents: {}, events: {}, studies: {}, parts, ...more }, raw.person, medrec);
const made = (parts: unknown): PersonIndex => ({ ...parseIndex(raw, raw.person), privacy: { ...of(parts), text: 'a text' } as Privacy });
const index = made(given);
const id = (stem: string) => [...index.records, ...index.documents].find((x) => x.id.startsWith(stem))!.id;
const record = (stem: string) => index.records.find((r) => r.id.startsWith(stem))!;
const shared = (stem: string) => sharedRecord(index, record(stem));
const services = (r: MedRecord) => claimLines(r).map((l) => l.label);

describe('a claim with a private part, on a shared screen', () => {
  it('has the lines that are left, and goes by their name', () => {
    for (const stem of ['r_mixed', 'r_checks', 'r_noted', 'r_rooms', 'r_uncounted', 'r_before', 'r_labbed', 'r_labboth']) {
      const all = record(stem);
      const gone = given[all.id]!.lines as number[];
      expect((shared(stem).fields.items as unknown[]).length, stem).toBe((all.fields.items as unknown[]).length - gone.length);
      expect(shared(stem).fields.items, stem).toEqual((all.fields.items as unknown[]).filter((_, i) => !gone.includes(i)));
      expect(shared(stem).display, stem).toBe(given[all.id]!.display);
      expect(services(shared(stem)), stem).not.toContain(services(all)[gone[0]!]);
    }
    expect(services(shared('r_mixed'))).toEqual(['Sample visit', 'Ear wax look']);
    expect(recordTitle(shared('r_checks'))).not.toBe(recordTitle(record('r_checks')));
  });

  it('keeps its own totals, and says how many lines are not shown', () => {
    const r = shared('r_mixed');
    expect([claimCents(r), r.fields.amounts]).toEqual([claimCents(record('r_mixed')), record('r_mixed').fields.amounts]);
    expect([partSays(index, r.id), r.without]).toEqual(['1 service not shown', { whole: record('r_mixed'), says: '1 service not shown' }]);
  });

  it('has the diagnoses and the payer’s notes that are left', () => {
    const r = shared('r_second');
    expect([diagnosisNames(index, r).length, diagnosisNames(index, record('r_second')).length]).toEqual([1, 2]);
    expect([claimNotes(r), claimNotes(record('r_second'))]).toEqual([['Paid in full'], ['Paid in full', 'Behavioral health is paid apart']]);
    expect(partSays(index, r.id)).toBe('1 diagnosis and 1 payer note not shown');
  });

  it('has no more of it where it is entered in error: the list of claims counts it by what is left', () => {
    const claim = record('r_labbed');
    const wrong = { ...index, records: index.records.filter((r) => r !== claim), inError: { records: [claim], documents: [] } };
    expect(sharedIndex(wrong).inError).toEqual({ records: [shared('r_labbed')], documents: [] });
    const lines = (idx: PersonIndex) => errorLines(raw.person, idx).map((l) => l.service);
    const gone = services(claim)[(given[claim.id]!.lines as number[])[0]!]!;
    expect([lines(wrong).includes(gone), lines(sharedIndex(wrong)).includes(gone), lines(sharedIndex(wrong)).length > 0]).toEqual([true, false, true]);
    expect('inError' in sharedIndex(index)).toBe(false);
  });

  it('takes its category from the lines that are left, and none where they have none', () => {
    expect([record('r_labbed').fields.category, shared('r_labbed').fields.category]).toEqual(['lab', 'visit']);
    const none = made({ [id('r_labbed')]: { ...given[id('r_labbed')], category: null } });
    expect('category' in sharedRecord(none, record('r_labbed')).fields).toBe(false);
    expect(shared('r_mixed').fields.category).toBe(record('r_mixed').fields.category);
  });

  it('shows nothing of a list that its places are not of', () => {
    const past = made({ [id('r_mixed')]: { display: 'Sample visit', lines: [9], says: '1 service not shown' }, [id('r_second')]: { diagnoses: [0, 2], payer_notes: [5] } });
    expect('items' in sharedRecord(past, record('r_mixed')).fields).toBe(false);
    expect(['diagnoses', 'payer_notes'].filter((k) => k in sharedRecord(past, record('r_second')).fields)).toEqual([]);
    expect(sharedRecord(past, record('r_second')).fields.items).toEqual(record('r_second').fields.items);
    const notAList = { ...record('r_mixed'), fields: { items: 'none' } } as MedRecord;
    expect(sharedRecord(index, notAList).fields).toEqual({});
    // Nor the name medrec gave all of it, where it gives none for what is left.
    const r = record('r_mixed');
    const titled = (part: object) => recordTitle(sharedRecord(made({ [r.id]: part }), r));
    expect([recordTitle({ ...r, fields: { ...r.fields, items: [] } }), titled({ lines: [9], display: 'Sample visit' }), titled({ lines: [9] })]).toEqual(['Sample visit, Quick feelings form and 1 more', 'Sample visit', 'Claim from Example Pediatrics']);
    const none = made({ [r.id]: { lines: [0, 1, 2] } });
    expect(find([{ person: 'p', index: sharedIndex(none), text }], 'Quick feelings').hits.map((h) => h.id)).not.toContain(r.id);
    // One whose private part is in no line is named as before.
    expect(sharedRecord(made({ [r.id]: { diagnoses: [0] } }), r).display).toBe(r.display);
  });

  it('is itself where it has none, and is not cut twice', () => {
    const plain = index.records.find((r) => r.kind === 'claim' && !given[r.id])!;
    expect(sharedRecord(index, plain)).toBe(plain);
    expect(sharedRecord(index, shared('r_mixed'))).toEqual(shared('r_mixed'));
    expect(sharedRecord(made(undefined), record('r_mixed'))).toBe(record('r_mixed'));
    const held: PersonIndex = { ...index, privacy: { kind: 'held', why: 'none', text: '' } };
    expect([sharedRecord(held, record('r_mixed')), partOf(held, id('r_mixed'))]).toEqual([record('r_mixed'), undefined]);
  });
});

describe('an index, as shared screens go by it', () => {
  it('has each claim without its part, and is one object each time', () => {
    const twin = sharedIndex(index);
    expect(twin).toBe(sharedIndex(index));
    expect(twin.records.map((r) => r.id)).toEqual(index.records.map((r) => r.id));
    expect(twin.records.filter((r) => r.without).map((r) => r.id)).toEqual(index.records.map((r) => r.id).filter((x) => given[x]));
    expect(sharedIndex(made({}))).not.toBe(twin);
    const none = made({});
    expect(sharedIndex(none)).toBe(none);
    const held: PersonIndex = { ...index, privacy: { kind: 'held', why: 'none', text: '' } };
    expect(sharedIndex(held)).toBe(held);
  });

  it('keeps every amount in Costs, and names no line that is left out', () => {
    const [all, left] = [costLines('p', index), costLines('p', sharedIndex(index))];
    expect(totals(left).cents).toEqual(totals(all).cents);
    const gone = index.records.flatMap((r) => ((given[r.id]?.lines as number[]) ?? []).map((i) => ({ claim: r.id, service: services(r)[i]! })));
    expect(gone.length).toBeGreaterThan(5);
    const named = (xs: typeof all, x: { claim: string; service: string }) => xs.some((l) => l.claim === x.claim && (l.service === x.service || l.claimTitle.includes(x.service)));
    expect(gone.filter((x) => !named(all, x))).toEqual([]);
    expect(gone.filter((x) => named(left, x))).toEqual([]);
  });

  it('counts the amounts of a line left out where the claim gives no totals', () => {
    const bare = (r: MedRecord): MedRecord => ({ ...r, fields: { ...r.fields, amounts: {} } });
    for (const r of index.records.filter((x) => given[x.id]?.lines)) {
      const without = { ...index, records: [bare(r)] };
      expect(totals(costLines('p', sharedIndex(without))).cents, r.id).toEqual(totals(costLines('p', without)).cents);
    }
  });

  it('has the amounts of the lines left out in a line that names none, and any other difference as before', () => {
    const r = record('r_mixed');
    const gone = claimLines(r).filter((_, i) => (given[r.id]!.lines as number[]).includes(i));
    const [line, ...more] = costLines('p', sharedIndex({ ...index, records: [r] })).filter((l) => !l.split);
    expect([line!.service, line!.category, line!.cents]).toEqual(['Not shown here', 'other', costLines('p', { ...index, records: [r] }).find((l) => l.service === gone[0]!.label)!.cents]);
    expect(more.map((l) => [l.service, l.cents])).toEqual([['Not split by line', { youOwe: 1000 }]]);
    const short: MedRecord = { ...r, fields: { ...r.fields, amounts: { billed: { amount: '75.00', currency: 'USD' } } } };
    const rest = (x: PersonIndex) => costLines('p', x).filter((l) => l.service === 'Not split by line').map((l) => l.cents);
    const without = { ...index, records: [short] };
    expect(rest(sharedIndex(without))).toEqual(rest(without));
    expect(rest(without)).toHaveLength(1);
    expect(costLines('p', { ...index, records: [record('r_second')] }).filter((l) => !l.split)).toEqual(costLines('p', sharedIndex({ ...index, records: [record('r_second')] })).filter((l) => !l.split));
  });

  it('has them on their own days, so a year or a month comes to what it does on its person’s own pages', () => {
    const r = record('r_mixed');
    const on = (dates: (string | undefined)[]): PersonIndex => {
      const items = (r.fields.items as Record<string, Json>[]).map((x, i) => ({ ...x, ...(dates[i] ? { serviced: dates[i] } : {}) }));
      return { ...made({ [r.id]: { lines: [0, 1] } }), records: [{ ...r, fields: { ...r.fields, items } }] };
    };
    const days = (x: PersonIndex) => {
      const by: Record<string, number> = {};
      for (const l of costLines('p', x)) by[`${l.date} ${l.planYear.start}`] = (by[`${l.date} ${l.planYear.start}`] ?? 0) + (l.cents.billed ?? 0);
      return by;
    };
    const hidden = (x: PersonIndex) => costLines('p', sharedIndex(x)).filter((l) => l.service === 'Not shown here').map((l) => [l.date, l.cents.billed, l.split]);
    const stay = on(['2023-12-31', '2024-01-01', '2024-01-01']);
    expect(days(sharedIndex(stay))).toEqual(days(stay));
    expect(days(stay)).toEqual({ '2023-12-31 2023-01-01': 2000, '2024-01-01 2024-01-01': 4000, '2024-08-05 2024-01-01': 0 });
    expect(hidden(stay)).toEqual([
      ['2024-01-01', 2000, false],
      ['2023-12-31', 2000, false],
    ]);
    // One line for a day, and the claim's own where they give none.
    expect([hidden(on(['2024-01-01', '2024-01-01'])), hidden(on([]))]).toEqual([[['2024-01-01', 4000, false]], [['2024-08-05', 4000, false]]]);
  });

  it('judges no line that is left as one the plan left out, for want of those that are not', () => {
    const both = (amount: string) => ({ billed: { amount, currency: 'USD' }, you_owe: { amount, currency: 'USD' } });
    const item = (display: string, amount: string) => ({ service: { system: 'http://www.ama-assn.org/go/cpt', code: '99213', display }, amounts: both(amount) });
    const r = { ...record('r_mixed'), fields: { items: [item('Sample one', '-60.00'), item('Sample two', '100.00'), item('Sample three', '60.00')], amounts: both('100.00') } } as MedRecord;
    const cut = sharedRecord(made({ [r.id]: { lines: [0] } }), r);
    expect([claimLines(r).map((l) => l.counted), claimLines(cut).map((l) => l.counted)]).toEqual([[true, true, true], [true, true]]);
    const uncut = { ...r, fields: { ...r.fields, items: (r.fields.items as Json[]).slice(1) } };
    expect(claimLines(uncut).map((l) => l.counted)).toEqual([true, false]);
  });

  it('is found by no word that is left out', () => {
    const hits = (q: string, x: PersonIndex, t: PersonText = text) => find([{ person: 'p', index: x, text: t }], q).hits.map((h) => h.id);
    const whole = (stem: string) => services(record(stem))[(given[id(stem)]!.lines as number[])[0]!]!;
    const word = whole('r_mixed');
    expect(hits(word, index)).toContain(id('r_mixed'));
    expect(hits(word, sharedIndex(index))).not.toContain(id('r_mixed'));
    expect(hits('Ear wax', sharedIndex(index))).toContain(id('r_mixed'));
    expect(hits('Fagerstrom', index)).toEqual([id('d_account')]);
    expect(hits('Fagerstrom', sharedIndex(index), sharedTexts(index, text)!)).toEqual([]);
    expect(hits('Questions', sharedIndex(index), sharedTexts(index, text)!)).toEqual([id('d_account')]);
  });
});

describe('a paper’s text, on a shared screen', () => {
  it('has no line that is private', () => {
    const left = sharedTexts(index, text)!.texts;
    expect(left[id('d_account')]).toBe('Example Pediatrics\nSample visit 20.00\n\n\nEar wax look 20.00\nTotal 60.00\fQuestions? Call us.\n\nThank you');
    expect(left[id('d_explained')]).toBe('Example Health Plan\n99213 Sample visit\n\n\n\nThis is not a bill');
    expect(left[id('d_told')]).toBe(text.texts[id('d_told')]);
    expect(sharedTexts(index, text)).toBe(sharedTexts(index, text));
  });

  it('is cut by its bytes, whatever their order', () => {
    expect(sharedText('añb\ncd\nef', [[5, 2]])).toBe('añb\n\nef');
    expect(sharedText('abc\ndef\nghi', [[8, 3], [0, 3]])).toBe('\ndef\n');
    expect(sharedText('abc', [])).toBe('abc');
    expect(sharedText('abc', [[0, 3]])).toBe('');
    expect(sharedText('', [[0, 0]])).toBe('');
  });

  it('is none of it where they are not places of it', () => {
    expect([sharedText('abc', [[2, 5]]), sharedText('abc', [[9, 1]]), sharedText('añb', [[2, 1]]), sharedText('añb', [[0, 2]]), sharedText('abcdef', [[0, 3], [2, 2]])]).toEqual(Array(5).fill(undefined));
    const past = made({ [id('d_account')]: { text: [[500, 2]] } });
    expect(sharedTexts(past, text)!.texts[id('d_account')]).toBeUndefined();
    expect(sharedTexts(past, text)!.texts[id('d_explained')]).toBe(text.texts[id('d_explained')]);
  });

  it('is the text itself where there are no parts, and none where there is no text', () => {
    expect([sharedTexts(made({}), text), sharedTexts(index, null)]).toEqual([text, null]);
  });

  it('is none where it is another text.json than the one medrec judged, or the folder cannot say', () => {
    const other = { ...text, md5: 'a newer text' };
    const unsaid = parseText(fixture('parts/medrec/text.json'))!;
    expect([sharedTexts(index, other), sharedTexts(index, unsaid), sharedTexts(made({}), other)]).toEqual([null, null, null]);
    expect([textUnfit(index, other), textUnfit(index, unsaid), textUnfit(index, text), textUnfit(index, null), textUnfit(made(undefined), other)]).toEqual(['changed', 'unchecked', undefined, undefined, undefined]);
    expect(sharedTexts({ ...index, privacy: of({}) }, unsaid)).toBeNull();
    // A list of before 0.9.9 judged no lines: the text is as it was.
    expect(sharedTexts(made(undefined), other)).toBe(other);
    const held: PersonIndex = { ...index, privacy: { kind: 'held', why: 'none', text: '' } };
    expect(sharedTexts(held, other)).toBe(other);
    // Cut again for a newer text its index is told of.
    expect(sharedTexts(index, { ...text, texts: {} })!.texts).toEqual({});
  });
});

describe('private.json’s parts', () => {
  it('are read with what a visit says without them', () => {
    const p = parseParts({ e_1: { kind: 'office', title: 'Office visit', what: null, what_from: null, place: 'Example Place', place_from: 'claims', clinicians: [], money: {}, expected: [{ what: 'bill', why: 'Because', since: '2024-01-02' }, { why: 'no name' }], says: '1 service not shown' }, e_2: { place: null, place_from: null, expected: null } })!;
    expect(p.get('e_1')!.event).toEqual({ kind: 'office', title: 'Office visit', what: null, place: 'Example Place', placeFrom: 'claims', expected: [{ what: 'bill', why: 'Because', since: '2024-01-02' }] });
    expect(p.get('e_2')!.event).toEqual({ place: null, placeFrom: null, expected: null });
    expect(p.get('e_2')!.says).toBeUndefined();
    // Where a place is from, in a way the app does not know, is not said.
    expect(parseParts({ e_1: { place_from: 'a new way' } })!.get('e_1')!.event).toEqual({ placeFrom: null });
  });

  it('that do not read refuse the list: what they would leave out is not known', () => {
    for (const parts of [null, [], 'x', { r_1: null }, { r_1: { lines: [-1] } }, { r_1: { lines: [1.5] } }, { r_1: { lines: 'all' } }, { r_1: { diagnoses: ['1'] } }, { d_1: { text: [[1]] } }, { d_1: { text: [[1, -2]] } }, { d_1: { text: {} } }, { r_1: { display: 7 } }, { e_1: { what: 7 } }, { e_1: { expected: 'none' } }])
      expect(() => parseParts(parts), JSON.stringify(parts)).toThrow('a private part in it does not read');
    expect(() => of({ r_1: { lines: ['x'] } })).toThrow('a private part in it does not read');
  });

  it('are none of an earlier medrec’s list, which says no cleared visits either', () => {
    const known = (p: ReturnType<typeof of>) => (p.kind === 'known' ? [p.parts?.size, p.clear && [...p.clear]] : p.kind);
    expect([known(of(undefined, '0.9.8')), known(of({}, '0.9.9')), known(of(undefined, '0.9.9', { clear_events: ['e_1', 7] })), known(of({}, '0.9.8', { clear_events: ['e_1'] }))]).toEqual([
      [undefined, undefined],
      [0, []],
      [undefined, ['e_1']],
      [0, undefined],
    ]);
  });
});
