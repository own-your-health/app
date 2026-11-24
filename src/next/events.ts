// Events: what happened, one card however many claims, visits and papers it
// produced. This is a stand-in for medrec's events view
// (`views/<person>/events.json`), which is not released yet. It groups here,
// on the index, by the household's matching rules, so the redesign behind
// ?next can be built and tried on the sample. When medrec writes events,
// this file goes and the screens read those. Each grouping names its rule as
// the rules do (C1: a hospital's claim opens an event; E3: a portal visit
// joins the claims of its day; D2: a paper joins by provider and date).

import { CATEGORY_LABELS, claimAmounts, claimCategory, claimCents, claimTitle, claimVisitId, countedLines, isPharmacyClaim, type Category } from '../model/claims';
import { sameProvider } from '../model/providers';
import { day, decimalCents, isWithdrawn, organizationName, sortByDateDesc, str } from '../model/records';
import type { Household, MedDocument, MedRecord, PersonIndex } from '../model/types';
import { recentVisits, visitTimeline, type Visit } from '../model/visits';

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
} as const;
export type Rule = keyof typeof RULES;

const CONFIDENCE_ORDER: Confidence[] = ['sure', 'likely', 'unsure'];
const leastSure = (cs: Confidence[]): Confidence => CONFIDENCE_ORDER[Math.max(0, ...cs.map((c) => CONFIDENCE_ORDER.indexOf(c)))]!;

/** How sure the event is: the least sure of its parts. */
export function eventConfidence(e: CareEvent): Confidence {
  return leastSure([...e.claims.map((c) => c.confidence), ...e.visits.map((v) => v.confidence), ...e.papers.map((p) => p.confidence), e.doubt ? 'unsure' : 'sure']);
}

// ---- Claims (C) ----

interface Classified {
  record: MedRecord;
  start: string;
  end: string;
  provider?: string;
  type: 'facility' | 'professional' | 'pharmacy' | 'dental';
  facility?: 'er' | 'stay' | 'outpatient' | 'series';
  role?: ClaimRole;
  vaccine?: boolean;
}

const HOSPITAL_DOCTOR = /emergency|admitted to the hospital|hospital care|day of discharge|observation/i;

function period(r: MedRecord): { start?: string; end?: string } {
  const p = r.fields.billable_period;
  const obj = p && typeof p === 'object' && !Array.isArray(p) ? p : undefined;
  const start = day(str(obj?.start)) ?? day(r.date);
  const end = day(str(obj?.end));
  return { start, end: end && start && end > start ? end : start };
}

/** C0: what kind of claim it is, from its type, codes and words. */
function classify(r: MedRecord): Classified | undefined {
  const { start, end } = period(r);
  if (!start || !end) return undefined;
  const base = { record: r, start, end, provider: str(r.fields.provider) };
  const type = (str(r.fields.type) ?? r.code?.code ?? '').toLowerCase();
  const lines = countedLines(r);
  const category = claimCategory(r);
  if (isPharmacyClaim(r)) return { ...base, type: 'pharmacy', role: 'pharmacy', vaccine: lines.some((l) => l.category === 'vaccine' || /vaccin|immuni[sz]/i.test(l.label)) };
  if (type === 'oral' || category === 'dental') return { ...base, type: 'dental', role: 'dental' };
  if (type === 'institutional') {
    const facility = lines.some((l) => /^emerg/i.test(l.label) || /^045/.test(l.revenue?.code ?? ''))
      ? 'er'
      : lines.some((l) => /room and board|inpatient/i.test(l.label) || /^01/.test(l.revenue?.code ?? ''))
        ? 'stay'
        : end > start
          ? 'series'
          : 'outpatient';
    return { ...base, type: 'facility', facility, role: 'facility' };
  }
  const role: ClaimRole = lines.some((l) => HOSPITAL_DOCTOR.test(l.label))
    ? 'hospital'
    : category === 'lab' || category === 'imaging' || (lines.length > 0 && lines.every((l) => l.category === 'lab' || l.category === 'imaging'))
      ? 'ancillary'
      : category === 'visit' || lines.some((l) => l.category === 'visit')
        ? 'office'
        : 'service';
  return { ...base, type: 'professional', role };
}

const within = (d: string, e: { start: string; end: string }) => d >= e.start && d <= e.end;
const nextDay = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

function newEvent(id: string, kind: EventKind, start: string, end: string): CareEvent {
  return { id, kind, start, end, title: '', claims: [], visits: [], recorded: [], papers: [] };
}

