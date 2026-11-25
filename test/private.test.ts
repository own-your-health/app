// Private items: medrec's private.json as the store reads it, when it can't
// be used (and everything of that person's is held back from shared screens),
// and what each shared screen's model leaves out. The private.json files are
// medrec's own: the sample's, and the cases scripts/private-fixtures.mjs makes.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { FolderError } from '../src/model/parse';
import { anyPrivate, atLeast, documentPrivate, HELD, isHeld, itemPrivate, paperPrivate, parsePrivate, recordPrivate, studyPrivate, takenOut, whyHeld } from '../src/model/private';
import { find } from '../src/model/search';
import type { PersonIndex } from '../src/model/types';
import { viewOf } from '../src/model/views';
import { householdEvents, shown } from '../src/next/calendar';
import { eventPrivate } from '../src/next/event';
import { careTeam, doctorSheet } from '../src/next/health';
import { personEvents } from '../src/next/load';
import { billPrivate, forShared, openBills, unbilledShares } from '../src/next/money';
import { papersOf, sharedPapers } from '../src/next/papers';
import { heldPeople, quietClaims } from '../src/next/shared';
import { personNamed } from './demo-data';
import { demoFolderWith, demoJson, manifestWith, privateCase, type Overlay } from './helpers';

const TODAY = '2026-11-22';

async function load(overlay: Overlay = {}, manifest?: Parameters<typeof demoFolderWith>[1]): Promise<Store> {
  const store = new Store(demoFolderWith(overlay, manifest));
  await store.load();
  return store;
}

const SAMPLE = await load();
const MARKED = await load(privateCase('marked'));
const UNREADABLE = await load(privateCase('unreadable'));

const id = (name: string) => personNamed(SAMPLE.household, name).id;
const sam = id('Sam Example');
const robin = id('Robin Example');
const index = (store: Store, person: string) => store.index(person)!;
const viewPath = (person: string) => `views/${person}/${viewOf(demoJson('views/views.json'), person, 'private.json')!.name}`;
const held = (store: Store) => heldPeople(store).map((x) => x.person.name);
const why = (store: Store, person = sam) => {
  const p = index(store, person).privacy;
  return p?.kind === 'held' ? p.why : 'known';
};
const events = (store: Store) => householdEvents(store.household, (p) => store.index(p), TODAY);
const record = (store: Store, person: string, fits: (r: PersonIndex['records'][number]) => boolean) => index(store, person).records.find(fits)!;
const paper = (store: Store, person: string, title: string) => index(store, person).documents.find((d) => d.title === title)!;
const eventOn = (store: Store, person: string, day: string, kind?: string) => personEvents(index(store, person), store.household, TODAY).find((e) => e.start === day && (!kind || e.kind === kind))!;

