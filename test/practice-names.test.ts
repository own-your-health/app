// The practice a record came through: its own sign-in's name, so that two
// practices on one portal address are told apart, and never an id, nor the
// name of another person's sign-in.
import { describe, expect, it } from 'vitest';
import { parseMedrecEvents } from '../src/model/events';
import { practiceName, practiceOf, practiceOrId, sameSignIn } from '../src/model/practices';
import { nameKey, providerKey } from '../src/model/providers';
import { originNames, portalCounts } from '../src/model/records';
import { resultContext } from '../src/model/result';
import type { Household, MedDocument, MedRecord, PersonIndex } from '../src/model/types';
import { visitTimeline } from '../src/model/visits';
import { nameEvent, type CareEvent } from '../src/next/event';
import { careEvents } from '../src/next/grouping';
import { fromMedrec } from '../src/next/medrecEvents';
import { recordsOf, ruled, RULES } from './rules';

const [LEE, TONI, RILEY] = [ruled('Lee'), ruled('Toni'), ruled('Riley')];
const PERSON = LEE;
/** Lee's sign-ins, with one that has no id, one no source of anyone's has, and addresses written with their last slash, which the records leave off. */
const household: Household = {
  ...RULES,
  sources: [{ id: 's_no_id', kind: 'portal', person: LEE, cli: 'athena', organization_name: 'Example Walk-in Clinic' } as Household['sources'][number], ...RULES.sources.map((s) => ({ ...s, fhir_base: `${s.fhir_base}/` }))],
  organizations: [{ id: '800005', name: 'Example Heart Clinic' }, ...RULES.organizations],
};
const BASE = 'https://records.example.net/fhir/r4';
const visit = recordsOf('Lee').records.find((r) => r.display === 'RETURN VISIT LEVEL TWO')!;

/** The fixture's visit, through other sign-ins, in order. */
function visitThrough(...organizations: string[]): MedRecord {
  const r = structuredClone(visit);
  r.provenance = organizations.map((organization_id) => {
    const p = structuredClone(visit.provenance[0]!);
    p.source.organization_id = organization_id;
    return p;
  });
  return r;
}

function placeOf(record: MedRecord): string | undefined {
  const e: CareEvent = { id: 'e_x', kind: 'office', start: '2026-04-21', end: '2026-04-21', title: '', claims: [], visits: [{ record, rule: 'E1', confidence: 'sure' }], recorded: [], papers: [] };
  nameEvent(e, household, PERSON);
  return e.place;
}

describe('a practice’s name', () => {
  const from = (organization_id: string, cli = 'athena') => practiceName(household, PERSON, { organization_id, cli, fhir_base: BASE });

  it('tells two practices on one address apart', () => {
    expect([from('800001'), from('800002')]).toEqual(['Example Foot Care', 'Example Hearing Center']);
  });

  it('is the one of its own CLI when two share an id', () => {
    expect(practiceName(household, PERSON, { organization_id: '800001', cli: 'mychart', fhir_base: 'https://fhir.example.org/r4' })).toBe('Example Health');
  });

  it('falls back to the household’s organization of that id, never to another at its address', () => {
    expect([from('800005'), from('800003'), from('800009')]).toEqual(['Example Heart Clinic', undefined, undefined]);
  });
});

describe('a visit whose portal names every practice as one', () => {
  it('is at its sign-in’s practice', () => {
    expect([placeOf(visitThrough('800001')), placeOf(visitThrough('800002'))]).toEqual(['Example Foot Care', 'Example Hearing Center']);
  });

  it('has no place when no practice is known: not an id, nor the connection’s name', () => {
    expect([placeOf(visitThrough('800003')), placeOf(visitThrough('800009')), placeOf(visitThrough('800004'))]).toEqual([undefined, undefined, undefined]);
  });

  it('is at the practice any of its sign-ins names, in either order', () => {
    expect([placeOf(visitThrough('800004', '800001')), placeOf(visitThrough('800001', '800004'))]).toEqual(['Example Foot Care', 'Example Foot Care']);
  });

  it('says where a record came from without a bare id', () => {
    expect(['800001', '800003', '800009'].map((org) => originNames(visitThrough(org).provenance, household, PERSON))).toEqual([['Example Foot Care'], ['athena'], ['athena']]);
    // The CLI stands for all of its practices that nothing names.
    expect(originNames(visitThrough('800003', '800009', '800001').provenance, household, PERSON)).toEqual(['athena', 'Example Foot Care']);
  });
});

