// medrec's events (views/<person id>/events.json, `medrec-events/v1`, medrec
// 0.9.0 and later). The store reads them; src/next/medrecEvents.ts makes them
// the app's events.

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
  const pending = (Array.isArray(raw.pending) ? raw.pending : []).filter(isObj).flatMap((x): MedrecPending[] =>
    text(x.document) ? [{ document: text(x.document)!, could_join: (Array.isArray(x.could_join) ? x.could_join : []).filter((y): y is string => typeof y === 'string'), rule: (text(x.rule) ?? '') as MedrecRule }] : [],
  );
  return { person, events, pending, papers: new Map() };
}