describe('reading private.json', () => {
  const raw = demoJson<Record<string, unknown>>(viewPath(sam));

  it('reads the sample’s, as medrec wrote it', () => {
    const p = index(SAMPLE, sam).privacy!;
    if (p.kind !== 'known') throw new Error('not known');
    expect([p.records.size, p.documents.size, p.events.size]).toEqual([4, 0, 2]);
    expect(new Set([...p.records.values(), ...p.events.values()])).toEqual(new Set(['mental_health', 'substance_use']));
    for (const name of ['Robin Example', 'Alex Example', 'Jamie Example']) expect([anyPrivate(index(SAMPLE, id(name))), isHeld(index(SAMPLE, id(name)))]).toEqual([false, false]);
    expect(held(SAMPLE)).toEqual([]);
  });

  it('refuses a later schema as newer, and another person’s file or one without its lists as malformed', () => {
    const kind = (x: unknown, person = sam) => {
      try {
        parsePrivate(x, person);
      } catch (e) {
        return e instanceof FolderError ? e.kind : 'other';
      }
      return 'read';
    };
    expect(kind(raw)).toBe('read');
    expect(kind({ ...raw, schema: 'medrec-private/v2' })).toBe('newer_format');
    expect(kind({ ...raw, schema: 'medrec-events/v1' })).toBe('malformed');
    expect(kind(raw, robin)).toBe('malformed');
    expect(kind({ ...raw, documents: undefined })).toBe('malformed');
    expect(kind({ ...raw, events: [] })).toBe('malformed');
    expect(kind(null)).toBe('malformed');
  });

  it('takes an area it does not know, or an entry it cannot read, as private all the same', () => {
    const p = parsePrivate({ ...raw, records: { r_a: { area: 'a_later_area' }, r_b: {}, r_c: null, r_d: { area: 7 }, r_e: { area: HELD } } }, sam);
    if (p.kind !== 'known') throw new Error('not known');
    expect([...p.records]).toEqual([['r_a', 'a_later_area'], ['r_b', 'household'], ['r_c', 'household'], ['r_d', 'household'], ['r_e', 'household']]);
  });

  it('reads the studies medrec 0.9.5 lists, and knows a list from an earlier one by having none', () => {
    const earlier = parsePrivate({ ...raw, studies: undefined, unreported_studies: undefined }, sam);
    const later = parsePrivate({ ...raw, studies: { m_a: { area: 'reproductive', from: 'report' }, m_b: {} }, unreported_studies: ['m_c'] }, sam);
    if (earlier.kind !== 'known' || later.kind !== 'known') throw new Error('not known');
    expect([earlier.studies, earlier.unreported.size]).toEqual([null, 0]);
    expect([[...later.studies!], [...later.unreported]]).toEqual([[['m_a', 'reproductive'], ['m_b', 'household']], ['m_c']]);
    for (const odd of [{ studies: [] }, { studies: null }, { unreported_studies: {} }, { unreported_studies: [1] }]) expect(() => parsePrivate({ ...raw, ...odd }, sam)).toThrow(FolderError);
  });

  it('knows a medrec that judges the papers tied to a private one by its version', () => {
    const ties = (medrec?: string) => {
      const p = parsePrivate(raw, sam, medrec);
      return p.kind === 'known' && p.ties;
    };
    expect(['0.9.6', '0.9.10', '0.10.0', '1.0.0', '0.9.6-rc.1'].map(ties)).toEqual([true, true, true, true, true]);
    expect([undefined, '', 'later', '0.9', '0.9.5', '0.8.9', 'v0.9.6'].map(ties)).toEqual([false, false, false, false, false, false, false]);
    expect([atLeast('1.2.3', [1, 2, 4]), atLeast('2.0.0', [1, 9, 9])]).toEqual([false, true]);
    // The store hands it the version that wrote the folder's lists.
    const known = index(SAMPLE, sam).privacy!;
    expect(known.kind === 'known' && known.ties).toBe(false);
  });

  it('holds everything while marks_unreadable is anything but false', () => {
    for (const v of [true, 'yes', 1, null]) expect(parsePrivate({ ...raw, marks_unreadable: v }, sam).kind).toBe('held');
    expect(parsePrivate({ ...raw, marks_unreadable: false }, sam).kind).toBe('known');
  });

  it('holds everything while labels_unreadable is anything but false, and says it is not the marks', () => {
    const why = (x: object) => {
      const p = parsePrivate({ ...raw, ...x }, sam);
      return p.kind === 'held' ? p.why : p.kind;
    };
    expect([true, 'yes', 1, null].map((v) => why({ labels_unreadable: v, marks_unreadable: true }))).toEqual(['labels', 'labels', 'labels', 'labels']);
    expect([why({ labels_unreadable: true }), why({ labels_unreadable: false }), why({ labels_unreadable: false, marks_unreadable: true })]).toEqual(['labels', 'known', 'marks']);
  });

  it('never reads a record’s or a paper’s own fields for it', async () => {
    const path = `${personNamed(SAMPLE.household, 'Alex Example').folder}/index.json`;
    const idx = demoJson<{ records: object[]; documents: object[] }>(path);
    for (const x of [...idx.records, ...idx.documents]) Object.assign(x, { private: true, private_area: 'household' });
    // The folder still gives the MD5 medrec wrote from, so its lists are current.
    const store = await load({ [path]: JSON.stringify(idx) }, (m) => void (m.md5![path] = demoJson<{ md5: Record<string, string> }>('manifest.json').md5[path]!));
    const alex = index(store, id('Alex Example'));
    expect([isHeld(alex), anyPrivate(alex)]).toEqual([false, false]);
    expect(shown(events(store), undefined, false).hidden).toBe(2);
  });
});