describe('the records each portal gave', () => {
  const counts = (...visits: MedRecord[]) => [...portalCounts(visits, household, PERSON)];

  it('are counted by practice', () => {
    expect(counts(visitThrough('800001'), visitThrough('800002'), visitThrough('800001'))).toEqual([['Example Foot Care', 2], ['Example Hearing Center', 1]]);
  });

  it('count a record through two sign-ins once, for the practice and not the connection', () => {
    expect(counts(visitThrough('800004', '800002'))).toEqual([['Example Hearing Center', 1]]);
  });

  it('count for the connection when no practice is named, and for a portal when nothing is', () => {
    expect(counts(visitThrough('800004'), visitThrough('800003'))).toEqual([['Example Records (all practices)', 1], ['Portal', 1]]);
  });
});

describe('a sign-in known by its id alone', () => {
  it('is this person’s own source’s name, else the household’s organization, else the id', () => {
    const name = (person: string, organization_id: string) => practiceOrId(household, person, { organization_id });
    expect([name(PERSON, '800002'), name(PERSON, '800005'), name('p_other', '800001')]).toEqual(['Example Hearing Center', 'Example Heart Clinic', '800001']);
  });

  it('is none when two of this person’s sources have the id under different names', () => {
    expect(practiceOf(household, PERSON, { organization_id: '800001' }).kind).toBe('shared');
    expect(practiceOrId(household, PERSON, { organization_id: '800001' })).toBeUndefined();
  });

  it('is nothing without an id', () => {
    expect(practiceOf(household, PERSON, {})).toEqual({ kind: 'unnamed' });
    expect(practiceOrId(household, PERSON, { cli: 'athena' })).toBeUndefined();
  });
});

describe('two names that are one', () => {
  it('differ in case, punctuation or "LLC" only, in any script', () => {
    expect(nameKey('The Example Clinic, LLC')).toBe(nameKey('EXAMPLE CLINIC'));
    expect(nameKey('Клиника Пример')).toBe(nameKey('КЛИНИКА «ПРИМЕР»'));
    expect(nameKey('Клиника Пример')).not.toBe(nameKey('Больница Пример'));
    expect([nameKey('Inc.'), nameKey('—'), nameKey(''), nameKey(undefined)]).toEqual(['inc', undefined, undefined, undefined]);
  });

  it('compare as providers by their Latin letters alone', () => {
    expect(['The Example Clinic, LLC', '  Example—Clinic ', 'Клиника', undefined].map(providerKey)).toEqual(['example clinic', 'example clinic', '', '']);
  });
});

