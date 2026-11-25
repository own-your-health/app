// The Conditions, Allergies, Medicines and Immunizations sections as lists a
// person can read: one entry per condition, allergy, medicine or vaccine
// (medrec keeps a record per date), its status in words, when it was first
// and last recorded, and every source that recorded it.
//
// What is current is what medrec's standing.json says by every source's word
// (model/standing.ts). Without it, the newest record's status says, and
// nothing is told of sources that differ. Every list is of the records it may
// show (`may`): one it may not is as if it were not in the records.

import { isDoseGiven, isWithdrawn, medicines, seriesKey, sortByDateDesc, str, type MedicineGroup } from './records';
import { groupOn, saidOnLine, sourceName, standingLists, type Group, type Line, type Said, type Standing, type Standings, type StandingKind } from './standing';
import type { MedRecord, PersonIndex, Provenance } from './types';
import { placeName } from './words';

/** FHIR status codes, in words. */
export const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  recurrence: 'Recurred',
  relapse: 'Relapsed',
  inactive: 'Inactive',
  remission: 'In remission',
  resolved: 'Resolved',
  completed: 'Completed',
  stopped: 'Stopped',
  'on-hold': 'On hold',
  cancelled: 'Cancelled',
  draft: 'Draft',
  intended: 'Intended',
  'not-taken': 'Not taken',
  'not-done': 'Not given',
  unknown: 'Status unknown',
  'entered-in-error': 'Entered in error',
};

export function statusText(status: string | undefined): string | undefined {
  if (!status) return undefined;
  return STATUS_TEXT[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, ' ');
}

/** One condition, allergy or vaccine across the dates it was recorded. */
export interface ListItem {
  key: string;
  name: string;
  /** The newest record: its status and fields describe the item now. */
  latest: MedRecord;
  /** Newest first. */
  records: MedRecord[];
  /** The earliest date recorded. */
  first?: string;
  provenance: Provenance[];
  /** What its sources say of it, where standing.json says. */
  standing?: ItemStanding;
}

/** What one source says, by its name. */
export interface SaidBy {
  name: string;
  word: Said;
}

/** What an item is by every source's word. */
export interface ItemStanding {
  group: Group;
  /** The standing of the record that names it. */
  of: Standing;
  differs: boolean;
  said: SaidBy[];
  /** The sources not heard. */
  unheard: string[];
  /** The records that say otherwise, beside its own. */
  against: MedRecord[];
  /** A medicine ended by its date was filled after it. */
  filled?: string;
}

/** What a list by standing.json says beside its items. */
export interface ListNotes {
  /** How many are entered in error, and not shown. */
  inError: number;
  /** The sources with no problem list, whose visits' diagnoses are in all. */
  noProblemList: string[];
}

/** The records a list may show. */
export type May = (id: string) => boolean;
const everything: May = () => true;

const items = (records: MedRecord[]): ListItem[] => grouped(records).map(([key, rs]) => item(key, sortByDateDesc(rs)));

/** Records, newest first, as one item. */
function item(key: string, records: MedRecord[]): ListItem {
  const latest = records[0]!;
  const dated = records.filter((r) => r.date);
  return { key, name: latest.display || latest.code?.display || 'Unnamed', latest, records, first: dated[dated.length - 1]?.date, provenance: records.flatMap((r) => r.provenance) };
}

/** The items of a list made without standing.json, each shown only when all of it may be. */
const shownOf = <T extends { records: MedRecord[] }>(xs: T[], may: May): T[] => xs.filter((x) => x.records.every((r) => may(r.id)));

/** What each source says of a line, by its name, and those not heard. */
export function saidOf(st: Standings, l: Pick<Line, 'records' | 'against' | 'unheard'>): Pick<ItemStanding, 'said' | 'unheard'> {
  return { said: saidOnLine(st, l).map((word) => ({ name: sourceName(st, word.source), word })), unheard: [...new Set(l.unheard.map((n) => sourceName(st, n)))] };
}

interface ByStanding {
  current: ListItem[];
  onHold: ListItem[];
  endedByDate: ListItem[];
  rest: ListItem[];
  all: ListItem[];
  notes: ListNotes;
}

