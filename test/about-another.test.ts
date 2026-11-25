import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { aboutAnother, aboutText, stillAbout, unsureText, withoutAbout, type About, type Unsure } from '../src/model/aboutAnother';
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

const NOW = { household: 'h'.repeat(32), index: 'i'.repeat(32) };
const only = (...ids: string[]): About => ({ ids: new Set(ids) });

describe('the items views.json names', () => {
  const said = (person: unknown, medrec = '0.9.9', now = NOW) => {
    const { ids, unsure } = aboutAnother({ medrec, household: NOW.household, people: { p_a: person, p_b: { index: NOW.index, about_another: ['r_9'] } } }, 'p_a', now);
    return [[...ids], unsure];
  };
  const of = (about_another?: unknown) => ({ index: NOW.index, ...(about_another === undefined ? {} : { about_another }) });

  it('are a person’s own, and none where it names none', () => {
    expect([said(of(['r_1', 'd_2'])), said(of())]).toEqual([
      [['r_1', 'd_2'], undefined],
      [[], undefined],
    ]);
  });

  it('may not be all, where the list does not read', () => {
    expect([said(of('r_1')), said(of(['r_1', 7, 'd_2'])), said(of(null)), said('p')]).toEqual([
      [[], 'unreadable'],
      [['r_1', 'd_2'], 'unreadable'],
      [[], 'unreadable'],
      [[], 'unreadable'],
    ]);
  });

  it('may not be all, where the list is not known to be of these files', () => {
    const list = of(['r_1']);
    const other = 'o'.repeat(32);
    expect([said(list, '0.9.9', { ...NOW, index: other }), said(list, '0.9.9', { ...NOW, household: other }), said(undefined)]).toEqual([
      [['r_1'], 'behind'],
      [['r_1'], 'behind'],
      [[], 'behind'],
    ]);
    const unchecked = (now: { household?: string | null; index?: string | null }) => aboutAnother({ medrec: '0.9.9', household: now.household, people: { p_a: { index: now.index } } }, 'p_a', now).unsure;
    expect([unchecked({ ...NOW, index: undefined }), unchecked({ ...NOW, household: undefined }), unchecked({ ...NOW, index: null }), unchecked(NOW)]).toEqual(['behind', 'behind', 'behind', undefined]);
  });

  it('are not said by an earlier medrec’s views, or by none', () => {
    expect([said({ index: 'other' }, '0.9.8'), said(undefined, '0.9.8'), said(of(['r_1']), '0.9.8')]).toEqual([
      [[], 'unsaid'],
      [[], 'unsaid'],
      [['r_1'], 'unsaid'],
    ]);
    expect([aboutAnother(null, 'p_a', NOW), aboutAnother({ people: {} }, 'p_a', NOW)]).toEqual(Array(2).fill({ ids: new Set(), unsure: 'unsaid' }));
  });

  it('are what an earlier read said until a list of these files reads', () => {
    const earlier = new Set(['r_1']);
    const now = (said: About) => {
      const { ids, unsure } = stillAbout(said, earlier);
      return [[...ids], unsure];
    };
    expect([now(only('r_2')), now(only())]).toEqual([
      [['r_2'], undefined],
      [[], undefined],
    ]);
    for (const unsure of ['unreadable', 'newer_format', 'behind', 'unsaid'] as const) expect(now({ ids: new Set(['r_2']), unsure })).toEqual([['r_1', 'r_2'], unsure]);
    // A folder that never said has nothing to say.
    expect([stillAbout({ ids: new Set(), unsure: 'unsaid' }, undefined), stillAbout({ ids: new Set(), unsure: 'behind' }, undefined)]).toEqual([only(), { ids: new Set(), unsure: 'behind' }]);
    // One whose list named nobody did say.
    expect(stillAbout({ ids: new Set(), unsure: 'unsaid' }, new Set())).toEqual({ ids: new Set(), unsure: 'unsaid' });
  });
});

