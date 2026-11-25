// Private items: medrec's private.json as the store reads it, when it can't
// be used (and everything of that person's is held back from shared screens),
// and what each shared screen's model leaves out. The private.json files are
// medrec's own: the sample's, and the cases scripts/private-fixtures.mjs makes.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { parseMedrecEvents, type MedrecEvent, type MedrecRule } from '../src/model/events';
import { FolderError } from '../src/model/parse';
import { anyPrivate, atLeast, documentPrivate, HELD, isHeld, itemPrivate, paperPrivate, parsePrivate, recordPrivate, studyPrivate, takenOut, whyHeld } from '../src/model/private';
import { documentTitle } from '../src/model/records';
import { find } from '../src/model/search';
import type { PersonIndex } from '../src/model/types';
import { viewOf } from '../src/model/views';
import { asShared, householdEvents, shown } from '../src/next/calendar';
import { eventOf, eventPrivate, sharedForm, type CareEvent } from '../src/next/event';
import { careTeam, doctorSheet } from '../src/next/health';
import { personEvents } from '../src/next/load';
import { billPrivate, openBills, sharedDesk, sharedOpen, unbilledShares, type OpenBill } from '../src/next/money';
import { papersOf, sharedPapers } from '../src/next/papers';
import { providerPage } from '../src/next/provider';
import { heldPeople, quietClaims } from '../src/next/shared';
import { personNamed } from './demo-data';
import { demoFolderWith, demoJson, manifestWith, privateCase, type Overlay } from './helpers';

const TODAY = '2026-11-22';
/** The paper Sam was given after the endoscopy. */
const AFTER = 'After your upper endoscopy.pdf';

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
const eventsPath = (person: string) => `views/${person}/${viewOf(demoJson('views/views.json'), person, 'events.json')!.name}`;
const held = (store: Store) => heldPeople(store).map((x) => x.person.name);
const why = (store: Store, person = sam) => {
  const p = index(store, person).privacy;
  return p?.kind === 'held' ? p.why : 'known';
};
const events = (store: Store) => householdEvents(store.household, (p) => store.index(p), TODAY);
const record = (store: Store, person: string, fits: (r: PersonIndex['records'][number]) => boolean) => index(store, person).records.find(fits)!;
const paper = (store: Store, person: string, title: string) => index(store, person).documents.find((d) => documentTitle(d) === title)!;
const eventOn = (store: Store, person: string, day: string, kind?: string) => personEvents(index(store, person), store.household, TODAY).find((e) => e.start === day && (!kind || e.kind === kind))!;

