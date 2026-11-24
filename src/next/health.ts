// Health: each person's page in a fixed order (Due, Current,
// Worth noticing, Recently, then Quiet), how much the records can know about
// them, and what a doctor's sheet holds. Quiet by default: what is not news
// is counted and kept one tap away, never dropped. A private item (medrec's
// `private`) shows on its person's own page, marked, and stays off shared
// views and the doctor's sheet unless turned on.

import { isOutOfRange } from '../model/flags';
import { allergyList, conditionList, medicineList, vaccineList, type AllergyItem, type ConditionItem, type MedicineItem, type VaccineItem } from '../model/lists';
import { latestResults, type LatestResult } from '../model/overview';
import { isWithdrawn, str } from '../model/records';
import type { MedRecord, PersonIndex } from '../model/types';
import { placeName } from '../model/words';

/** How long an out-of-range result stays worth noticing, and a result belongs on a doctor's sheet. */
export const NOTICE_DAYS = 730;

export type CoverageKind = 'records_and_claims' | 'records_only' | 'claims_only' | 'none';

/** What the records can know about a person: their doctors' records, their plan's claims, their papers. */
export interface Coverage {
  kind: CoverageKind;
  /** "Doctors' records and claims". */
  words: string;
  /** What that leaves out, in a sentence. */
  detail: string;
}

/** Kinds only a doctor's record gives; a claim or a paper gives none of them. */
const CLINICAL = new Set(['condition', 'result', 'immunization', 'allergy', 'encounter', 'procedure']);

export function coverageOf(index: PersonIndex): Coverage {
  const clinical = index.records.some((r) => CLINICAL.has(r.kind));
  const claims = index.records.some((r) => r.kind === 'claim');
  const papers = index.documents.length > 0;
  if (clinical && claims) return { kind: 'records_and_claims', words: 'Doctors’ records and claims', detail: `Doctors’ records, the plan’s claims${papers ? ' and papers' : ''}.` };
  if (clinical) return { kind: 'records_only', words: 'Doctors’ records only', detail: 'No claims are connected, so what care cost, and fills the doctors don’t list, are missing.' };
  if (claims || papers) return { kind: 'claims_only', words: 'Claims and papers only', detail: 'No doctor’s records are connected: no results, problems or allergies, only what claims and papers say.' };
  return { kind: 'none', words: 'No records yet', detail: 'Nothing has been loaded for this person yet.' };
}

/** Why an item is private, from any of its records: their area, or the household's own marking; undefined when none is. */
export function privateOf(records: MedRecord[]): string | undefined {
  const r = records.find((x) => x.private);
  return r ? (r.private_area ?? 'household') : undefined;
}

/** A result's record, for its privacy and its page. */
const recordOf = (index: PersonIndex, x: LatestResult) => index.records.find((r) => r.id === x.latest.id);

export const resultPrivate = (index: PersonIndex, x: LatestResult) => privateOf([recordOf(index, x)].filter((r): r is MedRecord => !!r));

/** Whether a result is a vital sign (weight, height, blood pressure) rather than a lab test. */
export const isVital = (index: PersonIndex, x: LatestResult) => /vital/i.test(String(recordOf(index, x)?.fields.category ?? ''));

export interface HealthItems {
  /** Current: active conditions, active medicines, current allergies. */
  conditions: ConditionItem[];
  medicines: MedicineItem[];
  allergies: AllergyItem[];
  /** Worth noticing: each test's newest result when it is out of range and from the last NOTICE_DAYS, critical first. */
  noticing: LatestResult[];
  /** Quiet: what is not news, kept and counted. */
  quiet: {
    conditions: ConditionItem[];
    medicines: MedicineItem[];
    allergies: AllergyItem[];
    /** Each test's newest result, in range. */
    inRange: LatestResult[];
    /** Out-of-range newest results older than NOTICE_DAYS. */
    olderFlags: LatestResult[];
    vaccines: VaccineItem[];
  };
}

