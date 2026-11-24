// What happened, as the redesign (?next) shows it: an event is one visit,
// emergency room trip, stay, test day or fill, however many claims, portal
// records and papers it produced. This module is the lasting half: the
// event's shape, its kind in words, how sure it is, and what it cost from its
// claims' totals. Who makes the events is load.ts's choice.

import { CATEGORY_LABELS, claimAmounts, claimCategory, claimCents, claimTitle, type Category } from '../model/claims';
import { sameProvider } from '../model/providers';
import { organizationName, str } from '../model/records';
import type { Household, MedDocument, MedRecord } from '../model/types';

export type EventKind = 'er' | 'stay' | 'outpatient' | 'series' | 'office' | 'service' | 'tests' | 'dental' | 'vaccine' | 'fill';
export type Confidence = 'sure' | 'likely' | 'unsure';
/** What a claim was for, in its event: a hospital's own claim, a doctor there, a lab or imaging, a doctor's office, other care. */
export type ClaimRole = 'facility' | 'hospital' | 'ancillary' | 'office' | 'service' | 'pharmacy' | 'dental';

export interface EventClaim {
  record: MedRecord;
  role: ClaimRole;
  provider?: string;
  /** The rule that put it here, and how sure it is. */
  rule: Rule;
  confidence: Confidence;
}

export interface EventPaper {
  doc: MedDocument;
  rule: Rule;
  confidence: Confidence;
}

export interface CareEvent {
  /** The id of the record it started from: its hospital's claim, its portal visit or its first claim. */
  id: string;
  kind: EventKind;
  start: string;
  end: string;
  title: string;
  place?: string;
  claims: EventClaim[];
  /** The portal's visit records, and how they joined. */
  visits: { record: MedRecord; rule: Rule; confidence: Confidence }[];
  /** What the portal recorded at those visits: results, reports, diagnoses, medicines. */
  recorded: MedRecord[];
  papers: EventPaper[];
  /** A hospital visit known only from its doctors' claims. */
  noFacility?: boolean;
  /** Why it is not as sure as the rest: other events of the day that could own a part of it. */
  doubt?: string;
  /** What it was, in medrec's words: the portal's reason, else the claims' services (medrec's `what`). */
  what?: string;
  /** What medrec still expects for it: the doctors' claims, the hospital's claim, a claim or a bill. */
  expected?: { what: string; why: string; since?: string }[];
}

/** The rules, in words a person can follow. */
export const RULES = {
  C1: 'The hospital’s own claim, over its dates',
  C2: 'A doctor’s, lab’s or imaging claim dated within the hospital visit',
  C3: 'A claim from the same day as the hospital’s outpatient claim',
  C4: 'A hospital doctor’s claims on days next to each other, with no claim from the hospital',
  C5: 'A provider’s claims on one day',
  C5j: 'A lab or imaging claim from the only office visit that day',
  C6: 'A pharmacy’s or dentist’s claims on one day',
  M: 'medrec linked the claim to this visit',
  E2: 'The portal’s visits at one place on one day',
  E3: 'The portal’s visit on a day the claims cover',
  E3n: 'The portal’s visit, with the clinic named on a claim',
  E0: 'The portal’s visit, with no claim for it',
  E4: 'Recorded at the portal’s visit',
  DM: 'medrec linked the paper to a record of this visit',
  D2: 'From a provider of this visit, dated within it or 3 days after',
  D3: 'The only visit that day; the paper’s practice is on no claim',
  D3a: 'The only visit that day, and the paper’s amount is this visit’s share',
  D3s: 'A bill from a provider of this visit, for exactly what its claim says you owe',
  // medrec's rules (events.json, 0.9.0), where the app's had none.
  E1: 'A call, message or order from the same practice within 3 days',
  E5: 'A vaccine given the day of a vaccine claim',
  D2b: 'The paper names a clinician of this visit',
  D4: 'A note or summary from the portal’s visit, dated 0 to 3 days after it',
  D5: 'A prescription filled at this pharmacy 0 to 1 day later',
  X1: 'Care of a newborn during a parent’s hospital stay',
  X2: 'A paper filed under someone else, dated before their birth',
  N5: 'A clinician known to work at this practice',
} as const;
/** A rule's name, as the app or medrec wrote it; medrec may write one the app does not know yet. */
export type Rule = keyof typeof RULES | (string & {});

