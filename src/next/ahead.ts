// What is ahead of a person as lines: the vaccine doses due and coming up,
// and the refills running out. Home's Do now and Coming up, and the
// calendar's Ahead, show the same lines. Refills of one person in one week
// share a line, and so do doses.

import { called } from '../model/people';
import { whyHeld } from '../model/private';
import type { Person, PersonIndex } from '../model/types';
import { count, monthDayText } from '../ui/format';
import type { Route } from '../ui/router';
import { addDays, refillsDue, vaccineNeeds, type DoseVisit, type Refill, type VaccineNeeds } from './needs';

export interface AheadLine {
  person: Person;
  /** The day it sorts by. */
  day: string;
  /** Overdue or due today; else it is coming up. */
  now: boolean;
  title: string;
  /** What it is, after the person's name. */
  text: string;
  /** The same on Home, shorter. */
  brief: string;
  /** Its day, or "Due" or "Today". */
  tag: string;
  late: boolean;
  /** In a few words, for the person's one line on Home: "Flu due". */
  short: string;
  route: Route;
  /** Why it is private, when it is. */
  private?: string;
}

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** The Sunday that starts a day's week. */
const weekOf = (day: string) => addDays(day, -weekday(day));

/** A vaccine's name without what it protects against: "DTaP". */
const vaccine = (name: string) => name.replace(/ \(.*\)$/, '');
const dose = (d: DoseVisit['doses'][number]) => `${vaccine(d.name)} vaccine, dose ${d.next.dose}`;

function dueLine(person: Person, v: VaccineNeeds): AheadLine[] {
  const flu = v.flu ? [`Flu vaccine, ${v.flu.season} season`] : [];
  const names = [...v.due.map(dose), ...flu];
  if (!names.length) return [];
  const one = names.length === 1;
  const listed = [...v.due.map((d) => `${vaccine(d.name)}, dose ${d.next.dose}`), ...(v.flu ? [`Flu, ${v.flu.season} season`] : [])].join(', ');
  const days = [...v.due.map((d) => d.next.from), ...(v.flu ? [v.flu.from] : [])].sort();
  return [
    {
      person,
      day: days[0]!,
      now: true,
      title: one ? names[0]! : `${names.length} vaccine doses`,
      text: one ? 'the schedule places it by now, and these records don’t show it' : `${listed} · the schedule places them by now, and these records don’t show them`,
      brief: one ? 'not in these records' : listed,
      tag: 'Due',
      late: true,
      short: one ? `${v.flu ? 'Flu' : 'Vaccine'} due` : `${names.length} doses due`,
      route: { name: 'person', person: person.id, section: 'immunizations' },
    },
  ];
}

/** Visits whose windows open in one week are one line: a dose counted from the one before it need not open on an age's day. */
function visitLines(person: Person, visits: DoseVisit[]): AheadLine[] {
  const weeks = new Map<string, DoseVisit[]>();
  for (const v of visits) weeks.set(weekOf(v.from), [...(weeks.get(weekOf(v.from)) ?? []), v]);
  return [...weeks.values()].map((vs): AheadLine => {
    const first = vs[0]!;
    const doses = vs.flatMap((v) => v.doses);
    const one = doses.length === 1 ? doses[0]! : undefined;
    const months = vs.length === 1 ? first.months : undefined;
    const names = doses.map((d) => vaccine(d.name)).join(', ');
    const from = monthDayText(first.from);
    return {
      person,
      day: first.from,
      now: false,
      title: one ? dose(one) : months !== undefined ? `${months}-month vaccines` : `${doses.length} vaccine doses`,
      text: [`from ${from}`, one ? one.next.when : names].join(' · '),
      brief: one ? `from then, ${one.next.when}` : months !== undefined ? `${count(doses.length, 'vaccine')}, from then` : names,
      tag: from,
      late: false,
      short: from,
      route: { name: 'person', person: person.id, section: 'immunizations' },
    };
  });
}

/** Refills of one week are one line; a private one never shares one with others. */
function refillLines(person: Person, refills: Refill[]): AheadLine[] {
  const weeks = new Map<string, Refill[]>();
  for (const r of refills) {
    const k = `${weekOf(r.runsOut)}|${r.days <= 0}|${r.private ?? ''}`;
    weeks.set(k, [...(weeks.get(k) ?? []), r]);
  }
  return [...weeks.values()].map((rs): AheadLine => {
    const first = rs[0]!;
    const now = first.days <= 0;
    const one = rs.length === 1;
    const when = (r: Refill) => `${r.days < 0 ? 'ran' : 'runs'} out about ${monthDayText(r.runsOut)}`;
    const filled = first.medicine.lastFill!;
    return {
      person,
      day: first.runsOut,
      now,
      title: one ? first.medicine.name : `${rs.length} refills`,
      text: one
        ? [`refill: ${when(first)}`, `${filled.daysSupply} days filled ${monthDayText(filled.date!)}${filled.pharmacy ? ` at ${filled.pharmacy}` : ''}`].join(' · ')
        : rs.map((r) => `${r.medicine.name} ${when(r)}`).join(' · '),
      brief: one ? `${first.days < 0 ? 'ran' : 'runs'} out about then` : rs.map((r) => r.medicine.name).join(', '),
      tag: first.days === 0 ? 'Today' : monthDayText(first.runsOut),
      late: first.days < 0,
      short: now ? (one ? 'Refill due' : `${rs.length} refills`) : monthDayText(first.runsOut),
      route: one ? { name: 'item', person: person.id, id: first.medicine.latest.id } : { name: 'health', who: person.id },
      ...(first.private ? { private: first.private } : {}),
    };
  });
}

/**
 * One person's lines, soonest first. On their own page (`own`) private ones
 * are in; on a shared one they are left out, and a person whose items are
 * held back has none.
 */
export function aheadOf(person: Person, idx: PersonIndex, today: string, own: boolean): AheadLine[] {
  if (!own && whyHeld(idx)) return [];
  const v = vaccineNeeds(person.birth_date, idx, today);
  const refills = refillsDue(idx, today).filter((r) => own || !r.private);
  return bySoonest([...(v ? [...dueLine(person, v), ...visitLines(person, v.visits)] : []), ...refillLines(person, refills)]);
}

/** Everyone's lines, or one person's, soonest first. */
export function aheadAll(people: Person[], index: (id: string) => PersonIndex | undefined, today: string, who?: string): AheadLine[] {
  return bySoonest(people.flatMap((p) => (who && p.id !== who ? [] : index(p.id) ? aheadOf(p, index(p.id)!, today, who === p.id) : [])));
}

const bySoonest = (lines: AheadLine[]): AheadLine[] => lines.sort((a, b) => Number(b.now) - Number(a.now) || a.day.localeCompare(b.day) || called(a.person).localeCompare(called(b.person)));