describe('a person whose list can’t be used is held back', () => {
  const folder = (name: string) => personNamed(SAMPLE.household, name).folder;
  const otherMd5 = (...paths: string[]) => (m: { md5?: Record<string, string> }) => void paths.forEach((p) => (m.md5![p] = '0'.repeat(32)));

  it('with no views, no views medrec wrote for them, or views without it', async () => {
    const none = await load({ 'views/views.json': null });
    expect([held(none).length, why(none)]).toEqual([4, 'none']);
    expect(whyHeld(index(none, sam))).toBe('medrec has not written which items are private. medrec 0.9.1 and later does, with its views.');
    const views = demoJson<{ people: Record<string, { files: Record<string, string> } & Record<string, unknown>> }>('views/views.json');
    delete views.people[sam]!.files['private.json'];
    expect(held(await load({ 'views/views.json': JSON.stringify(views) }))).toEqual(['Sam Example']);
    const older = demoJson<typeof views>('views/views.json');
    delete older.people[sam]!.marks;
    expect(held(await load({ 'views/views.json': JSON.stringify(older) }))).toEqual(['Sam Example']);
    delete older.people[robin];
    expect(held(await load({ 'views/views.json': JSON.stringify(older) }))).toEqual(['Robin Example', 'Sam Example']);
    const unread = await load({ 'views/views.json': '{' });
    expect([held(unread).length, why(unread)]).toEqual([4, 'unreadable']);
  });

  it('when the app does not know the views’ layout, which says to update the app, or they do not read', async () => {
    const views = demoJson<{ schema: string; people: Record<string, Record<string, unknown>> }>('views/views.json');
    const with_ = (change: object) => load({ 'views/views.json': JSON.stringify({ ...views, ...change }) });
    const newer = await with_({ schema: 'medrec-views/v3' });
    expect([held(newer).length, why(newer), whyHeld(index(newer, sam))]).toEqual([4, 'newer_format', 'medrec’s views, which say which items are private, are written by a newer medrec. Update the app.']);
    for (const odd of [{ schema: 'medrec-events/v1' }, { schema: 2 }, { schema: undefined }, { people: [] }]) {
      const store = await with_(odd);
      expect([held(store).length, why(store), whyHeld(index(store, sam))]).toEqual([4, 'unreadable', 'medrec’s views could not be read, so nothing says which items are private.']);
    }
    // v1 is not medrec's: there are no views of its own to read.
    expect(why(await with_({ schema: 'medrec-views/v1' }))).toBe('none');
    // Only one person's entry does not read: it is named, and the others' lists stand.
    const people = { ...views.people, [sam]: { ...views.people[sam], text: 'no md5' } };
    const one = await with_({ people });
    expect([held(one), why(one), whyHeld(index(one, sam))]).toEqual([['Sam Example'], 'unreadable', 'medrec’s list of which items are private could not be read: views/views.json does not say which files it was made from.']);
  });

  it('when a file medrec read for it has changed, and so for the people linked to it', async () => {
    const changed = async (...paths: string[]) => {
      const store = await load({}, otherMd5(...paths));
      return [held(store), why(store)];
    };
    expect(await changed(`${folder('Sam Example')}/index.json`)).toEqual([['Sam Example', 'Alex Example', 'Jamie Example'], 'behind']);
    expect(await changed(`${folder('Sam Example')}/text.json`)).toEqual([['Sam Example', 'Alex Example', 'Jamie Example'], 'behind']);
    expect(await changed('household.json')).toEqual([['Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example'], 'behind']);
    // A decision or a mark the household made since: Sam has had neither.
    for (const f of ['overrides.json', 'marks.json']) {
      const path = `${folder('Sam Example')}/${f}`;
      const store = await load({}, (m) => (m.files.push(path), void (m.md5![path] = 'f'.repeat(32))));
      expect([held(store), why(store)]).toEqual([['Sam Example'], 'behind']);
    }
    // medrec's own marks, over a list written before them.
    const marks = privateCase('marked');
    const stale = await load(Object.fromEntries(Object.entries(marks).filter(([f]) => f.endsWith('marks.json'))));
    expect([held(stale), why(stale)]).toEqual([['Robin Example', 'Sam Example'], 'behind']);
    expect(index(stale, sam).events).toBeDefined();
    // Marks removed since the list was made from them.
    const robins = `${folder('Robin Example')}/marks.json`;
    expect(held(await load(Object.fromEntries(Object.entries(marks).filter(([f]) => f !== robins))))).toEqual(['Robin Example']);
  });

  it('when provider-state.json is not the one its list was made from, or is gone', async () => {
    const path = `${folder('Sam Example')}/provider-state.json`;
    const text = JSON.stringify({ schema: 'medrec-provider-state/v1', person: sam });
    const views = (state: unknown, medrec: string | undefined = '0.9.7') => {
      const v = demoJson<{ people: Record<string, object> }>('views/views.json');
      return JSON.stringify({ ...v, medrec, people: { ...v.people, [sam]: { ...v.people[sam], provider_state: state } } });
    };
    const md5 = createHash('md5').update(text).digest('hex');
    const of = async (overlay: Overlay) => {
      const store = await load(overlay);
      return [held(store), why(store)];
    };
    // Written, and the views not yet made from it.
    expect(await of({ [path]: text, 'views/views.json': views(undefined) })).toEqual([['Sam Example'], 'behind']);
    expect(await of({ [path]: text, 'views/views.json': views('0'.repeat(32)) })).toEqual([['Sam Example'], 'behind']);
    // Gone since.
    expect(await of({ 'views/views.json': views(md5) })).toEqual([['Sam Example'], 'behind']);
    // The one they were made from, and none as medrec before 0.9.7 and as one without a directory has it.
    expect(await of({ [path]: text, 'views/views.json': views(md5) })).toEqual([[], 'known']);
    expect(await of({ 'views/views.json': views(null) })).toEqual([[], 'known']);
    // Beside a list an older medrec made, its next one will be behind it too: nothing to wait for.
    const by = async (medrec: string, overlay: Overlay = {}, state?: unknown) => {
      const store = await load({ [path]: text, 'views/views.json': views(state, medrec), ...overlay });
      return [why(store), store.holdMayEnd()];
    };
    expect([await by('0.9.6'), await by(''), await by('0.9.7'), await by('0.9.6', {}, '0'.repeat(32))]).toEqual([['older_medrec', false], ['older_medrec', false], ['behind', true], ['behind', true]]);
    const idx = `${folder('Sam Example')}/index.json`;
    expect(await by('0.9.6', { [idx]: `${JSON.stringify(demoJson(idx))} ` })).toEqual(['behind', true]);
    // Only what is made from it waits for it: their visits and bills are medrec's still.
    const behind = await load({ [path]: text, 'views/views.json': views(undefined) });
    expect([index(behind, sam).events === undefined, index(behind, sam).bills === undefined, behind.eventsNotes.size, behind.billsNotes.size]).toEqual([false, false, 0, 0]);
    expect((await load({ 'views/views.json': views(7) })).index(sam)!.privacy).toMatchObject({ kind: 'held', why: 'unreadable' });
  });

  it('while the file is arriving, or when nothing can be checked, or it does not read', async () => {
    const path = viewPath(sam);
    const of = async (...args: Parameters<typeof load>) => {
      const store = await load(...args);
      return [held(store), why(store)];
    };
    expect(await of({}, otherMd5(path))).toEqual([['Sam Example'], 'arriving']);
    expect(await of({ [path]: null })).toEqual([['Sam Example'], 'arriving']);
    const everyone = ['Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example'];
    expect(await of({}, (m) => void delete m.md5)).toEqual([everyone, 'unchecked']);
    const same = demoJson<{ md5: Record<string, string> }>('manifest.json').md5[path]!;
    const served = (text: string) => of({ [path]: text }, (m) => void (m.md5![path] = same));
    expect(await served('{"schema": "medrec-priv')).toEqual([['Sam Example'], 'unreadable']);
    expect(await served(JSON.stringify({ ...demoJson<object>(path), schema: 'medrec-private/v2' }))).toEqual([['Sam Example'], 'newer_format']);
    expect(await served(JSON.stringify(demoJson(viewPath(robin))))).toEqual([['Sam Example'], 'unreadable']);
  });

  it('when medrec says the household’s marks don’t read', () => {
    expect([held(UNREADABLE), why(UNREADABLE)]).toEqual([['Sam Example'], 'marks']);
    expect(whyHeld(index(UNREADABLE, sam))).toBe('The household’s own private marks could not be read.');
  });

  it('when their list can’t be used, but not while they have no items at all', async () => {
    const path = `${folder('Jamie Example')}/index.json`;
    const empty = JSON.stringify({ ...demoJson<object>(path), documents: [], records: [], studies: [], imports: [] });
    const store = await load({ [path]: empty });
    // Jamie's list is behind an index with nothing in it: there is nothing to leave off, or to say.
    expect([why(store, id('Jamie Example')), held(store).includes('Jamie Example'), anyPrivate(index(store, id('Jamie Example')))]).toEqual(['behind', false, false]);
  });

  it('when the files it was made from can’t be checked', async () => {
    const real = demoFolderWith({});
    const store = new Store(new Proxy(real, { get: (t, k) => (k === 'md5' ? async () => Promise.reject(new Error('offline')) : Reflect.get(t, k, t)) }));
    await store.load();
    expect([held(store).length, why(store)]).toEqual([4, 'unreadable']);
    expect(whyHeld(index(store, sam))).toBe('medrec’s list of which items are private could not be read: offline');
  });

  it('when the store has no answer for them at all', () => {
    const idx = { ...index(SAMPLE, robin) };
    delete idx.privacy;
    expect([isHeld(idx), recordPrivate(idx, 'r_any'), documentPrivate(idx, 'd_any'), whyHeld(idx)]).toEqual([true, HELD, HELD, 'medrec has not written which items are private. medrec 0.9.1 and later does, with its views.']);
    expect(careTeam(idx, TODAY).length).toBeGreaterThan(0);
  });

  it('leaves all of theirs off every shared screen, and everyone else’s on; their own pages have all of it', () => {
    const all = events(UNREADABLE);
    const mine = all.filter((x) => x.person.id === sam);
    expect(mine.length).toBe(7);
    expect(mine.every((x) => x.private === HELD)).toBe(true);
    // The calendar: none of Sam's, even with private events shown, and none counted as private.
    for (const showPrivate of [false, true]) expect(shown(all, undefined, showPrivate)).toEqual({ events: all.filter((x) => x.person.id !== sam), hidden: 0 });
    expect(shown(all, sam, false).events).toEqual(mine);
    // Money.
    const idx = index(UNREADABLE, sam);
    expect(openBills(idx, mine, TODAY)).toHaveLength(2);
    expect(forShared(idx, openBills(idx, mine, TODAY))).toEqual([]);
    expect(unbilledShares(idx, mine).every((u) => u.private === HELD)).toBe(true);
    const claims = idx.records.filter((r) => r.kind === 'claim').map((r) => r.id);
    expect([...quietClaims(UNREADABLE, TODAY).keys()].sort()).toEqual(claims.sort());
    // Papers: Sam's are all held, the others' all clear.
    const papers = sharedPapers(UNREADABLE.household, UNREADABLE.indexes, TODAY);
    expect(papers.length).toBeGreaterThan(0);
    expect(papers.every((p) => p.person !== sam && !p.private)).toBe(true);
    // The doctor's sheet.
    const off = doctorSheet(idx, TODAY, false);
    expect([off.allergies, off.medicines, off.problems, off.vaccines, off.labs, off.vitals, off.careTeam].every((x) => x.length === 0)).toBe(true);
    expect(doctorSheet(idx, TODAY, true).allergies.map((a) => a.name)).toEqual(['Peanuts']);
    // Search.
    for (const r of idx.records) expect(itemPrivate(idx, r.kind, r.id)).toBe(HELD);
    for (const d of idx.documents) expect(itemPrivate(idx, 'document', d.id)).toBe(HELD);
  });
});

