// The CDC's routine childhood immunization schedule, as a static table, and
// how a child's recorded doses line up with it. This is the schedule's own
// timing, not advice: the app says which doses the schedule places at the
// child's age that these records do not show, and which come next. Records
// can miss doses given elsewhere, and the schedule's catch-up rules, minimum
// intervals and exceptions are not applied here.
//
// Source: CDC, Child and Adolescent Immunization Schedule by Age,
// Recommendations for Ages 18 Years or Younger, United States, 2025, dated
// July 2, 2025: https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent-age-compliant.html
// and its notes. Only rows routine for all children are here (not shared
// clinical decision-making, high-risk or travel rows). RSV antibody at birth
// depends on the mother's vaccination, so it is left out.

import type { MedRecord } from './types';

export const SCHEDULE_SOURCE = {
  title: 'CDC Child and Adolescent Immunization Schedule by Age, 2025',
  date: '2025-07-02',
  url: 'https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent-age-compliant.html',
} as const;

/** A dose's place: an age range in months, or a time after the dose before it. */
type When = { age: [number, number] } | { after: [number, number] };

/** A product whose series differs from the antigen's usual one. */
interface Variant {
  /** The product's CVX codes, and its name when a dose has no CVX code. */
  cvx: string[];
  text: RegExp;
  /** Which of the antigen's doses its series has, by index. */
  doses: number[];
}

interface Antigen {
  id: string;
  name: string;
  doses: When[];
  /** Used when every dose given is this product; before a first dose, the count reads as each possibility. */
  variants?: Variant[];
  /** The age in months after which the schedule no longer gives it. */
  until?: number;
  /** CVX codes of vaccines that carry it, combinations included. */
  cvx: string[];
  /** Matches the vaccine's name when it has no CVX code. */
  text: RegExp;
}

const Y = 12;

export const ANTIGENS: Antigen[] = [
  { id: 'hepb', name: 'Hepatitis B', doses: [{ age: [0, 0] }, { age: [1, 2] }, { age: [6, 18] }], cvx: ['08', '42', '43', '44', '45', '51', '102', '104', '110', '146', '189'], text: /hep(atitis)?\s*-?\s*b\b|hepb|engerix|recombivax/i },
  // Rotarix is 2 doses; RotaTeq, or any unknown dose, makes it 3.
  { id: 'rota', name: 'Rotavirus', doses: [{ age: [2, 2] }, { age: [4, 4] }, { age: [6, 6] }], until: 8, cvx: ['116', '119', '122'], text: /rota/i, variants: [{ cvx: ['119'], text: /rotarix/i, doses: [0, 1] }] },
  { id: 'dtap', name: 'DTaP (diphtheria, tetanus, whooping cough)', doses: [{ age: [2, 2] }, { age: [4, 4] }, { age: [6, 6] }, { age: [15, 18] }, { age: [4 * Y, 6 * Y] }], until: 7 * Y, cvx: ['01', '20', '22', '50', '102', '106', '107', '110', '120', '130', '146'], text: /dtap|dtp\b|daptacel|infanrix|pediarix|pentacel|kinrix|quadracel|vaxelis/i },
  // PedvaxHIB (PRP-OMP) is 3 doses, with no 6-month dose; the others 4.
  { id: 'hib', name: 'Hib (Haemophilus influenzae type b)', doses: [{ age: [2, 2] }, { age: [4, 4] }, { age: [6, 6] }, { age: [12, 15] }], until: 5 * Y, cvx: ['17', '46', '47', '48', '49', '50', '51', '102', '120', '146', '148'], text: /\bhib\b|haemophilus|acthib|hiberix|pedvaxhib|pentacel|vaxelis/i, variants: [{ cvx: ['49'], text: /pedvax/i, doses: [0, 1, 3] }] },
  { id: 'pcv', name: 'Pneumococcal conjugate', doses: [{ age: [2, 2] }, { age: [4, 4] }, { age: [6, 6] }, { age: [12, 15] }], until: 5 * Y, cvx: ['100', '133', '152', '215', '216'], text: /pneumococcal conjugate|\bpcv\d*\b|prevnar|vaxneuvance/i },
  { id: 'ipv', name: 'Polio (IPV)', doses: [{ age: [2, 2] }, { age: [4, 4] }, { age: [6, 18] }, { age: [4 * Y, 6 * Y] }], until: 18 * Y, cvx: ['10', '89', '110', '120', '130', '146'], text: /\bipv\b|polio|ipol|pediarix|pentacel|kinrix|quadracel|vaxelis/i },
  { id: 'mmr', name: 'MMR (measles, mumps, rubella)', doses: [{ age: [12, 15] }, { age: [4 * Y, 6 * Y] }], until: 18 * Y, cvx: ['03', '94'], text: /\bmmr|measles|proquad/i },
  { id: 'var', name: 'Chickenpox (varicella)', doses: [{ age: [12, 15] }, { age: [4 * Y, 6 * Y] }], until: 18 * Y, cvx: ['21', '94'], text: /varicella|chickenpox|varivax|proquad|mmrv/i },
  { id: 'hepa', name: 'Hepatitis A', doses: [{ age: [12, 23] }, { after: [6, 18] }], until: 18 * Y, cvx: ['31', '83', '84', '85', '104'], text: /hep(atitis)?\s*-?\s*a\b|hepa\b|havrix|vaqta|twinrix/i },
  { id: 'tdap', name: 'Tdap', doses: [{ age: [11 * Y, 12 * Y] }], until: 18 * Y, cvx: ['115'], text: /tdap|boostrix|adacel/i },
  { id: 'hpv', name: 'HPV', doses: [{ age: [11 * Y, 12 * Y] }, { after: [6, 12] }], until: 18 * Y, cvx: ['62', '118', '137', '165'], text: /\bhpv|papilloma|gardasil|cervarix/i },
  { id: 'menacwy', name: 'Meningococcal ACWY', doses: [{ age: [11 * Y, 12 * Y] }, { age: [16 * Y, 16 * Y] }], until: 18 * Y + 11, cvx: ['108', '114', '136', '147', '203'], text: /menacwy|mcv4|menactra|menveo|menquadfi|meningococcal (conjugate|acwy)/i },
];

