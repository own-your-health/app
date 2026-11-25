// What needs someone besides bills: a refill coming due by its last
// fill's days' supply, and a child's vaccine doses, those the schedule
// places by now that the records do not show and those coming up, grouped
// into the visits that give them.

import { medicineList, type MedicineItem } from '../model/lists';
import { fluSeason, monthsBetween, scheduleDigest, scheduleFor, type FluSeason, type ScheduleRow } from '../model/schedule';
import { recordsPrivate } from '../model/private';
import type { PersonIndex } from '../model/types';

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Whole days from one day to another; negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** How many days before and after a supply runs out its refill shows. */
export const REFILL_DAYS = 14;

export interface Refill {
  medicine: MedicineItem;
  /** The day the last fill's supply ends. */
  runsOut: string;
  /** Days from today to that day; negative once past. */
  days: number;
  /** Why it is private, when a record of the medicine is. */
  private?: string;
}

/** Active medicines whose last fill runs out within REFILL_DAYS either side of today, soonest first. */
export function refillsDue(index: PersonIndex, today: string): Refill[] {
  return medicineList(index)
    .active.flatMap((m): Refill[] => {
      const f = m.lastFill;
      if (!f?.date || !f.daysSupply) return [];
      const runsOut = addDays(f.date, f.daysSupply);
      const days = daysBetween(today, runsOut);
      if (Math.abs(days) > REFILL_DAYS) return [];
      const area = recordsPrivate(index, m.records.map((r) => r.id));
      return [{ medicine: m, runsOut, days, ...(area ? { private: area } : {}) }];
    })
    .sort((a, b) => a.runsOut.localeCompare(b.runsOut));
}

type Next = ScheduleRow & { next: NonNullable<ScheduleRow['next']> };

/** Doses whose window opens on the same day: one visit to the doctor. */
export interface DoseVisit {
  from: string;
  /** Days from today until it opens. */
  days: number;
  /** The child's age in whole months that day, when every dose is placed by age ("2-month vaccines"). */
  months?: number;
  doses: Next[];
}

export interface VaccineNeeds {
  /** Doses the schedule places by now that these records do not show. */
  due: Next[];
  /** This season's flu doses, when fewer are recorded than the schedule gives. */
  flu?: FluSeason;
  /** Doses coming up within the schedule's COMING_UP_DAYS, by the day their window opens. */
  visits: DoseVisit[];
}

/** A child's vaccine doses by the schedule, or undefined past its ages or with no birth date. */
export function vaccineNeeds(birth: string | undefined, index: PersonIndex, today: string): VaccineNeeds | undefined {
  if (!birth) return undefined;
  const rows = scheduleFor(birth, index.records, today);
  if (!rows) return undefined;
  const season = fluSeason(birth, index.records, today);
  const digest = scheduleDigest(rows, season);
  const due: Next[] = [];
  const soon: Next[] = [];
  for (const e of digest) {
    if ('flu' in e) continue;
    if (e.row.next.state === 'not_recorded') due.push(e.row);
    else if (e.row.next.state === 'coming_up') soon.push(e.row);
  }
  const visits: DoseVisit[] = [];
  for (const r of soon) {
    const v = visits.find((x) => x.from === r.next.from);
    if (v) v.doses.push(r);
    else visits.push({ from: r.next.from, days: daysBetween(today, r.next.from), doses: [r] });
  }
  for (const v of visits) if (v.doses.every((d) => d.next.when.startsWith('at '))) v.months = monthsBetween(birth, v.from);
  visits.sort((a, b) => a.from.localeCompare(b.from));
  return { due, ...(season?.missing ? { flu: season } : {}), visits };
}

