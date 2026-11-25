// Visits as a timeline: each visit with the documents that belong to it,
// what was recorded at it, and its claim. A document belongs to a visit
// when medrec linked it, or when it is dated within the visit (one day, or
// a stay's days) and comes from the same practice. A record belongs the same
// way. Each document joins one visit at most. A claim belongs to the visit
// medrec linked it to, else to one of its days from a provider matching the
// visit.

import { claimLines, claimProvider, claimResultIds, claimVisitId, isContractClaim } from './claims';
import { practiceOf, practiceOrId, sameSignIn, type SignIn } from './practices';
import { sameProvider } from './providers';
import { day, isWithdrawn, sortByDateDesc, str } from './records';
import type { Household, ImagingStudy, MedDocument, MedRecord, PersonIndex, Provenance } from './types';
import { placeName } from './words';

/** FHIR encounter class, in words. */
export const VISIT_CLASS: Record<string, string> = {
  ambulatory: 'Office visit',
  AMB: 'Office visit',
  inpatient: 'Hospital stay',
  IMP: 'Hospital stay',
  emergency: 'Emergency',
  EMER: 'Emergency',
  virtual: 'Video visit',
  VR: 'Video visit',
  'home health': 'Home visit',
  HH: 'Home visit',
  observation: 'Observation stay',
  OBSENC: 'Observation stay',
};

/** What a visit's records are, by kind, in the order a visit summary lists them. */
const RECORDED: string[] = ['condition', 'result', 'procedure', 'medication', 'immunization', 'allergy', 'report'];

const NOT_A_VISIT = new Set(['cancelled', 'entered-in-error', 'planned']);

/** Visits that happened (not planned, cancelled or in the future), newest first. */
export function recentVisits(index: PersonIndex, today: string): MedRecord[] {
  return sortByDateDesc(index.records.filter((r) => r.kind === 'encounter' && !NOT_A_VISIT.has(r.status ?? '') && (!r.date || r.date.slice(0, 10) <= today)));
}

/** A sign-in a record came through. */
export interface Through extends SignIn {
  organization_id: string;
  /** Several practices of this person's share it, so it alone says which of them to none. */
  shared: boolean;
}

export interface Visit {
  record: MedRecord;
  /** The first day, and for a stay the last. */
  start?: string;
  end?: string;
  /** The sign-ins whose records name this visit. */
  through: Through[];
  /** Linked by medrec first, then the same days and practice. */
  documents: { doc: MedDocument; linked: boolean }[];
  /** Records of the visit's days and practice, by kind in RECORDED order. */
  recorded: { kind: string; records: MedRecord[] }[];
  /** Claims for it: those medrec linked to it, then the same days from a provider matching the visit's practice or location. */
  claims: MedRecord[];
  studies: ImagingStudy[];
}


function window(r: MedRecord): { start?: string; end?: string } {
  const start = day(r.date);
  const period = r.fields.period;
  const endRaw = period && typeof period === 'object' && !Array.isArray(period) ? str(period.end) : undefined;
  const end = day(endRaw);
  return { start, end: end && start && end > start ? end : start };
}

const within = (d: string | undefined, v: { start?: string; end?: string }) => !!d && !!v.start && d >= v.start && d <= (v.end ?? v.start);

/** The sign-ins some provenance names. */
export function through(household: Household, person: string, provenance: Provenance[]): Through[] {
  return provenance.flatMap(({ source: { organization_id, cli, fhir_base } }) => (organization_id ? [{ organization_id, cli, fhir_base, shared: practiceOf(household, person, { organization_id, cli, fhir_base }).kind === 'shared' }] : []));
}

/** The names of a visit's practice and place: never a records connection's, which many practices go by. */
export function visitPlaces(v: Pick<Visit, 'record' | 'through'>, household: Household, person: string): string[] {
  const practices = v.through.map((t) => practiceOrId(household, person, t));
  return [...practices, str(v.record.fields.location), str(v.record.fields.service_provider)].map(placeName).filter((x): x is string => !!x);
}

/**
 * Visits that happened, newest first, and the documents no visit claims.
 * `household` and `person` name the visit's practices for matching a document
 * filed by hand, which carries only an organization's name. Through a sign-in
 * several practices share, a visit takes what came that way on its days only
 * when no other visit there could have.
 */