/** Influenza: every season from 6 months; 2 doses in a child's first season under 9. */
export const FLU = { id: 'flu', name: 'Flu (influenza)', from: 6, cvx: ['15', '16', '88', '111', '135', '140', '141', '144', '149', '150', '151', '153', '155', '158', '161', '166', '168', '171', '185', '186', '197', '205'], text: /influenza|\bflu\b|fluzone|flucelvax|flulaval|fluarix|afluria|flumist/i };

const NOT_GIVEN = new Set(['not-done', 'entered-in-error']);

function cvxOf(r: MedRecord): string | undefined {
  const c = r.code;
  if (!c?.code || (c.system && !/cvx/i.test(c.system))) return undefined;
  return c.code.replace(/^0+(?=\d{2})/, '').padStart(2, '0');
}

function carries(r: MedRecord, a: { cvx: string[]; text: RegExp }): boolean {
  const cvx = cvxOf(r);
  if (cvx) return a.cvx.includes(cvx);
  return a.text.test(`${r.display} ${r.code?.display ?? ''}`);
}

/** The days a child got a vaccine carrying this antigen: one per day, oldest first. */
function doseDays(records: MedRecord[], a: { cvx: string[]; text: RegExp }): { day: string; record: MedRecord }[] {
  const byDay = new Map<string, MedRecord>();
  for (const r of records) {
    if (r.kind !== 'immunization' || NOT_GIVEN.has(r.status ?? '') || !r.date) continue;
    if (!carries(r, a)) continue;
    const day = r.date.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, r);
  }
  return [...byDay].sort(([x], [y]) => x.localeCompare(y)).map(([day, record]) => ({ day, record }));
}

/** Whole months from `birth` to `day` (both YYYY-MM-DD). */
export function monthsBetween(birth: string, day: string): number {
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (y - by) * 12 + (m - bm) - (d < bd ? 1 : 0);
}

/** The day `months` months after `day`. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

function ageText(months: number): string {
  if (months === 0) return 'birth';
  if (months < 24) return `${months} ${months === 1 ? 'month' : 'months'}`;
  return `${Math.floor(months / 12)} years`;
}

function windowText([from, to]: [number, number]): string {
  if (from === to) return ageText(from);
  if (from >= 24 && to >= 24) return `${Math.floor(from / 12)}–${Math.floor(to / 12)} years`;
  if (from < 24 && to < 24) return `${from}–${to} months`;
  return `${ageText(from)} to ${ageText(to)}`;
}

export type DoseState = 'given' | 'not_recorded' | 'coming_up' | 'later' | 'past_age';

export interface ScheduleRow {
  id: string;
  name: string;
  /** Doses the schedule gives in all (for this child's products). */
  total: number;
  /** The total in words: "2 or 3" while no dose says which brand. */
  totalText: string;
  given: { day: string; record: MedRecord }[];
  /** The first dose not in these records, if the schedule still gives it. */
  next?: { dose: number; state: Exclude<DoseState, 'given'>; from: string; when: string };
}

