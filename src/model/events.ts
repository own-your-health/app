// medrec's events (views/<person id>/events.json, `medrec-events/v1`, medrec
// 0.9.0 and later) and what views.json says medrec read when it wrote them.
// The store reads both; src/next/medrecEvents.ts makes them the app's events.

import { FolderError } from './parse';
import type { MedDocument } from './types';

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

export interface MedrecEvent {
  id: string;
  kind: string;
  start: string;
  end: string;
  title: string;
  what?: string;
  place?: string;
  confidence: Sureness;
  members: MedrecMember[];
  expected: { what: string; why: string; since?: string }[];
  could_join: string[];
}

export interface MedrecEvents {
  person: string;
  events: MedrecEvent[];
  /** The other people's papers these events name (X2), by id; the store fills it in from their indexes. */
  papers: Map<string, { person: string; doc: MedDocument }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const sureness = (v: unknown): Sureness => (v === 'sure' || v === 'likely' ? v : 'unsure');

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
  const events: MedrecEvent[] = [];
  for (const e of raw.events) {
    if (!isObj(e) || !text(e.id) || !DAY.test(String(e.start)) || !DAY.test(String(e.end)) || !Array.isArray(e.members)) continue;
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
    events.push({
      id: text(e.id)!,
      kind: text(e.kind) ?? '',
      start: String(e.start),
      end: String(e.end),
      title: text(e.title) ?? '',
      ...(text(e.what) ? { what: text(e.what) } : {}),
      ...(text(e.place) ? { place: text(e.place) } : {}),
      confidence: sureness(e.confidence),
      members,
      expected,
      could_join: (Array.isArray(e.could_join) ? e.could_join : []).filter((x): x is string => typeof x === 'string'),
    });
  }
  return { person, events, papers: new Map() };
}

type Md5 = string | null;

/**
 * What views.json (`medrec-views/v2`) says of a person's events.json: its
 * stored name, its MD5, and the MD5s of the files medrec read to write it.
 * A reader compares those with the folder's to tell fresh events from stale
 * ones (the data contract's "A reader decides freshness by MD5").
 */
export interface EventsView {
  /** `events.<first 12 hex of its MD5>.json`, under views/<person id>/. */
  name: string;
  md5: string;
  household: Md5;
  index: Md5;
  text: Md5;
  overrides: Md5;
  linked: Map<string, { index: Md5; text: Md5 }>;
}

const MD5 = /^[0-9a-f]{32}$/;
const md5Of = (v: unknown): Md5 | undefined => (v === null ? null : typeof v === 'string' && MD5.test(v) ? v : undefined);

/** Undefined when the views are not medrec's v2 layout, hold no events for this person, or leave out what freshness needs. */
export function eventsView(views: unknown, person: string): EventsView | undefined {
  if (!isObj(views) || views.schema !== 'medrec-views/v2' || !isObj(views.people)) return undefined;
  const p = views.people[person];
  if (!isObj(p) || !isObj(p.files)) return undefined;
  const md5 = md5Of(p.files['events.json']);
  const [household, index, txt, overrides] = [md5Of(views.household), md5Of(p.index), md5Of(p.text), md5Of(p.overrides)];
  if (!md5 || household === undefined || index === undefined || txt === undefined || overrides === undefined || !isObj(p.linked)) return undefined;
  const linked = new Map<string, { index: Md5; text: Md5 }>();
  for (const [id, l] of Object.entries(p.linked)) {
    const [li, lt] = isObj(l) ? [md5Of(l.index), md5Of(l.text)] : [undefined, undefined];
    if (li === undefined || lt === undefined) return undefined;
    linked.set(id, { index: li, text: lt });
  }
  return { name: `events.${md5.slice(0, 12)}.json`, md5, household, index, text: txt, overrides, linked };
}
