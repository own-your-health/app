// The private parts of open items (private.json `parts`, medrec 0.9.9) in
// visits: what a shared screen goes by, and that everything else is whole.
// The sample's visits, with parts set on what the store read.
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
import { demoFolderWith } from './helpers';

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
  it('is the one the store reads, and no other', async () => {
    const before = await SAMPLE.text(robin);
    const idx = withParts({});
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    expect([typeof before!.md5, idx.privacy.text]).toEqual(['string', before!.md5]);
    expect(sharedTexts(idx, before)).toEqual(before);
    // A folder whose text.json changed since.
    const folder = demoFolderWith({});
    const store = new Store(folder);
    await store.load();
    folder.md5 = async () => 'f'.repeat(32);
    expect(sharedTexts(idx, await store.text(robin))).toBeNull();
    // One that cannot say.
    const silent = demoFolderWith({});
    const other = new Store(silent);
    await other.load();
    silent.md5 = () => Promise.reject(new Error('offline'));
    const unsaid = await other.text(robin);
    expect([Object.keys(unsaid!.texts).length > 0, unsaid!.md5, sharedTexts(idx, unsaid)]).toEqual([true, undefined, null]);
    expect(sharedIndex(idx)).toBe(idx);
  });
});
