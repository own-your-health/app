// The private parts of open items (private.json `parts`, medrec 0.9.9) in
// visits: what a shared screen goes by, and that everything else is whole.
// The sample's visits, with parts set on what the store read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { claimLines } from '../src/model/claims';
import { parseParts, sharedIndex, sharedTexts } from '../src/model/parts';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { asShared, householdEvents } from '../src/next/calendar';
import type { CareEvent } from '../src/next/event';
import { careEvents } from '../src/next/grouping';
import { personEvents } from '../src/next/load';
import { explainedLines } from '../src/next/money';
import { personNamed } from './demo-data';
import { DEMO, demoFolderWith } from './helpers';

const TODAY = '2026-11-22';
const FOLDER = demoFolderWith({});
const SAMPLE = new Store(FOLDER);
await SAMPLE.load();
const robin = personNamed(SAMPLE.household, 'Robin Example').id;
const sam = personNamed(SAMPLE.household, 'Sam Example').id;

/** A person's index as the store reads it, with these parts. */
function withParts(parts: Record<string, object>, person = robin): PersonIndex {
  const idx = structuredClone(SAMPLE.index(person)!);
  if (idx.privacy?.kind !== 'known') throw new Error('not known');
  idx.privacy.parts = parseParts(parts)!;
  return idx;
}
const all = (idx: PersonIndex) => personEvents(idx, SAMPLE.household, TODAY);
const mixed = (e: CareEvent) => e.claims.find((c) => claimLines(c.record).filter((l) => l.counted).length > 1)?.record;
const VISIT = all(SAMPLE.index(robin)!).find((e) => mixed(e) && e.place && e.kind !== 'fill' && e.kind !== 'vaccine')!;
const CLAIM = mixed(VISIT)!;
const labels = (r: MedRecord) => claimLines(r).map((l) => l.label);
/** The visit, where its claim has a private line and it has this part. */
const visit = (part: object = {}) => {
  const idx = withParts({ [CLAIM.id]: { display: 'Sample care', lines: [0], says: '1 service not shown' }, [VISIT.id]: { says: '1 service not shown', ...part } });
  return all(idx).find((e) => e.id === VISIT.id)!;
};