/** A rule in words; one the app does not know yet is named as medrec's. */
export const ruleText = (rule: Rule): string => (RULES as Record<string, string>)[rule] ?? `medrec’s rule ${rule}`;

const CONFIDENCE_ORDER: Confidence[] = ['sure', 'likely', 'unsure'];
const leastSure = (cs: Confidence[]): Confidence => CONFIDENCE_ORDER[Math.max(0, ...cs.map((c) => CONFIDENCE_ORDER.indexOf(c)))]!;

/** How sure the event is: the least sure of its parts. */
export function eventConfidence(e: CareEvent): Confidence {
  return leastSure([...e.claims.map((c) => c.confidence), ...e.visits.map((v) => v.confidence), ...e.papers.map((p) => p.confidence), e.doubt ? 'unsure' : 'sure']);
}

export const KIND_TITLES: Record<EventKind, string> = {
  er: 'Emergency room',
  stay: 'Hospital stay',
  outpatient: 'Hospital visit',
  series: 'Course of care',
  office: 'Office visit',
  service: 'Care',
  tests: 'Tests',
  dental: 'Dental visit',
  vaccine: 'Vaccine',
  fill: 'Pharmacy',
};

/** The event's kind in words, as its card and page say it. */
export function kindText(e: CareEvent): string {
  if ((e.kind === 'er' || e.kind === 'stay') && e.end > e.start) return `${KIND_TITLES[e.kind]} · ${e.kind === 'er' || nights(e) === 1 ? 'overnight' : `${nights(e)} nights`}`;
  return KIND_TITLES[e.kind];
}

const nights = (e: CareEvent) => Math.round((Date.parse(e.end) - Date.parse(e.start)) / 86_400_000);


// ---- Money ----

/** One provider's part of an event's cost. */
export interface Charge {
  provider: string;
  /** What they were, in plain words: "The hospital", "Lab". */
  role: string;
  claims: MedRecord[];
  billed?: number;
  /** The plan's price for it: what it allowed. */
  price?: number;
  planPaid?: number;
  share?: number;
}

export interface EventMoney {
  billed?: number;
  /** The network discount: what was billed above the plan's price. */
  discount?: number;
  price?: number;
  planPaid?: number;
  share?: number;
  /** Your share is the parts the claims give, added up: no claim gave its own figure. */
  shareAdded: boolean;
  /** Where your share comes from: a copay, a deductible, coinsurance, what was not covered. */
  reasons: { name: 'deductible' | 'copay' | 'coinsurance' | 'notCovered'; cents: number }[];
  charges: Charge[];
  /** Billed less the discount less what the plan paid is your share, to the cent. */
  adds: boolean;
}

const ROLE_WORDS: Record<ClaimRole, string> = {
  facility: 'The hospital',
  hospital: 'Hospital doctor',
  ancillary: 'Tests',
  office: 'Doctor’s office',
  service: 'Care',
  pharmacy: 'Pharmacy',
  dental: 'Dentist',
};

function roleText(c: EventClaim, e: CareEvent): string {
  if (c.role === 'hospital' && e.kind === 'er') return 'Emergency doctor';
  if (c.role === 'ancillary' || c.role === 'service') {
    const cat = claimCategory(c.record);
    if (cat === 'lab') return 'Lab';
    if (cat === 'imaging') return 'Imaging';
    if (cat && cat !== 'mixed') return CATEGORY_LABELS[cat as Category].one;
  }
  return ROLE_WORDS[c.role];
}

const add = (a: number | undefined, b: number | undefined) => (b === undefined ? a : (a ?? 0) + b);

