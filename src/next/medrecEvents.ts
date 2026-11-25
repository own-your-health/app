// medrec's events (src/model/events.ts) as the app's. medrec decides what
// belongs together and how sure it is; the app keeps naming and pricing an
// event from its records (event.ts), so a screen reads the same either way.

import { claimCategory, claimProvider } from '../model/claims';
import type { MedrecEvent, MedrecEvents } from '../model/events';
import type { Household, MedDocument, MedRecord, PersonIndex } from '../model/types';
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
 * not from its portal or claims has no such claim, and is not told.
 */
function placePrivate(m: MedrecEvent, file: MedrecEvents): boolean {
  if (m.placeFrom !== 'linked') return false;
  return (
    !m.bornDuring.length ||
    m.bornDuring.some((l) => {
      const other = file.others.get(l.person);
      const stay = other?.events?.events.find((e) => e.id === l.event);
      if (!other || !stay || stay.placeFrom || other.privacy?.kind !== 'known' || other.privacy.events.has(stay.id)) return true;
      return stay.members.some((x) => (x.record ? recordPrivate(other, x.record) : !x.person && paperPrivate(other, x.document!)));
    })
  );
}

/** The papers of another person's that these events hold (X2), private ones too, for that person's own list of them. */
export const papersHeldFor = (file: MedrecEvents, person: string): { document: string; event: string; confidence: Confidence }[] =>
  file.events.flatMap((e) => e.members.flatMap((x) => (x.person === person && x.document ? [{ document: x.document, event: e.id, confidence: x.confidence }] : [])));

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
    const { kind, title } = kindOf(m, e.visits[0]?.record);
    // A day of vaccine claims only is a vaccine visit, as the app's own grouping makes it.
    e.kind = kind === 'service' && !title && e.claims.length && e.claims.every((c) => claimCategory(c.record) === 'vaccine') ? 'vaccine' : kind;
    if (m.kind === 'stay_no_facility' || m.kind === 'er_no_facility') e.noFacility = true;
    const noPlace = !!m.place && placePrivate(m, file);
    if (m.place && placeHolds(m.place, e, household, index.person)) e.place = m.place;
    if (m.expected.length) e.expected = m.expected;
    if (m.confidence === 'unsure') e.doubt = m.could_join.length > 1 ? `It could be part of any of ${m.could_join.length} other visits` : m.could_join.length ? 'It could be part of another visit' : 'medrec is not sure what it belongs with';
    const given = { ...(title ? { title } : {}), ...(m.what ? { what: m.what } : {}), noPlace };
    const area = eventPrivate(e, index);
    // A place a private paper says it is at is private, whatever other paper does: which of them gave it is not said.
    const told = m.placeFrom === 'alias' && file.aliases.some((a) => a.organization === m.place && paperPrivate(index, a.document));
    const rest = area ? undefined : (withoutPrivate(e, index) ?? (told ? { ...e } : undefined));
    nameEvent(e, household, index.person, { ...given, private: !!knownArea(area) });
    if (rest) {
      if (told) delete rest.place;
      nameEvent(rest, household, index.person, given);
      e.shared = rest;
    }
    return [e];
  });
}
