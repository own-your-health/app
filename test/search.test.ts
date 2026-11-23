import { describe, expect, it } from 'vitest';
import { matchRanges, search, searchAll, snippet, terms } from '../src/model/search';
import { parseText } from '../src/model/parse';
import type { PersonText } from '../src/model/types';
import { demoJson } from './helpers';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const textOf = (name: string): PersonText | null => {
  const p = personNamed(household, name);
  try {
    return parseText(demoJson(`${p.folder}/text.json`));
  } catch {
    return null;
  }
};
const robin = personNamed(household, 'Robin Example');
const index = indexes.get(robin.id)!;
const text = textOf('Robin Example');
const everyone = household.people.map((p) => ({ person: p.id, index: indexes.get(p.id)!, text: textOf(p.name) }));
const brief = (hits: ReturnType<typeof search>) => hits.map((x) => [x.title, x.where, x.field ?? null]);

describe('terms', () => {
  it('splits words, keeps a quoted phrase whole, folds case and accents, and drops repeats', () => {
    expect(terms('  LDL  Cholestérol ldl "fasting  12 hours" ')).toEqual(['ldl', 'cholesterol', 'fasting 12 hours']);
    expect(terms('   ')).toEqual([]);
    expect(terms('"unclosed phrase')).toEqual(['unclosed', 'phrase']);
  });
});

describe('search', () => {
  it('needs every word', () => {
    expect(search(index, text, 'ldl').length).toBeGreaterThan(0);
    expect(search(index, text, 'ldl zzzz')).toEqual([]);
    expect(search(index, text, '   ')).toEqual([]);
  });

  it('finds words inside a document’s text, with the words around them', () => {
    const hits = search(index, text, 'fasting');
    expect(brief(hits)).toEqual([['Lipid panel', 'text', null]]);
    expect(hits[0]!.snippet).toContain('Lipid panel, fasting 12 hours');
  });

  it('matches a quoted phrase only in that order, and ignores accents', () => {
    expect(search(index, text, '"fasting 12 hours"')).toHaveLength(1);
    expect(search(index, text, '"12 fasting"')).toEqual([]);
    expect(search(index, text, 'fásting')).toHaveLength(1);
  });

  it('finds words in a record’s fields and says which field', () => {
    const alex = personNamed(household, 'Alex Example');
    const hits = search(indexes.get(alex.id)!, null, 'ear pain');
    expect(brief(hits)).toEqual([['Sick visit', 'field', 'Reason']]);
    expect(hits[0]!.snippet).toBe('Ear pain');
    // A dosage, a prescriber, a claim's amounts and a statement's amount are fields too.
    expect(brief(search(index, null, 'once a day')).map((x) => x[2])).toContain('Dosage');
    expect(brief(search(index, text, '53.68'))).toEqual(
      expect.arrayContaining([
        ['Office visit claim', 'field', 'Total'],
        ['Statement from Example Health', 'field', 'Statement'],
        ['Explanation of Benefits', 'text', null],
      ]),
    );
  });

  it('puts title matches first, then fields, then document text, newest first in each', () => {
    const hits = search(index, text, 'lisinopril');
    const ranks = hits.map((x) => ({ title: 0, field: 1, text: 2 })[x.where]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(hits[0]!.where).toBe('title');
    expect(hits.at(-1)).toMatchObject({ title: 'After visit summary', where: 'text' });
    const titled = hits.filter((x) => x.where === 'title').map((x) => x.date ?? '');
    expect(titled).toEqual([...titled].sort().reverse());
  });

  it('finds nothing in the text when the text is not loaded', () => {
    expect(search(index, null, 'lisinopril').every((h) => h.where !== 'text')).toBe(true);
  });

  it('searches everyone at once, naming whose each hit is', () => {
    const hits = searchAll(everyone, 'Example Pediatrics');
    const names = new Set(hits.map((x) => household.people.find((p) => p.id === x.person)!.name));
    expect([...names].sort()).toEqual(['Alex Example', 'Jamie Example']);
    expect(searchAll(everyone, 'hep b').map((x) => x.person)).toContain(personNamed(household, 'Jamie Example').id);
  });
});

describe('match ranges', () => {
  it('are in the text’s own characters, accents and all, merged where they overlap', () => {
    expect(matchRanges('Café au lait', ['cafe'])).toEqual([[0, 4]]);
    expect(matchRanges('LDL cholesterol, LDL', ['ldl'])).toEqual([
      [0, 3],
      [17, 20],
    ]);
    expect(matchRanges('cholesterol', ['chol', 'lester'])).toEqual([[0, 9]]);
    expect(matchRanges('nothing', ['zz'])).toEqual([]);
  });
});

describe('snippet', () => {
  it('marks cut ends', () => {
    const t = `${'a '.repeat(100)}needle${' b'.repeat(100)}`;
    const s = snippet(t, 'needle', 10);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('needle');
    expect(snippet('short needle', 'needle')).toBe('short needle');
    expect(snippet('nothing', 'needle')).toBe('');
    expect(snippet('Le café est fermé', 'cafe', 3)).toBe('Le café es…');
  });
});