/** A kind's lists by standing.json; undefined without it. */
function byStanding(index: PersonIndex, kind: StandingKind, day: string, may: May): ByStanding | undefined {
  const st = index.standing;
  if (!st) return undefined;
  // One entered in error is counted, where it may be.
  const byId = new Map([...index.records, ...(index.inError?.records ?? [])].map((r) => [r.id, r]));
  const records = (ids: string[]) => ids.map((id) => byId.get(id)!);
  const lists = standingLists(st, kind, day, (id) => byId.has(id) && may(id));
  const make = (l: Line): ListItem => {
    const of = st.records.get(l.records[0]!)!;
    return {
      ...item(l.records[0]!, records(l.records)),
      standing: {
        group: groupOn(of, day),
        of,
        differs: l.differs,
        ...saidOf(st, l),
        against: records(l.against),
        ...(l.filled?.date ? { filled: l.filled.date } : {}),
      },
    };
  };
  return {
    current: lists.current.map(make),
    onHold: lists.onHold.map(make),
    endedByDate: lists.endedByDate.map(make),
    rest: lists.rest.map(make),
    all: lists.all.map(make),
    notes: { inError: lists.inError, noProblemList: [...new Set(lists.withoutProblemList.map((n) => sourceName(st, n)))] },
  };
}

function grouped(records: MedRecord[]): [string, MedRecord[]][] {
  const groups = new Map<string, MedRecord[]>();
  for (const r of records) {
    const k = seriesKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups];
}

const newestFirst = (a: ListItem, b: ListItem) => (b.latest.date ?? '').localeCompare(a.latest.date ?? '') || a.name.localeCompare(b.name);

// ---- Conditions ----

const ACTIVE = new Set(['active', 'recurrence', 'relapse']);
const ENDED = new Set(['inactive', 'remission', 'resolved']);
/** Statuses the group's heading already says, so a row needs no note for them. */
const PLAIN = new Set(['active', 'inactive', 'resolved']);
const UNCONFIRMED = new Set(['provisional', 'differential', 'unconfirmed']);

export interface ConditionItem extends ListItem {
  /** When it ended, from the newest record's abatement. */
  ended?: string;
  /** Active (FHIR active, recurrence or relapse) and not ruled out. */
  isActive: boolean;
  /** The source was not sure: verification provisional, differential or unconfirmed. */
  unconfirmed: boolean;
  /** The source ruled it out: verification refuted. */
  refuted: boolean;
  /** A status the group's heading does not already say: Recurred, Relapsed, In remission. */
  statusNote?: string;
}

export interface ConditionLists {
  active: ConditionItem[];
  ended: ConditionItem[];
  other: ConditionItem[];
  /** By standing.json alone: every record by itself, and what is said beside the list. */
  all?: ConditionItem[];
  notes?: ListNotes;
}

/**
 * Active, ended and other. By standing.json: the lines that are current, the
 * records that are ended, and those ruled out or given as a diagnosis at a
 * visit. Without it, by the newest record of each condition, newest first in
 * each: active, ended (inactive, remission, resolved), and other (no status,
 * or ruled out: FHIR verification status refuted).
 */
export function conditionList(index: PersonIndex, day: string, may: May = everything): ConditionLists {
  const condition = (i: ListItem): ConditionItem => {
    const status = i.latest.status ?? '';
    const verification = str(i.latest.fields.verification_status) ?? '';
    const refuted = i.standing ? i.standing.of.is === 'refuted' : verification === 'refuted';
    return {
      ...i,
      ended: str(i.latest.fields.abatement),
      isActive: i.standing ? i.standing.group === 'current' : ACTIVE.has(status) && !refuted,
      unconfirmed: UNCONFIRMED.has(verification),
      refuted,
      statusNote: status && !PLAIN.has(status) ? statusText(status) : undefined,
    };
  };
  const s = byStanding(index, 'condition', day, may);
  if (s) {
    const rest = s.rest.map(condition);
    const isEnded = (i: ConditionItem) => i.standing?.of.is === 'ended';
    return { active: s.current.map(condition), ended: rest.filter(isEnded), other: rest.filter((i) => !isEnded(i)), all: s.all.map(condition), notes: s.notes };
  }
  const all = shownOf(items(index.records.filter((r) => r.kind === 'condition' && !isWithdrawn(r))), may)
    .map(condition)
    .sort(newestFirst);
  const ended = (i: ConditionItem) => !i.refuted && ENDED.has(i.latest.status ?? '');
  return { active: all.filter((i) => i.isActive), ended: all.filter(ended), other: all.filter((i) => !i.isActive && !ended(i)) };
}

