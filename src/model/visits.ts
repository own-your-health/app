// Visits as a timeline: each visit with the documents that belong to it,
// what was recorded at it, and its claim. A document belongs to a visit
// when medrec linked it, or when it is dated within the visit (one day, or
// a stay's days) and comes from the same organization. A record belongs the
// same way. Each document joins one visit at most.

import { sameProvider } from './providers';
import { day, isWithdrawn, organizationName, sortByDateDesc, str } from './records';
import type { Household, ImagingStudy, MedDocument, MedRecord, PersonIndex } from './types';

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

export interface Visit {
  record: MedRecord;
  /** The first day, and for a stay the last. */
  start?: string;
  end?: string;
  /** The organizations (slugs) whose records name this visit. */
  organizations: string[];
  /** Linked by medrec first, then the same days and organization. */
  documents: { doc: MedDocument; linked: boolean }[];
  /** Records of the visit's days and organizations, by kind in RECORDED order. */
  recorded: { kind: string; records: MedRecord[] }[];
  /** Claims for it: the same days, from a provider matching the visit's organization or location. */
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

function orgsOf(r: MedRecord): string[] {
  return [...new Set(r.provenance.map((p) => p.source.organization_id).filter((x): x is string => !!x))];
}

/**
 * Visits that happened, newest first, and the documents no visit claims.
 * `household` and `person` name the visit's organizations for matching a
 * document filed by hand, which carries only an organization's name.
 */
export function visitTimeline(index: PersonIndex, household: Household, person: string, today: string): { visits: Visit[]; loose: MedDocument[] } {
  const encounters = recentVisits(index, today);
  const docs = new Map(index.documents.map((d) => [d.id, d]));
  const taken = new Set<string>();
  const visits: Visit[] = encounters.map((record) => {
    const w = window(record);
    const organizations = orgsOf(record);
    return { record, ...w, organizations, documents: [], recorded: [], claims: [], studies: [] };
  });

  const names = (v: Visit) => [...v.organizations.map((o) => organizationName(household, person, o)), str(v.record.fields.location), str(v.record.fields.service_provider)].filter((x): x is string => !!x);
  const fromVisitOrg = (v: Visit, org: string | undefined, orgName: string | undefined) => (org ? v.organizations.includes(org) : false) || names(v).some((n) => sameProvider(n, orgName));

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
    const v = visits.find((x) => within(day(d.date), x) && fromVisitOrg(x, d.provenance.source.organization_id, d.organization));
    if (v) {
      v.documents.push({ doc: d, linked: false });
      taken.add(d.id);
    }
  }

  for (const v of visits) {
    const mine = index.records.filter((r) => r !== v.record && !isWithdrawn(r) && within(day(r.date), v));
    for (const kind of RECORDED) {
      const rs = mine.filter((r) => r.kind === kind && orgsOf(r).some((o) => v.organizations.includes(o)));
      if (rs.length) v.recorded.push({ kind, records: rs });
    }
    v.claims = mine.filter((r) => {
      if (r.kind !== 'claim') return false;
      const provider = str(r.fields.provider);
      return names(v).some((n) => sameProvider(n, provider));
    });
    v.studies = index.studies.filter((s) => within(day(s.date), v));
  }
  return { visits, loose: sortByDateDesc(index.documents.filter((d) => !taken.has(d.id))) };
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
