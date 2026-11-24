// medrec's events.json (medrec 0.9.0) read into the app's events: what the
// reader keeps and drops, when the store trusts the file (freshness by MD5,
// as the data contract has readers decide it), how members become claims,
// visits, records and papers, and the app's own grouping without them.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { DemoFolder } from '../src/folder';
import { parseMedrecEvents } from '../src/model/events';
import { viewOf } from '../src/model/views';
import { FolderError, parseIndex } from '../src/model/parse';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { doseCount, eventOf, eventPrivate, nameEvent, ruleText, type CareEvent } from '../src/next/event';
import { groupedByMedrec, personEvents } from '../src/next/load';
import { claimLines } from '../src/model/claims';
import { careEvents } from '../src/next/grouping';
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

const eventsPath = (pid: string) => `views/${pid}/${viewOf(demoJson('views/views.json'), pid, 'events.json')!.name}`;
const grouped = (store: Store) => Object.fromEntries(household.people.map((p) => [p.name, groupedByMedrec(store.index(p.id)!)]));

describe('reading events.json', () => {
  it('finds each person’s events, and the MD5s medrec wrote them from, in views.json', () => {
    const views = demoJson<{ household: string; people: Record<string, { index: string }> }>('views/views.json');
    const sam = viewOf(views, id('Sam Example'), 'events.json')!;
    expect(sam.name).toMatch(/^events\.[0-9a-f]{12}\.json$/);
    expect([sam.household, sam.index]).toEqual([views.household, views.people[id('Sam Example')]!.index]);
    expect(sam.overrides).toBeNull();
    // Jamie's events read their parents' records too.
    expect([...viewOf(views, id('Jamie Example'), 'events.json')!.linked.keys()].sort()).toEqual([id('Robin Example'), id('Sam Example')].sort());
    expect(viewOf(views, 'p_nobody', 'events.json')).toBeUndefined();
    expect(viewOf({ schema: 'medrec-views/v1', people: {} }, id('Sam Example'), 'events.json')).toBeUndefined();
    expect(viewOf(null, id('Sam Example'), 'events.json')).toBeUndefined();
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
    const knee = events('Sam Example').find((e) => e.kind === 'outpatient')!;
    expect([knee.start, knee.end, knee.title, knee.place]).toEqual(['2026-08-26', '2026-08-26', 'Hospital visit', 'Example Surgery Center']);
    expect(knee.claims.map((c) => c.role)).toEqual(['facility', 'ancillary', 'service', 'service', 'service']);
    expect(knee.papers.map((p) => p.doc.title)).toEqual(['Statement from Example Surgery Center', 'Going home after knee surgery']);
    expect(ruleText(knee.claims[0]!.rule)).toBe('The hospital’s own claim, over its dates');
    // Any record of the visit opens it.
    expect(eventOf(events('Sam Example'), knee.claims[2]!.record.id)).toBe(knee);
  });

  it('names a fill from the pharmacy’s record when no claim came with it, and keeps what medrec still expects', () => {
    const fill = events('Sam Example').find((e) => e.start === '2026-10-25')!;
    expect([fill.kind, fill.title, fill.claims.length, fill.recorded.map((r) => r.kind)]).toEqual(['fill', 'Loratadine 10 mg tablet', 0, ['medication']]);
    const robinVisit = events('Robin Example').find((e) => e.start === '2026-11-18')!;
    expect(robinVisit.expected).toEqual([{ what: 'bill', why: 'No bill filed yet.', since: '2026-11-18' }]);
    expect(robinVisit.what).toBe('Blood pressure follow-up');
  });

  it('makes a portal stay with no claim a hospital stay', () => {
    const birth = events('Jamie Example').find((e) => e.visits.some((v) => v.record.display === 'Birth hospital stay'))!;
    expect([birth.kind, birth.title, birth.what, birth.place]).toEqual(['stay', 'Hospital stay', 'Birth', 'Example Health Birth Center']);
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
    // medrec's title names a kind the app does not know, and its `what` says what it was.
    expect([withVisit!.kind, withVisit!.title, withVisit!.what, withVisit!.place, withVisit!.visits.length, withVisit!.recorded.length]).toEqual(['service', 'Video visit', 'Follow-up', 'Example Clinic', 1, 0]);
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

  it('heads a visit with its kind, says what it was in plain words, and keeps a billing descriptor for Details', () => {
    const visit = events('Robin Example').find((e) => e.start === '2025-03-10')!;
    expect([visit.title, visit.what, visit.place, visit.descriptors]).toEqual(['Office visit', 'Annual physical', 'Example Health Main Clinic', ['YEARLY EXAM RETURNING ADULT']]);
    // Named again once its records say it plainly, it keeps no descriptor.
    const again = structuredClone(visit);
    again.visits[0]!.record.display = 'Yearly checkup';
    nameEvent(again, household, id('Robin Example'));
    expect([again.what, again.descriptors]).toEqual(['Yearly checkup', undefined]);
  });

  it('makes a day of vaccine claims a vaccine visit named for its dose, as the app’s own grouping does', () => {
    // medrec files the claim's day as a service, with the portal's record of the dose.
    const shot = events('Alex Example').find((e) => e.start === '2025-10-20')!;
    expect([shot.kind, shot.title, shot.what, shot.place]).toEqual(['vaccine', 'Influenza, seasonal, injectable', undefined, 'Example Pediatrics']);
    // Without medrec, the dose's record is not in the event: the claim names it, without its line for giving it.
    const own = careEvents(indexes.get(id('Alex Example'))!, household, TODAY).find((e) => e.start === '2025-10-20')!;
    expect([own.kind, own.title]).toEqual(['vaccine', 'Flu vaccine']);
    // A claim for two vaccines is two doses.
    const line = claimLines(own.claims[0]!.record)[0]!;
    const two = structuredClone(own);
    const items = two.claims[0]!.record.fields.items as Record<string, unknown>[];
    items.push({ ...structuredClone(items[0]!), sequence: 9, service: { system: line.system, code: '91320', display: 'COVID-19 vaccine' } });
    nameEvent(two, household, id('Alex Example'));
    expect([doseCount(two), two.title]).toEqual([2, '2 vaccines']);
  });

  it('says what a visit was in the first words that say more than its title', () => {
    const said = (list: CareEvent[], day: string) => list.find((e) => e.start === day && e.kind !== 'tests')!.what;
    const own = (name: string) => careEvents(indexes.get(id(name))!, household, TODAY);
    // The portal calls each of these "Office visit": medrec's words, else the portal's reason.
    expect(['2025-09-15', '2026-10-01', '2026-11-18'].map((day) => said(events('Robin Example'), day))).toEqual(['Follow-up visit', 'Annual physical', 'Blood pressure follow-up']);
    expect(['2025-09-15', '2026-10-01', '2026-11-18'].map((day) => said(own('Robin Example'), day))).toEqual(['Follow-up', 'Annual physical', 'Blood pressure follow-up']);
    // medrec's words, unless they are the title again: then the claims say it.
    expect(said(events('Sam Example'), '2026-08-26')).toBe('Knee scope, one side and Antibiotic during surgery');
    const knee = structuredClone(events('Sam Example').find((e) => e.start === '2026-08-26')!);
    nameEvent(knee, household, id('Sam Example'), { what: knee.title });
    expect(knee.what).toBe('Knee scope, one side and antibiotic during surgery');
    // medrec's words come before the portal's name for the visit ("Sick visit").
    expect(said(events('Alex Example'), '2026-11-20')).toBe('Ear pain');
  });

  it('calls a private visit by the portal’s name for it, not the reason', () => {
    const counseling = events('Sam Example').find((e) => e.start === '2026-10-27')!;
    expect([eventPrivate(counseling, indexes.get(id('Sam Example'))!), counseling.what]).toEqual(['mental_health', 'Counseling session']);
    // medrec's words, when it is not private.
    const open = structuredClone(counseling);
    nameEvent(open, household, id('Sam Example'), { what: 'Anxiety' });
    expect(open.what).toBe('Anxiety');
  });

  it('never makes a portal platform’s name a place', () => {
    const visit = structuredClone(events('Robin Example').find((e) => e.start === '2026-11-18')!);
    visit.place = 'athenahealth (all practices)';
    nameEvent(visit, household, id('Robin Example'));
    expect(visit.place).toBe('Example Health Main Clinic');
  });

  it('names a fill for the pharmacy’s record of the drug, never a claim’s word for any drug', () => {
    const fill = events('Robin Example').find((e) => e.kind === 'fill' && e.start === '2026-11-12')!;
    expect([fill.title, fill.what, fill.place, fill.claims[0]!.provider]).toEqual(['Lisinopril 10 mg tablet', undefined, 'Example Pharmacy', 'Example Pharmacy']);
    // A claim that says only "Prescription drug", with no record of the drug.
    const claimOnly = { ...blank('fill'), claims: structuredClone(fill.claims) };
    for (const item of claimOnly.claims[0]!.record.fields.items as { service: { display: string } }[]) item.service.display = 'Prescription drug';
    nameEvent(claimOnly, household, id('Robin Example'));
    expect(claimOnly.title).toBe('Pharmacy fill');
    // A drug a pharmacy names in capitals.
    const capitals = blank('fill');
    nameEvent(capitals, household, id('Sam Example'), { what: 'CETIRIZINE 10 MG TABLET' });
    expect(capitals.title).toBe('Cetirizine 10 mg tablet');
  });

  it('names a fill or a vaccine known only from the portal for what it was', () => {
    const fill = blank('fill');
    fill.recorded.push(medication());
    nameEvent(fill, household, id('Sam Example'));
    expect(fill.title).toBe(medication().display);
  });

  it('names a day of several doses for how many, and one dose for what it was', () => {
    const day = events('Alex Example').find((e) => e.kind === 'vaccine' && e.start === '2022-01-10')!;
    expect([day.title, day.recorded.map((r) => r.display)]).toEqual(['4 vaccines', ['DTaP', 'IPV', 'MMR', 'Varicella']]);
    const one = events('Alex Example').find((e) => e.kind === 'vaccine' && e.start === '2024-10-14')!;
    expect(one.title).toBe('Influenza, seasonal, injectable');
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
    expect(own.find((e) => e.kind === 'outpatient')?.claims).toHaveLength(5);
  });
});
