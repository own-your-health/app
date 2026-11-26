import { describe, expect, it } from 'vitest';
import { claimDiagnoses, claimLines, claimNotes, placedNotes } from '../src/model/claims';
import { nameList, nameSep } from '../src/model/codeNames';
import { costLines } from '../src/model/costs';
import { parseIndex, parseText } from '../src/model/parse';
import { leftOff, offInEach, ownText, sharedIndex, sharedRecord, sharedTexts } from '../src/model/parts';
import { parsePrivate, type Privacy } from '../src/model/private';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { fixture } from './helpers';

// What shared screens leave out of an open item, as its person's own pages
// mark it, over medrec's own fixture for private parts (test/fixtures/parts/medrec/).
const raw = fixture<{ person: string }>('parts/medrec/index.json');
const text = { ...parseText(fixture('parts/medrec/text.json'))!, md5: 'a text' };
const given = fixture<Record<string, Record<string, unknown>>>('parts/medrec/parts.json');
const made = (parts: unknown): PersonIndex => ({
  ...parseIndex(raw, raw.person),
  privacy: { ...parsePrivate({ schema: 'medrec-private/v1', person: raw.person, records: {}, documents: {}, events: {}, studies: {}, parts }, raw.person, '0.9.9'), text: 'a text' } as Privacy,
});
const index = made(given);
const record = (stem: string) => index.records.find((r) => r.id.startsWith(stem))!;
const paper = (stem: string) => index.documents.find((d) => d.id.startsWith(stem))!.id;