describe('copies of one statement', () => {
  const knee = 'Statement from Example Surgery Center';
  /** Sam with two copies of the surgery center's statement, medrec's list as one before or after 0.9.6 has it. */
  const withCopies = (documents: string[], ties = false): PersonIndex => {
    const idx = structuredClone(index(SAMPLE, sam));
    const first = idx.documents.find((d) => d.title === knee)!;
    idx.documents.push({ ...first, id: 'd_second', same_statement_as: first.id }, { ...first, id: 'd_third', same_statement_as: first.id });
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    idx.privacy = { ...idx.privacy, documents: new Map(documents.map((x) => [x === 'first' ? first.id : x, 'household'])), ties };
    return idx;
  };
  const areas = (idx: PersonIndex) => {
    const first = idx.documents.find((d) => d.title === knee)!.id;
    return [first, 'd_second', 'd_third'].map((x) => paperPrivate(idx, x));
  };

  it('are private when one is, whichever it is, in a list from before medrec 0.9.6', () => {
    for (const one of ['first', 'd_second', 'd_third']) expect(areas(withCopies([one]))).toEqual(['household', 'household', 'household']);
    expect(areas(withCopies([]))).toEqual([undefined, undefined, undefined]);
  });

  it('are as medrec says from 0.9.6, which judges them itself', () => {
    expect(areas(withCopies(['d_second'], true))).toEqual([undefined, 'household', undefined]);
  });

  it('leave other papers alone', () => {
    const idx = withCopies(['first']);
    expect(idx.documents.filter((d) => d.title !== knee).map((d) => paperPrivate(idx, d.id))).toEqual([undefined, undefined, undefined]);
    // Nor a paper the household marked not private, whatever its copy is.
    const marked = structuredClone(index(MARKED, sam));
    const doc = marked.documents.find((d) => d.title === 'Going home after knee surgery')!;
    marked.documents.push({ ...doc, id: 'd_copy', same_statement_as: doc.id });
    if (marked.privacy?.kind !== 'known') throw new Error('not known');
    marked.privacy.documents.set('d_copy', 'household');
    expect([doc.id, 'd_copy'].map((x) => paperPrivate(marked, x))).toEqual([undefined, 'household']);
  });
});

