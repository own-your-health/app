// medrec's events (views/<person id>/events.json, `medrec-events/v1`, medrec
// 0.9.0 and later), read into the app's events. medrec decides what belongs
// together and how sure it is; the app keeps naming and pricing an event
// from its records (event.ts), so a screen reads the same either way.

import type { Household, MedDocument, MedRecord, PersonIndex } from '../model/types';
import { nameEvent, type CareEvent, type ClaimRole, type Confidence, type EventKind } from './event';

export interface MedrecMember {
  record?: string;
  document?: string;
  kind: string;
  role: string;
  rule: string;
  confidence: Confidence;
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
  confidence: Confidence;
  members: MedrecMember[];
  expected: { what: string; why: string; since?: string }[];
  could_join: string[];
}

export interface MedrecEvents {
  person: string;
  events: MedrecEvent[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const sureness = (v: unknown): Confidence => (v === 'sure' || v === 'likely' ? v : 'unsure');

/** A person's events.json; an event or member missing what the app relies on is dropped, a field it does not know is ignored. */
export function parseMedrecEvents(raw: unknown, person: string): MedrecEvents {
  if (!isObj(raw) || raw.schema !== 'medrec-events/v1' || !Array.isArray(raw.events)) throw new Error('events.json is not medrec’s events.');
  if (raw.person !== person) throw new Error('events.json is for someone else.');
  const events: MedrecEvent[] = [];
  for (const e of raw.events) {
    if (!isObj(e) || !text(e.id) || !DAY.test(String(e.start)) || !DAY.test(String(e.end)) || !Array.isArray(e.members)) continue;
    const members = e.members.filter(isObj).flatMap((m): MedrecMember[] => {
      const record = text(m.record);
      const document = text(m.document);
      if (!record === !document) return [];
      return [{ ...(record ? { record } : { document }), kind: text(m.kind) ?? '', role: text(m.role) ?? '', rule: text(m.rule) ?? '', confidence: sureness(m.confidence), ...(text(m.provider) ? { provider: text(m.provider) } : {}) }];
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
  return { person, events };
}

/**
 * The stored name of a person's events.json, from views.json: each view is
 * stored with the first 12 hex of its MD5 before the extension. Undefined
 * when the views are not medrec's v2 layout or hold no events for them.
 */
export function medrecEventsName(views: unknown, person: string): string | undefined {
  if (!isObj(views) || views.schema !== 'medrec-views/v2' || !isObj(views.people)) return undefined;
  const p = views.people[person];
  const md5 = isObj(p) && isObj(p.files) ? p.files['events.json'] : undefined;
  return typeof md5 === 'string' && /^[0-9a-f]{32}$/.test(md5) ? `events.${md5.slice(0, 12)}.json` : undefined;
}

const KINDS: Record<string, EventKind> = {
  er: 'er',
  er_no_facility: 'er',
  inpatient: 'stay',
  stay_no_facility: 'stay',
  outpatient: 'outpatient',
  office: 'office',
  service: 'service',
  tests: 'tests',
  dental: 'dental',
  vaccine: 'vaccine',
  fill: 'fill',
  series: 'series',
};

const ROLES: Record<string, ClaimRole> = { facility: 'facility', hospital: 'hospital', ancillary: 'ancillary', office: 'office', dental: 'dental', service: 'service', fill: 'pharmacy' };

/** A portal visit with no claim, by the visit's class: a stay, an emergency room visit, else an office visit. */
function portalKind(visit: MedRecord | undefined): EventKind {
  const cls = String(visit?.fields.class ?? '').toLowerCase();
  return /inpatient|^imp$|acute/.test(cls) ? 'stay' : /emergency|^emer$/.test(cls) ? 'er' : 'office';
}

/** medrec's events as the app's, newest first as medrec orders them. A member whose record or paper is not in the index (views older than it) is left out. */
export function fromMedrec(file: MedrecEvents, index: PersonIndex, household: Household): CareEvent[] {
  const records = new Map<string, MedRecord>(index.records.map((r) => [r.id, r]));
  const docs = new Map<string, MedDocument>(index.documents.map((d) => [d.id, d]));
  return file.events.flatMap((m): CareEvent[] => {
    const e: CareEvent = { id: m.id, kind: 'service', start: m.start, end: m.end, title: '', claims: [], visits: [], recorded: [], papers: [] };
    for (const x of m.members) {
      if (x.document) {
        const doc = docs.get(x.document);
        if (doc) e.papers.push({ doc, rule: x.rule, confidence: x.confidence });
        continue;
      }
      const record = records.get(x.record!);
      if (!record) continue;
      if (record.kind === 'claim') e.claims.push({ record, role: ROLES[x.role] ?? 'service', ...(x.provider ? { provider: x.provider } : {}), rule: x.rule, confidence: x.confidence });
      else if (x.role === 'portal' || x.role === 'contact') e.visits.push({ record, rule: x.rule, confidence: x.confidence });
      else e.recorded.push(record);
    }
    if (!e.claims.length && !e.visits.length && !e.recorded.length && !e.papers.length) return [];
    // Papers newest first, as the app lists them.
    e.papers.sort((a, b) => (b.doc.date ?? '').localeCompare(a.doc.date ?? ''));
    e.kind = KINDS[m.kind] ?? (m.kind === 'portal' ? portalKind(e.visits[0]?.record) : 'service');
    if (m.kind === 'stay_no_facility' || m.kind === 'er_no_facility') e.noFacility = true;
    if (m.place) e.place = m.place;
    if (m.what) e.what = m.what;
    if (m.expected.length) e.expected = m.expected;
    if (m.confidence === 'unsure') e.doubt = m.could_join.length > 1 ? `It could be part of any of ${m.could_join.length} other visits` : m.could_join.length ? 'It could be part of another visit' : 'medrec is not sure what it belongs with';
    nameEvent(e, household, index.person);
    // A kind the app does not know is shown by medrec's title.
    if (!KINDS[m.kind] && m.kind !== 'portal' && m.title) e.title = m.title;
    return [e];
  });
}