/** How far ahead a dose counts as coming up. */
export const COMING_UP_DAYS = 90;

/**
 * Each antigen against the schedule for a child born on `birth`, as of
 * `today`. Under 19 only; the adult schedule is different.
 */
export function scheduleFor(birth: string, records: MedRecord[], today: string): ScheduleRow[] | undefined {
  const age = monthsBetween(birth, today);
  if (age < 0 || age >= 19 * Y) return undefined;
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + COMING_UP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows: ScheduleRow[] = [];
  for (const a of ANTIGENS) {
    const given = doseDays(records, a);
    const variant = given.length ? a.variants?.find((v) => given.every((g) => carries(g.record, v))) : undefined;
    const doses = variant ? variant.doses.map((i) => a.doses[i]!) : a.doses;
    // Before a first dose, the product (and so the count) is not known.
    const counts = given.length ? [doses.length] : [...new Set([a.doses.length, ...(a.variants ?? []).map((v) => v.doses.length)])].sort((x, y) => x - y);
    const row: ScheduleRow = { id: a.id, name: a.name, total: doses.length, totalText: counts.join(' or '), given };
    const k = given.length;
    if (k < doses.length) {
      const w = doses[k]!;
      let from: string;
      let when: string;
      if ('age' in w) {
        from = addMonths(birth, w.age[0]);
        when = `at ${windowText(w.age)}`;
      } else {
        const prev = given[k - 1]?.day;
        const prevWindow = doses[k - 1];
        const base = prev ?? (prevWindow && 'age' in prevWindow ? addMonths(birth, prevWindow.age[0]) : birth);
        from = addMonths(base, w.after[0]);
        when = `${w.after[0]}–${w.after[1]} months after dose ${k}`;
      }
      const state: Exclude<DoseState, 'given'> = a.until !== undefined && age >= a.until ? 'past_age' : from <= today ? 'not_recorded' : from <= soon ? 'coming_up' : 'later';
      row.next = { dose: k + 1, state, from, when };
    }
    rows.push(row);
  }
  return rows;
}

export interface FluSeason {
  /** The season, as "2026–27". */
  season: string;
  /** Doses this season the schedule gives: 2 in a first season under 9, else 1. */
  due: number;
  given: { day: string; record: MedRecord }[];
  /** Fewer doses this season in these records than the schedule gives. */
  missing: boolean;
}

/** This flu season (from July 1) for a child 6 months or older. */
export function fluSeason(birth: string, records: MedRecord[], today: string): FluSeason | undefined {
  const age = monthsBetween(birth, today);
  if (age < FLU.from || age >= 19 * Y) return undefined;
  const [y, m] = today.split('-').map(Number) as [number, number];
  const startYear = m >= 7 ? y : y - 1;
  const start = `${startYear}-07-01`;
  const all = doseDays(records, FLU);
  const before = all.filter((g) => g.day < start).length;
  const given = all.filter((g) => g.day >= start);
  const due = age < 9 * Y && before < 2 ? 2 : 1;
  return { season: `${startYear}–${String(startYear + 1).slice(2)}`, due, given, missing: given.length < due };
}

export type DigestEntry = { row: ScheduleRow & { next: NonNullable<ScheduleRow['next']> } } | { flu: FluSeason };

/**
 * What the overview lists: the doses the schedule places by now that these
 * records do not show (in the table's order), this season's flu dose if
 * missing, then the doses coming up within COMING_UP_DAYS, soonest first.
 */
export function scheduleDigest(rows: ScheduleRow[], flu: FluSeason | undefined): DigestEntry[] {
  const withNext = rows.filter((r): r is ScheduleRow & { next: NonNullable<ScheduleRow['next']> } => !!r.next);
  const notRecorded = withNext.filter((r) => r.next.state === 'not_recorded');
  const comingUp = withNext.filter((r) => r.next.state === 'coming_up').sort((a, b) => a.next.from.localeCompare(b.next.from));
  return [...notRecorded.map((row) => ({ row })), ...(flu?.missing ? [{ flu }] : []), ...comingUp.map((row) => ({ row }))];
}