/** What an event cost, from its claims' own totals: never their lines. */
export function eventMoney(e: CareEvent): EventMoney {
  const out: EventMoney = { shareAdded: false, reasons: [], charges: [], adds: false };
  const reasons = new Map<EventMoney['reasons'][number]['name'], number>();
  for (const c of e.claims) {
    const cents = claimCents(c.record);
    const a = claimAmounts(c.record);
    // A plan that splits a charge can give a price below zero; then the price is what was paid on it.
    const price = cents.allowed !== undefined && cents.allowed >= 0 ? cents.allowed : cents.planPaid !== undefined && cents.youOwe !== undefined ? cents.planPaid + cents.youOwe : undefined;
    const provider = c.provider ?? 'Provider not named';
    const role = roleText(c, e);
    let ch = out.charges.find((x) => sameProvider(x.provider, provider) || x.provider === provider);
    if (!ch) out.charges.push((ch = { provider, role, claims: [] }));
    ch.claims.push(c.record);
    ch.billed = add(ch.billed, cents.billed);
    ch.price = add(ch.price, price);
    ch.planPaid = add(ch.planPaid, cents.planPaid);
    ch.share = add(ch.share, cents.youOwe);
    out.billed = add(out.billed, cents.billed);
    out.price = add(out.price, price);
    out.planPaid = add(out.planPaid, cents.planPaid);
    out.share = add(out.share, cents.youOwe);
    if (a.shareAdded) out.shareAdded = true;
    for (const p of ['deductible', 'copay', 'coinsurance', 'notCovered'] as const) if (cents[p]) reasons.set(p, (reasons.get(p) ?? 0) + cents[p]!);
  }
  out.reasons = [...reasons].map(([name, cents]) => ({ name, cents }));
  if (out.billed !== undefined && out.price !== undefined) out.discount = out.billed - out.price;
  out.adds = out.billed !== undefined && out.discount !== undefined && out.planPaid !== undefined && out.share !== undefined && out.billed - out.discount - out.planPaid === out.share;
  return out;
}

/** A pharmacy trip: the pharmacy takes your share at the counter, so no bill follows. */
export const paidAtCounter = (e: CareEvent) => e.claims.length > 0 && e.claims.every((c) => c.role === 'pharmacy');

/** The event a record belongs to: a claim, a portal visit, something recorded there, or a paper. */
export function eventOf(events: CareEvent[], id: string): CareEvent | undefined {
  return events.find((e) => e.id === id || e.claims.some((c) => c.record.id === id) || e.visits.some((v) => v.record.id === id) || e.recorded.some((r) => r.id === id) || e.papers.some((p) => p.doc.id === id));
}

/** Why an event is private, when a record or paper in it is (medrec's `private_area`); undefined when nothing in it is. */
export function privateArea(e: CareEvent): string | undefined {
  const marked = [...e.claims.map((c) => c.record), ...e.visits.map((v) => v.record), ...e.recorded, ...e.papers.map((p) => p.doc)].find((x) => x.private === true);
  return marked ? (marked.private_area ?? 'household') : undefined;
}

export const PRIVATE_AREAS: Record<string, string> = {
  mental_health: 'Mental health',
  reproductive: 'Reproductive care',
  sexual_health: 'Sexual health',
  substance_use: 'Substance use',
  household: 'Marked private',
};



/** Its title, and its place when its source gave none: the portal's words where there are some, else from the claims. */
export function nameEvent(e: CareEvent, household: Household, person: string): void {
  const v = e.visits[0]?.record;
  const vName = v ? str(v.fields.location) ?? str(v.fields.service_provider) ?? v.provenance.map((p) => p.source.organization_id).filter((x): x is string => !!x).map((o) => organizationName(household, person, o))[0] : undefined;
  e.place ??= vName ?? e.claims.find((c) => c.role === 'office')?.provider ?? e.claims[0]?.provider;
  if (v && v.display) {
    e.title = v.display;
    return;
  }
  const first = e.claims[0]?.record;
  if (e.kind === 'tests' && e.claims.length) {
    const cats = new Set(e.claims.map((c) => claimCategory(c.record)));
    e.title = cats.size === 1 && cats.has('imaging') ? 'Imaging' : cats.size === 1 && cats.has('lab') ? 'Lab tests' : 'Tests';
  } else if ((e.kind === 'service' || e.kind === 'fill' || e.kind === 'vaccine') && first) e.title = claimTitle(first);
  // A fill or a vaccine known only from the portal is named for what it was.
  else if (!e.claims.length && e.recorded[0]?.display && (e.kind === 'fill' || e.kind === 'vaccine')) e.title = e.recorded[0].display;
  else e.title = KIND_TITLES[e.kind];
}