const take = (e: CareEvent, c: Classified, rule: Rule, confidence: Confidence = 'sure') => {
  e.claims.push({ record: c.record, role: c.role ?? 'service', provider: c.provider, rule, confidence });
  if (c.start < e.start) e.start = c.start;
  if (c.end > e.end) e.end = c.end;
};

/** The claims as events, by rules C1 to C6. Every claim lands in exactly one event. */
function claimEvents(claims: Classified[]): CareEvent[] {
  const events: CareEvent[] = [];
  const left = new Set(claims);
  const use = (c: Classified) => left.delete(c);
  const byStart = [...claims].sort((a, b) => a.start.localeCompare(b.start) || a.record.id.localeCompare(b.record.id));

  // C1: each hospital claim opens an event over its dates; one hospital's overlapping claims are one.
  const rank = { stay: 3, er: 2, outpatient: 1, series: 0 } as const;
  for (const c of byStart.filter((x) => x.type === 'facility')) {
    if (!left.has(c)) continue;
    const e = newEvent(c.record.id, c.facility!, c.start, c.end);
    take(e, c, 'C1');
    use(c);
    if (c.facility !== 'series') {
      for (const o of byStart) {
        if (!left.has(o) || o.type !== 'facility' || o.facility === 'series' || !sameProvider(o.provider, c.provider)) continue;
        if (o.start > e.end || o.end < e.start) continue;
        take(e, o, 'C1');
        use(o);
        if (rank[o.facility!] > rank[e.kind as keyof typeof rank]) e.kind = o.facility!;
      }
    }
    e.place = c.provider;
    events.push(e);
  }
  // C2: an ER visit or stay takes the doctors', labs' and imaging claims dated within it.
  for (const e of events.filter((x) => x.kind === 'er' || x.kind === 'stay')) {
    for (const c of byStart) {
      if (left.has(c) && c.type === 'professional' && (c.role === 'hospital' || c.role === 'ancillary') && within(c.start, e)) {
        take(e, c, 'C2');
        use(c);
      }
    }
  }
  // C3: a same-day outpatient visit takes the day's professional claims but a hospital doctor's.
  for (const e of events.filter((x) => x.kind === 'outpatient')) {
    for (const c of byStart) {
      if (left.has(c) && c.type === 'professional' && c.role !== 'hospital' && c.start === e.start) {
        take(e, c, 'C3', 'likely');
        use(c);
      }
    }
  }
  // C4: a hospital doctor's claims on touching days, with no hospital claim, are a visit to the hospital.
  for (const c of byStart.filter((x) => x.role === 'hospital')) {
    if (!left.has(c)) continue;
    const e = newEvent(c.record.id, 'er', c.start, c.end);
    take(e, c, 'C4');
    use(c);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of byStart) {
        if (!left.has(o) || o.role !== 'hospital' || !sameProvider(o.provider, c.provider)) continue;
        if (o.start > nextDay(e.end) || nextDay(o.end) < e.start) continue;
        take(e, o, 'C4');
        use(o);
        grew = true;
      }
    }
    for (const o of byStart) {
      if (left.has(o) && o.type === 'professional' && sameProvider(o.provider, c.provider) && within(o.start, e)) {
        take(e, o, 'C4');
        use(o);
      }
    }
    if (e.claims.every((x) => !/emergency/i.test(countedLines(x.record).map((l) => l.label).join(' ')))) e.kind = 'stay';
    e.noFacility = true;
    events.push(e);
  }
  // C5: the rest, day by day and provider by provider.
  const days = [...new Set(byStart.filter((c) => left.has(c) && c.type === 'professional').map((c) => c.start))];
  for (const d of days) {
    const groups: Classified[][] = [];
    for (const c of byStart) {
      if (!left.has(c) || c.type !== 'professional' || c.start !== d) continue;
      const g = groups.find((x) => sameProvider(x[0]!.provider, c.provider));
      if (g) g.push(c);
      else groups.push([c]);
    }
    const offices: CareEvent[] = [];
    const tests: Classified[][] = [];
    for (const g of groups) {
      const roles = new Set(g.map((c) => c.role));
      if (roles.has('office')) {
        const e = newEvent(g[0]!.record.id, 'office', d, d);
        for (const c of g) {
          take(e, c, 'C5');
          use(c);
        }
        offices.push(e);
      } else if (roles.has('service')) {
        const e = newEvent(g[0]!.record.id, g.every((c) => claimCategory(c.record) === 'vaccine') ? 'vaccine' : 'service', d, d);
        for (const c of g) {
          take(e, c, 'C5');
          use(c);
        }
        events.push(e);
      } else tests.push(g);
    }
    events.push(...offices);
    const lab = tests.flat();
    if (!lab.length) continue;
    if (offices.length === 1) {
      for (const c of lab) {
        take(offices[0]!, c, 'C5j', 'likely');
        use(c);
      }
    } else {
      const e = newEvent(lab[0]!.record.id, 'tests', d, d);
      for (const c of lab) {
        take(e, c, 'C5');
        use(c);
      }
      if (offices.length > 1) e.doubt = `${offices.length} office visits that day could have ordered these`;
      events.push(e);
    }
  }
  // C6: a pharmacy's or dentist's claims, by provider and day.
  for (const c of byStart) {
    if (!left.has(c)) continue;
    const kind: EventKind = c.type === 'dental' ? 'dental' : c.vaccine ? 'vaccine' : 'fill';
    const e = events.find((x) => x.kind === kind && x.start === c.start && x.claims.some((y) => sameProvider(y.provider, c.provider))) ?? newEvent(c.record.id, kind, c.start, c.end);
    take(e, c, 'C6');
    use(c);
    if (!events.includes(e)) events.push(e);
  }
  return events;
}