describe('what the household marked', () => {
  const day = '2026-08-26';

  it('a visit marked private takes its records and papers with it', () => {
    const knee = eventOn(MARKED, sam, day);
    expect(eventPrivate(knee, index(MARKED, sam))).toBe('household');
    for (const c of knee.claims) expect(recordPrivate(index(MARKED, sam), c.record.id)).toBe('household');
    const bills = openBills(index(MARKED, sam), events(MARKED).filter((x) => x.person.id === sam), TODAY);
    expect(bills.map((b) => [b.bill.provider, b.private])).toEqual([['Example Billing', undefined], ['Example Surgery Center', 'household']]);
    expect(forShared(index(MARKED, sam), bills).map((b) => b.bill.provider)).toEqual(['Example Billing']);
    expect(shown(events(MARKED), undefined, false).events.some((x) => x.event.id === knee.id)).toBe(false);
  });

  it('a paper marked not private shows, placed as if the private visit it is in were not there', () => {
    const doc = paper(MARKED, sam, 'Going home after knee surgery');
    const own = papersOf(index(MARKED, sam), MARKED.household, TODAY, MARKED.indexes).find((x) => x.doc.id === doc.id)!;
    expect([own.private, own.with?.private, own.with?.event.start]).toEqual([undefined, 'household', day]);
    expect(paperPrivate(index(MARKED, sam), doc.id)).toBeUndefined();
    const shared = sharedPapers(MARKED.household, MARKED.indexes, TODAY);
    const p = shared.find((x) => x.doc.id === doc.id)!;
    expect([p.with, p.could, p.why]).toEqual([undefined, undefined, 'No visit listed here is on or near Aug 26, 2026.']);
    // The visit's other paper, its bill, was not marked so, and stays off; its owner has it.
    const off = ['Statement from Example Lab', 'Statement from Example Surgery Center'];
    const all = MARKED.household.people.flatMap((x) => papersOf(index(MARKED, x.id), MARKED.household, TODAY, MARKED.indexes));
    expect(all.filter((x) => x.private).map((x) => [x.doc.title, x.private])).toEqual(off.map((t) => [t, 'household']));
    expect(shared).toHaveLength(all.length - 2);
    expect(shared.some((x) => off.includes(x.doc.title ?? ''))).toBe(false);
  });

  it('a shared paper is placed by no private record or bill', () => {
    const on = (idx: PersonIndex, doc: string) => {
      const indexes = new Map([...SAMPLE.indexes, [idx.person, idx]]);
      const found = (papers: ReturnType<typeof sharedPapers>) => papers.find((x) => x.doc.id === doc);
      const own = found(papersOf(idx, SAMPLE.household, TODAY, indexes));
      const shared = found(sharedPapers(SAMPLE.household, indexes, TODAY));
      return [own?.with?.how, own?.private, shared?.with?.how, shared?.why];
    };
    // A receipt that is not private, for a bill that is.
    const idx = structuredClone(index(SAMPLE, robin));
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    const receipt = paper(SAMPLE, robin, 'Payment receipt from Example Health').id;
    expect(on(idx, receipt)).toEqual(['bill', undefined, 'bill', undefined]);
    for (const d of idx.documents) if (d.doc_type === 'bill') idx.privacy.documents.set(d.id, 'household');
    expect(on(idx, receipt)).toEqual(['bill', undefined, undefined, 'No visit listed here is on or near Apr 20, 2025.']);
    // An explanation of benefits the household marked not private, of a claim that is private in a visit that is not.
    const eobs = structuredClone(index(SAMPLE, robin));
    if (eobs.privacy?.kind !== 'known') throw new Error('not known');
    const eob = paper(SAMPLE, robin, 'Explanation of Benefits').id;
    expect(on(eobs, eob)).toEqual(['claim', undefined, 'claim', undefined]);
    for (const r of eobs.records) if (r.documents.includes(eob)) eobs.privacy.records.set(r.id, 'household');
    expect(on(eobs, eob)).toEqual(['claim', undefined, undefined, 'An explanation of benefits covers claims, and no visit listed here has its claim.']);
  });

  it('a bill marked private accounts for no share on a shared screen, which lists the visit’s as with no bill', () => {
    const idx = index(MARKED, robin);
    const bill = paper(MARKED, robin, 'Statement from Example Lab');
    const mine = events(MARKED).filter((x) => x.person.id === robin);
    const day = mine.find((x) => x.event.papers.some((p) => p.doc.id === bill.id))!.event.start;
    const labs = (shared: boolean) => unbilledShares(idx, mine, shared).filter((u) => u.provider === 'Example Lab' && u.event.event.start === day);
    expect([paperPrivate(idx, bill.id), labs(false), labs(true).map((u) => [u.cents, u.private])]).toEqual(['household', [], [[1928, undefined]]]);
    // A private receipt accounts for none either.
    const receipt = { ...bill, id: 'd_receipt', doc_type: 'receipt', organization: 'Example Lab', date: '2026-11-20' };
    const paid = { ...index(SAMPLE, sam), documents: [...index(SAMPLE, sam).documents, receipt] };
    const shares = (idx: PersonIndex, shared: boolean) => unbilledShares(idx, events(SAMPLE).filter((x) => x.person.id === sam), shared).filter((u) => u.provider === 'Example Lab').length;
    if (paid.privacy?.kind !== 'known') throw new Error('not known');
    const secret: PersonIndex = { ...paid, privacy: { ...paid.privacy, documents: new Map([['d_receipt', 'household']]) } };
    expect([shares(index(SAMPLE, sam), true), shares(paid, true), shares(secret, true), shares(secret, false)]).toEqual([1, 0, 1, 0]);
    // Nothing else is changed by it, and without a private paper nothing is.
    expect(unbilledShares(idx, mine, true)).toHaveLength(unbilledShares(idx, mine).length + 1);
    expect(unbilledShares(index(SAMPLE, robin), mine, true)).toEqual(unbilledShares(index(SAMPLE, robin), mine));
  });

  it('a bill whose visit alone is private shows without the visit', () => {
    const idx = index(MARKED, sam);
    const knee = events(MARKED).find((x) => x.person.id === sam && x.event.start === day)!;
    const bill = openBills(idx, events(MARKED).filter((x) => x.person.id === sam), TODAY).find((b) => b.event?.event.id === knee.event.id)!;
    expect(forShared(idx, [bill])).toEqual([]);
    const cleared = { ...bill };
    delete cleared.private;
    const shared = { ...cleared };
    delete shared.event;
    expect(forShared(idx, [cleared])).toEqual([shared]);
  });

  it('a visit marked not private shows, though its records stay private', () => {
    const visit = eventOn(MARKED, sam, '2026-10-27');
    expect(eventPrivate(visit, index(MARKED, sam))).toBeUndefined();
    expect(shown(events(MARKED), undefined, false).events.some((x) => x.event.id === visit.id)).toBe(true);
    // Its claim does not: no share of it is listed, and Money neither dates nor links it.
    const claim = visit.claims[0]!.record.id;
    expect(recordPrivate(index(MARKED, sam), claim)).toBe('mental_health');
    expect(unbilledShares(index(MARKED, sam), events(MARKED).filter((x) => x.person.id === sam)).find((u) => u.event.event.id === visit.id)!.private).toBe('mental_health');
    expect(quietClaims(MARKED, TODAY).get(claim)).toBe('mental_health');
  });

  it('a fill is as private as the record it is named for, whatever its event says', () => {
    const idx = structuredClone(index(SAMPLE, sam));
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    const fill = personEvents(idx, SAMPLE.household, TODAY).find((e) => e.kind === 'fill' && e.start === '2026-10-31')!;
    expect(idx.privacy.events.delete(fill.id)).toBe(true);
    expect(eventPrivate(fill, idx)).toBe('substance_use');
  });

  it('one record and one paper marked by themselves are the only ones of theirs left off', () => {
    const idx = index(MARKED, robin);
    const off = doctorSheet(idx, TODAY, false);
    expect([off.allergies, off.privateLeft, [...off.leftFrom]]).toEqual([[], 1, ['allergies']]);
    expect(doctorSheet(idx, TODAY, true).allergies).toHaveLength(1);
    const bills = openBills(idx, events(MARKED).filter((x) => x.person.id === robin), TODAY);
    expect(bills.map((b) => [b.bill.provider, b.private])).toEqual([['Example Health', undefined], ['Example Lab', 'household']]);
    expect(events(MARKED).filter((x) => x.person.id === robin && x.private)).toEqual([]);
  });
});