describe('reading private.json', () => {
  const raw = demoJson<Record<string, unknown>>(viewPath(sam));

  it('reads the sample’s, as medrec wrote it', () => {
    const p = index(SAMPLE, sam).privacy!;
    if (p.kind !== 'known') throw new Error('not known');
    expect([p.records.size, p.documents.size, p.events.size]).toEqual([4, 0, 2]);
    expect(new Set([...p.records.values(), ...p.events.values()])).toEqual(new Set(['sexual_health']));
    for (const name of ['Robin Example', 'Alex Example', 'Drew Example']) expect([anyPrivate(index(SAMPLE, id(name))), isHeld(index(SAMPLE, id(name)))]).toEqual([false, false]);
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
    expect(known.kind === 'known' && known.ties).toBe(true);
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
    expect(await changed(`${folder('Sam Example')}/index.json`)).toEqual([['Sam Example', 'Alex Example', 'Drew Example'], 'behind']);
    expect(await changed(`${folder('Sam Example')}/text.json`)).toEqual([['Sam Example', 'Alex Example', 'Drew Example'], 'behind']);
    expect(await changed('household.json')).toEqual([['Robin Example', 'Sam Example', 'Alex Example', 'Drew Example'], 'behind']);
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
    // Beside a list an older medrec made: an update whose first pass is not done, or an older one that wrote last.
    const by = async (medrec: string, overlay: Overlay = {}, state?: unknown) => {
      const store = await load({ [path]: text, 'views/views.json': views(state, medrec), ...overlay });
      return [why(store), store.holdMayEnd()];
    };
    expect([await by('0.9.6'), await by(''), await by('0.9.7'), await by('0.9.6', {}, '0'.repeat(32))]).toEqual([['older_medrec', true], ['older_medrec', true], ['behind', true], ['behind', true]]);
    // The update's first pass ends between two reads.
    const updating = await load({ [path]: text, 'views/views.json': views(undefined, '0.9.6') });
    const updated = await load({ [path]: text, 'views/views.json': views(md5) });
    expect([held(updating), updating.mayBring(), held(updated), updating.snapshot === updated.snapshot]).toEqual([['Sam Example'], true, [], false]);
    expect(updating.index(sam)!.privacy).toMatchObject({ text: expect.stringMatching(/older medrec.*update medrec on every computer/) });
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
    const everyone = ['Robin Example', 'Sam Example', 'Alex Example', 'Drew Example'];
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
    const path = `${folder('Drew Example')}/index.json`;
    const empty = JSON.stringify({ ...demoJson<object>(path), documents: [], records: [], studies: [], imports: [] });
    const store = await load({ [path]: empty });
    // Drew's list is behind an index with nothing in it: there is nothing to leave off, or to say.
    expect([why(store, id('Drew Example')), held(store).includes('Drew Example'), anyPrivate(index(store, id('Drew Example')))]).toEqual(['behind', false, false]);
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
    expect(mine.length).toBe(8);
    expect(mine.every((x) => x.private === HELD)).toBe(true);
    // The calendar: none of Sam's, even with private events shown, and none counted as private.
    for (const showPrivate of [false, true]) expect(shown(all, undefined, showPrivate)).toEqual({ events: all.filter((x) => x.person.id !== sam), hidden: 0 });
    expect(shown(all, sam, false).events).toEqual(mine);
    // Money.
    const idx = index(UNREADABLE, sam);
    expect(openBills(idx, mine, TODAY)).toHaveLength(2);
    expect(sharedOpen(idx, openBills(idx, mine, TODAY))).toEqual([]);
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
  const statement = 'Statement from Example Endoscopy Center.pdf';
  /** Sam with two copies of the endoscopy center's statement, medrec's list as one before or after 0.9.6 has it. */
  const withCopies = (documents: string[], ties = false): PersonIndex => {
    const idx = structuredClone(index(SAMPLE, sam));
    const first = idx.documents.find((d) => documentTitle(d) === statement)!;
    idx.documents.push({ ...first, id: 'd_second', same_statement_as: first.id }, { ...first, id: 'd_third', same_statement_as: first.id });
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    idx.privacy = { ...idx.privacy, documents: new Map(documents.map((x) => [x === 'first' ? first.id : x, 'household'])), ties };
    return idx;
  };
  const areas = (idx: PersonIndex) => {
    const first = idx.documents.find((d) => documentTitle(d) === statement)!.id;
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
    expect(idx.documents.filter((d) => documentTitle(d) !== statement && !d.same_statement_as).map((d) => paperPrivate(idx, d.id))).toEqual([undefined, undefined, undefined, undefined]);
    // Nor a paper the household marked not private, whatever its copy is.
    const marked = structuredClone(index(MARKED, sam));
    const doc = marked.documents.find((d) => documentTitle(d) === AFTER)!;
    marked.documents.push({ ...doc, id: 'd_copy', same_statement_as: doc.id });
    if (marked.privacy?.kind !== 'known') throw new Error('not known');
    marked.privacy.documents.set('d_copy', 'household');
    expect([doc.id, 'd_copy'].map((x) => paperPrivate(marked, x))).toEqual([undefined, 'household']);
  });
});

describe('what the household marked', () => {
  const day = '2026-09-16';

  it('a visit marked private takes its records and papers with it', () => {
    const scope = eventOn(MARKED, sam, day);
    expect(eventPrivate(scope, index(MARKED, sam))).toBe('household');
    for (const c of scope.claims) expect(recordPrivate(index(MARKED, sam), c.record.id)).toBe('household');
    const bills = openBills(index(MARKED, sam), events(MARKED).filter((x) => x.person.id === sam), TODAY);
    expect(bills.map((b) => [b.bill.provider, b.private])).toEqual([['Example Billing', undefined], ['Example Endoscopy Center', 'household']]);
    expect(sharedOpen(index(MARKED, sam), bills).map((b) => b.bill.provider)).toEqual(['Example Billing']);
    expect(shown(events(MARKED), undefined, false).events.some((x) => x.event.id === scope.id)).toBe(false);
  });

  it('a paper marked not private shows, placed as if the private visit it is in were not there', () => {
    const doc = paper(MARKED, sam, AFTER);
    const own = papersOf(index(MARKED, sam), MARKED.household, TODAY, MARKED.indexes).find((x) => x.doc.id === doc.id)!;
    expect([own.private, own.with?.private, own.with?.event.start]).toEqual([undefined, 'household', day]);
    expect(paperPrivate(index(MARKED, sam), doc.id)).toBeUndefined();
    const shared = sharedPapers(MARKED.household, MARKED.indexes, TODAY);
    const p = shared.find((x) => x.doc.id === doc.id)!;
    expect([p.with, p.could, p.why]).toEqual([undefined, undefined, 'No visit listed here is on or near Sep 16, 2026.']);
    // The visit's other paper, its bill, was not marked so, and stays off; its owner has it.
    const off = ['Statement from Example Lab.pdf', 'Statement from Example Endoscopy Center.pdf'];
    const all = MARKED.household.people.flatMap((x) => papersOf(index(MARKED, x.id), MARKED.household, TODAY, MARKED.indexes));
    expect(all.filter((x) => x.private).map((x) => [documentTitle(x.doc), x.private])).toEqual(off.map((t) => [t, 'household']));
    expect(shared).toHaveLength(all.length - 2);
    expect(shared.some((x) => off.includes(documentTitle(x.doc)))).toBe(false);
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
    const receipt = paper(SAMPLE, robin, 'Payment receipt.pdf').id;
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
    const bill = paper(MARKED, robin, 'Statement from Example Lab.pdf');
    const mine = events(MARKED).filter((x) => x.person.id === robin);
    const day = mine.find((x) => x.event.papers.some((p) => p.doc.id === bill.id))!.event.start;
    const labs = (shared: boolean) => unbilledShares(idx, mine, shared).filter((u) => u.provider === 'Example Lab' && u.event.event.start === day);
    expect([paperPrivate(idx, bill.id), labs(false), labs(true).map((u) => [u.cents, u.private])]).toEqual(['household', [], [[1928, undefined]]]);
    // A private receipt accounts for none either.
    const receipt = { ...bill, id: 'd_receipt', doc_type: 'receipt', organization: 'Example Lab', date: '2026-11-12' };
    const paid = { ...index(SAMPLE, sam), documents: [...index(SAMPLE, sam).documents, receipt] };
    const shares = (idx: PersonIndex, shared: boolean) => unbilledShares(idx, events(SAMPLE).filter((x) => x.person.id === sam), shared).filter((u) => u.provider === 'Example Lab').length;
    if (paid.privacy?.kind !== 'known') throw new Error('not known');
    const secret: PersonIndex = { ...paid, privacy: { ...paid.privacy, documents: new Map([['d_receipt', 'household']]) } };
    expect([shares(index(SAMPLE, sam), true), shares(paid, true), shares(secret, true), shares(secret, false)]).toEqual([2, 0, 2, 0]);
    // Nothing else is changed by it, and without a private paper nothing is.
    expect(unbilledShares(idx, mine, true)).toHaveLength(unbilledShares(idx, mine).length + 1);
    expect(unbilledShares(index(SAMPLE, robin), mine, true)).toEqual(unbilledShares(index(SAMPLE, robin), mine));
  });

  it('a bill whose visit alone is private shows without the visit, or what the visit’s claims say of it', () => {
    const idx = index(MARKED, sam);
    const scope = events(MARKED).find((x) => x.person.id === sam && x.event.start === day)!;
    const bill = openBills(idx, events(MARKED).filter((x) => x.person.id === sam), TODAY).find((b) => b.event?.event.id === scope.event.id)!;
    expect(sharedOpen(idx, [bill])).toEqual([]);
    const cleared = { ...bill };
    delete cleared.private;
    expect([cleared.verdict, cleared.claimSays, cleared.saidBy]).toEqual(['matches', 9050, scope.event.claims.find((c) => c.provider === 'Example Endoscopy Center')!.record.id]);
    const shared = { ...cleared, claimSaysVisit: false, verdict: 'unmatched' };
    delete shared.event;
    delete shared.claimSays;
    delete shared.saidBy;
    expect(sharedOpen(idx, [cleared])).toEqual([shared]);
    // The same where medrec matched no claim, and where it matched one that is not private.
    const by = (claim: string | undefined) => {
      const said: OpenBill = { ...cleared };
      if (claim) said.saidBy = claim;
      else delete said.saidBy;
      return said;
    };
    const open = idx.records.find((r) => r.kind === 'claim' && !recordPrivate(idx, r.id))!.id;
    const of = (b: OpenBill) => [b.event, b.verdict, b.claimSays];
    expect(sharedOpen(idx, [by(undefined), by(open)]).map(of)).toEqual([
      [undefined, 'unmatched', undefined],
      [undefined, 'matches', 9050],
    ]);
    // Where medrec matched one and gives no share of it, the claims said are the visit's.
    const shareless = (claim: string) => {
      const was = index(MARKED, sam);
      const state = { ...was.bills!.states.get(cleared.bill.doc.id)!, claim };
      delete state.owed;
      return { ...was, bills: { ...was.bills!, states: new Map([...was.bills!.states, [cleared.bill.doc.id, state]]) } };
    };
    const asked = openBills(shareless(open), [scope], TODAY).find((b) => b.bill.doc.id === cleared.bill.doc.id)!;
    expect([asked.verdict, asked.claimSays, asked.saidBy]).toEqual(['matches', 9050, undefined]);
    delete asked.private;
    expect(sharedOpen(shareless(open), [asked]).map(of)).toEqual([[undefined, 'unmatched', undefined]]);
    const unbacked = { ...by(undefined), verdict: 'no_claim' as const };
    delete unbacked.claimSays;
    expect(sharedOpen(idx, [unbacked]).map((b) => b.verdict)).toEqual(['unmatched']);
    // Where the visit is not private, the same while a claim of it is, with the visit.
    const visit = { ...scope, event: { ...scope.event, claims: scope.event.claims.slice(1), fewerClaims: true as const } };
    delete visit.private;
    const whole = { ...visit, event: { ...scope.event, shared: visit.event } };
    expect([visit, asShared(whole), { ...visit, event: scope.event }].flatMap((event) => sharedOpen(idx, [{ ...unbacked, event }])).map((b) => [b.verdict, !!b.event])).toEqual([
      ['unmatched', true],
      ['unmatched', true],
      ['no_claim', true],
    ]);
    // A payment at that visit is listed for what its claims say alone, so it is not.
    const paid = { receipt: cleared.bill.doc, provider: 'Example', cents: 5000, claimSays: 2500, event: cleared.event! };
    expect([cleared.event!, visit, { ...visit, event: scope.event }].map((event) => sharedDesk([{ ...paid, event }]).length)).toEqual([0, 0, 1]);
  });

  it('a visit marked not private shows, though its records stay private', () => {
    const visit = eventOn(MARKED, sam, '2026-11-03');
    expect(eventPrivate(visit, index(MARKED, sam))).toBeUndefined();
    expect(shown(events(MARKED), undefined, false).events.some((x) => x.event.id === visit.id)).toBe(true);
    // Its claim does not: no share of it is listed, and Money neither dates nor links it.
    const claim = visit.claims[0]!.record.id;
    expect(recordPrivate(index(MARKED, sam), claim)).toBe('sexual_health');
    expect(unbilledShares(index(MARKED, sam), events(MARKED).filter((x) => x.person.id === sam)).find((u) => u.event.event.id === visit.id)!.private).toBe('sexual_health');
    expect(quietClaims(MARKED, TODAY).get(claim)).toBe('sexual_health');
    // On a shared screen it is medrec's own name and place for it, with nothing of those records: no amount, and not one of their names where medrec gives none.
    const row = (of: ReturnType<typeof events>) => shown(of, undefined, false).events.find((x) => x.event.id === visit.id)!;
    expect([row(events(MARKED)).event.title, row(events(MARKED)).event.place, row(events(MARKED)).money.share]).toEqual([visit.title, visit.place, undefined]);
    expect([row(events(MARKED)).event.claims, row(events(MARKED)).event.visits]).toEqual([[], []]);
    const idx = structuredClone(index(MARKED, sam));
    const given = idx.events!.events.find((e) => e.id === visit.id)!;
    delete given.what;
    delete given.place;
    const unnamed = row(householdEvents(MARKED.household, (p) => (p === sam ? idx : undefined), TODAY)).event;
    expect([unnamed.title, unnamed.place, unnamed.what]).toEqual([visit.title, undefined, undefined]);
    // Its own person's page, and a calendar that was told to show private items, have all of it.
    expect(shown(events(MARKED), sam, false).events.find((x) => x.event.id === visit.id)!.event).toEqual(visit);
    expect(shown(events(MARKED), undefined, true).events.find((x) => x.event.id === visit.id)!.event).toEqual(visit);
  });

  it('an open visit shows on a shared screen without a place a private paper says it is at', () => {
    const was = index(SAMPLE, robin).events!.events.find((e) => e.place && e.members.some((m) => m.document))!;
    const AT = 'Placeholder Practice';
    const claim = was.members.find((m) => m.kind === 'claim')!.record!;
    const place = (from: string, paper: string, organization = AT) => {
      const idx = structuredClone(index(SAMPLE, robin));
      if (idx.privacy?.kind !== 'known') throw new Error('not known');
      const [secret, open] = idx.documents.filter((d) => !was.members.some((m) => m.document === d.id));
      idx.privacy.documents.set(secret!.id, 'household');
      const raw = demoJson<{ events: { id: string }[]; aliases: object[] }>(eventsPath(robin));
      Object.assign(raw.events.find((e) => e.id === was.id)!, { place: AT, place_from: from });
      raw.aliases = [secret!, open!].filter((d) => paper === 'both' || (d === secret) === (paper === 'private')).map((d) => ({ clinician: 'Example', organization, rule: 'N5', document: d.id, confidence: 'likely' }));
      idx.events = parseMedrecEvents(raw, robin);
      const e = personEvents(idx, SAMPLE.household, TODAY).find((x) => x.id === was.id)!;
      const all = householdEvents(SAMPLE.household, (p) => (p === robin ? idx : undefined), TODAY);
      const page = providerPage({ household: SAMPLE.household, indexes: new Map([[robin, idx]]), today: TODAY, marks: [] }, { person: robin, id: claim, field: 'provider' }, true)!;
      const on = [asShared(all.find((x) => x.event.id === was.id)!), page.visits.find((v) => v.event.event.id === was.id)!.event];
      expect(on[1]!.event.place).toBe(on[0]!.event.place);
      return [e.place, on[0]!.event.place];
    };
    // On a shared screen the records name it, as they would had medrec given none.
    expect(place('alias', 'private')).toEqual([AT, was.place]);
    // One that says it is enough, whatever other paper does.
    expect(place('alias', 'both')).toEqual([AT, was.place]);
    expect([place('alias', 'open'), place('alias', 'private', 'Another practice'), place('portal', 'private')]).toEqual([
      [AT, AT],
      [AT, AT],
      [AT, AT],
    ]);
  });

  it('an open visit shows on a shared screen without its private parts, and as it is with none', () => {
    const all = (idx: PersonIndex) => personEvents(idx, SAMPLE.household, TODAY);
    const was = all(index(SAMPLE, robin));
    expect(was.every((e) => !e.shared)).toBe(true);
    const of = (e: CareEvent) => [...e.claims.map((c) => c.record.id), ...e.visits.map((v) => v.record.id), ...e.recorded.map((r) => r.id), ...e.papers.map((p) => p.doc.id)];
    const visit = was.find((e) => e.claims.length && e.visits.length && e.recorded.length && e.papers.length)!;
    for (const id of of(visit)) {
      const idx = structuredClone(index(SAMPLE, robin));
      if (idx.privacy?.kind !== 'known') throw new Error('not known');
      (id.startsWith('d_') ? idx.privacy.documents : idx.privacy.records).set(id, 'household');
      const event = all(idx).find((e) => e.id === visit.id)!;
      const { shared, ...own } = event;
      expect(own, id).toEqual(visit);
      // A record that is private takes the papers it links with it.
      expect(of(shared!), id).not.toContain(id);
      expect(of(visit).filter((x) => !of(shared!).includes(x)).every((x) => x === id || x.startsWith('d_')), id).toBe(true);
      expect(shared!.fewerClaims, id).toBe(visit.claims.some((c) => c.record.id === id) ? true : undefined);
      expect(all(idx).filter((e) => e.shared).map((e) => e.id), id).toEqual([visit.id]);
    }
  });

  it('a fill is as private as the record it is named for, whatever its event says', () => {
    const idx = structuredClone(index(SAMPLE, sam));
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    const fill = personEvents(idx, SAMPLE.household, TODAY).find((e) => e.kind === 'fill' && e.start === '2026-11-04')!;
    expect(idx.privacy.events.delete(fill.id)).toBe(true);
    expect(eventPrivate(fill, idx)).toBe('sexual_health');
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
    expect(own.filter((e) => eventPrivate(e, idx)).map((e) => [e.start, eventPrivate(e, idx), e.what])).toEqual([['2026-11-03', 'sexual_health', 'Clinic visit']]);
  });

  it('cannot tell a paper the household took out, so it stays off with its visit', () => {
    const idx = structuredClone(index(MARKED, sam));
    delete idx.events;
    const after = papersOf(idx, MARKED.household, TODAY, new Map([[sam, idx]])).find((p) => documentTitle(p.doc) === AFTER)!;
    expect(after.private).toBe('household');
  });
});

/** An index as a list from medrec 0.9.5 has it: `studies` and the papers private records link are medrec's own answer. */
function judged095(store: Store, person: string, lists: { documents?: Record<string, string>; studies?: Record<string, string>; unreported?: string[] } = {}): PersonIndex {
  const idx = structuredClone(index(store, person));
  if (idx.privacy?.kind !== 'known') throw new Error('not known');
  for (const [doc, area] of Object.entries(lists.documents ?? {})) idx.privacy.documents.set(doc, area);
  idx.privacy.studies = new Map(Object.entries(lists.studies ?? {}));
  idx.privacy.unreported = new Set(lists.unreported ?? []);
  idx.privacy.ties = false;
  return idx;
}

/** An index as a list from before medrec 0.9.5 has it: the sample's without its `studies`. */
function judged091(store: Store, person: string): PersonIndex {
  const idx = structuredClone(index(store, person));
  if (idx.privacy?.kind !== 'known') throw new Error('not known');
  idx.privacy.studies = null;
  idx.privacy.unreported = new Set();
  idx.privacy.ties = false;
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
    expect([paperPrivate(idx, eob), shownAs(idx, eob).private]).toEqual(['sexual_health', 'sexual_health']);
    const after = paper(SAMPLE, sam, AFTER).id;
    expect([paperPrivate(idx, after), shownAs(idx, after).with?.how]).toEqual([undefined, 'event']);
    link(idx, isPrivate('medication'), after);
    expect([paperPrivate(idx, after), shownAs(idx, after).private]).toEqual(['sexual_health', 'sexual_health']);
  });

  it('is private whatever else links it', () => {
    const idx = judged091(SAMPLE, sam);
    const eob = added(idx);
    link(idx, record(SAMPLE, sam, (r) => r.kind === 'allergy').id, eob);
    expect(paperPrivate(idx, eob)).toBeUndefined();
    link(idx, isPrivate('medication'), eob);
    expect(paperPrivate(idx, eob)).toBe('sexual_health');
  });

  it('is not when the household marked it not private: from a visit it made private, or in a list from 0.9.5', () => {
    const marked = structuredClone(index(MARKED, sam));
    const after = paper(MARKED, sam, AFTER).id;
    link(marked, eventOn(MARKED, sam, '2026-09-16').claims[0]!.record.id, after);
    expect([takenOut(marked, after), paperPrivate(marked, after)]).toEqual([true, undefined]);

    const later = judged095(SAMPLE, sam);
    const eob = added(later);
    expect(takenOut(later, eob)).toBe(false);
    link(later, isPrivate('claim'), eob);
    expect([takenOut(later, eob), paperPrivate(later, eob)]).toEqual([true, undefined]);
    // Its visit stays private, so the paper shows without it.
    const p = shownAs(later, eob);
    expect([p.private, p.with?.how, p.with?.private]).toEqual([undefined, 'claim', 'sexual_health']);
    expect(billPrivate(later, later.documents.find((d) => d.id === eob)!, events(SAMPLE).find((x) => x.person.id === sam && x.private)!)).toBeUndefined();
    expect(paperPrivate(judged095(SAMPLE, sam, { documents: { [eob]: 'sexual_health' } }), eob)).toBe('sexual_health');
  });

  it('is not when the record is one the household marked not private, though its visit is private', () => {
    const idx = judged091(MARKED, sam);
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    const claim = eventOn(MARKED, sam, '2026-09-16').claims[0]!.record.id;
    const eob = added(idx);
    link(idx, claim, eob);
    expect(shownAs(idx, eob).private).toBe('household');
    expect(idx.privacy.records.delete(claim)).toBe(true);
    expect([shownAs(idx, eob).private, shownAs(idx, eob).with?.private]).toEqual([undefined, 'household']);
  });

  it('makes its visit private in the app’s own grouping', () => {
    const idx = judged091(SAMPLE, sam);
    delete idx.events;
    const after = paper(SAMPLE, sam, AFTER).id;
    const holds = () => personEvents(idx, SAMPLE.household, TODAY).find((e) => e.papers.some((p) => p.doc.id === after));
    const e = holds();
    if (!e) throw new Error('the app’s own grouping puts it with no visit');
    expect(eventPrivate(e, idx)).toBeUndefined();
    link(idx, isPrivate('medication'), after);
    expect(eventPrivate(e, idx)).toBe('sexual_health');
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
    const meds = record(SAMPLE, sam, (r) => r.kind === 'medication' && /emtricitabine/i.test(r.display));
    expect(studyPrivate(idx, { ...study, report: meds.id })).toBe('sexual_health');
    expect(studyPrivate(idx, { ...study, report: 'd_notfiledyetxxxxxxxxxx' })).toBe(HELD);
    idx.records.find((r) => r.id === meds.id)!.documents.push(note.id);
    expect(studyPrivate(idx, { ...study, report: note.id })).toBe('sexual_health');
  });
});