describe('on its person’s own pages', () => {
  it('a claim’s line, diagnosis and payer’s note that shared screens leave out are those medrec places', () => {
    const mixed = record('r_mixed');
    expect(claimLines(mixed).map((l) => [l.label, leftOff(index, mixed, 'lines', l.at)])).toEqual([
      ['Sample visit', false],
      ['Quick feelings form', true],
      ['Ear wax look', false],
    ]);
    const second = record('r_second');
    expect(claimDiagnoses(second).map((d) => [d.code, leftOff(index, second, 'diagnoses', d.at)])).toEqual([
      ['J02.9', false],
      ['F41.1', true],
    ]);
    expect(placedNotes(second).map((n) => [n.text, leftOff(index, second, 'payerNotes', n.at)])).toEqual([
      ['Paid in full', false],
      ['Behavioral health is paid apart', true],
    ]);
  });

  it('a place is of the list as medrec wrote it, whatever in it does not read and whatever order it is shown in', () => {
    const r: MedRecord = {
      ...record('r_second'),
      fields: {
        items: ['none', { service: { display: 'First' } }, null, { service: { display: 'Second' } }],
        diagnoses: [{ sequence: 2, code: { code: 'J02.9' } }, 'none', { sequence: 1, code: { code: 'F41.1' } }],
        payer_notes: ['', 3, 'Kept'],
      },
    };
    expect(claimLines(r).map((l) => [l.label, l.at])).toEqual([
      ['First', 1],
      ['Second', 3],
    ]);
    expect(claimDiagnoses(r).map((d) => [d.code, d.at])).toEqual([
      ['F41.1', 2],
      ['J02.9', 0],
    ]);
    expect([placedNotes(r), claimNotes(r), placedNotes({ ...r, fields: {} })]).toEqual([[{ text: 'Kept', at: 2 }], ['Kept'], []]);
  });

  it('nothing is left out of a record already cut for shared screens, of one with no part, or at no place', () => {
    const cut = sharedRecord(index, record('r_mixed'));
    expect(claimLines(cut).map((l) => leftOff(index, cut, 'lines', l.at))).toEqual([false, false]);
    expect([leftOff(made({}), record('r_mixed'), 'lines', 1), leftOff(index, record('r_mixed'), 'lines', undefined), leftOff(index, record('r_mixed'), 'diagnoses', 1), leftOff(index, record('r_second'), 'lines', 1)]).toEqual([false, false, false, false]);
  });

  it('a name of several claims is marked where every one leaves it out, once, in its order', () => {
    expect(
      offInEach([
        ['Office visit', true],
        ['Flu vaccine', false],
        ['Office visit', false],
        ['Flu vaccine', true],
        ['Drug screen', true],
        ['Drug screen', true],
      ]),
    ).toEqual([
      { text: 'Office visit', off: false },
      { text: 'Flu vaccine', off: false },
      { text: 'Drug screen', off: true },
    ]);
  });

  it('a paper’s text is in pieces by its private lines, which are what shared screens leave out', () => {
    for (const stem of ['d_account', 'd_explained']) {
      const pieces = ownText(index, text, paper(stem));
      expect(pieces.map((p) => p.text).join(''), stem).toBe(text.texts[paper(stem)]);
      expect(pieces.flatMap((p) => (p.off ? [] : [p.text])).join(''), stem).toBe(sharedTexts(index, text)!.texts[paper(stem)]);
      expect(pieces.filter((p) => p.off).length, stem).toBe((given[paper(stem)]!.text as unknown[]).length);
      expect(pieces.some((p) => p.text === ''), stem).toBe(false);
    }
    expect(ownText(index, { ...text, texts: { [paper('d_account')]: 'añb\ncd\nef' } }, paper('d_account'))).toEqual([{ text: 'añb\ncd\nef', off: false }]);
    expect(ownText(made({ [paper('d_account')]: { text: [[0, 4], [5, 1]] } }), { ...text, texts: { [paper('d_account')]: 'añb\ncd\nef' } }, paper('d_account'))).toEqual([
      { text: 'añb', off: true },
      { text: '\n', off: false },
      { text: 'c', off: true },
      { text: 'd\nef', off: false },
    ]);
  });

  it('a paper’s text is one piece where medrec said its lines of another text, of no place in it, or of none', () => {
    const account = paper('d_account');
    const whole = [{ text: text.texts[account], off: false }];
    const unsaid = parseText(fixture('parts/medrec/text.json'))!;
    expect(ownText(index, { ...text, md5: 'a newer text' }, account)).toEqual(whole);
    expect(ownText(index, unsaid, account)).toEqual(whole);
    expect(ownText(made({ [account]: { text: [[500, 2]] } }), text, account)).toEqual(whole);
    expect(ownText({ ...index, privacy: { kind: 'held', why: 'none', text: '' } }, text, account)).toEqual(whole);
    expect(ownText(made({}), text, account)).toEqual(whole);
    if (index.privacy?.kind !== 'known') throw new Error('not known');
    expect(ownText({ ...index, privacy: { ...index.privacy, text: undefined } }, unsaid, account)).toEqual(whole);
    expect(ownText(index, text, 'd_none')).toEqual([{ text: '', off: false }]);
  });

  it('Costs marks each such line on its person’s own, and none on a shared screen', () => {
    const marked = costLines(raw.person, index).filter((l) => l.notShared);
    const placed = index.records.flatMap((r) => {
      const lines = given[r.id]?.lines as number[] | undefined;
      return r.kind === 'claim' && lines ? claimLines(r).filter((l) => lines.includes(l.at)).map((l) => [r.id, l.label]) : [];
    });
    expect(marked.map((l) => [l.claim, l.service]).sort()).toEqual(placed.sort());
    expect(marked.length).toBeGreaterThan(5);
    expect(marked.some((l) => l.uncounted)).toBe(true);
    expect(costLines(raw.person, sharedIndex(index)).filter((l) => l.notShared)).toEqual([]);
  });

  it('names go between with a semicolon where one holds a comma', () => {
    expect([nameSep(['Fever', 'Cough']), nameSep(['Fever', 'Pain, unspecified']), nameList(['Fever', 'Pain, unspecified'])]).toEqual([', ', '; ', 'Fever; Pain, unspecified']);
  });
});