describe('the app’s own grouping, with medrec’s list', () => {
  it('makes a visit private when any record in it is', () => {
    const idx = structuredClone(index(SAMPLE, sam));
    delete idx.events;
    const own = personEvents(idx, SAMPLE.household, TODAY);
    expect(own.filter((e) => eventPrivate(e, idx)).map((e) => [e.start, eventPrivate(e, idx), e.what])).toEqual([['2026-10-27', 'mental_health', 'Counseling session']]);
  });

  it('cannot tell a paper the household took out, so it stays off with its visit', () => {
    const idx = structuredClone(index(MARKED, sam));
    delete idx.events;
    const goingHome = papersOf(idx, MARKED.household, TODAY, new Map([[sam, idx]])).find((p) => p.doc.title === 'Going home after knee surgery')!;
    expect(goingHome.private).toBe('household');
  });
});

/** An index as a list from medrec 0.9.5 or later has it: `studies` and the papers private records link are medrec's own answer. */
function judged095(store: Store, person: string, lists: { documents?: Record<string, string>; studies?: Record<string, string>; unreported?: string[] } = {}): PersonIndex {
  const idx = structuredClone(index(store, person));
  if (idx.privacy?.kind !== 'known') throw new Error('not known');
  for (const [doc, area] of Object.entries(lists.documents ?? {})) idx.privacy.documents.set(doc, area);
  idx.privacy.studies = new Map(Object.entries(lists.studies ?? {}));
  idx.privacy.unreported = new Set(lists.unreported ?? []);
  return idx;
}

