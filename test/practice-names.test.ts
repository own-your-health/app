// The practice a record came through: its own sign-in's name, so that two
// practices on one portal address are told apart, and never an id.
import { describe, expect, it } from 'vitest';
import { organizationName, originNames, portalCounts, practiceName } from '../src/model/records';
import type { Household, MedRecord } from '../src/model/types';
import { nameEvent, type CareEvent } from '../src/next/event';
import { demo } from './demo-data';
import { fixture } from './helpers';

const athena = fixture<Pick<Household, 'sources' | 'organizations'> & { encounter: MedRecord }>('household/athena.json');
const household: Household = { ...demo().household, sources: athena.sources, organizations: athena.organizations };
const CHILD = 'p_child';

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
  const e: CareEvent = { id: 'e_x', kind: 'office', start: '2026-11-02', end: '2026-11-02', title: '', claims: [], visits: [{ record, rule: 'E1', confidence: 'sure' }], recorded: [], papers: [] };
  nameEvent(e, household, CHILD);
  return e.place;
}

describe('a practice’s name', () => {
  const from = (organization_id: string, cli = 'athena') => practiceName(household, CHILD, { organization_id, cli, fhir_base: 'https://athena.example.test/fhir/r4' });

  it('tells two practices on one address apart, whoever’s sign-in it is', () => {
    expect([from('900001'), from('900002')]).toEqual(['Example Pediatrics', 'Example Family Medicine']);
  });

  it('is the one of its own CLI when two share an id', () => {
    expect(practiceName(household, CHILD, { organization_id: '900001', cli: 'mychart', fhir_base: 'https://mychart.example.test/fhir/r4/' })).toBe('Example Health');
  });

  it('falls back to the household’s organization of that id, never to another at its address', () => {
    expect([from('900005'), from('900003'), from('900009')]).toEqual(['Example Orthopedics', undefined, undefined]);
  });
});

describe('a visit whose portal names every practice as one', () => {
  it('is at its sign-in’s practice', () => {
    expect([placeOf(visitThrough('900001')), placeOf(visitThrough('900002'))]).toEqual(['Example Pediatrics', 'Example Family Medicine']);
  });

  it('has no place when no practice is known: not an id, nor the connection’s name', () => {
    expect([placeOf(visitThrough('900003')), placeOf(visitThrough('900009')), placeOf(visitThrough('900004'))]).toEqual([undefined, undefined, undefined]);
  });

  it('is at the practice any of its sign-ins names, in either order', () => {
    expect([placeOf(visitThrough('900004', '900001')), placeOf(visitThrough('900001', '900004'))]).toEqual(['Example Pediatrics', 'Example Pediatrics']);
  });

  it('says where a record came from without a bare id', () => {
    expect(['900001', '900003', '900009'].map((org) => originNames(visitThrough(org).provenance, household, CHILD))).toEqual([['Example Pediatrics'], ['athena'], ['athena']]);
    // The CLI stands for all of its practices that nothing names.
    expect(originNames(visitThrough('900003', '900009', '900001').provenance, household, CHILD)).toEqual(['athena', 'Example Pediatrics']);
  });
});

describe('the records each portal gave', () => {
  const counts = (...visits: MedRecord[]) => [...portalCounts(visits, household, CHILD)];

  it('are counted by practice', () => {
    expect(counts(visitThrough('900001'), visitThrough('900002'), visitThrough('900001'))).toEqual([['Example Pediatrics', 2], ['Example Family Medicine', 1]]);
  });

  it('count a record through two sign-ins once, for the practice and not the connection', () => {
    expect(counts(visitThrough('900004', '900002'))).toEqual([['Example Family Medicine', 1]]);
  });

  it('count for the connection when no practice is named, and for a portal when nothing is', () => {
    expect(counts(visitThrough('900004'), visitThrough('900003'))).toEqual([['athenahealth (all practices)', 1], ['Portal', 1]]);
  });
});

describe('a source named by its organization alone', () => {
  it('is this person’s own source’s name, else the household’s organization, else the id', () => {
    // Another CLI's source with the same id is not this person's.
    expect(organizationName(household, 'p_other', '900001')).toBe('900001');
    expect([organizationName(household, CHILD, '900001'), organizationName(household, CHILD, '900005')]).toEqual(['Example Pediatrics', 'Example Orthopedics']);
  });
});
