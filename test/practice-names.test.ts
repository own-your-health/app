// The practice a record came through: its own sign-in's name, so that two
// practices on one portal address are told apart, and never an id.
import { describe, expect, it } from 'vitest';
import { originNames, practiceName } from '../src/model/records';
import type { Household, MedRecord } from '../src/model/types';
import { nameEvent, type CareEvent } from '../src/next/event';
import { demo } from './demo-data';
import { fixture } from './helpers';

const athena = fixture<Pick<Household, 'sources' | 'organizations'> & { encounter: MedRecord }>('household/athena.json');
const household: Household = { ...demo().household, sources: athena.sources, organizations: athena.organizations };
const CHILD = 'p_child';

/** The fixture's visit, through another sign-in. */
function visitThrough(organization_id: string): MedRecord {
  const r = structuredClone(athena.encounter);
  r.provenance[0]!.source.organization_id = organization_id;
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

  it('says where a record came from without a bare id', () => {
    expect(['900001', '900003', '900009'].map((org) => originNames(visitThrough(org).provenance, household, CHILD))).toEqual([['Example Pediatrics'], ['athena'], ['athena']]);
  });
});