/** An index as a list from before medrec 0.9.5 has it: the sample's without its `studies`. */
function judged091(store: Store, person: string): PersonIndex {
  const idx = structuredClone(index(store, person));
  if (idx.privacy?.kind !== 'known') throw new Error('not known');
  idx.privacy.studies = null;
  idx.privacy.unreported = new Set();
  return idx;
}

describe('a paper a private record links', () => {
  const isPrivate = (kind: string) => record(SAMPLE, sam, (r) => r.kind === kind && recordPrivate(index(SAMPLE, sam), r.id) !== undefined).id;
  const link = (idx: PersonIndex, rec: string, doc: string) => idx.records.find((r) => r.id === rec)!.documents.push(doc);
  const shownAs = (idx: PersonIndex, doc: string) => papersOf(idx, SAMPLE.household, TODAY, new Map([[sam, idx]])).find((p) => p.doc.id === doc)!;
  const added = (idx: PersonIndex) => {
    const eob = { ...idx.documents[0]!, id: 'd_privateclaimseobxxxxx', doc_type: 'eob' };
    idx.documents.push(eob);
    return eob.id;
  };

  it('is private, whether no visit holds it or one that is not private does', () => {
    const idx = judged091(SAMPLE, sam);
    const eob = added(idx);
    expect(paperPrivate(idx, eob)).toBeUndefined();
    link(idx, isPrivate('claim'), eob);
    expect([paperPrivate(idx, eob), shownAs(idx, eob).private]).toEqual(['mental_health', 'mental_health']);
    const goingHome = paper(SAMPLE, sam, 'Going home after knee surgery').id;
    expect([paperPrivate(idx, goingHome), shownAs(idx, goingHome).with?.how]).toEqual([undefined, 'event']);
    link(idx, isPrivate('medication'), goingHome);
    expect([paperPrivate(idx, goingHome), shownAs(idx, goingHome).private]).toEqual(['substance_use', 'substance_use']);
  });

  it('is private whatever else links it', () => {
    const idx = judged091(SAMPLE, sam);
    const eob = added(idx);
    link(idx, record(SAMPLE, sam, (r) => r.kind === 'allergy').id, eob);
    expect(paperPrivate(idx, eob)).toBeUndefined();
    link(idx, isPrivate('medication'), eob);
    expect(paperPrivate(idx, eob)).toBe('substance_use');
  });

  it('is not when the household marked it not private: from a visit it made private, or in a list from 0.9.5', () => {
    const marked = structuredClone(index(MARKED, sam));
    const goingHome = paper(MARKED, sam, 'Going home after knee surgery').id;
    link(marked, eventOn(MARKED, sam, '2026-08-26').claims[0]!.record.id, goingHome);
    expect([takenOut(marked, goingHome), paperPrivate(marked, goingHome)]).toEqual([true, undefined]);

    const later = judged095(SAMPLE, sam);
    const eob = added(later);
    expect(takenOut(later, eob)).toBe(false);
    link(later, isPrivate('claim'), eob);
    expect([takenOut(later, eob), paperPrivate(later, eob)]).toEqual([true, undefined]);
    // Its visit stays private, so the paper shows without it.
    const p = shownAs(later, eob);
    expect([p.private, p.with?.how, p.with?.private]).toEqual([undefined, 'claim', 'mental_health']);
    expect(billPrivate(later, later.documents.find((d) => d.id === eob)!, events(SAMPLE).find((x) => x.person.id === sam && x.private)!)).toBeUndefined();
    expect(paperPrivate(judged095(SAMPLE, sam, { documents: { [eob]: 'mental_health' } }), eob)).toBe('mental_health');
  });

  it('is not when the record is one the household marked not private, though its visit is private', () => {
    const idx = judged091(MARKED, sam);
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    const claim = eventOn(MARKED, sam, '2026-08-26').claims[0]!.record.id;
    const eob = added(idx);
    link(idx, claim, eob);
    expect(shownAs(idx, eob).private).toBe('household');
    expect(idx.privacy.records.delete(claim)).toBe(true);
    expect([shownAs(idx, eob).private, shownAs(idx, eob).with?.private]).toEqual([undefined, 'household']);
  });

  it('makes its visit private in the app’s own grouping', () => {
    const idx = judged091(SAMPLE, sam);
    delete idx.events;
    const goingHome = paper(SAMPLE, sam, 'Going home after knee surgery').id;
    const holds = () => personEvents(idx, SAMPLE.household, TODAY).find((e) => e.papers.some((p) => p.doc.id === goingHome));
    const e = holds();
    if (!e) throw new Error('the app’s own grouping puts it with no visit');
    expect(eventPrivate(e, idx)).toBeUndefined();
    link(idx, isPrivate('medication'), goingHome);
    expect(eventPrivate(e, idx)).toBe('substance_use');
  });
});

