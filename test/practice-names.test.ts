// The practice a record came through: its own sign-in's name, so that two
// practices on one portal address are told apart, and never an id, nor the
// name of another person's sign-in.
import { describe, expect, it } from 'vitest';
import { parseMedrecEvents } from '../src/model/events';
import { organizationName, originNames, portalCounts, practiceName } from '../src/model/records';
import type { Household, MedDocument, MedRecord, PersonIndex } from '../src/model/types';
import { sameSignIn, visitTimeline } from '../src/model/visits';
import { nameEvent, type CareEvent } from '../src/next/event';
import { careEvents } from '../src/next/grouping';
import { fromMedrec } from '../src/next/medrecEvents';
import { demo } from './demo-data';
import { fixture } from './helpers';

const athena = fixture<Pick<Household, 'sources' | 'organizations'> & { encounter: MedRecord }>('household/athena.json');
const household: Household = { ...demo().household, sources: athena.sources, organizations: athena.organizations };
const PERSON = 'p_one';

/** The fixture's visit, through other sign-ins, in order. */
function visitThrough(...organizations: string[]): MedRecord {
  const r = structuredClone(athena.encounter);
  r.provenance = organizations.map((organization_id) => {
    const p = structuredClone(athena.encounter.provenance[0]!);
    p.source.organization_id = organization_id;
    return p;
  });
  return r;
}

function placeOf(record: MedRecord): string | undefined {
  const e: CareEvent = { id: 'e_x', kind: 'office', start: '2026-06-11', end: '2026-06-11', title: '', claims: [], visits: [{ record, rule: 'E1', confidence: 'sure' }], recorded: [], papers: [] };
  nameEvent(e, household, PERSON);
  return e.place;
}

describe('a practice’s name', () => {
  const from = (organization_id: string, cli = 'athena') => practiceName(household, PERSON, { organization_id, cli, fhir_base: 'https://athena.example.test/fhir/r4' });

  it('tells two practices on one address apart', () => {
    expect([from('900001'), from('900002')]).toEqual(['Example Eye Care', 'Example Hearing Clinic']);
  });

  it('is the one of its own CLI when two share an id', () => {
    expect(practiceName(household, PERSON, { organization_id: '900001', cli: 'mychart', fhir_base: 'https://mychart.example.test/fhir/r4/' })).toBe('Example Health');
  });

  it('falls back to the household’s organization of that id, never to another at its address', () => {
    expect([from('900005'), from('900003'), from('900009')]).toEqual(['Example Foot Clinic', undefined, undefined]);
  });
});

describe('a visit whose portal names every practice as one', () => {
  it('is at its sign-in’s practice', () => {
    expect([placeOf(visitThrough('900001')), placeOf(visitThrough('900002'))]).toEqual(['Example Eye Care', 'Example Hearing Clinic']);
  });

  it('has no place when no practice is known: not an id, nor the connection’s name', () => {
    expect([placeOf(visitThrough('900003')), placeOf(visitThrough('900009')), placeOf(visitThrough('900004'))]).toEqual([undefined, undefined, undefined]);
  });

  it('is at the practice any of its sign-ins names, in either order', () => {
    expect([placeOf(visitThrough('900004', '900001')), placeOf(visitThrough('900001', '900004'))]).toEqual(['Example Eye Care', 'Example Eye Care']);
  });

  it('says where a record came from without a bare id', () => {
    expect(['900001', '900003', '900009'].map((org) => originNames(visitThrough(org).provenance, household, PERSON))).toEqual([['Example Eye Care'], ['athena'], ['athena']]);
    // The CLI stands for all of its practices that nothing names.
    expect(originNames(visitThrough('900003', '900009', '900001').provenance, household, PERSON)).toEqual(['athena', 'Example Eye Care']);
  });
});

describe('the records each portal gave', () => {
  const counts = (...visits: MedRecord[]) => [...portalCounts(visits, household, PERSON)];

  it('are counted by practice', () => {
    expect(counts(visitThrough('900001'), visitThrough('900002'), visitThrough('900001'))).toEqual([['Example Eye Care', 2], ['Example Hearing Clinic', 1]]);
  });

  it('count a record through two sign-ins once, for the practice and not the connection', () => {
    expect(counts(visitThrough('900004', '900002'))).toEqual([['Example Hearing Clinic', 1]]);
  });

  it('count for the connection when no practice is named, and for a portal when nothing is', () => {
    expect(counts(visitThrough('900004'), visitThrough('900003'))).toEqual([['athenahealth (all practices)', 1], ['Portal', 1]]);
  });
});

describe('a source named by its organization alone', () => {
  it('is this person’s own source’s name, else the household’s organization, else the id', () => {
    expect([organizationName(household, PERSON, '900002'), organizationName(household, PERSON, '900005')]).toEqual(['Example Hearing Clinic', 'Example Foot Clinic']);
    expect(organizationName(household, 'p_other', '900001')).toBe('900001');
  });

  it('is none when two of this person’s sources have the id under different names', () => {
    expect(organizationName(household, PERSON, '900001')).toBeUndefined();
  });
});