// ---- The portal (E) and papers (D) ----

const VISIT_KINDS = new Set(['ambulatory', 'AMB', 'emergency', 'EMER', 'inpatient', 'IMP', 'observation', 'OBSENC', 'virtual', 'VR', 'home health', 'HH']);

function visitNames(v: Visit, household: Household, person: string): string[] {
  return [...v.organizations.map((o) => organizationName(household, person, o)), str(v.record.fields.location), str(v.record.fields.service_provider), str(v.record.fields.practitioner)].filter((x): x is string => !!x);
}

const PAPER_TYPES = new Set(['bill', 'receipt', 'discharge_summary', 'visit_summary', 'lab_report', 'imaging_report', 'prescription', 'letter', 'referral', 'other']);

/**
 * A person's events, newest first: claims grouped by rules C1 to C6, the
 * portal's visits joined to them (E2, E3) or standing alone, what the portal
 * recorded there (E4), and papers (D2, D3). `today` leaves out what is to come.
 */
export function careEvents(index: PersonIndex, household: Household, today: string): CareEvent[] {
  const claims = index.records
    .filter((r) => r.kind === 'claim' && !isWithdrawn(r))
    .map(classify)
    .filter((c): c is Classified => !!c && c.start <= today);
  const events = claimEvents(claims);
  const ofClaim = new Map(events.flatMap((e) => e.claims.map((c) => [c.record.id, e] as const)));

  // E2: the portal's visits at one place on one day are one.
  const { visits } = visitTimeline(index, household, index.person, today);
  const visitClass = (v: Visit) => {
    const c = str(v.record.fields.class);
    return !c || VISIT_KINDS.has(c);
  };
  const groups: Visit[][] = [];
  for (const v of [...visits].reverse().filter(visitClass)) {
    const g = groups.find((x) => x[0]!.start === v.start && (x[0]!.organizations.some((o) => v.organizations.includes(o)) || visitNames(x[0]!, household, index.person).some((n) => visitNames(v, household, index.person).some((m) => sameProvider(n, m)))));
    if (g) g.push(v);
    else groups.push([v]);
  }
  const visitIds = new Set(recentVisits(index, today).map((r) => r.id));
  for (const g of groups) {
    const first = g[0]!;
    const d = first.start;
    if (!d) continue;
    const names = g.flatMap((v) => visitNames(v, household, index.person));
    // medrec's own link wins; then the one claim event of the day (E3).
    const linked = [...new Set(g.flatMap((v) => events.filter((e) => e.claims.some((c) => claimVisitId(c.record) === v.record.id && visitIds.has(v.record.id)))))];
    let e: CareEvent | undefined;
    let rule: Rule = 'E0';
    let confidence: Confidence = 'sure';
    if (linked.length === 1) {
      e = linked[0];
      rule = 'M';
    } else {
      const candidates = events.filter((x) => !['fill', 'dental', 'series', 'vaccine'].includes(x.kind) && within(d, x) && !x.visits.length);
      if (candidates.length === 1) {
        e = candidates[0];
        const named = e!.claims.some((c) => names.some((n) => sameProvider(n, c.provider)));
        rule = named ? 'E3n' : 'E3';
        confidence = named ? 'sure' : 'likely';
      } else if (candidates.length > 1) {
        e = undefined;
        rule = 'E0';
        confidence = 'unsure';
      }
    }
    const kindOf = (v: Visit): EventKind => {
      const c = str(v.record.fields.class) ?? '';
      return /^(emergency|EMER)$/.test(c) ? 'er' : /^(inpatient|IMP|observation|OBSENC)$/.test(c) ? 'stay' : 'office';
    };
    if (!e) {
      e = newEvent(first.record.id, kindOf(first), d, first.end ?? d);
      if (confidence === 'unsure') e.doubt = 'More than one group of claims that day could be this visit';
      events.push(e);
    }
    for (const v of g) e.visits.push({ record: v.record, rule: g.length > 1 && v !== first ? 'E2' : rule, confidence });
    if (first.end && first.end > e.end) e.end = first.end;
    for (const v of g) {
      for (const k of v.recorded) for (const r of k.records) if (!e.recorded.includes(r)) e.recorded.push(r);
      for (const x of v.documents) if (!e.papers.some((p) => p.doc.id === x.doc.id)) e.papers.push({ doc: x.doc, rule: x.linked ? 'DM' : 'D2', confidence: 'sure' });
    }
  }

  // Papers: medrec's links to a claim, then D2, then D3.
  const placed = new Set(events.flatMap((e) => e.papers.map((p) => p.doc.id)));
  const docs = new Map(index.documents.map((d) => [d.id, d]));
  for (const c of claims) {
    const e = ofClaim.get(c.record.id);
    for (const id of c.record.documents) {
      const d = docs.get(id);
      if (e && d && !placed.has(id)) {
        e.papers.push({ doc: d, rule: 'DM', confidence: 'sure' });
        placed.add(id);
      }
    }
  }
  const providers = (e: CareEvent) => [e.place, ...e.claims.map((c) => c.provider)].filter((x): x is string => !!x);
  for (const d of sortByDateDesc(index.documents)) {
    const date = day(d.date);
    if (placed.has(d.id) || !date || !PAPER_TYPES.has(d.doc_type ?? 'other')) continue;
    const near = events.filter((e) => date >= e.start && date <= addDays(e.end, 3) && providers(e).some((p) => sameProvider(p, d.organization)));
    if (near.length) {
      const e = near.find((x) => within(date, x)) ?? near.sort((a, b) => a.end.localeCompare(b.end))[near.length - 1]!;
      e.papers.push({ doc: d, rule: 'D2', confidence: 'sure' });
      placed.add(d.id);
      continue;
    }
    if (d.doc_type !== 'bill' && d.doc_type !== 'receipt') continue;
    // A statement is dated when it was sent: it joins by its amount, the one
    // visit from its provider in the half year before it whose claim asks that much.
    const due = d.statement?.amount_due ? decimalCents(d.statement.amount_due.amount) : undefined;
    if (due !== undefined && due > 0) {
      const asked = events.filter((e) => e.start <= date && date <= addDays(e.start, 183) && eventMoney(e).charges.some((c) => sameProvider(c.provider, d.organization) && c.share === due));
      if (asked.length === 1) {
        asked[0]!.papers.push({ doc: d, rule: 'D3s', confidence: 'sure' });
        placed.add(d.id);
        continue;
      }
    }
    const named = events.some((e) => providers(e).some((p) => sameProvider(p, d.organization)));
    const that = events.filter((e) => e.kind !== 'fill' && within(date, e));
    if (!named && that.length === 1) {
      const e = that[0]!;
      const sure = due !== undefined && due === eventMoney(e).share;
      e.papers.push({ doc: d, rule: sure ? 'D3a' : 'D3', confidence: sure ? 'sure' : 'likely' });
      placed.add(d.id);
    }
  }

  for (const e of events) name(e, household, index.person);
  return events.sort((a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id));
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const KIND_TITLES: Record<EventKind, string> = {
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

/** Its title and place: the portal's words where there are some, else from the claims. */
function name(e: CareEvent, household: Household, person: string): void {
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
  else e.title = KIND_TITLES[e.kind];
}

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

/** The event a record belongs to: a claim, a portal visit, something recorded there, or a paper. */
export function eventOf(events: CareEvent[], id: string): CareEvent | undefined {
  return events.find((e) => e.id === id || e.claims.some((c) => c.record.id === id) || e.visits.some((v) => v.record.id === id) || e.recorded.some((r) => r.id === id) || e.papers.some((p) => p.doc.id === id));
}