// ---- Allergies ----

export interface AllergyItem extends ListItem {
  /** Every reaction any record names, once each. */
  reactions: string[];
  criticality?: string;
}

/** FHIR criticality, in words: the risk of a severe reaction. */
export const CRITICALITY_TEXT: Record<string, string> = {
  high: 'high risk of a severe reaction',
  low: 'low risk of a severe reaction',
  'unable-to-assess': 'risk not assessed',
};

export interface AllergyLists {
  current: AllergyItem[];
  ended: AllergyItem[];
  /** By standing.json alone: every record by itself, and what is said beside the list. */
  all?: AllergyItem[];
  notes?: ListNotes;
}

/** Current and ended. Without standing.json, current is anything not inactive or resolved, a missing status included. */
export function allergyList(index: PersonIndex, day: string, may: May = everything): AllergyLists {
  const allergy = (i: ListItem): AllergyItem => {
    const reactions = i.records.flatMap((r) => (Array.isArray(r.fields.reaction) ? r.fields.reaction.filter((x): x is string => typeof x === 'string') : []));
    return { ...i, reactions: [...new Set(reactions)], criticality: str(i.latest.fields.criticality) };
  };
  const s = byStanding(index, 'allergy', day, may);
  if (s) return { current: s.current.map(allergy), ended: s.rest.map(allergy), all: s.all.map(allergy), notes: s.notes };
  const all = shownOf(items(index.records.filter((r) => r.kind === 'allergy' && !isWithdrawn(r))), may)
    .map(allergy)
    .sort(newestFirst);
  const isEnded = (i: AllergyItem) => i.latest.status === 'inactive' || i.latest.status === 'resolved';
  return { current: all.filter((i) => !isEnded(i)), ended: all.filter(isEnded) };
}

// ---- Medicines ----

export interface MedicineItem extends MedicineGroup {
  first?: string;
  /** How the records know of it: prescribed, reported, filled. */
  known: string[];
  prescriber?: string;
  /** The newest fill, from a dispense record. */
  lastFill?: { date?: string; pharmacy?: string; daysSupply?: number };
  provenance: Provenance[];
  /** What medicines of one code or name share: the heading their prescriptions are under. */
  heading: string;
  standing?: ItemStanding;
}

export interface MedicineLists {
  active: MedicineItem[];
  past: MedicineItem[];
  /** By standing.json alone: prescriptions on hold, and those ended by their date. */
  onHold: MedicineItem[];
  endedByDate: MedicineItem[];
  /** By standing.json alone: each prescription by itself, then the medicines known by their fills, and what is said beside the list. */
  all?: MedicineItem[];
  notes?: ListNotes;
}

const KNOWN: Record<string, string> = { request: 'prescribed', statement: 'reported', dispense: 'filled' };

export const isFill = (r: MedRecord): boolean => r.kind === 'medication' && r.fields.source === 'dispense';
/** A fill that was given, as medrec counts them. */
export const isGiven = (r: MedRecord) => !r.status || r.status === 'completed' || r.status === 'unknown';

/** Letters with no accent to take off that medrec folds too. */
const LETTERS: Record<string, string> = { đ: 'd', ø: 'o', ł: 'l', ı: 'i', ß: 'ss', æ: 'ae' };

/** A name as medrec keys what has no code: in lowercase, without its accents, and what is no letter or digit as one space. */
export const fold = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/(?<=[a-z])\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[đøłıßæ]/g, (c) => LETTERS[c]!)
    .replace(/[^\p{Alphabetic}\p{N}]+/gu, ' ')
    .trim();

/** What a medicine shares with the others of its code or name: its prescription's line, or a fill's by the same rule. */
const headingOf = (index: PersonIndex, r: MedRecord): string => index.standing?.records.get(r.id)?.line ?? (r.code?.code ? `${r.code.system ?? ''}|${r.code.code}` : `~${fold(r.display)}`);

/** Every record of a medicine's code or name, its prescriptions and its fills. */
export const recordsOf = (index: PersonIndex, m: MedicineItem): MedRecord[] => (m.standing ? index.records.filter((r) => r.kind === 'medication' && headingOf(index, r) === m.heading) : m.records);

