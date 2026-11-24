// medrec's events.json (medrec 0.9.0) read into the app's events: what the
// reader keeps and drops, when the store trusts the file (freshness by MD5,
// as the data contract has readers decide it), how members become claims,
// visits, records and papers, and the app's own grouping without them.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { DemoFolder } from '../src/folder';
import { eventsView, parseMedrecEvents } from '../src/model/events';
import { FolderError, parseIndex } from '../src/model/parse';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { eventOf, nameEvent, ruleText, type CareEvent } from '../src/next/event';
import { groupedByMedrec, personEvents } from '../src/next/load';
import { fromMedrec } from '../src/next/medrecEvents';
import { demo, demoEventsNotes, personNamed } from './demo-data';
import { demoFetch, demoJson, fixture } from './helpers';

const TODAY = '2026-11-22';
const ANCHOR = new Date(demoJson<{ anchor: string }>('manifest.json').anchor);
const { household, indexes } = demo();
const id = (name: string) => personNamed(household, name).id;
const folderOf = (name: string) => personNamed(household, name).folder;
const events = (name: string) => personEvents(indexes.get(id(name))!, household, TODAY);
const ODD = 'p_aaaaaaaaaaaaaaaaaaaa';

/** The sample loaded by a store, with each file the folder serves (manifest.json among them) passed through `change`; null serves none. */
async function loadWith(change: (path: string, text: string) => string | null): Promise<Store> {
  const files = demoFetch();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const res = await files(input);
    if (!res.ok) return res;
    const text = change(decodeURIComponent(String(input).replace(/^\/app\/demo\//, '')), await res.text());
    return text === null ? new Response('not found', { status: 404 }) : new Response(text, { status: 200 });
  }) as typeof fetch;
  const store = new Store(new DemoFolder('/app/demo/', fetchImpl, ANCHOR));
  await store.load();
  return store;
}

/** The manifest with the MD5 of each named file changed: as if the folder held another version of it. */
const otherMd5 = (...paths: string[]) => (path: string, text: string) => {
  if (path !== 'manifest.json') return text;
  const m = JSON.parse(text) as { md5: Record<string, string> };
  for (const p of paths) m.md5[p] = '0'.repeat(32);
  return JSON.stringify(m);
};

const eventsPath = (pid: string) => `views/${pid}/${eventsView(demoJson('views/views.json'), pid)!.name}`;
const grouped = (store: Store) => Object.fromEntries(household.people.map((p) => [p.name, groupedByMedrec(store.index(p.id)!)]));

describe('reading events.json', () => {
  it('finds each person’s events, and the MD5s medrec wrote them from, in views.json', () => {
    const views = demoJson<{ household: string; people: Record<string, { index: string }> }>('views/views.json');
    const sam = eventsView(views, id('Sam Example'))!;
    expect(sam.name).toMatch(/^events\.[0-9a-f]{12}\.json$/);
    expect([sam.household, sam.index]).toEqual([views.household, views.people[id('Sam Example')]!.index]);
    expect(sam.overrides).toBeNull();
    // Jamie's events read their parents' records too.
    expect([...eventsView(views, id('Jamie Example'))!.linked.keys()].sort()).toEqual([id('Robin Example'), id('Sam Example')].sort());
    expect(eventsView(views, 'p_nobody')).toBeUndefined();
    expect(eventsView({ schema: 'medrec-views/v1', people: {} }, id('Sam Example'))).toBeUndefined();
    expect(eventsView(null, id('Sam Example'))).toBeUndefined();
  });

  it('refuses a later schema as newer, and another person’s file as malformed', () => {
    const kind = (raw: unknown, person: string) => {
      try {
        parseMedrecEvents(raw, person);
      } catch (e) {
        return e instanceof FolderError ? e.kind : 'other';
      }
      return 'read';
    };
    expect(kind({ schema: 'medrec-events/v2', person: ODD, events: [] }, ODD)).toBe('newer_format');
    expect(kind({ schema: 'medrec-index/v1', person: ODD, events: [] }, ODD)).toBe('malformed');
    expect(kind(fixture('events/odd.json'), 'p_someone_else')).toBe('malformed');
    expect(kind(fixture('events/odd.json'), ODD)).toBe('read');
  });

  it('drops an event without an id or a day, and a member naming both a record and a paper; ignores fields it does not know', () => {
    const file = parseMedrecEvents(fixture('events/odd.json'), ODD);
    expect(file.events.map((e) => e.id)).toEqual(['e_aaaaaaaaaaaaaaaaaaaa', 'e_cccccccccccccccccccc']);
    const e = file.events[0]!;
    expect(e.members.map((m) => m.record ?? m.document)).toEqual(['r_known', 'r_gone', 'd_known', 'd_other']);
    expect(e.members[2]!.confidence).toBe('unsure');
    expect(e.members[3]!.person).toBe('p_bbbbbbbbbbbbbbbbbbbb');
    expect(e.expected).toEqual([{ what: 'claim', why: 'No claim filed yet.', since: '2026-01-05' }]);
    expect(e.could_join).toEqual(['e_bbbbbbbbbbbbbbbbbbbb', 'e_cccccccccccccccccccc']);
  });
});

describe('when the store uses medrec’s events', () => {
  it('uses every person’s in the sample, whose files are the ones medrec wrote them from', () => {
    for (const p of household.people) expect(groupedByMedrec(indexes.get(p.id)!)).toBe(true);
    expect([...demoEventsNotes]).toEqual([]);
    expect(events('Sam Example').every((e) => e.id.startsWith('e_'))).toBe(true);
  });

  it('groups a person’s records itself when medrec wrote their events from an older index, and so for the people linked to them', async () => {
    // Robin imported since: Robin's events are behind, and so are the children's, which read their parents' records.
    const store = await loadWith(otherMd5(`${folderOf('Robin Example')}/index.json`));
    expect(grouped(store)).toEqual({ 'Robin Example': false, 'Sam Example': true, 'Alex Example': false, 'Jamie Example': false });
    expect(store.eventsNotes.get(id('Robin Example'))).toEqual({
      kind: 'behind',
      text: 'medrec’s grouping of these visits is older than their records. The app groups them itself. medrec writes it again after its next import or refresh.',
    });
    expect(store.eventsNotes.get(id('Jamie Example'))?.kind).toBe('behind');
    // Robin's newest visit is still there, from the app's own grouping.
    expect(personEvents(store.index(id('Robin Example'))!, store.household, TODAY)[0]!.id).toMatch(/^r_/);
  });

  it('is behind on a changed household.json, text.json or overrides.json too', async () => {
    const sam = folderOf('Sam Example');
    expect(grouped(await loadWith(otherMd5('household.json')))).toEqual({ 'Robin Example': false, 'Sam Example': false, 'Alex Example': false, 'Jamie Example': false });
    for (const f of [`${sam}/text.json`]) expect((await loadWith(otherMd5(f))).eventsNotes.get(id('Sam Example'))?.kind).toBe('behind');
    // Sam has no overrides.json: one that appears is a decision medrec has not applied yet.
    const decided = await loadWith((path, text) => {
      if (path !== 'manifest.json') return text;
      const m = JSON.parse(text) as { files: string[]; md5: Record<string, string> };
      m.files.push(`${sam}/overrides.json`);
      m.md5[`${sam}/overrides.json`] = 'f'.repeat(32);
      return JSON.stringify(m);
    });
    expect(decided.eventsNotes.get(id('Sam Example'))?.kind).toBe('behind');
  });

  it('waits for an events file still arriving, and says when one cannot be read or is newer', async () => {
    const sam = id('Sam Example');
    const arriving = await loadWith(otherMd5(eventsPath(sam)));
    expect(arriving.eventsNotes.get(sam)).toEqual({ kind: 'arriving', text: 'medrec is still writing the grouping of these visits. The app groups them itself.' });
    expect((await loadWith((path, text) => (path === eventsPath(sam) ? null : text))).eventsNotes.get(sam)?.kind).toBe('arriving');

    const broken = await loadWith((path, text) => (path === eventsPath(sam) ? '{"schema": ' : text));
    expect(broken.eventsNotes.get(sam)).toEqual({ kind: 'unreadable', text: `medrec’s grouping of these visits could not be read: ${eventsPath(sam)} is not valid JSON. The app groups them itself.` });
    expect(groupedByMedrec(broken.index(sam)!)).toBe(false);

    const newer = await loadWith((path, text) => (path === eventsPath(sam) ? JSON.stringify({ ...JSON.parse(text), schema: 'medrec-events/v2' }) : text));
    expect(newer.eventsNotes.get(sam)?.kind).toBe('newer_format');
    expect(newer.eventsNotes.get(sam)?.text).toContain('in a newer format (medrec-events/v2) than this app reads');
  });

  it('groups everyone’s itself, and says so, when the folder gives no MD5 or views.json cannot be read', async () => {
    const unchecked = await loadWith((path, text) => (path === 'manifest.json' ? JSON.stringify({ ...JSON.parse(text), md5: undefined }) : text));
    expect([...unchecked.eventsNotes.values()].map((n) => n.kind)).toEqual(['unchecked', 'unchecked', 'unchecked', 'unchecked']);

    const noViews = await loadWith((path, text) => (path === 'views/views.json' ? 'not json' : text));
    expect(noViews.viewsError).toBe('medrec’s views could not be read (views/views.json is not valid JSON.). The app groups each person’s visits itself.');
    expect(Object.values(grouped(noViews))).toEqual([false, false, false, false]);
    expect(noViews.indexErrors.size).toBe(0);
  });

  it('shows another person’s paper in an event, from their index (X2)', async () => {
    const jamie = id('Jamie Example');
    const robinPaper = indexes.get(id('Robin Example'))!.documents[0]!;
    const store = await loadWith((path, text) => {
      if (path !== eventsPath(jamie)) return text;
      const file = JSON.parse(text) as { events: { members: unknown[] }[] };
      file.events[0]!.members.push({ document: robinPaper.id, person: id('Robin Example'), kind: robinPaper.doc_type, role: 'paper', rule: 'X2', confidence: 'likely' });
      return JSON.stringify(file);
    });
    const [first] = personEvents(store.index(jamie)!, store.household, TODAY);
    expect(first!.papers.map((p) => [p.doc.id, p.person])).toContainEqual([robinPaper.id, id('Robin Example')]);
    expect(ruleText(first!.papers.find((p) => p.person)!.rule)).toBe('A paper filed under someone else, dated before their birth');
  });
});

describe('medrec’s events as the app’s', () => {
  it('sorts each member into the visit’s claims, portal visits, records and papers', () => {
    const er = events('Sam Example').find((e) => e.kind === 'er')!;
    expect([er.start, er.end, er.title, er.place]).toEqual(['2026-09-12', '2026-09-13', 'Emergency room', 'Example General Hospital']);
    expect(er.claims.map((c) => c.role)).toEqual(['facility', 'hospital', 'ancillary', 'ancillary', 'ancillary']);
    expect(er.papers.map((p) => p.doc.title)).toEqual(['Emergency department discharge instructions', 'Statement from Example General Hospital']);
    expect(ruleText(er.claims[0]!.rule)).toBe('The hospital’s own claim, over its dates');
    // Any record of the visit opens it.
    expect(eventOf(events('Sam Example'), er.claims[2]!.record.id)).toBe(er);
  });

  it('names a fill from the pharmacy’s record when no claim came with it, and keeps what medrec still expects', () => {
    const fill = events('Sam Example').find((e) => e.start === '2026-10-29')!;
    expect([fill.kind, fill.title, fill.claims.length, fill.recorded.map((r) => r.kind)]).toEqual(['fill', 'Vitamin D3 2,000 unit capsule', 0, ['medication']]);
    const robinVisit = events('Robin Example').find((e) => e.start === '2026-11-18')!;
    expect(robinVisit.expected).toEqual([{ what: 'bill', why: 'No bill filed yet.', since: '2026-11-18' }]);
    expect(robinVisit.what).toBe('Blood pressure follow-up');
  });

  it('makes a portal stay with no claim a hospital stay', () => {
    const birth = events('Jamie Example').find((e) => e.visits.some((v) => v.record.display === 'Birth hospital stay'))!;
    expect([birth.kind, birth.title, birth.place]).toEqual(['stay', 'Birth hospital stay', 'Example Health Birth Center']);
  });

  it('leaves out a member the index no longer has, names a kind it does not know by medrec’s title, and says why an unsure one is unsure', () => {
    const sam = indexes.get(id('Sam Example'))!;
    const visit = sam.records.find((r) => r.kind === 'encounter' && r.display)!;
    const [doc, other] = [sam.documents[0]!, sam.documents[1]!];
    const index: PersonIndex = {
      ...parseIndex({ schema: 'medrec-index/v1', person: ODD, rev: 1, documents: [], records: [], studies: [], imports: [] }, ODD),
      records: [{ ...visit, id: 'r_known' }],
      documents: [{ ...doc, id: 'd_known' }, { ...doc, id: 'd_paper' }],
    };
    const file = parseMedrecEvents(fixture('events/odd.json'), ODD);
    file.papers.set('d_other', { person: 'p_bbbbbbbbbbbbbbbbbbbb', doc: { ...other, id: 'd_other' } });
    const [withVisit, papersOnly] = fromMedrec(file, index, household);
    // The portal's own name for the visit comes first; medrec's title names a kind the app does not know.
    expect([withVisit!.kind, withVisit!.title, withVisit!.place, withVisit!.visits.length, withVisit!.recorded.length]).toEqual(['service', visit.display, 'Example Clinic', 1, 0]);
    expect(withVisit!.papers.map((p) => [p.doc.id, p.person])).toEqual(expect.arrayContaining([['d_known', undefined], ['d_other', 'p_bbbbbbbbbbbbbbbbbbbb']]));
    expect(withVisit!.doubt).toBe('It could be part of any of 2 other visits');
    expect(ruleText(withVisit!.papers.find((p) => p.doc.id === 'd_known')!.rule)).toBe('medrec’s rule D9');
    expect([papersOnly!.kind, papersOnly!.title]).toEqual(['service', 'Video visit']);
  });
});

describe('naming an event', () => {
  const sam = () => indexes.get(id('Sam Example'))!;
  const blank = (kind: CareEvent['kind']): CareEvent => ({ id: 'x', kind, start: '2026-01-01', end: '2026-01-01', title: '', claims: [], visits: [], recorded: [], papers: [] });
  const medication = () => sam().records.find((r): r is MedRecord => r.kind === 'medication' && !!r.display)!;

  it('names a fill or a vaccine known only from the portal for what it was, and one with a claim from the claim', () => {
    const fill = blank('fill');
    fill.recorded.push(medication());
    nameEvent(fill, household, id('Sam Example'));
    expect(fill.title).toBe(medication().display);

    const claimed = events('Robin Example').find((e) => e.kind === 'fill' && e.claims.length)!;
    const again = { ...blank('fill'), claims: claimed.claims, recorded: [medication()] };
    nameEvent(again, household, id('Robin Example'));
    expect(again.title).toBe(claimed.title);
  });

  it('never meets a claimless fill or vaccine in the app’s own grouping, which makes them only from claims', () => {
    for (const p of household.people) {
      const own = personEvents(parseIndex(demoJson(`${p.folder}/index.json`), p.id), household, TODAY);
      expect(own.filter((e) => (e.kind === 'fill' || e.kind === 'vaccine') && !e.claims.length)).toEqual([]);
    }
  });
});

describe('a folder without events.json', () => {
  it('groups the person’s records in the app, as before', () => {
    const p = personNamed(household, 'Sam Example');
    const index = parseIndex(demoJson(`${p.folder}/index.json`), p.id);
    expect(groupedByMedrec(index)).toBe(false);
    const own = personEvents(index, household, TODAY);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => e.id.startsWith('r_'))).toBe(true);
    expect(own.find((e) => e.kind === 'er')?.claims).toHaveLength(5);
  });
});