describe('another person’s paper in a visit (X2), and a visit linked to another’s (X1)', () => {
  const drew = id('Drew Example');
  /** Drew's paper in Robin's newest visit with a claim and a paper, and what can be changed of each. */
  function shared(type = 'letter') {
    const [parent, child] = [structuredClone(index(SAMPLE, robin)), structuredClone(index(SAMPLE, drew))];
    const doc = child.documents.find((d) => d.doc_type === 'letter')!;
    doc.doc_type = type;
    for (const e of child.events!.events) e.members = e.members.filter((m) => m.document !== doc.id);
    const visit = parent.events!.events.find((e) => e.members.some((m) => m.kind === 'claim') && e.members.some((m) => m.document))!;
    visit.members.push({ ...visit.members.find((m) => m.document)!, document: doc.id, person: drew, rule: 'X2' as MedrecRule });
    parent.events!.others = new Map([[drew, child]]);
    const all = new Map([...SAMPLE.indexes, [robin, parent], [drew, child]]);
    if (child.privacy?.kind !== 'known' || parent.privacy?.kind !== 'known') throw new Error('not known');
    return {
      parent,
      child,
      doc,
      visit,
      all,
      privacy: { parent: parent.privacy, child: child.privacy },
      event: () => personEvents(parent, SAMPLE.household, TODAY).find((e) => e.id === visit.id)!,
      listed: () => papersOf(child, SAMPLE.household, TODAY, all).find((x) => x.doc.id === doc.id)!,
      everyone: () => sharedPapers(SAMPLE.household, all, TODAY).find((x) => x.doc.id === doc.id),
    };
  }
  const ids = (e: CareEvent) => e.papers.map((p) => p.doc.id);

  it('the paper is in the visit, and with it, while it is not private', () => {
    const s = shared();
    expect(s.event().papers.find((p) => p.doc.id === s.doc.id)).toMatchObject({ person: drew });
    expect([s.listed().private, s.listed().with?.event.id, s.everyone()?.with?.event.id]).toEqual([undefined, s.visit.id, s.visit.id]);
  });

  it('a private one is in none of the visit, on the visit’s own person’s pages too, and stays with it on its own person’s', () => {
    for (const held of [false, true]) {
      const s = shared('bill');
      const was = s.event();
      expect(ids(was)).toContain(s.doc.id);
      expect(eventOf(personEvents(s.parent, SAMPLE.household, TODAY), s.doc.id)?.id).toBe(s.visit.id);
      const marked = { ...s.privacy.child, documents: new Map([[s.doc.id, 'household']]) };
      if (held) delete s.child.privacy;
      else s.child.privacy = marked;
      const e = s.event();
      expect(ids(e)).toEqual(ids(was).filter((x) => x !== s.doc.id));
      expect(JSON.stringify(e)).not.toContain(s.doc.id);
      expect(ids(sharedForm(e))).not.toContain(s.doc.id);
      expect(eventOf(personEvents(s.parent, SAMPLE.household, TODAY), s.doc.id)).toBeUndefined();
      expect([s.listed().with?.event.id, s.listed().with?.person, s.listed().with?.private, s.everyone()]).toEqual([s.visit.id, robin, undefined, undefined]);
      // With the list there again, or the mark gone, it is back.
      s.child.privacy = s.privacy.child;
      expect(ids(s.event())).toEqual(ids(was));
    }
  });

  it('one of a person whose index is not here, or that their index does not have, is not shown', () => {
    const gone = shared();
    gone.parent.events!.others = new Map();
    expect(ids(gone.event())).not.toContain(gone.doc.id);
    const missing = shared();
    missing.child.documents = missing.child.documents.filter((d) => d.id !== missing.doc.id);
    expect(ids(missing.event())).not.toContain(missing.doc.id);
  });

  it('a visit with nothing else is not there', () => {
    const s = shared();
    s.visit.members = s.visit.members.filter((m) => m.person);
    expect(s.event().papers).toHaveLength(1);
    s.child.privacy = { ...s.privacy.child, documents: new Map([[s.doc.id, 'household']]) };
    expect(s.event()).toBeUndefined();
  });

  it('another person’s private visit is not named with a paper of this person’s, whose line says no more than with none', () => {
    const s = shared();
    const none = (() => {
      const without = shared();
      without.visit.members = without.visit.members.filter((m) => !m.person);
      return without.listed();
    })();
    expect(none).toMatchObject({ why: 'No visit of this person’s is on or near Dec 16, 2025.' });
    s.privacy.parent.events.set(s.visit.id, 'household');
    expect([s.listed().with, s.listed().why, s.listed().private]).toEqual([undefined, none.why, undefined]);
    // Nor one of a person whose items nothing judges.
    const held = shared();
    delete held.parent.privacy;
    expect([held.listed().with, held.listed().why]).toEqual([undefined, none.why]);
  });

  it('another person’s open visit is named as a shared screen names it', () => {
    const s = shared();
    const claim = s.visit.members.find((m) => m.kind === 'claim')!.record!;
    expect(s.event().shared).toBeUndefined();
    s.privacy.parent.records.set(claim, 'household');
    s.parent.privacy = { ...s.privacy.parent };
    const own = s.event();
    expect(own.shared).toBeDefined();
    expect(s.listed().with?.event).toBe(own.shared);
    expect(papersOf(s.parent, SAMPLE.household, TODAY, s.all).find((x) => x.with?.event.id === s.visit.id)!.with!.event).toBe(own);
  });

  it('a place that is a linked visit’s is left out, on its own person’s pages too, where that visit is private or not known not to be', () => {
    const AT = 'Placeholder Hospital';
    const at = personEvents(index(SAMPLE, drew), SAMPLE.household, TODAY).find((e) => e.visits.some((v) => v.record.fields.location))!.id;
    const place = (change: (parent: PersonIndex, stay: { id: string; members: { record?: string; document?: string; person?: string }[]; placeFrom?: MedrecEvent['placeFrom'] }, e: { links?: object[]; place_from: string }) => void, from = 'linked') => {
      const [parent, child] = [structuredClone(index(SAMPLE, robin)), structuredClone(index(SAMPLE, drew))];
      const stay = parent.events!.events.find((e) => e.members.some((m) => m.kind === 'claim'))!;
      const raw = demoJson<{ events: { id: string; members: { kind: string }[] }[] }>(eventsPath(drew));
      const e = Object.assign(raw.events.find((x) => x.id === at)!, { place: AT, place_from: from, links: [{ event: stay.id, person: robin, relation: 'born_during' }] as object[] | undefined });
      change(parent, stay, e as { links?: object[]; place_from: string });
      child.events = parseMedrecEvents(raw, drew);
      child.events.others = new Map([[robin, parent]]);
      return personEvents(child, SAMPLE.household, TODAY).find((x) => x.id === e.id)!.place;
    };
    const known = (p: PersonIndex) => {
      if (p.privacy?.kind !== 'known') throw new Error('not known');
      return p.privacy;
    };
    const none = undefined;
    // Its own records would name one, had medrec given none.
    expect(place((_, __, e) => Object.assign(e, { place: undefined }))).toMatch(/^Example /);
    expect(place(() => {})).toBe(AT);
    expect(place((p, s) => known(p).events.set(s.id, 'household'))).toBe(none);
    expect(place((p, s) => known(p).records.set(s.members.find((m) => m.record)!.record!, 'household'))).toBe(none);
    const paper = (person?: string) =>
      place((p, s) => {
        s.members.push({ document: p.documents[0]!.id, ...(person ? { person } : {}) });
        known(p).documents.set(p.documents[0]!.id, 'household');
      });
    // A private paper of theirs too, and not one of another person's.
    expect([paper(), paper(drew)]).toEqual([none, AT]);
    expect(place((p) => delete p.privacy)).toBe(none);
    expect(place((p, s) => ((s.members = []), delete p.privacy))).toBe(none);
    expect(place((p, s) => (p.events!.events = p.events!.events.filter((x) => x.id !== s.id)))).toBe(none);
    expect(place((p) => delete p.events)).toBe(none);
    expect(place((_, __, e) => delete e.links)).toBe(none);
    expect(place((_, s, e) => (e.links = [{ event: s.id, person: 'p_aaaaaaaaaaaaaaaaaaaa', relation: 'born_during' }]))).toBe(none);
    // Only a stay whose own place is its portal's or its claims' has a claim that gives it.
    expect([place((_, s) => (s.placeFrom = 'portal')), place((_, s) => (s.placeFrom = 'claims'))]).toEqual([AT, AT]);
    expect([place((_, s) => (s.placeFrom = 'alias')), place((_, s) => (s.placeFrom = 'linked')), place((_, s) => delete s.placeFrom)]).toEqual([none, none, none]);
    // Any of several, as which gave it is not said.
    const another = (relation: string) =>
      place((p, s, e) => {
        const second = p.events!.events.find((x) => x.id !== s.id)!.id;
        e.links!.push({ event: second, person: robin, relation });
        known(p).events.set(second, 'household');
      });
    expect(another('born_during')).toBe(none);
    // A relation the app does not know says nothing of the place.
    expect(another('later')).toBe(AT);
    // One its own records give is its own.
    expect(place((p, s) => known(p).events.set(s.id, 'household'), 'portal')).toBe(AT);
  });
});

describe('search', () => {
  it('leaves private items out of everyone’s results, and finds them for their person', () => {
    const scope = [...SAMPLE.indexes.values()].map((i) => ({ person: i.person, index: i, text: null }));
    const clear = scope.map((s) => ({ ...s, leave: (kind: string, item: string) => !!itemPrivate(s.index, kind, item) }));
    const names = (people: typeof scope, q: string) => find(people, q).hits.map((h) => h.title);
    expect(names(scope, 'emtricitabine').length).toBe(2);
    expect(names(clear, 'emtricitabine')).toEqual([]);
    expect(names(clear, 'my meds')).not.toContain('Emtricitabine-tenofovir 200-300 mg tablet');
    expect(names(scope, 'my meds')).toContain('Emtricitabine-tenofovir 200-300 mg tablet');
    expect(names(clear, 'lisinopril')).toEqual(names(scope, 'lisinopril'));
  });
});

it('lays a case over the sample with the MD5s its files have', () => {
  const m = JSON.parse(manifestWith(privateCase('unreadable'))) as { files: string[] };
  expect(m.files).toContain('Sam Example/marks.json');
});