export function visitTimeline(index: PersonIndex, household: Household, person: string, today: string): { visits: Visit[]; loose: MedDocument[] } {
  const encounters = recentVisits(index, today);
  const docs = new Map(index.documents.map((d) => [d.id, d]));
  const taken = new Set<string>();
  const visits: Visit[] = encounters.map((record) => {
    return { record, ...window(record), through: through(household, person, record.provenance), documents: [], recorded: [], claims: [], studies: [] };
  });

  const names = (v: Visit) => visitPlaces(v, household, person);
  const at = (v: Visit, name: string | undefined) => names(v).some((n) => sameProvider(n, name));
  const came = (v: Visit, t: Through) => v.through.some((x) => sameSignIn(x, t));
  const meets = (a: Visit, b: Visit) => !!a.start && !!b.start && a.start <= (b.end ?? b.start) && b.start <= (a.end ?? a.start);
  const alone = (v: Visit, t: Through) => !visits.some((x) => x !== v && meets(x, v) && came(x, t) && !names(x).some((n) => at(v, n)));
  const fromVisit = (v: Visit, provenance: Provenance[]) => through(household, person, provenance).some((t) => came(v, t) && (!t.shared || alone(v, t)));

  // Linked documents first, so a same-day match never takes one medrec linked elsewhere.
  for (const v of visits) {
    for (const id of v.record.documents) {
      const d = docs.get(id);
      if (d && !taken.has(id)) {
        v.documents.push({ doc: d, linked: true });
        taken.add(id);
      }
    }
  }
  for (const d of sortByDateDesc(index.documents)) {
    if (taken.has(d.id)) continue;
    const v = visits.find((x) => within(day(d.date), x) && (fromVisit(x, [d.provenance]) || at(x, d.organization)));
    if (v) {
      v.documents.push({ doc: d, linked: false });
      taken.add(d.id);
    }
  }

  // A claim in medrec's contract shape goes to the visit medrec linked, if it
  // is one of these, and else to none: medrec relinks on every write of the
  // index and leaves the link out when no single visit matches. A claim from
  // an earlier medrec is matched here by day and provider.
  const visitIds = new Set(visits.map((v) => v.record.id));
  const linkedVisit = (r: MedRecord) => {
    const id = claimVisitId(r);
    return id && visitIds.has(id) ? id : undefined;
  };
  const claims = index.records.filter((r) => r.kind === 'claim' && !isWithdrawn(r));
  for (const v of visits) {
    const mine = index.records.filter((r) => r !== v.record && !isWithdrawn(r) && within(day(r.date), v));
    for (const kind of RECORDED) {
      const rs = mine.filter((r) => r.kind === kind && fromVisit(v, r.provenance));
      if (rs.length) v.recorded.push({ kind, records: rs });
    }
    v.claims = claims.filter((r) => {
      if (isContractClaim(r)) return linkedVisit(r) === v.record.id;
      if (!mine.includes(r)) return false;
      const provider = claimProvider(r);
      return at(v, provider);
    });
    v.studies = index.studies.filter((s) => within(day(s.date), v));
  }
  return { visits, loose: sortByDateDesc(index.documents.filter((d) => !taken.has(d.id))) };
}

export interface ClaimContext {
  /** The visit it paid for: the one medrec linked, or for a claim from an earlier medrec, the one matched by day and provider. */
  visit?: Visit;
  /** The results and reports medrec linked to it. */
  results: MedRecord[];
  /** The records each line paid for, as medrec linked them, in claimLines order. */
  lineRecords: MedRecord[][];
}

/** What a claim paid for, as far as these records say. */
export function claimContext(index: PersonIndex, household: Household, person: string, today: string, r: MedRecord): ClaimContext {
  const visit = visitTimeline(index, household, person, today).visits.find((v) => v.claims.includes(r));
  const byId = new Map(index.records.filter((x) => x !== r && !isWithdrawn(x)).map((x) => [x.id, x]));
  const pick = (ids: string[]) => [...new Set(ids)].map((id) => byId.get(id)).filter((x): x is MedRecord => !!x);
  return { visit, results: pick(claimResultIds(r)), lineRecords: claimLines(r).map((l) => pick(l.records)) };
}

/** The visit a record is, with what belongs to it; undefined for a record that is not a visit that happened. */
export function visitOf(index: PersonIndex, household: Household, person: string, today: string, recordId: string): Visit | undefined {
  return visitTimeline(index, household, person, today).visits.find((v) => v.record.id === recordId);
}

/** The visit's kind in words, when its name does not already say it. */
export function visitKind(v: Visit): string | undefined {
  const c = str(v.record.fields.class);
  const kind = c ? VISIT_CLASS[c] : undefined;
  return kind && !(v.record.display ?? '').toLowerCase().includes(kind.toLowerCase()) ? kind : undefined;
}