// Practices that share one organization, CLI and FHIR base, which is all a
// record says of its source: two of Lee's, and one of Toni's.
describe('a sign-in several practices share', () => {
  /** With organizations known by the ids sources have. */
  const home: Household = { ...RULES, organizations: ['group West', 'east East', 'lake Lake'].map((x) => x.split(' ')).map(([id, name]) => ({ id: `example-${id}`, name: `Example ${name} Clinic` })) };
  const NAMES: Record<string, string> = { r_morning: 'Morning visit', r_afternoon: 'Afternoon visit', r_later: 'Later visit', r_lake: 'Lake visit', r_lake_two: 'Second lake visit', r_count: 'Count', r_level: 'Level', r_rate: 'Rate' };
  const filed = recordsOf('Lee').records;
  const from = (organization_id: string) => ({ organization_id, cli: 'athena', fhir_base: BASE });
  const record = (id: string, over: Partial<MedRecord> = {}): MedRecord => ({ ...structuredClone(filed.find((r) => r.display === NAMES[id])!), id, ...over });
  const person = (...records: MedRecord[]): PersonIndex => ({ schema: 'medrec-index/v1', person: LEE, rev: 1, documents: [], records, studies: [], imports: [] });
  const at = (id: string, location: string) => record(id, { fields: { class: 'AMB', location } });

  it('names none of them for the person who has two there', () => {
    expect(practiceName(home, LEE, from('example-group'))).toBeUndefined();
    expect(practiceOf(home, LEE, from('example-group'))).toEqual({ kind: 'shared', names: ['Example North Clinic', 'Example South Clinic'] });
    expect(practiceOrId(home, LEE, from('example-group'))).toBeUndefined();
  });

  it('names the one practice of the person who has one there', () => {
    expect(practiceName(home, TONI, from('example-group'))).toBe('Example West Clinic');
    expect(practiceOrId(home, TONI, from('example-group'))).toBe('Example West Clinic');
  });

  it('never gives one person the name of another’s source, nor the household’s organization named for it', () => {
    expect(['example-group', 'example-east'].map((o) => practiceName(home, RILEY, from(o)))).toEqual([undefined, undefined]);
    expect(practiceOrId(home, RILEY, from('example-east'))).toBe('example-east');
    // This person's own source there, through another CLI, is not another's.
    expect(practiceName(home, LEE, { organization_id: 'example-lake', cli: 'mychart' })).toBe('Example Lake Clinic');
  });

  it('is one practice when the names are one', () => {
    const same = { ...home, sources: home.sources.map((s) => (s.organization_name === 'Example South Clinic' ? { ...s, organization_name: 'Example North Clinic, LLC' } : s)) };
    expect(practiceName(same, LEE, from('example-group'))).toBe('Example North Clinic');
  });

  it('is several practices when their names are not in Latin letters', () => {
    const named = (id: string, name: string | undefined) => ({ ...home, sources: home.sources.map((s) => (s.organization_name === id && s.organization !== 'example-north' ? { ...s, organization_name: name } : s)) });
    const two = { ...home, sources: named('Example North Clinic', 'Клиника Север').sources.map((s) => (s.organization_name === 'Example South Clinic' ? { ...s, organization_name: 'Клиника Юг' } : s)) };
    expect(practiceOf(two, LEE, from('example-group'))).toEqual({ kind: 'shared', names: ['Клиника Север', 'Клиника Юг'] });
    // Another person's source with no name does not take the organization's.
    const unnamed = { ...named('Example East Clinic', undefined), organizations: [{ id: 'example-east', name: 'Клиника Восток' }] };
    expect(practiceName(unnamed, RILEY, from('example-east'))).toBe('Клиника Восток');
  });

  it('puts no result of its own day beside another: they may be two practices’', () => {
    const context = (...records: MedRecord[]) => resultContext(person(...records), home, LEE, '2026-12-01', records[0]!);
    const beside = (...records: MedRecord[]) => context(...records).sameDraw.flatMap((g) => g.records.map((r) => r.id));
    const on = (r: MedRecord, date: string) => ({ ...r, date });
    const level = on(record('r_level'), '2026-04-21');
    expect(beside(record('r_count'), level)).toEqual([]);
    expect(beside(record('r_count'), level, record('r_morning'), record('r_afternoon'))).toEqual([]);
    expect(beside(record('r_rate'), on(record('r_rate', { id: 'r_rate_two' }), '2026-05-05'))).toEqual(['r_rate_two']);
    const named = (name: string) => ({ ...home, sources: home.sources.map((s) => (s.organization_name === 'Example Lake Clinic' ? { ...s, organization_name: name } : s)) });
    const two = person(record('r_rate'), on(record('r_rate', { id: 'r_rate_two' }), '2026-05-05'));
    expect(['MyChart (Example Health)', 'Example Records (all practices)'].map((name) => resultContext(two, named(name), LEE, '2026-12-01', two.records[0]!).sameDraw.length)).toEqual([1, 0]);
    const north = on(record('r_rate', { id: 'r_rate_north' }), '2026-05-05');
    north.provenance[0]!.source.organization_id = 'example-north';
    expect(beside(record('r_rate'), north)).toEqual([]);
    // The day's only visit by it has both, and the report that came with them.
    const report = record('r_count', { id: 'r_report', kind: 'report' });
    expect(beside(record('r_count'), level, record('r_morning'))).toEqual(['r_level']);
    expect([context(record('r_count'), report, record('r_morning')), context(record('r_count'), report)].map((c) => c.reports.map((r) => r.id))).toEqual([['r_report'], []]);
  });

  it('is shared as far as either record says: one that leaves its CLI out could be either practice’s', () => {
    const two: Household = { ...home, sources: [
      { id: 's_a', kind: 'fhir', person: LEE, cli: 'athena', organization: 'example-pair', organization_name: 'Example North Clinic' },
      { id: 's_b', kind: 'fhir', person: LEE, cli: 'mychart', organization: 'example-pair', organization_name: 'Example South Clinic' },
    ] as Household['sources'] };
    const of = (id: string, cli: string | undefined, over: Partial<MedRecord> = {}) => {
      const r = record(id, over);
      r.provenance[0]!.source = { kind: 'fhir', organization_id: 'example-pair', ...(cli ? { cli } : {}) };
      return r;
    };
    const a = of('r_morning', undefined), b = of('r_afternoon', undefined), count = of('r_count', 'athena'), level = of('r_count', undefined, { id: 'r_two' });
    expect(careEvents(person(a, b), two, '2026-12-01')).toHaveLength(2);
    const recorded = (...records: MedRecord[]) => Object.fromEntries(visitTimeline(person(...records), two, LEE, '2026-12-01').visits.map((v) => [v.record.id, v.recorded.flatMap((g) => g.records.map((r) => r.id))]));
    expect(recorded(a, b, count)).toEqual({ r_morning: [], r_afternoon: [] });
    // The visit that gives its CLI is the result's practice.
    expect(recorded(of('r_morning', 'athena'), b, count)).toEqual({ r_morning: ['r_count'], r_afternoon: [] });
    expect([resultContext(person(count, level), two, LEE, '2026-12-01', count), resultContext(person(count, level), two, LEE, '2026-12-01', level)].map((c) => c.sameDraw)).toEqual([[], []]);
  });

  it('says where a record came from by its CLI, not by an id that may be another practice’s', () => {
    expect(originNames(record('r_morning').provenance, home, LEE)).toEqual(['athena']);
    expect(originNames(record('r_morning').provenance, home, TONI)).toEqual(['Example West Clinic']);
    expect(originNames(record('r_morning').provenance, home, RILEY)).toEqual(['example-group']);
    expect([...portalCounts([record('r_morning')], home, LEE)]).toEqual([['Portal', 1]]);
  });

  it('gives a visit no place but the one it names itself', () => {
    const place = (r: MedRecord, who: string) => {
      const e: CareEvent = { id: 'e_x', kind: 'office', start: '2026-04-21', end: '2026-04-21', title: '', claims: [], visits: [{ record: r, rule: 'E1', confidence: 'sure' }], recorded: [], papers: [] };
      nameEvent(e, home, who);
      return e.place;
    };
    expect([place(record('r_morning'), LEE), place(at('r_morning', 'Example South Clinic'), LEE), place(record('r_morning'), TONI)]).toEqual([undefined, 'Example South Clinic', 'Example West Clinic']);
  });

  it('keeps two visits of one day apart, unless they name one place', () => {
    const days = (...records: MedRecord[]) => careEvents(person(...records), home, '2026-12-01').map((e) => e.visits.map((v) => v.record.id).sort());
    expect(days(record('r_morning'), record('r_afternoon'))).toHaveLength(2);
    expect(days(at('r_morning', 'Example North Clinic'), at('r_afternoon', 'Example South Clinic'))).toHaveLength(2);
    expect(days(at('r_morning', 'Example North Clinic'), at('r_afternoon', 'Example North Clinic'))).toEqual([['r_afternoon', 'r_morning']]);
    // The connection's own name, or its id, is no place two visits share.
    expect(days(at('r_morning', 'Example Records (all practices)'), at('r_afternoon', 'Example Records (all practices)'))).toHaveLength(2);
    // A sign-in of one practice still makes one visit of a day's two, whatever script its name is in.
    const lake = (name: string) => careEvents(person(record('r_lake'), record('r_lake_two')), { ...home, sources: home.sources.map((s) => (s.organization_name === 'Example Lake Clinic' ? { ...s, organization_name: name } : s)) }, '2026-12-01').length;
    expect([lake('Example Lake Clinic'), lake('Клиника Озеро')]).toEqual([1, 1]);
    // A platform's name for one health system is no place, and still one sign-in's.
    expect([lake('MyChart (Example Health)'), lake('MyChart')]).toEqual([1, 1]);
    // A records connection's for every practice is not one's.
    expect([lake('Example Records (all practices)'), lake('Example Records (All Locations) ')]).toEqual([2, 2]);
  });

  it('gives a visit what came that way on its day only when no other visit there could have', () => {
    const recorded = (...records: MedRecord[]) => Object.fromEntries(visitTimeline(person(...records), home, LEE, '2026-12-01').visits.map((v) => [v.record.id, v.recorded.flatMap((g) => g.records.map((r) => r.id))]));
    expect(recorded(record('r_morning'), record('r_later'), record('r_level'))).toEqual({ r_later: ['r_level'], r_morning: [] });
    expect(recorded(record('r_morning'), record('r_afternoon'), record('r_count'))).toEqual({ r_morning: [], r_afternoon: [] });
    expect(recorded(at('r_morning', 'Example North Clinic'), at('r_afternoon', 'Example North Clinic'), record('r_count'))).toEqual({ r_morning: ['r_count'], r_afternoon: ['r_count'] });
    expect(recorded(record('r_lake'), record('r_lake_two'), record('r_rate'))).toEqual({ r_lake: ['r_rate'], r_lake_two: ['r_rate'] });
  });

  it('gives a paper to no visit by it on a day of two, and to one whose place the paper names', () => {
    const papers = (a: MedRecord, b: MedRecord, organization?: string) => {
      const doc = { id: 'd_note', path: 'x', sha256: '', md5: '', size: 1, date: '2026-04-21', doc_type: 'visit_summary', records: [], organization, provenance: record('r_count').provenance[0]! } as unknown as MedDocument;
      const { visits, loose } = visitTimeline({ ...person(a, b), documents: [doc] }, home, LEE, '2026-12-01');
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
    const event = (place: string, records: MedRecord[], who = LEE): string | undefined => {
      const members = records.map((r) => ({ record: r.id, kind: r.kind, role: r.kind === 'claim' ? 'office' : r.kind === 'encounter' ? 'portal' : 'satellite', rule: 'E0', confidence: 'sure', ...(r.kind === 'claim' ? { provider: r.fields.provider } : {}) }));
      const file = parseMedrecEvents({ schema: 'medrec-events/v1', person: who, events: [{ id: 'e_aaaaaaaaaaaaaaaaaaaa', kind: 'portal', start: '2026-04-21', end: '2026-04-21', title: 'Visit', place, confidence: 'sure', members, expected: [], could_join: [] }], pending: [] }, who);
      return fromMedrec(file, { ...person(...records), person: who }, home)[0]!.place;
    };
    const claim = (provider: string) => record('r_count', { id: 'r_claim', kind: 'claim', fields: { provider, amounts: {} } });

    it('is dropped when only another person’s source has that name', () => {
      expect(event('Example East Clinic', [record('r_morning')])).toBeUndefined();
      expect(event('Example West Clinic', [record('r_morning')])).toBeUndefined();
    });

    it('is dropped when it is one of several names the sign-in has', () => {
      expect([event('Example North Clinic', [record('r_morning')]), event('EXAMPLE SOUTH CLINIC, LLC', [record('r_morning')]), event('Example North Clinic', [record('r_count')])]).toEqual([undefined, undefined, undefined]);
    });

    it('stands when the visit or a claim names it', () => {
      expect(event('Example East Clinic', [at('r_morning', 'Example East Clinic Lakeside')])).toBe('Example East Clinic');
      expect(event('Example East Clinic', [record('r_morning'), claim('Example East Clinic Lakeside')])).toBe('Example East Clinic');
    });

    it('stands when it is this person’s one source’s, or no source’s at all', () => {
      expect([event('Example Lake Clinic', [record('r_lake')]), event('Example West Clinic', [record('r_morning')], TONI), event('Example Hill Hospital', [record('r_morning')])]).toEqual(['Example Lake Clinic', 'Example West Clinic', 'Example Hill Hospital']);
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