function medicine(g: MedicineGroup, heading: string): MedicineItem {
  const rs = g.records;
  const dated = rs.filter((r) => r.date);
  const fill = rs.find(isFill);
  const days = fill?.fields.days_supply;
  return {
    ...g,
    heading,
    first: dated[dated.length - 1]?.date,
    known: [...new Set(rs.map((r) => KNOWN[str(r.fields.source) ?? ''] ?? '').filter(Boolean))],
    prescriber: rs.map((r) => str(r.fields.prescriber)).find(Boolean),
    lastFill: fill ? { date: fill.date, pharmacy: placeName(str(fill.fields.pharmacy)), daysSupply: typeof days === 'number' ? days : undefined } : undefined,
    provenance: rs.flatMap((r) => r.provenance),
  };
}

const byDateThenName = (a: MedicineItem, b: MedicineItem) => (b.latest.date ?? '').localeCompare(a.latest.date ?? '') || a.name.localeCompare(b.name);

/**
 * Active and past. By standing.json each prescription is its own, with the
 * fills of its medicine, and a medicine that only fills are known of is past.
 * Without it, medicines by code or name, newest first: active when any record
 * of one is, and withdrawn records count for nothing.
 */
export function medicineList(index: PersonIndex, day: string, may: May = everything): MedicineLists {
  const s = byStanding(index, 'medication', day, may);
  if (s) return prescriptions(index, s, may);
  const groups = medicines({ ...index, records: index.records.filter((r) => !isWithdrawn(r)) });
  const all = shownOf(groups, may)
    .map((g) => medicine(g, g.key))
    .sort(byDateThenName);
  return { active: all.filter((m) => m.active), past: all.filter((m) => !m.active), onHold: [], endedByDate: [] };
}

function prescriptions(index: PersonIndex, s: ByStanding, may: May): MedicineLists {
  const wrong = new Set(index.standing?.inError.get('medication'));
  const fills = new Map<string, MedRecord[]>();
  for (const r of sortByDateDesc(index.records.filter((x) => isFill(x) && isGiven(x) && !wrong.has(x.id) && may(x.id)))) {
    const k = headingOf(index, r);
    fills.set(k, [...(fills.get(k) ?? []), r]);
  }
  // Its own date, words and prescriber; of its medicine's fills, what they say of the filling: one may be of another prescription.
  const prescription = (i: ListItem): MedicineItem => {
    const heading = i.standing!.of.line;
    return { ...medicine({ key: i.key, name: i.name, latest: i.latest, records: [i.latest, ...(fills.get(heading) ?? [])], active: i.standing!.group === 'current' }, heading), first: i.first, prescriber: str(i.latest.fields.prescriber), standing: i.standing };
  };
  const all = s.all.map(prescription);
  const prescribed = new Set(all.map((m) => m.heading));
  const filledOnly = [...fills].flatMap(([key, rs]) => (prescribed.has(key) ? [] : [medicine({ key, name: rs[0]!.display || rs[0]!.code?.display || 'Medicine', latest: rs[0]!, records: rs, active: false }, key)]));
  return { active: s.current.map(prescription), past: [...s.rest.map(prescription), ...filledOnly], onHold: s.onHold.map(prescription), endedByDate: s.endedByDate.map(prescription), all: [...all, ...filledOnly], notes: s.notes };
}

/** A list of medicines under their headings, in the list's order: those of one code or name together. */
export function underHeadings(xs: MedicineItem[]): MedicineItem[][] {
  const out = new Map<string, MedicineItem[]>();
  for (const m of xs) out.set(m.heading, [...(out.get(m.heading) ?? []), m]);
  return [...out.values()];
}

// ---- Immunizations ----

/** One vaccine, by its code, with the doses given oldest first. */
export interface VaccineItem extends ListItem {
  doses: MedRecord[];
}

/**
 * Doses given, one entry per vaccine with the most recent dose first, and
 * the records of doses not given (FHIR not-done), newest first.
 */
export function vaccineList(index: PersonIndex): { given: VaccineItem[]; notGiven: MedRecord[] } {
  const imm = index.records.filter((r) => r.kind === 'immunization');
  const given = items(imm.filter(isDoseGiven))
    .map((i): VaccineItem => ({ ...i, doses: [...i.records].reverse() }))
    .sort(newestFirst);
  return { given, notGiven: sortByDateDesc(imm.filter((r) => r.status === 'not-done')) };
}
