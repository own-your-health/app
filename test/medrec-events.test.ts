// medrec's events.json (medrec 0.9.0) read into the app's events: what the
// reader keeps and drops, how members become claims, visits, records and
// papers, and the app's own grouping for a folder without them.
import { describe, expect, it } from 'vitest';
import { parseIndex } from '../src/model/parse';
import type { PersonIndex } from '../src/model/types';
import { eventOf, ruleText } from '../src/next/event';
import { groupedByMedrec, personEvents } from '../src/next/load';
import { fromMedrec, medrecEventsName, parseMedrecEvents } from '../src/next/medrecEvents';
import { demo, personNamed } from './demo-data';
import { demoJson, fixture } from './helpers';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const id = (name: string) => personNamed(household, name).id;
const events = (name: string) => personEvents(indexes.get(id(name))!, household, TODAY);

describe('reading events.json', () => {
  it('finds each person’s events by the name views.json gives it', () => {
    const views = demoJson('views/views.json');
    expect(medrecEventsName(views, id('Sam Example'))).toMatch(/^events\.[0-9a-f]{12}\.json$/);
    expect(medrecEventsName(views, 'p_nobody')).toBeUndefined();
    expect(medrecEventsName({ schema: 'medrec-views/v1', people: {} }, id('Sam Example'))).toBeUndefined();
    expect(medrecEventsName(null, id('Sam Example'))).toBeUndefined();
  });

  it('refuses another schema or another person’s file', () => {
    expect(() => parseMedrecEvents({ schema: 'medrec-events/v2', person: 'p_a', events: [] }, 'p_a')).toThrow('not medrec’s events');
    expect(() => parseMedrecEvents(fixture('events/odd.json'), 'p_someone_else')).toThrow('someone else');
  });

  it('drops an event without an id or a day, and a member naming both a record and a paper; ignores fields it does not know', () => {
    const file = parseMedrecEvents(fixture('events/odd.json'), 'p_aaaaaaaaaaaaaaaaaaaa');
    expect(file.events.map((e) => e.id)).toEqual(['e_aaaaaaaaaaaaaaaaaaaa']);
    const e = file.events[0]!;
    expect(e.members.map((m) => m.record ?? m.document)).toEqual(['r_known', 'r_gone', 'd_known']);
    expect(e.members[2]!.confidence).toBe('unsure');
    expect(e.expected).toEqual([{ what: 'claim', why: 'No claim filed yet.', since: '2026-01-05' }]);
    expect(e.could_join).toEqual(['e_bbbbbbbbbbbbbbbbbbbb', 'e_cccccccccccccccccccc']);
  });
});

describe('medrec’s events as the app’s', () => {
  it('reads every person’s events from medrec in the sample', () => {
    for (const p of household.people) expect(groupedByMedrec(indexes.get(p.id)!)).toBe(true);
    expect(events('Sam Example').every((e) => e.id.startsWith('e_'))).toBe(true);
  });

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

  it('leaves out a member the index no longer has, shows a kind it does not know by medrec’s title, and says why an unsure one is unsure', () => {
    const index: PersonIndex = {
      ...parseIndex({ schema: 'medrec-index/v1', person: 'p_aaaaaaaaaaaaaaaaaaaa', rev: 1, documents: [], records: [], studies: [], imports: [] }, 'p_aaaaaaaaaaaaaaaaaaaa'),
    };
    const sam = indexes.get(id('Sam Example'))!;
    const visit = sam.records.find((r) => r.kind === 'encounter')!;
    const doc = sam.documents[0]!;
    index.records = [{ ...visit, id: 'r_known' }];
    index.documents = [{ ...doc, id: 'd_known' }];
    const [e] = fromMedrec(parseMedrecEvents(fixture('events/odd.json'), 'p_aaaaaaaaaaaaaaaaaaaa'), index, household);
    expect([e!.title, e!.place, e!.visits.length, e!.recorded.length, e!.papers.length]).toEqual(['Video visit', 'Example Clinic', 1, 0, 1]);
    expect(e!.doubt).toBe('It could be part of any of 2 other visits');
    expect(ruleText(e!.papers[0]!.rule)).toBe('medrec’s rule D9');
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
