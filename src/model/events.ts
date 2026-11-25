// medrec's events (views/<person id>/events.json, `medrec-events/v1`, medrec
// 0.9.0 and later). The store reads them; src/next/medrecEvents.ts makes them
// the app's events.

import { FolderError } from './parse';
import type { PersonIndex } from './types';

export type Sureness = 'sure' | 'likely' | 'unsure';

/** A rule name as medrec wrote it: only the reader makes one, so the app's own rules stay checked by name. */
export type MedrecRule = string & { readonly medrecRule: true };

export interface MedrecMember {
  record?: string;
  document?: string;
  /** Another person's paper, filed under them (X2). */
  person?: string;
  kind: string;
  role: string;
  rule: MedrecRule;
  confidence: Sureness;
  provider?: string;
}

const PLACE_FROM = ['portal', 'claims', 'alias', 'linked'] as const;
export type PlaceFrom = (typeof PLACE_FROM)[number];

export interface MedrecEvent {
  id: string;
  kind: string;
  start: string;
  end: string;
  title: string;
  what?: string;
  place?: string;
  /** Where the place is from: its portal, its claims, a paper that says its clinician works there (N5), or another person's stay it is linked to (X1). Absent for one the app does not know. */
  placeFrom?: PlaceFrom;
  /** Other people's stays that it was during, of a newborn's events (X1): the only links the app reads. */
  bornDuring: { event: string; person: string }[];
  confidence: Sureness;
  members: MedrecMember[];
  expected: { what: string; why: string; since?: string }[];
  could_join: string[];
  /** The person's items entered in error that it would have. */
  inError: string[];
}

/** A paper that fits two or more events, which medrec merged into none. */
export interface MedrecPending {
  document: string;
  could_join: string[];
  rule: MedrecRule;
}

export interface MedrecEvents {
  person: string;
  events: MedrecEvent[];
  pending: MedrecPending[];
  /** The practices clinicians were learned to work at, with the paper that says so (N5). */
  aliases: { organization: string; document: string }[];
  /** The events that are none without what is entered in error, newest first (medrec 0.9.9 and later). */
  errors: MedrecEvent[];
  /** How many of the household's decisions name each item entered in error: kept, and not applied. */
  notApplied: ReadonlyMap<string, number>;
  /** The visit each item entered in error would be in: one that stands, or one of `errors`. */
  errorAt: ReadonlyMap<string, string>;
  /** The indexes of the other people whose events (X1) and papers (X2) these name, from the load this file is of; the store fills it in. */
  others: ReadonlyMap<string, PersonIndex>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const placeFrom = (v: unknown): { placeFrom?: PlaceFrom } => {
  const known = PLACE_FROM.find((x) => x === v);
  return known ? { placeFrom: known } : {};
};
const sureness = (v: unknown): Sureness => (v === 'sure' || v === 'likely' ? v : 'unsure');

/** One event of the file's: none when it misses what the app relies on. */
function event(e: unknown, person: string): MedrecEvent[] {
  if (!isObj(e) || !text(e.id) || !DAY.test(String(e.start)) || !DAY.test(String(e.end)) || !Array.isArray(e.members)) return [];
  const members = e.members.filter(isObj).flatMap((m): MedrecMember[] => {
    const record = text(m.record);
    const document = text(m.document);
    if (!record === !document) return [];
    const other = text(m.person);
    return [
      {
        ...(record ? { record } : { document }),
        ...(other && other !== person ? { person: other } : {}),
        kind: text(m.kind) ?? '',
        role: text(m.role) ?? '',
        rule: (text(m.rule) ?? '') as MedrecRule,
        confidence: sureness(m.confidence),
        ...(text(m.provider) ? { provider: text(m.provider) } : {}),
      },
    ];
  });
  const expected = (Array.isArray(e.expected) ? e.expected : []).filter(isObj).flatMap((x) => (text(x.what) ? [{ what: text(x.what)!, why: text(x.why) ?? '', ...(text(x.since) ? { since: text(x.since) } : {}) }] : []));
  return [
    {
      id: text(e.id)!,
      kind: text(e.kind) ?? '',
      start: String(e.start),
      end: String(e.end),
      title: text(e.title) ?? '',
      ...(text(e.what) ? { what: text(e.what) } : {}),
      ...(text(e.place) ? { place: text(e.place), ...placeFrom(e.place_from) } : {}),
      bornDuring: (Array.isArray(e.links) ? e.links : []).filter(isObj).flatMap((x) => (x.relation === 'born_during' && text(x.event) && text(x.person) ? [{ event: text(x.event)!, person: text(x.person)! }] : [])),
      confidence: sureness(e.confidence),
      members,
      expected,
      could_join: strings(e.could_join),
      inError: strings(e.in_error),
    },
  ];
}

/**
 * A person's events.json. An event or member missing what the app relies on
 * is dropped, and a field it does not know is ignored. A later schema is
 * `newer_format`; anything else that is not this person's events is
 * `malformed`.
 */
export function parseMedrecEvents(raw: unknown, person: string): MedrecEvents {
  const schema = isObj(raw) ? raw.schema : undefined;
  if (typeof schema === 'string' && schema.startsWith('medrec-events/') && schema !== 'medrec-events/v1') throw new FolderError('newer_format', `Its events are in a newer format (${schema}) than this app reads.`);
  if (!isObj(raw) || schema !== 'medrec-events/v1' || !Array.isArray(raw.events)) throw new FolderError('malformed', 'Its events file is not medrec’s events.');
  if (raw.person !== person) throw new FolderError('malformed', 'Its events file is for someone else.');
  const read = (list: unknown): MedrecEvent[] => (Array.isArray(list) ? list.flatMap((e) => event(e, person)) : []);
  const pending = (Array.isArray(raw.pending) ? raw.pending : []).filter(isObj).flatMap((x): MedrecPending[] =>
    text(x.document) ? [{ document: text(x.document)!, could_join: strings(x.could_join), rule: (text(x.rule) ?? '') as MedrecRule }] : [],
  );
  const aliases = (Array.isArray(raw.aliases) ? raw.aliases : []).filter(isObj).flatMap((x) => (text(x.organization) && text(x.document) ? [{ organization: text(x.organization)!, document: text(x.document)! }] : []));
  const inError = Object.entries(isObj(raw.in_error) ? raw.in_error : {}).flatMap(([id, x]) => (isObj(x) ? [{ id, at: x.event, not: x.not_applied }] : []));
  const notApplied = new Map(inError.flatMap((x): [string, number][] => (Array.isArray(x.not) ? [[x.id, x.not.length]] : [])));
  const errorAt = new Map(inError.flatMap((x): [string, string][] => (typeof x.at === 'string' ? [[x.id, x.at]] : [])));
  return { person, events: read(raw.events), pending, aliases, errors: read(raw.events_in_error), notApplied, errorAt, others: new Map() };
}
