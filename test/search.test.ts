import { describe, expect, it } from 'vitest';
import { search, snippet } from '../src/model/search';
import { parseText } from '../src/model/parse';
import { demoJson } from './helpers';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const robin = personNamed(household, 'Robin Example');
const index = indexes.get(robin.id)!;
const text = parseText(demoJson(`${robin.folder}/text.json`));

describe('search', () => {
  it('needs every word', () => {
    expect(search(index, text, 'ldl').length).toBeGreaterThan(0);
    expect(search(index, text, 'ldl zzzz')).toEqual([]);
    expect(search(index, text, '   ')).toEqual([]);
  });

  it('finds words inside a document’s text, with the words around them', () => {
    const hits = search(index, text, 'triglycerides');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.inText).toBe(true);
    expect(hits[0]!.snippet).toContain('Triglycerides 99 mg/dL');
  });

  it('finds nothing in the text when the text is not loaded', () => {
    expect(search(index, null, 'lisinopril').every((h) => !h.inText)).toBe(true);
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
  });
});
