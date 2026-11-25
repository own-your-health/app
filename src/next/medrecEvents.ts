// medrec's events (src/model/events.ts) as the app's. medrec decides what
// belongs together and how sure it is; the app keeps naming and pricing an
// event from its records (event.ts), so a screen reads the same either way.

import { claimCategory, claimProvider } from '../model/claims';
import type { MedrecEvent, MedrecEvents } from '../model/events';
import type { Household, MedDocument, MedRecord, PersonIndex } from '../model/types';
import { partOf, type EventPart } from '../model/parts';
import { knownArea, paperPrivate, recordPrivate } from '../model/private';
import { practiceOf } from '../model/practices';
import { nameKey, sameProvider } from '../model/providers';
import { str } from '../model/records';
import { eventPrivate, nameEvent, withoutPrivate, type CareEvent, type ClaimRole, type Confidence, type EventKind } from './event';
import { tidyName } from '../model/words';

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

/**
 * The app's kind for medrec's. A portal visit with no claim takes the
 * visit's class: a stay, an emergency room visit, else an office visit. A
 * kind the app does not know is a service, shown by medrec's title.
 */
function kindOf(m: MedrecEvent, visit: MedRecord | undefined): { kind: EventKind; title?: string } {
  const known = KINDS[m.kind];
  if (known) return { kind: known };
  if (m.kind !== 'portal') return { kind: 'service', ...(m.title ? { title: m.title } : {}) };
  const cls = String(visit?.fields.class ?? '').toLowerCase();
  return { kind: /inpatient|^imp$|acute/.test(cls) ? 'stay' : /emergency|^emer$/.test(cls) ? 'er' : 'office' };
}

/**
 * Whether the place medrec gives is the event's. Where a portal names none,
 * medrec takes it from a source, and before 0.9.6 it can take one that only
 * shares the record's organization, CLI and FHIR base: another person's, or
 * another practice of this person's. A place the visit or a claim names is
 * the event's whatever the sources are called.
 *
 * To remove with medrec 0.9.6, which says the source a record came through:
 * `SignIn` takes that source, and its events need no check.
 */
function placeHolds(place: string, e: CareEvent, household: Household, person: string): boolean {
  const said = [...e.visits.flatMap((v) => [str(v.record.fields.location), str(v.record.fields.service_provider)]), ...e.claims.flatMap((c) => [c.provider, claimProvider(c.record)])];
  if (said.some((x) => sameProvider(x, place))) return true;
  const key = nameKey(place);
  const named = household.sources.filter((s) => key && nameKey(s.organization_name) === key);
  if (named.length && !named.some((s) => s.person === person)) return false;
  const came = [...e.visits.map((v) => v.record), ...e.recorded].flatMap((r) => r.provenance.map((p) => practiceOf(household, person, p.source)));
  return came.some((p) => p.kind === 'named' && nameKey(p.name) === key) || !came.some((p) => p.kind === 'shared' && p.names.some((n) => nameKey(n) === key));
}

/**
 * Whether an event's place is that of another person's stay that is private,
 * holds a private item of theirs, or cannot be told not to: it is judged as
 * theirs, so it is left out on this person's pages too, and nothing takes its
 * place. medrec takes it from the claim of a stay this event was during, and
 * does not say which, so any of several is enough. A stay whose own place is
 * not from its portal or claims has no such claim to tell by.
 */
function placePrivate(m: MedrecEvent, file: MedrecEvents): boolean {
  if (m.placeFrom !== 'linked') return false;
  return (
    !m.bornDuring.length ||
    m.bornDuring.some((l) => {
      const other = file.others.get(l.person);
      const stay = other?.events?.events.find((e) => e.id === l.event);
      if (!other || !stay || other.privacy?.kind !== 'known' || other.privacy.events.has(stay.id)) return true;
      // medrec 0.9.9 and later says which events' places may be shown.
      if (other.privacy.clear) return !other.privacy.clear.has(stay.id);
      if (stay.placeFrom !== 'portal' && stay.placeFrom !== 'claims') return true;
      return stay.members.some((x) => (x.record ? recordPrivate(other, x.record) : !x.person && paperPrivate(other, x.document!)));
    })
  );
}

/** Gives an event its kind, as medrec has it, and whether its facility's claim is in; its title, for a kind the app does not know. */
function kindAs(m: MedrecEvent, e: CareEvent): string | undefined {
  const { kind, title } = kindOf(m, e.visits[0]?.record);
  // A day of vaccine claims only is a vaccine visit, as the app's own grouping makes it.
  e.kind = kind === 'service' && !title && e.claims.length && e.claims.every((c) => claimCategory(c.record) === 'vaccine') ? 'vaccine' : kind;
  if (m.kind === 'stay_no_facility' || m.kind === 'er_no_facility') e.noFacility = true;
  else delete e.noFacility;
  return title;
}

