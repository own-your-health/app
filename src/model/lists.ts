// The Conditions, Allergies, Medicines and Immunizations sections as lists a
// person can read: one entry per condition, allergy, medicine or vaccine
// (medrec keeps a record per date), its status in words, when it was first
// and last recorded, and every source that recorded it.

import { isDoseGiven, isWithdrawn, medicines, seriesKey, sortByDateDesc, type MedicineGroup } from './records';
import type { Json, MedRecord, PersonIndex, Provenance } from './types';

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

const str = (v: Json | undefined): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

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
}

function items(records: MedRecord[]): ListItem[] {
  const groups = new Map<string, MedRecord[]>();
  for (const r of records) {
    const k = seriesKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups].map(([key, rs]) => {
    const sorted = sortByDateDesc(rs);
    const latest = sorted[0]!;
    const dated = sorted.filter((r) => r.date);
    return { key, name: latest.display || latest.code?.display || 'Unnamed', latest, records: sorted, first: dated[dated.length - 1]?.date, provenance: sorted.flatMap((r) => r.provenance) };
  });
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
  /** Notes for the row, beyond its group: Unconfirmed, Ruled out, Recurred, Relapsed, In remission. */
  notes: string[];
}

/**
 * Active, ended (inactive, remission, resolved), and other (no status, or
 * ruled out: FHIR verification status refuted), by the newest record of
 * each condition. Newest first in each.
 */
export function conditionList(index: PersonIndex): { active: ConditionItem[]; ended: ConditionItem[]; other: ConditionItem[] } {
  const all = items(index.records.filter((r) => r.kind === 'condition' && !isWithdrawn(r)))
    .map((i): ConditionItem => {
      const status = i.latest.status ?? '';
      const verification = str(i.latest.fields.verification_status) ?? '';
      const refuted = verification === 'refuted';
      const notes = [UNCONFIRMED.has(verification) ? 'Unconfirmed' : null, refuted ? 'Ruled out' : null, status && !PLAIN.has(status) ? statusText(status)! : null].filter((x): x is string => !!x);
      return { ...i, ended: str(i.latest.fields.abatement), isActive: ACTIVE.has(status) && !refuted, notes };
    })
    .sort(newestFirst);
  const ended = (i: ConditionItem) => !i.notes.includes('Ruled out') && ENDED.has(i.latest.status ?? '');
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

/** Current (anything not inactive or resolved, a missing status included) and ended. */
export function allergyList(index: PersonIndex): { current: AllergyItem[]; ended: AllergyItem[] } {
  const all = items(index.records.filter((r) => r.kind === 'allergy' && !isWithdrawn(r)))
    .map((i): AllergyItem => {
      const reactions = i.records.flatMap((r) => (Array.isArray(r.fields.reaction) ? r.fields.reaction.filter((x): x is string => typeof x === 'string') : []));
      return { ...i, reactions: [...new Set(reactions)], criticality: str(i.latest.fields.criticality) };
    })
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
}

const KNOWN: Record<string, string> = { request: 'prescribed', statement: 'reported', dispense: 'filled' };

/** Active (any record active) and past, newest first; withdrawn records count for nothing. */
export function medicineList(index: PersonIndex): { active: MedicineItem[]; past: MedicineItem[] } {
  const all = medicines({ ...index, records: index.records.filter((r) => !isWithdrawn(r)) })
    .map((g): MedicineItem => {
      const rs = g.records;
      const dated = rs.filter((r) => r.date);
      const fill = rs.find((r) => r.fields.source === 'dispense');
      const days = fill?.fields.days_supply;
      return {
        ...g,
        first: dated[dated.length - 1]?.date,
        known: [...new Set(rs.map((r) => KNOWN[str(r.fields.source) ?? ''] ?? '').filter(Boolean))],
        prescriber: rs.map((r) => str(r.fields.prescriber)).find(Boolean),
        lastFill: fill ? { date: fill.date, pharmacy: str(fill.fields.pharmacy), daysSupply: typeof days === 'number' ? days : undefined } : undefined,
        provenance: rs.flatMap((r) => r.provenance),
      };
    })
    .sort((a, b) => (b.latest.date ?? '').localeCompare(a.latest.date ?? '') || a.name.localeCompare(b.name));
  return { active: all.filter((m) => m.active), past: all.filter((m) => !m.active) };
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