const since = (today: string, days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** A person's health, sorted into what is current, what is worth noticing, and what is quiet. */
export function healthOf(index: PersonIndex, today: string): HealthItems {
  const conditions = conditionList(index);
  const medicines = medicineList(index);
  const allergies = allergyList(index);
  const from = since(today, NOTICE_DAYS);
  const results = latestResults(index);
  const flagged = results.filter((x) => isOutOfRange(x.flag));
  return {
    conditions: conditions.active,
    medicines: medicines.active,
    allergies: allergies.current,
    noticing: flagged.filter((x) => (x.latest.date ?? '') >= from),
    quiet: {
      conditions: [...conditions.ended, ...conditions.other],
      medicines: medicines.past,
      allergies: allergies.ended,
      inRange: results.filter((x) => !isOutOfRange(x.flag)),
      olderFlags: flagged.filter((x) => (x.latest.date ?? '') < from),
      vaccines: vaccineList(index).given,
    },
  };
}

/** How a result moved since the one before it: up, down or the same, when both have a number. */
export function trendOf(x: LatestResult): 'up' | 'down' | 'same' | undefined {
  const pts = x.series.points.filter((p) => p.value !== undefined && p.date);
  const i = pts.findIndex((p) => p.id === x.latest.id);
  const before = i > 0 ? pts[i - 1] : undefined;
  if (x.latest.value === undefined || !before || before.value === undefined) return undefined;
  return x.latest.value > before.value ? 'up' : x.latest.value < before.value ? 'down' : 'same';
}

/** The ICD-10 code a condition's newest record carries, for the doctor's sheet. */
export function icdOf(c: ConditionItem): string | undefined {
  const code = c.latest.code;
  return code?.code && /icd-?10/i.test(code.system ?? '') ? code.code : undefined;
}

export interface CareMember {
  name: string;
  /** The newest visit with them in the last NOTICE_DAYS, and where. */
  last?: string;
  place?: string;
  /** The current medicines they prescribe. */
  prescribes: string[];
}

/**
 * Who cares for a person: everyone they saw in the last NOTICE_DAYS, newest
 * visit first, and whoever prescribes their current medicines. Only from the
 * records `include` keeps, so a shared view never learns of a private visit.
 */
export function careTeam(index: PersonIndex, today: string, include: (r: MedRecord) => boolean = () => true): CareMember[] {
  const from = since(today, NOTICE_DAYS);
  const team = new Map<string, CareMember>();
  const member = (name: string) => {
    const k = name.trim().toLowerCase();
    let m = team.get(k);
    if (!m) team.set(k, (m = { name: name.trim(), prescribes: [] }));
    return m;
  };
  for (const r of index.records) {
    const who = r.kind === 'encounter' && !isWithdrawn(r) && include(r) ? str(r.fields.practitioner) : undefined;
    const day = r.date?.slice(0, 10);
    if (!who || !day || day < from) continue;
    const m = member(who);
    if (!m.last || day > m.last) {
      m.last = day;
      m.place = placeName(str(r.fields.service_provider)) ?? placeName(str(r.fields.location));
    }
  }
  for (const med of medicineList(index).active) {
    if (!med.prescriber || !med.records.every(include)) continue;
    const m = member(med.prescriber);
    if (!m.prescribes.includes(med.name)) m.prescribes.push(med.name);
  }
  return [...team.values()].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || a.name.localeCompare(b.name));
}

/** What a doctor's sheet holds: everything current and the recent results, private items left off unless asked for, and counted. */
export interface DoctorSheet {
  allergies: AllergyItem[];
  medicines: MedicineItem[];
  problems: ConditionItem[];
  /** Each vaccine with its doses, newest vaccine first. */
  vaccines: VaccineItem[];
  /** Each test's newest result from the last NOTICE_DAYS: lab tests, and vital signs. */
  labs: LatestResult[];
  vitals: LatestResult[];
  careTeam: CareMember[];
  /** How many private items were left off: a medicine, and a doctor known only from private care, are one each. */
  privateLeft: number;
}

export function doctorSheet(index: PersonIndex, today: string, withPrivate: boolean): DoctorSheet {
  const h = healthOf(index, today);
  const from = since(today, NOTICE_DAYS);
  const recent = latestResults(index).filter((x) => (x.latest.date ?? '') >= from);
  let left = 0;
  const keep = <T>(xs: T[], priv: (x: T) => string | undefined): T[] => {
    if (withPrivate) return xs;
    const out = xs.filter((x) => !priv(x));
    left += xs.length - out.length;
    return out;
  };
  const byName = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name));
  const vitals = recent.filter((x) => isVital(index, x));
  const team = careTeam(index, today, (r) => !r.private);
  return {
    allergies: keep(h.allergies, (x) => privateOf(x.records)),
    medicines: keep(byName(h.medicines), (x) => privateOf(x.records)),
    problems: keep(h.conditions, (x) => privateOf(x.records)),
    vaccines: keep(h.quiet.vaccines, (x) => privateOf(x.records)),
    labs: keep(
      recent.filter((x) => !vitals.includes(x)),
      (x) => resultPrivate(index, x),
    ),
    vitals: keep(vitals, (x) => resultPrivate(index, x)),
    careTeam: withPrivate ? careTeam(index, today) : team,
    privateLeft: left + (withPrivate ? 0 : careTeam(index, today).filter((m) => !team.some((t) => t.name === m.name)).length),
  };
}