describe('an index without them', () => {
  it('has neither the records and papers nor any link to them, and counts them', () => {
    const doc = index.documents.find((d) => index.records.some((r) => r.documents.includes(d.id)))!;
    const left = withoutAbout(index, only(result!, doc.id, 'r_gone'));
    expect([findItem(left, result!), findItem(left, doc.id), left.about, left.aboutUnsure]).toEqual([undefined, undefined, 2, undefined]);
    expect([left.records.length, left.documents.length]).toEqual([index.records.length - 1, index.documents.length - 1]);
    const without = left.records.find((r) => r.id === claim.id)!;
    expect(without.fields.results).toEqual((claim.fields.results as string[]).filter((x) => x !== result));
    expect(lineOf(without)).toEqual(lineOf(claim).map((ids) => ids?.filter((x) => x !== result)));
    expect(left.records.some((r) => r.documents.includes(doc.id))).toBe(false);
    // Nothing else of a record changes, and none gains a list it has not.
    expect(left.records.filter((r) => r.id !== claim.id && !index.records.find((x) => x.id === r.id)!.documents.includes(doc.id))).toStrictEqual(
      index.records.filter((r) => ![claim.id, result].includes(r.id) && !r.documents.includes(doc.id)),
    );
    expect({ ...without, fields: { ...without.fields, results: claim.fields.results, items: claim.fields.items } }).toEqual(claim);
    const hasList = (r: MedRecord) => (r.fields.items as object[]).map((l) => 'records' in l);
    expect([hasList(without), Object.keys(without.fields)]).toEqual([hasList(claim), Object.keys(claim.fields)]);
    expect([left.documents, left.studies]).toStrictEqual([index.documents.filter((d) => d.id !== doc.id), index.studies]);
  });

  it('has no paper or study that names one', () => {
    const [gone, kept, copy, third, fourth] = index.documents.map((d) => ({ ...d }));
    const from = { document_id: gone!.id, rule_id: 'rule' };
    const read = { document_id: kept!.id, rule_id: 'rule' };
    Object.assign(kept!, { same_statement_as: gone!.id, near_duplicates: [{ document: gone!.id, similarity: 0.9 }, { document: copy!.id, similarity: 0.8 }], provenance: { ...kept!.provenance, derived_from: from } });
    Object.assign(copy!, { same_statement_as: gone!.id, near_duplicates: [{ document: gone!.id, similarity: 0.9 }], provenance: { ...copy!.provenance, derived_from: read } });
    Object.assign(third!, { same_statement_as: kept!.id });
    Object.assign(fourth!, { same_statement_as: gone!.id });
    const [first, second] = index.records;
    const records = [
      { ...first!, fields: { ...first!.fields, visit: gone!.id }, provenance: first!.provenance.map((p) => ({ ...p, derived_from: from })) },
      { ...second!, fields: { ...second!.fields, visit: first!.id }, provenance: second!.provenance.map((p) => ({ ...p, derived_from: read })) },
    ];
    const study = { id: 'm_a', study_uid: '1', path: 'a', modalities: [], series: [], instances: 0, size: 0, filed_at: '', report: gone!.id, provenance: [{ ...gone!.provenance, derived_from: from }] };
    const left = withoutAbout({ ...index, records, documents: [gone!, kept!, copy!, third!, fourth!], studies: [study, { ...study, id: 'm_b', report: first!.id }] }, only(gone!.id));
    const bare = <T extends object>(x: T, ...keys: string[]) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k)));
    const plain = bare(kept!.provenance, 'derived_from');
    expect(left.documents).toStrictEqual([
      // A statement whose first paper is gone is its next copy's.
      { ...bare(kept!, 'same_statement_as'), near_duplicates: [{ document: copy!.id, similarity: 0.8 }], provenance: plain },
      { ...copy!, same_statement_as: kept!.id, near_duplicates: [] },
      third,
      { ...fourth!, same_statement_as: kept!.id },
    ]);
    expect(left.records).toStrictEqual([{ ...first!, fields: first!.fields }, records[1]]);
    expect(left.studies).toStrictEqual([
      { ...bare(study, 'report'), provenance: [gone!.provenance] },
      { ...study, id: 'm_b', report: first!.id, provenance: [gone!.provenance] },
    ]);
  });

  it('is the index itself where there are none', () => {
    expect(withoutAbout(index, only())).toBe(index);
    expect(withoutAbout(index, only('r_gone'))).toBe(index);
    expect(withoutAbout(index, { ids: new Set(), unsure: 'behind' })).toEqual({ ...index, aboutUnsure: 'behind' });
  });

  it('leaves out a result whose key says so, whatever views.json names', () => {
    const own = index.records.find((r) => r.id === result)!;
    const other = { ...index, records: [...index.records, { ...own, id: 'r_about', key: `about|${own.key}|x` }] };
    const left = withoutAbout(other, only());
    expect([left.records.length, left.about, findItem(left, 'r_about')]).toEqual([index.records.length, 1, undefined]);
    const named = { ...other, records: other.records.map((r) => (r.id === 'r_about' ? { ...r, key: 'result|all about|x' } : r)) };
    expect(withoutAbout(named, only())).toBe(named);
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

  const out = (s: Store) => [s.index(ROBIN)!.about, s.index(ROBIN)!.aboutUnsure, findItem(s.index(ROBIN)!, result!) === undefined];
  /** The folder's views.json, as this medrec wrote it of the files here, or of others. */
  const by = (medrec: string, change: (p: Record<string, unknown>, v: Record<string, unknown>) => void = () => undefined): Overlay => {
    const v = demoJson<{ people: Record<string, Record<string, unknown>> }>('views/views.json');
    Object.assign(v, { medrec });
    change(v.people[ROBIN]!, v as Record<string, unknown>);
    return { 'views/views.json': JSON.stringify(v) };
  };

  it('is read without them, for their own person and no other', async () => {
    const s = await load(views((p) => void (p.about_another = [result])));
    expect([s.index(ROBIN)!.about, s.index(ALEX)!.about, findItem(s.index(ROBIN)!, result!)]).toEqual([1, undefined, undefined]);
    expect(s.index(ROBIN)!.events).toBeDefined();
  });

  it('is read without them while its views are behind: what is about somebody else stays so', async () => {
    const other = createHash('md5').update('other').digest('hex');
    const named = { about_another: [result] };
    expect(out(await load(by('0.9.9', (p) => Object.assign(p, named))))).toEqual([1, undefined, true]);
    expect(out(await load(by('0.9.9', (p) => Object.assign(p, named, { index: other }))))).toEqual([1, 'behind', true]);
    expect(out(await load(by('0.9.9', (p, v) => Object.assign(p, named) && Object.assign(v, { household: other }))))).toEqual([1, 'behind', true]);
    expect(out(await load(by('0.9.8', (p) => Object.assign(p, named, { index: other }))))).toEqual([1, undefined, true]);
  });

  it('says that it may hold some, where medrec’s list does not read', async () => {
    const s = await load({ 'views/views.json': '{' });
    expect([out(s), s.index(ALEX)!.aboutUnsure]).toEqual([[undefined, 'unreadable', false], 'unreadable']);
    expect(out(await load(by('0.9.9', (p) => void (p.about_another = { r_1: {} }))))).toEqual([undefined, 'unreadable', false]);
    expect(out(await load({ 'views/views.json': JSON.stringify({ schema: 'medrec-views/v3' }) }))).toEqual([undefined, 'newer_format', false]);
    // A folder without views is an earlier medrec's, and someone with no index has nothing.
    expect(out(await load({ 'views/views.json': null }))).toEqual([undefined, undefined, false]);
    expect((await load({ 'views/views.json': '{', 'Robin Example/index.json': null })).index(ROBIN)!.aboutUnsure).toBeUndefined();
  });

  it('keeps them out when it is read again and medrec’s list does not read, or is behind', async () => {
    const named = by('0.9.9', (p) => void (p.about_another = [result]));
    const again = async (overlay: Overlay) => {
      const folder = demoFolderWith(named);
      const s = new Store(folder);
      await s.load();
      const before = s.snapshot;
      folder.fresh = () => demoFolderWith(overlay);
      await s.reload();
      const once = out(s);
      // And again, from what the read before kept out.
      await s.reload();
      expect(out(s)).toEqual(once);
      return [...once, s.snapshot !== before];
    };
    expect(await again({ 'views/views.json': '{' })).toEqual([1, 'unreadable', true, true]);
    expect(await again(by('0.9.9', (p) => Object.assign(p, { index: createHash('md5').update('other').digest('hex') })))).toEqual([1, 'behind', true, true]);
    expect(await again({ 'views/views.json': JSON.stringify({ schema: 'medrec-views/v3' }) })).toEqual([1, 'newer_format', true, true]);
    // Another computer's earlier medrec, which has no list.
    expect(await again(by('0.9.8'))).toEqual([1, 'unsaid', true, true]);
    // A list that reads, of these files, decides.
    expect(await again(by('0.9.9'))).toEqual([undefined, undefined, false, true]);
  });

  it('keeps out what the newest list that read named', async () => {
    const folder = demoFolderWith(by('0.9.9', (p) => void (p.about_another = [])));
    const s = new Store(folder);
    await s.load();
    folder.fresh = () => demoFolderWith(by('0.9.9', (p) => void (p.about_another = [result])));
    await s.reload();
    const next = (overlay: Overlay) => {
      s.folder.fresh = () => demoFolderWith(overlay);
      return s.reload();
    };
    await next({ 'views/views.json': '{' });
    expect(out(s)).toEqual([1, 'unreadable', true]);
    // Nor do views that were here and are gone let it in.
    await expect(next({ 'views/views.json': null })).rejects.toThrow('medrec’s views are not in the folder.');
    expect(out(s)).toEqual([1, 'unreadable', true]);
  });

  it('says that an earlier medrec wrote the views after a list that named nobody, and not where none was', async () => {
    const after = async (first: Overlay, second: Overlay) => {
      const folder = demoFolderWith(first);
      const s = new Store(folder);
      await s.load();
      const at = [s.index(ROBIN)!.aboutUnsure];
      for (const overlay of [second, second]) {
        s.folder.fresh = () => demoFolderWith(overlay);
        await s.reload();
        at.push(s.index(ROBIN)!.aboutUnsure);
      }
      return at;
    };
    expect(await after(by('0.9.9'), by('0.9.8'))).toEqual([undefined, 'unsaid', 'unsaid']);
    expect(await after(by('0.9.8'), by('0.9.8'))).toEqual([undefined, undefined, undefined]);
    expect(await after({ 'views/views.json': '{' }, by('0.9.8'))).toEqual(['unreadable', undefined, undefined]);
    // One of other files is a list, and so are the ids of one that does not read.
    const behind = by('0.9.9', (p) => Object.assign(p, { index: createHash('md5').update('other').digest('hex') }));
    expect(await after(behind, by('0.9.8'))).toEqual(['behind', 'unsaid', 'unsaid']);
    const part = by('0.9.9', (p) => void (p.about_another = [result, 7]));
    expect(await after(part, by('0.9.8'))).toEqual(['unreadable', 'unsaid', 'unsaid']);
  });

  it('keeps out what a list named of someone whose index did not read', async () => {
    const folder = demoFolderWith({ ...by('0.9.9', (p) => void (p.about_another = [result])), 'Robin Example/index.json': '{' });
    const s = new Store(folder);
    await s.load();
    expect(s.index(ROBIN)).toBeUndefined();
    folder.fresh = () => demoFolderWith({ 'views/views.json': '{' });
    await s.reload();
    expect(out(s)).toEqual([1, 'unreadable', true]);
  });

  it('is another reading where it is not known any more', async () => {
    const one = async (unchecked: boolean) => {
      const folder = demoFolderWith(by('0.9.9', (_, v) => Object.values(v.people as Record<string, object>).forEach((p) => Object.assign(p, { files: {} }))));
      const md5 = folder.md5.bind(folder);
      if (unchecked) folder.md5 = (file) => (file === 'Robin Example/index.json' ? Promise.resolve(undefined) : md5(file));
      const s = new Store(folder);
      await s.load();
      return [s.index(ROBIN)!.aboutUnsure, s.snapshot];
    };
    const [known, not] = [await one(false), await one(true)];
    expect([known[0], not[0], known[1] === not[1]]).toEqual([undefined, 'behind', false]);
  });
});

it('a list says how many, and no more', () => {
  expect([aboutText(1), aboutText(2)]).toEqual(['1 item about another person, not shown', '2 items about another person, not shown']);
  expect([undefined, 'unreadable', 'newer_format', 'behind', 'unsaid'].map((x) => unsureText({ ...index, ...(x ? { aboutUnsure: x as Unsure } : {}) }))).toEqual([
    undefined,
    'medrec’s list of what is about another person could not be read, so some of these may be.',
    'medrec’s list of what is about another person is written by a newer medrec. Update the app. Until then some of these may be.',
    'Which of the newest items are about another person is not known yet, so some of these may be. medrec writes its list again after its next import or refresh.',
    'An older medrec wrote the folder’s views last, without its list of what is about another person, so some of these may be. Update medrec on every computer that writes the folder.',
  ]);
});