describe('an imaging study', () => {
  it('is as medrec 0.9.5 lists it: private with its report, held back with none', () => {
    const study = index(SAMPLE, sam).studies[0]!;
    const note = paper(SAMPLE, sam, 'Sports medicine visit note');
    const reported = { ...study, report: note.id };
    // The sample's own list, as medrec 0.9.5 wrote it: its one study has no report.
    const own = index(SAMPLE, sam).privacy;
    expect(own?.kind === 'known' && [own.studies?.size, [...own.unreported]]).toEqual([0, [study.id]]);
    expect(studyPrivate(index(SAMPLE, sam), study)).toBe(HELD);
    expect(studyPrivate(judged095(SAMPLE, sam, { studies: { [study.id]: 'reproductive' } }), reported)).toBe('reproductive');
    expect(studyPrivate(judged095(SAMPLE, sam, { unreported: [study.id] }), study)).toBe(HELD);
    expect(studyPrivate(judged095(SAMPLE, sam), reported)).toBeUndefined();
    // A study medrec lists in neither, with no report here, is nobody's to clear.
    expect(studyPrivate(judged095(SAMPLE, sam), study)).toBe(HELD);
    expect(anyPrivate(judged095(SAMPLE, robin, { studies: {} }))).toBe(false);
  });

  it('is, in an earlier list, as private as its report, a linked paper’s too, and held back without one', () => {
    const idx = judged091(SAMPLE, sam);
    const study = idx.studies[0]!;
    expect(studyPrivate(idx, study)).toBe(HELD);
    const note = paper(SAMPLE, sam, 'Sports medicine visit note');
    expect(studyPrivate(idx, { ...study, report: note.id })).toBeUndefined();
    const meds = record(SAMPLE, sam, (r) => r.kind === 'medication' && /nicotine/i.test(r.display));
    expect(studyPrivate(idx, { ...study, report: meds.id })).toBe('substance_use');
    expect(studyPrivate(idx, { ...study, report: 'd_notfiledyetxxxxxxxxxx' })).toBe(HELD);
    idx.records.find((r) => r.id === meds.id)!.documents.push(note.id);
    expect(studyPrivate(idx, { ...study, report: note.id })).toBe('substance_use');
  });
});

describe('what medrec’s list does not judge', () => {
  it('another person’s paper in a visit (X2) is judged as its own person’s, and its private visit is not named', () => {
    const jamie = structuredClone(index(SAMPLE, id('Jamie Example')));
    const scan = paper(SAMPLE, robin, 'Vaccination card');
    const stay = jamie.events!.events[0]!;
    stay.members.push({ ...stay.members[0]!, record: undefined, document: scan.id, person: robin });
    jamie.events!.papers.set(scan.id, { person: robin, doc: scan });
    const all = new Map([...SAMPLE.indexes, [jamie.person, jamie]]);
    const shownAs = () => papersOf(index(SAMPLE, robin), SAMPLE.household, TODAY, all).find((x) => x.doc.id === scan.id)!;
    expect([shownAs().private, shownAs().with?.private]).toEqual([undefined, undefined]);
    // Nothing says which of Jamie's items are private.
    delete jamie.privacy;
    expect([shownAs().private, shownAs().with?.private]).toEqual([undefined, HELD]);
  });
});

describe('search', () => {
  it('leaves private items out of everyone’s results, and finds them for their person', () => {
    const scope = [...SAMPLE.indexes.values()].map((i) => ({ person: i.person, index: i, text: null }));
    const clear = scope.map((s) => ({ ...s, leave: (kind: string, item: string) => !!itemPrivate(s.index, kind, item) }));
    const names = (people: typeof scope, q: string) => find(people, q).hits.map((h) => h.title);
    expect(names(scope, 'nicotine').length).toBe(2);
    expect(names(clear, 'nicotine')).toEqual([]);
    expect(names(clear, 'my meds')).not.toContain('Nicotine 14 mg/24 hour patch');
    expect(names(scope, 'my meds')).toContain('Nicotine 14 mg/24 hour patch');
    expect(names(clear, 'lisinopril')).toEqual(names(scope, 'lisinopril'));
  });
});

it('lays a case over the sample with the MD5s its files have', () => {
  const m = JSON.parse(manifestWith(privateCase('unreadable'))) as { files: string[] };
  expect(m.files).toContain('Sam Example/marks.json');
});