describe('a visit with a private part', () => {
  it('is whole on its person’s pages, and without it on a shared screen, which says how much is left out', () => {
    const { shared, ...own } = visit();
    expect(own).toEqual(VISIT);
    const left = shared!.claims.find((c) => c.record.id === CLAIM.id)!.record;
    expect(labels(left)).toEqual(labels(CLAIM).slice(1));
    expect(shared!.says).toBe('1 service not shown');
    // Every claim is there, so what it cost is whole.
    expect([shared!.claims.length, shared!.fewerClaims]).toEqual([VISIT.claims.length, undefined]);
    const idx = withParts({ [CLAIM.id]: { lines: [0], says: '1 service not shown' }, [VISIT.id]: { says: '1 service not shown' } });
    const mine = householdEvents(SAMPLE.household, (p) => (p === robin ? idx : undefined), TODAY).find((x) => x.event.id === VISIT.id)!;
    expect(asShared(mine).event.says).toBe('1 service not shown');
    const amounts = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'claim' || k === 'record' || k === 'claims' ? undefined : v));
    expect(amounts(asShared(mine).money)).toBe(amounts(mine.money));
  });

  it('is cut by its claim’s part alone, where it has none', () => {
    const idx = withParts({ [CLAIM.id]: { lines: [0], says: '1 service not shown' } });
    const { shared } = all(idx).find((e) => e.id === VISIT.id)!;
    expect(labels(shared!.claims.find((c) => c.record.id === CLAIM.id)!.record)).not.toContain(labels(CLAIM)[0]);
    expect(shared!.says).toBeUndefined();
    expect(all(idx).filter((e) => e.shared).map((e) => e.id)).toEqual([VISIT.id]);
  });

  it('goes by the words and the place that are left', () => {
    expect(VISIT.place).toBeDefined();
    expect(visit({ what: 'Sample words', place: 'Placeholder Hospital' }).shared).toMatchObject({ what: 'Sample words', place: 'Placeholder Hospital' });
    // One that is another person's is not its own, as for any place.
    const theirs = SAMPLE.household.sources.find((s) => s.person === sam && s.organization_name && !SAMPLE.household.sources.some((x) => x.person === robin && x.organization_name === s.organization_name))!.organization_name!;
    expect(visit({ place: theirs }).shared!.place).not.toBe(theirs);
    // With none, its open items name it, as they do a visit medrec gives none.
    const none = withParts({ [VISIT.id]: { place: null, what: null } });
    Object.assign(none.events!.events.find((e) => e.id === VISIT.id)!, { place: 'Placeholder Hospital', what: 'Its words' });
    const { shared, ...own } = all(none).find((e) => e.id === VISIT.id)!;
    expect([own.place, own.what]).toEqual(['Placeholder Hospital', 'Its words']);
    expect(shared!.place).not.toBe('Placeholder Hospital');
    expect(shared!.what).not.toBe('Its words');
  });

  it('is at a place judged as what is left has it, and not as all of it', () => {
    const at = (m: object, part: object, change: (idx: PersonIndex) => void = () => {}) => {
      const idx = withParts({ [VISIT.id]: part });
      Object.assign(idx.events!.events.find((e) => e.id === VISIT.id)!, { place: 'Placeholder Hospital', placeFrom: 'portal', bornDuring: [], ...m });
      change(idx);
      const e = all(idx).find((x) => x.id === VISIT.id)!;
      return [e.place, e.shared!.place];
    };
    const own = 'Placeholder Hospital';
    expect(at({}, {})).toEqual([own, own]);
    // Another person's stay gave it, and nothing says that is not private: nothing takes its place.
    expect(at({}, { place: 'Their Hospital', place_from: 'linked' })).toEqual([own, undefined]);
    expect(at({}, { place_from: 'linked' })).toEqual([own, undefined]);
    expect(at({ placeFrom: 'linked' }, { place: 'Open Hospital', place_from: 'portal' })).toEqual([undefined, 'Open Hospital']);
    expect(at({ placeFrom: 'linked' }, {})).toEqual([undefined, undefined]);
    // With none, or one that is another person's, its open items name it.
    const theirs = SAMPLE.household.sources.find((s) => s.person === sam && s.organization_name && !SAMPLE.household.sources.some((x) => x.person === robin && x.organization_name === s.organization_name))!.organization_name!;
    expect([at({}, { place: theirs }), at({ placeFrom: 'linked' }, { place: null })]).toEqual([
      [own, VISIT.place],
      [undefined, VISIT.place],
    ]);
    // A private paper told it, or told another.
    const told = (organization: string) => (idx: PersonIndex) => {
      const document = idx.documents.find((d) => !VISIT.papers.some((p) => p.doc.id === d.id))!.id;
      idx.events!.aliases = [{ organization, document }];
      if (idx.privacy?.kind === 'known') idx.privacy.documents.set(document, 'household');
    };
    expect(at({}, { place: 'Told Hospital', place_from: 'alias' }, told('Told Hospital'))).toEqual([own, VISIT.place]);
    expect(at({ placeFrom: 'alias' }, { place: 'Open Hospital', place_from: 'portal' }, told(own))).toEqual([own, 'Open Hospital']);
    expect(at({}, { place_from: 'alias' }, told(own))).toEqual([own, VISIT.place]);
    expect(at({ placeFrom: 'alias' }, { place_from: 'a new way' }, told(own))).toEqual([own, own]);
  });

  it('is of the kind that is left, named for it, with what is expected of that', () => {
    expect(visit({ kind: 'tests' }).shared).toMatchObject({ kind: 'tests' });
    expect(visit({ kind: 'a new kind', title: 'Sample visit' }).shared).toMatchObject({ kind: 'service', title: 'Sample visit' });
    expect(visit({ kind: null, title: null }).shared!.kind).toBe('service');
    const named = withParts({ [VISIT.id]: { title: null } });
    Object.assign(named.events!.events.find((e) => e.id === VISIT.id)!, { kind: 'a new kind', title: 'Its title' });
    const { shared, ...own } = all(named).find((e) => e.id === VISIT.id)!;
    expect([own.title, shared!.title === 'Its title']).toEqual(['Its title', false]);
    expect(visit().shared!.kind).toBe(VISIT.kind);
    expect(visit({ expected: [{ what: 'bill', why: 'Sample reason' }] }).shared!.expected).toEqual([{ what: 'bill', why: 'Sample reason' }]);
    expect('expected' in visit({ expected: null }).shared!).toBe(false);
    expect(visit({ kind: 'er_no_facility' }).shared).toMatchObject({ kind: 'er', noFacility: true });
    expect('noFacility' in visit({ kind: 'er' }).shared!).toBe(false);
  });

  it('has what is expected of it, and its own words, where the part says nothing of them', () => {
    const idx = withParts({ [VISIT.id]: { says: '1 service not shown' } });
    const m = idx.events!.events.find((e) => e.id === VISIT.id)!;
    Object.assign(m, { what: 'Its words', expected: [{ what: 'bill', why: 'Its reason' }], kind: 'er_no_facility' });
    const at = (part: object) => {
      if (idx.privacy?.kind === 'known') idx.privacy.parts = parseParts({ [VISIT.id]: part })!;
      const again = structuredClone(idx);
      return all(again).find((e) => e.id === VISIT.id)!.shared!;
    };
    expect(at({})).toMatchObject({ what: 'Its words', expected: [{ what: 'bill', why: 'Its reason' }], noFacility: true });
    const cut = at({ what: null, expected: null, kind: 'office' });
    expect([cut.what === 'Its words', cut.expected, cut.noFacility, cut.kind]).toEqual([false, undefined, undefined, 'office']);
  });

  it('is not shown by a part where it is private', () => {
    const idx = withParts({ [CLAIM.id]: { lines: [0] }, [VISIT.id]: { what: 'Sample words', says: '1 service not shown' } });
    if (idx.privacy?.kind === 'known') idx.privacy.events.set(VISIT.id, 'household');
    expect(all(idx).find((e) => e.id === VISIT.id)!.shared).toBeUndefined();
  });

  it('takes a portal visit’s kind from the visits that are left', () => {
    const idx = structuredClone(SAMPLE.index(robin)!);
    const e = all(idx).find((x) => x.visits.length && x.claims.length)!;
    const m = idx.events!.events.find((x) => x.id === e.id)!;
    const stay = idx.records.find((r) => r.id === e.visits[0]!.record.id)!;
    m.kind = 'portal';
    stay.fields.class = 'inpatient';
    if (idx.privacy?.kind === 'known') idx.privacy.records.set(stay.id, 'household');
    const now = all(structuredClone(idx)).find((x) => x.id === e.id)!;
    expect([now.kind, now.shared!.kind]).toEqual(['stay', 'office']);
  });

  it('is cut the same where the app groups the records itself', () => {
    const idx = withParts({ [CLAIM.id]: { lines: [0], says: '1 service not shown' } });
    delete idx.events;
    const mine = careEvents(idx, SAMPLE.household, TODAY).find((e) => e.claims.some((c) => c.record.id === CLAIM.id))!;
    expect(labels(mine.claims.find((c) => c.record.id === CLAIM.id)!.record)).toEqual(labels(CLAIM));
    expect(labels(mine.shared!.claims.find((c) => c.record.id === CLAIM.id)!.record)).toEqual(labels(CLAIM).slice(1));
    expect(careEvents(idx, SAMPLE.household, TODAY).filter((e) => e.shared)).toHaveLength(1);
    // It is named by the lines that are left.
    const lines = withParts(Object.fromEntries(idx.records.filter((r) => r.kind === 'claim' && labels(r).length > 1).map((r) => [r.id, { lines: [0] }])));
    delete lines.events;
    const cut = careEvents(lines, SAMPLE.household, TODAY).filter((e) => e.shared);
    const first = (e: CareEvent) => labels(e.claims.find((c) => labels(c.record).length > 1)!.record)[0]!;
    const said = (x: CareEvent, e: CareEvent) => x.what?.includes(first(e));
    expect(cut.filter((e) => said(e, e)).length).toBeGreaterThan(0);
    expect(cut.filter((e) => said(e.shared!, e)).map((e) => e.shared!.what)).toEqual([]);
    // With a private item, all of it is private.
    if (idx.privacy?.kind === 'known') idx.privacy.records.set(CLAIM.id, 'household');
    expect(careEvents(idx, SAMPLE.household, TODAY).filter((e) => e.shared)).toEqual([]);
  });

  describe('where the app groups the records itself', () => {
    const line = (display: string, code = '99999', category?: string) => ({ ...(category ? { category } : {}), service: { system: 'http://www.ama-assn.org/go/cpt', code, display }, amounts: {} });
    const DAY = '2026-11-02';
    /** Claims of these kinds, whose first lines are private but where `open`; all of one day and one hospital. */
    const group = (claims: { type: string; items: object[]; part?: object; provider?: string }[]) => {
      const ids = claims.map((_, i) => `r_made${i}`.padEnd(22, 'a'));
      const idx = withParts(Object.fromEntries(claims.flatMap((c, i) => (c.part ? [[ids[i]!, c.part]] : []))));
      delete idx.events;
      idx.records = claims.map((c, i) => ({ ...structuredClone(CLAIM), id: ids[i]!, date: DAY, fields: { provider: c.provider ?? 'Placeholder Hospital', billable_period: { start: DAY, end: DAY }, type: c.type, items: c.items } }) as MedRecord);
      idx.documents = [];
      const events = careEvents(idx, SAMPLE.household, TODAY);
      expect(events).toHaveLength(1);
      const said = (e: CareEvent) => [e.kind, ...e.claims.map((c) => c.role)];
      return { own: said(events[0]!), shared: said(events[0]!.shared!), e: events[0]!.shared!, whole: events[0]! };
    };
    const first = { lines: [0] };

    it('is of the kind its open lines make it', () => {
      const er = group([{ type: 'institutional', items: [line('Emergency department visit'), line('Sample scan')], part: first }]);
      expect([er.own, er.shared, er.e.title]).toEqual([['er', 'facility'], ['outpatient', 'facility'], group([{ type: 'institutional', items: [line('Sample scan')], part: {} }]).whole.title]);
      const shot = group([{ type: 'pharmacy', items: [line('Sample vaccine', '90686', 'vaccine'), line('Sample tablet')], part: first }]);
      expect([shot.own, shot.shared]).toEqual([['vaccine', 'pharmacy'], ['fill', 'pharmacy']]);
      expect(JSON.stringify([shot.e.title, shot.e.what])).not.toMatch(/vaccine/i);
      const office = group([{ type: 'professional', items: [line('Office visit', '99213', 'visit'), line('Sample care', '99999', 'medicine')], part: first }]);
      expect([office.own, office.shared]).toEqual([['office', 'office'], ['service', 'service']]);
    });

    it('is care of no said kind where those would not be one event', () => {
      const doctor = { type: 'professional', items: [line('Emergency department visit')], provider: 'Placeholder Doctors' };
      const split = group([{ type: 'institutional', items: [line('Emergency room'), line('Sample scan')], part: first }, doctor]);
      expect([split.own, split.shared, split.e.title]).toEqual([['er', 'facility', 'hospital'], ['service', 'facility', 'hospital'], 'Care']);
      const none = group([{ type: 'professional', items: [line('Office visit', '99213', 'visit')], part: first }]);
      expect([none.own, none.shared]).toEqual([['office', 'office'], ['service', 'service']]);
    });

    it('is a hospital’s doctors’ no more where only a private line says so', () => {
      const alone = group([{ type: 'professional', items: [line('Hospital care'), line('Sample care')], part: first }]);
      expect([alone.own, alone.whole.noFacility, alone.shared, 'noFacility' in alone.e]).toEqual([['stay', 'hospital'], true, ['service', 'service'], false]);
      const still = group([{ type: 'professional', items: [line('Sample care'), line('Hospital care')], part: first }]);
      expect([still.shared, still.e.noFacility]).toEqual([['stay', 'hospital'], true]);
    });

    it('says how many services are left out of it, in medrec’s words', () => {
      const items = [line('Sample care'), line('Sample scan'), line('Sample visit')];
      const says = (...parts: object[]) => group(parts.map((part) => ({ type: 'professional', items, part }))).e.says;
      expect([says(first), says(first, { lines: [0, 1], says: '2 services not shown' }), says({ diagnoses: [0], says: '1 diagnosis not shown' })]).toEqual(['1 service not shown', '3 services not shown', undefined]);
    });
  });
});

