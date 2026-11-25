import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { aboutAnother, aboutText, withoutAbout } from '../src/model/aboutAnother';
import { parseIndex } from '../src/model/parse';
import { findItem } from '../src/model/records';
import type { MedRecord } from '../src/model/types';
import { demoFolderWith, demoJson, type Overlay } from './helpers';
import { ALEX, ROBIN } from './sample';

// What views.json says is about somebody else is left out of the chart it is in.
const index = parseIndex(demoJson('Robin Example/index.json'), ROBIN);
const claim = index.records.find((r) => r.kind === 'claim' && Array.isArray(r.fields.results) && r.fields.results.length)!;
const [result] = claim.fields.results as string[];
const lineOf = (r: MedRecord) => (r.fields.items as { records?: string[] }[]).map((l) => l.records);

describe('the items views.json names', () => {
  it('are a person’s own, and none where it names none', () => {
    const views = { people: { p_a: { about_another: ['r_1', 7, 'd_2'] }, p_b: {}, p_c: { about_another: 'r_1' } } };
    expect(['p_a', 'p_b', 'p_c', 'p_d'].map((p) => [...aboutAnother(views, p)])).toEqual([['r_1', 'd_2'], [], [], []]);
    expect([aboutAnother(null, 'p_a').size, aboutAnother({}, 'p_a').size]).toEqual([0, 0]);
  });
});

describe('an index without them', () => {
  it('has neither the records and papers nor any link to them, and counts them', () => {
    const doc = index.documents.find((d) => index.records.some((r) => r.documents.includes(d.id)))!;
    const left = withoutAbout(index, new Set([result!, doc.id, 'r_gone']));
    expect([findItem(left, result!), findItem(left, doc.id), left.about]).toEqual([undefined, undefined, 2]);
    expect([left.records.length, left.documents.length]).toEqual([index.records.length - 1, index.documents.length - 1]);
    const without = left.records.find((r) => r.id === claim.id)!;
    expect(without.fields.results).toEqual((claim.fields.results as string[]).filter((x) => x !== result));
    expect(lineOf(without)).toEqual(lineOf(claim).map((ids) => ids?.filter((x) => x !== result)));
    expect(left.records.some((r) => r.documents.includes(doc.id))).toBe(false);
    // Nothing else of a record changes, and none gains a list it has not.
    expect(JSON.stringify(left.records.filter((r) => r.id !== claim.id && !index.records.find((x) => x.id === r.id)!.documents.includes(doc.id)))).toBe(
      JSON.stringify(index.records.filter((r) => ![claim.id, result].includes(r.id) && !r.documents.includes(doc.id))),
    );
    expect({ ...without, fields: { ...without.fields, results: claim.fields.results, items: claim.fields.items } }).toEqual(claim);
  });

  it('is the index itself where there are none', () => {
    expect(withoutAbout(index, new Set())).toBe(index);
    expect(withoutAbout(index, new Set(['r_gone'])).about).toBeUndefined();
  });

  it('leaves out a result whose key says so, whatever views.json names', () => {
    const own = index.records.find((r) => r.id === result)!;
    const other = { ...index, records: [...index.records, { ...own, id: 'r_about', key: `about|${String((own as unknown as { key: string }).key)}|x` } as MedRecord] };
    const left = withoutAbout(other, new Set());
    expect([left.records.length, left.about, findItem(left, 'r_about')]).toEqual([index.records.length, 1, undefined]);
    const named = { ...other, records: other.records.map((r) => (r.id === 'r_about' ? ({ ...r, key: 'result|all about|x' } as MedRecord) : r)) };
    expect(withoutAbout(named, new Set())).toBe(named);
  });
});

describe('a folder', () => {
  const views = (change: (p: Record<string, unknown>) => void): Overlay => {
    const v = demoJson<{ people: Record<string, Record<string, unknown>> }>('views/views.json');
    change(v.people[ROBIN]!);
    return { 'views/views.json': JSON.stringify(v) };
  };
  const load = async (overlay: Overlay): Promise<Store> => {
    const s = new Store(demoFolderWith(overlay));
    await s.load();
    return s;
  };

  it('is read without them, for their own person and no other', async () => {
    const s = await load(views((p) => void (p.about_another = [result])));
    expect([s.index(ROBIN)!.about, s.index(ALEX)!.about, findItem(s.index(ROBIN)!, result!)]).toEqual([1, undefined, undefined]);
    expect(s.index(ROBIN)!.events).toBeDefined();
  });

  it('is read without them while its views are behind: what is about somebody else stays so', async () => {
    const s = await load(views((p) => Object.assign(p, { about_another: [result], index: createHash('md5').update('other').digest('hex') })));
    expect([s.index(ROBIN)!.about, findItem(s.index(ROBIN)!, result!)]).toEqual([1, undefined]);
  });
});

it('a list says how many, and no more', () => {
  expect([aboutText(1), aboutText(2)]).toEqual(['1 item about another person, not shown', '2 items about another person, not shown']);
});