/** An event as its open members and their open lines alone say it: what medrec has otherwise (0.9.9 and later), and the rest as it was. */
function leftOf(m: MedrecEvent, p: EventPart): MedrecEvent {
  const { what, place, placeFrom, ...rest } = m;
  const now = {
    what: p.what === undefined ? what : (p.what ?? undefined),
    place: p.place === undefined ? place : (p.place ?? undefined),
    placeFrom: p.placeFrom === undefined ? placeFrom : (p.placeFrom ?? undefined),
  };
  return {
    ...rest,
    kind: p.kind === undefined ? m.kind : (p.kind ?? ''),
    title: p.title === undefined ? m.title : (p.title ?? ''),
    expected: p.expected === undefined ? m.expected : (p.expected ?? []),
    ...(now.what ? { what: now.what } : {}),
    ...(now.place ? { place: now.place, ...(now.placeFrom ? { placeFrom: now.placeFrom } : {}) } : {}),
  };
}

/** The papers of another person's that these events hold (X2), private ones too, for that person's own list of them. */
export const papersHeldFor = (file: MedrecEvents, person: string): { document: string; event: string; confidence: Confidence }[] =>
  file.events.flatMap((e) => e.members.flatMap((x) => (x.person === person && x.document ? [{ document: x.document, event: e.id, confidence: x.confidence }] : [])));

/** An event that is none without what is entered in error, as it would be, asked for by its id. */
export function eventInError(index: PersonIndex, household: Household, id: string): CareEvent | undefined {
  const file = index.events;
  const event = file?.errors.find((e) => e.id === id);
  if (!file || !event) return undefined;
  const { records, documents } = index.inError ?? { records: [], documents: [] };
  return fromMedrec({ ...file, events: [event] }, { ...index, records: [...index.records, ...records], documents: [...index.documents, ...documents] }, household)[0];
}

/**
 * medrec's events as the app's, newest first as medrec orders them. A
 * member whose record or paper is not in the index (events written before
 * an index the store has not checked them against) is left out. Another
 * person's paper (X2) comes from their index, and is judged as theirs: one
 * that is private, or not known not to be, is in none of it.
 */
export function fromMedrec(file: MedrecEvents, index: PersonIndex, household: Household): CareEvent[] {
  const records = new Map<string, MedRecord>(index.records.map((r) => [r.id, r]));
  const docs = new Map<string, MedDocument>(index.documents.map((d) => [d.id, d]));
  return file.events.flatMap((m): CareEvent[] => {
    const e: CareEvent = { id: m.id, kind: 'service', start: m.start, end: m.end, title: '', claims: [], visits: [], recorded: [], papers: [] };
    for (const x of m.members) {
      if (x.document && x.person) {
        const other = file.others.get(x.person);
        const doc = other?.documents.find((d) => d.id === x.document);
        if (other && doc && !paperPrivate(other, doc.id)) e.papers.push({ doc, rule: x.rule, confidence: x.confidence, person: x.person });
        continue;
      }
      if (x.document) {
        const doc = docs.get(x.document);
        if (doc) e.papers.push({ doc, rule: x.rule, confidence: x.confidence });
        continue;
      }
      const record = records.get(x.record!);
      if (!record) continue;
      if (record.kind === 'claim') e.claims.push({ record, role: ROLES[x.role] ?? 'service', ...(x.provider ? { provider: tidyName(x.provider) } : {}), rule: x.rule, confidence: x.confidence });
      else if (x.role === 'portal' || x.role === 'contact') e.visits.push({ record, rule: x.rule, confidence: x.confidence });
      else e.recorded.push(record);
    }
    if (!e.claims.length && !e.visits.length && !e.recorded.length && !e.papers.length) return [];
    // Papers newest first, as the app lists them.
    e.papers.sort((a, b) => (b.doc.date ?? '').localeCompare(a.doc.date ?? ''));
    const title = kindAs(m, e);
    const noPlace = !!m.place && placePrivate(m, file);
    if (m.place && placeHolds(m.place, e, household, index.person)) e.place = m.place;
    if (m.expected.length) e.expected = m.expected;
    if (m.inError.length) e.inError = m.inError.length;
    if (m.confidence === 'unsure') e.doubt = m.could_join.length > 1 ? `It could be part of any of ${m.could_join.length} other visits` : m.could_join.length ? 'It could be part of another visit' : 'medrec is not sure what it belongs with';
    const area = eventPrivate(e, index);
    const part = partOf(index, m.id);
    const left = part ? leftOf(m, part.event) : m;
    // A place a private paper says it is at is private, whatever other paper does: which of them gave it is not said.
    const told = left.placeFrom === 'alias' && file.aliases.some((a) => a.organization === left.place && paperPrivate(index, a.document));
    const rest = area ? undefined : (withoutPrivate(e, index) ?? (told || part ? { ...e } : undefined));
    nameEvent(e, household, index.person, { ...(title ? { title } : {}), ...(m.what ? { what: m.what } : {}), noPlace, private: !!knownArea(area) });
    if (rest) {
      const name = kindAs(left, rest);
      // The place is judged as what is left has it.
      if (told || !left.place) delete rest.place;
      else if (left.place !== m.place) {
        if (placeHolds(left.place, rest, household, index.person)) rest.place = left.place;
        else delete rest.place;
      }
      if (left.expected.length) rest.expected = left.expected;
      else delete rest.expected;
      if (part?.says) rest.says = part.says;
      nameEvent(rest, household, index.person, { ...(name ? { title: name } : {}), ...(left.what ? { what: left.what } : {}), noPlace: placePrivate(left, file) });
      e.shared = rest;
    }
    return [e];
  });
}