it('a line the plan did not count is not explained on a shared screen when it is private', () => {
  const idx = SAMPLE.index(sam)!;
  const events = (x: PersonIndex) => householdEvents(SAMPLE.household, (p) => (p === sam ? x : undefined), TODAY);
  const [was] = explainedLines(idx, events(idx), TODAY);
  const place = claimLines(was!.claim).findIndex((l) => l.label === was!.line.label && !l.counted);
  const cut = withParts({ [was!.claim.id]: { lines: [place] } }, sam);
  const left = (xs: ReturnType<typeof events>) => explainedLines(cut, xs, TODAY).filter((x) => x.claim.id === was!.claim.id && x.line.label === was!.line.label);
  expect(left(events(cut))).toHaveLength(1);
  expect(left(events(cut).map(asShared))).toEqual([]);
});

describe('the text medrec judged', () => {
  it('is the one that was read, by its own MD5, whatever the folder says of it', async () => {
    const before = await SAMPLE.text(robin);
    const idx = withParts({});
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    expect([typeof before!.md5, idx.privacy.text]).toEqual(['string', before!.md5]);
    expect(sharedTexts(idx, before)).toEqual(before);
    // A folder whose text.json changed since, and that says it did not.
    const path = 'Robin Example/text.json';
    const changed = demoFolderWith({ [path]: `${readFileSync(join(DEMO, path), 'utf8')} ` }, (m) => (m.md5![path] = before!.md5!));
    const store = new Store(changed);
    await store.load();
    const now = await store.text(robin);
    expect([await changed.md5(path), now!.texts, sharedTexts(idx, now)]).toEqual([before!.md5, before!.texts, null]);
    // Read for before a reload, and come after it, it is still by its own.
    const late = new Store(demoFolderWith({}));
    await late.load();
    let answer = () => {};
    const readHashed = late.folder.readHashed.bind(late.folder);
    late.folder.readHashed = async (p) => (await new Promise<void>((r) => (answer = r)), readHashed(p));
    const asked = late.text(robin);
    late.folder.fresh = () => changed;
    await late.reload();
    answer();
    expect([(await asked)!.md5, (await late.text(robin))!.md5]).toEqual([before!.md5, now!.md5]);
    expect(sharedIndex(idx)).toBe(idx);
  });

  it('is read once, and again where it was not read', async () => {
    const folder = demoFolderWith({ 'Robin Example/text.json': null });
    const store = new Store(folder);
    await store.load();
    const reads = folder.readHashed.bind(folder);
    let read = 0;
    folder.readHashed = (p) => (read++, reads(p));
    expect([await store.text(robin), await store.text(robin), await store.text('p_none'), read]).toEqual([null, null, null, 1]);
    folder.readHashed = () => Promise.reject(new Error('offline'));
    await expect(store.text(sam)).rejects.toThrow('offline');
    folder.readHashed = reads;
    expect((await store.text(sam))!.md5).toBeDefined();
  });
});