// Practices that share one organization, CLI and FHIR base, which is all a
// record says of its source: two of p_one's, and one of p_two's.
describe('a sign-in several practices share', () => {
  const shared = fixture<Pick<Household, 'sources' | 'organizations'> & { records: MedRecord[] }>('household/shared-source.json');
  const home: Household = { ...demo().household, sources: shared.sources, organizations: shared.organizations };
  const from = (organization_id: string) => ({ organization_id, cli: 'athena', fhir_base: 'https://athena.example.test/fhir/r4' });
  const record = (id: string, over: Partial<MedRecord> = {}): MedRecord => ({ ...structuredClone(shared.records.find((r) => r.id === id)!), ...over });
  const person = (...records: MedRecord[]): PersonIndex => ({ schema: 'medrec-index/v1', person: 'p_one', rev: 1, documents: [], records, studies: [], imports: [] });
  const at = (id: string, location: string) => record(id, { fields: { class: 'AMB', location } });

  it('names none of them for the person who has two there', () => {
    expect(practiceName(home, 'p_one', from('example-group'))).toBeUndefined();
    expect(organizationName(home, 'p_one', 'example-group')).toBeUndefined();
  });

  it('names the one practice of the person who has one there', () => {
    expect(practiceName(home, 'p_two', from('example-group'))).toBe('Example West Clinic');
    expect(organizationName(home, 'p_two', 'example-group')).toBe('Example West Clinic');
  });

  it('never gives one person the name of another’s source, nor the household’s organization named for it', () => {
    expect(['example-group', 'example-east'].map((o) => practiceName(home, 'p_three', from(o)))).toEqual([undefined, undefined]);
    expect(organizationName(home, 'p_three', 'example-east')).toBe('example-east');
    // This person's own source there, through another CLI, is not another's.
    expect(practiceName(home, 'p_one', { organization_id: 'example-lake', cli: 'mychart' })).toBe('Example Lake Clinic');
  });

  it('is one practice when the names are one', () => {
    const same = { ...home, sources: home.sources.map((s) => (s.id === 's_south' ? { ...s, organization_name: 'Example North Clinic, LLC' } : s)) };
    expect(practiceName(same, 'p_one', from('example-group'))).toBe('Example North Clinic');
  });

  it('says where a record came from by its CLI, not by an id that may be another practice’s', () => {
    expect(originNames(record('r_morning').provenance, home, 'p_one')).toEqual(['athena']);
    expect(originNames(record('r_morning').provenance, home, 'p_two')).toEqual(['Example West Clinic']);
    expect(originNames(record('r_morning').provenance, home, 'p_three')).toEqual(['example-group']);
    expect([...portalCounts([record('r_morning')], home, 'p_one')]).toEqual([['Portal', 1]]);
  });

  it('gives a visit no place but the one it names itself', () => {
    const place = (r: MedRecord, who: string) => {
      const e: CareEvent = { id: 'e_x', kind: 'office', start: '2026-06-11', end: '2026-06-11', title: '', claims: [], visits: [{ record: r, rule: 'E1', confidence: 'sure' }], recorded: [], papers: [] };
      nameEvent(e, home, who);
      return e.place;
    };
    expect([place(record('r_morning'), 'p_one'), place(at('r_morning', 'Example South Clinic'), 'p_one'), place(record('r_morning'), 'p_two')]).toEqual([undefined, 'Example South Clinic', 'Example West Clinic']);
  });

  it('keeps two visits of one day apart, unless they name one place', () => {
    const days = (...records: MedRecord[]) => careEvents(person(...records), home, '2026-12-01').map((e) => e.visits.map((v) => v.record.id).sort());
    expect(days(record('r_morning'), record('r_afternoon'))).toHaveLength(2);
    expect(days(at('r_morning', 'Example North Clinic'), at('r_afternoon', 'Example South Clinic'))).toHaveLength(2);
    expect(days(at('r_morning', 'Example North Clinic'), at('r_afternoon', 'Example North Clinic'))).toEqual([['r_afternoon', 'r_morning']]);
    // The connection's own name, or its id, is no place two visits share.
    expect(days(at('r_morning', 'athenahealth (all practices)'), at('r_afternoon', 'athenahealth (all practices)'))).toHaveLength(2);
    // A sign-in of one practice still makes one visit of a day's two.
    expect(days(record('r_lake'), record('r_lake_two'))).toEqual([['r_lake', 'r_lake_two']]);
  });

  it('gives a visit what came that way on its day only when no other visit there could have', () => {
    const recorded = (...records: MedRecord[]) => Object.fromEntries(visitTimeline(person(...records), home, 'p_one', '2026-12-01').visits.map((v) => [v.record.id, v.recorded.flatMap((g) => g.records.map((r) => r.id))]));
    expect(recorded(record('r_morning'), record('r_later'), record('r_level'))).toEqual({ r_later: ['r_level'], r_morning: [] });
    expect(recorded(record('r_morning'), record('r_afternoon'), record('r_count'))).toEqual({ r_morning: [], r_afternoon: [] });
    expect(recorded(at('r_morning', 'Example North Clinic'), at('r_afternoon', 'Example North Clinic'), record('r_count'))).toEqual({ r_morning: ['r_count'], r_afternoon: ['r_count'] });
    expect(recorded(record('r_lake'), record('r_lake_two'), record('r_rate'))).toEqual({ r_lake: ['r_rate'], r_lake_two: ['r_rate'] });
  });

  it('gives a paper to no visit by it on a day of two, and to one whose place the paper names', () => {
    const papers = (a: MedRecord, b: MedRecord, organization?: string) => {
      const doc = { id: 'd_note', path: 'x', sha256: '', md5: '', size: 1, date: '2026-06-11', doc_type: 'visit_summary', records: [], organization, provenance: record('r_count').provenance[0]! } as unknown as MedDocument;
      const { visits, loose } = visitTimeline({ ...person(a, b), documents: [doc] }, home, 'p_one', '2026-12-01');
      return [visits.filter((v) => v.documents.length).map((v) => v.record.id), loose.length];
    };
    expect(papers(record('r_morning'), record('r_afternoon'))).toEqual([[], 1]);
    expect(papers(at('r_morning', 'Example North Clinic'), at('r_afternoon', 'Example South Clinic'), 'Example South Clinic')).toEqual([['r_afternoon'], 0]);
  });

  it('is told apart from the same id under another CLI', () => {
    const sign = (cli?: string, fhir_base?: string) => ({ organization_id: 'a', cli, fhir_base });
    expect([sameSignIn(sign('athena'), sign('mychart')), sameSignIn(sign('athena'), sign()), sameSignIn(sign('athena', 'https://a.test/r4/'), sign('athena', 'https://a.test/r4')), sameSignIn(sign('athena', 'https://a.test/r4'), sign('athena', 'https://b.test/r4')), sameSignIn(sign('athena'), { organization_id: 'b', cli: 'athena' })]).toEqual([false, true, true, false, false]);
  });

  describe('and the place medrec gives an event', () => {
    const event = (place: string, records: MedRecord[], who = 'p_one'): string | undefined => {
      const members = records.map((r) => ({ record: r.id, kind: r.kind, role: r.kind === 'claim' ? 'office' : r.kind === 'encounter' ? 'portal' : 'satellite', rule: 'E0', confidence: 'sure', ...(r.kind === 'claim' ? { provider: r.fields.provider } : {}) }));
      const file = parseMedrecEvents({ schema: 'medrec-events/v1', person: who, events: [{ id: 'e_aaaaaaaaaaaaaaaaaaaa', kind: 'portal', start: '2026-06-11', end: '2026-06-11', title: 'Visit', place, confidence: 'sure', members, expected: [], could_join: [] }], pending: [] }, who);
      return fromMedrec(file, { ...person(...records), person: who }, home)[0]!.place;
    };
    const claim = (provider: string) => record('r_count', { id: 'r_claim', kind: 'claim', fields: { provider, amounts: {} } });

    it('is dropped when only another person’s source has that name', () => {
      expect(event('Example East Clinic', [record('r_morning')])).toBeUndefined();
      expect(event('Example West Clinic', [record('r_morning')])).toBeUndefined();
    });

    it('is dropped when it is one of several names the sign-in has', () => {
      expect([event('Example North Clinic', [record('r_morning')]), event('Example North Clinic', [record('r_count')])]).toEqual([undefined, undefined]);
    });

    it('stands when the visit or a claim names it', () => {
      expect(event('Example East Clinic', [at('r_morning', 'Example East Clinic Lakeside')])).toBe('Example East Clinic');
      expect(event('Example East Clinic', [record('r_morning'), claim('Example East Clinic Lakeside')])).toBe('Example East Clinic');
    });

    it('stands when it is this person’s one source’s, or no source’s at all', () => {
      expect([event('Example Lake Clinic', [record('r_lake')]), event('Example West Clinic', [record('r_morning')], 'p_two'), event('Example Hill Hospital', [record('r_morning')])]).toEqual(['Example Lake Clinic', 'Example West Clinic', 'Example Hill Hospital']);
      // One sign-in of the visit's tells which of the names it is.
      const alone = structuredClone(record('r_lake').provenance);
      alone[0]!.source.organization_id = 'example-north';
      const both = record('r_morning', { provenance: [...record('r_morning').provenance, ...alone] });
      expect([event('Example North Clinic', [both]), event('Example South Clinic', [both])]).toEqual(['Example North Clinic', 'Example North Clinic']);
      expect(event('Example North Clinic', [record('r_count', { provenance: both.provenance })])).toBe('Example North Clinic');
    });

    it('gives way to what the event’s own records name', () => {
      expect(event('Example East Clinic', [record('r_morning'), claim('Example Hill Hospital')])).toBe('Example Hill Hospital');
    });
  });
});
