// The Calendar: the household's events on the calendar people think
// in, a month at a time or as one list. A mark is an event, never a bill
// line: a dot for a visit or a test, a ring for a pharmacy trip or a vaccine,
// a bar across the days of an emergency room visit or a hospital stay.

import { HELD } from '../model/private';
import type { Household, Person, PersonIndex } from '../model/types';
import { eventMoney, eventPrivate, type CareEvent, type EventMoney } from './event';
import { personEvents } from './load';

export interface PersonEvent {
  person: Person;
  /** The person's place in the household: their lane and color. */
  lane: number;
  event: CareEvent;
  money: EventMoney;
  /** Why it stays off shared screens: its private area, or HELD; undefined when it does not. */
  private?: string;
}

/** Every loaded person's events, newest first; people whose records have not loaded are left out. */
export function householdEvents(household: Household, index: (id: string) => PersonIndex | undefined, today: string): PersonEvent[] {
  const out: PersonEvent[] = [];
  household.people.forEach((person, lane) => {
    const idx = index(person.id);
    if (!idx) return;
    for (const event of personEvents(idx, household, today)) {
      const area = eventPrivate(event, idx);
      out.push({ person, lane, event, money: eventMoney(event), ...(area ? { private: area } : {}) });
    }
  });
  return out.sort((a, b) => b.event.start.localeCompare(a.event.start) || b.event.end.localeCompare(a.event.end) || a.lane - b.lane || a.event.id.localeCompare(b.event.id));
}

/**
 * What a view shows: one person's events, private ones too (their own page),
 * or everyone's, where a private event shows only when the household turned
 * that on. `hidden` counts the private events left out. Events held back,
 * because no current list says which are private, never show on everyone's,
 * and are not counted as private.
 */
export function shown(events: PersonEvent[], who: string | undefined, showPrivate: boolean): { events: PersonEvent[]; hidden: number } {
  if (who) return { events: events.filter((x) => x.person.id === who), hidden: 0 };
  const cleared = events.filter((x) => x.private !== HELD);
  if (showPrivate) return { events: cleared, hidden: 0 };
  const kept = cleared.filter((x) => !x.private);
  return { events: kept, hidden: cleared.length - kept.length };
}

export type MarkShape = 'dot' | 'ring' | 'bar';

export function markShape(e: CareEvent): MarkShape {
  if (e.kind === 'er' || e.kind === 'stay') return 'bar';
  if (e.kind === 'fill' || e.kind === 'vaccine') return 'ring';
  return 'dot';
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(s: string | undefined): s is string {
  return !!s && MONTH.test(s);
}

export const monthOf = (day: string): string => day.slice(0, 7);

/** The month n months after this one (n may be negative). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

const iso = (t: Date) => t.toISOString().slice(0, 10);

/** The weeks that show this month, Sunday first, each seven days long; days of the months either side fill the first and last weeks. */
export function monthWeeks(month: string): string[][] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const last = new Date(Date.UTC(y, m, 0));
  const weeks: string[][] = [];
  for (const d = start; d <= last; ) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(iso(d));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** The events on a day: those that start, end or run through it. */
export const onDay = (events: PersonEvent[], day: string) => events.filter((x) => x.event.start <= day && day <= x.event.end);

/** The events of a month: those with a day in it. */
export function inMonth(events: PersonEvent[], month: string): PersonEvent[] {
  const first = `${month}-01`;
  const last = `${month}-31`;
  return events.filter((x) => x.event.start <= last && x.event.end >= first);
}

/** How many months the list shows at a time. */
export const LIST_MONTHS = 12;

/**
 * One page of the list: the newest `size` months with events, or those before
 * `before`; `earlier` is where the next page starts when there is one.
 */
export function listPage(events: PersonEvent[], before: string | undefined, size = LIST_MONTHS): { months: string[]; earlier?: string } {
  const all = [...new Set(events.map((x) => monthOf(x.event.start)))].filter((m) => !before || m < before);
  const months = all.slice(0, size);
  return all.length > size ? { months, earlier: months.at(-1)! } : { months };
}

/** Where a bar's day sits in its event: the first day, the last, one between, or a single day. */
export function barPart(e: CareEvent, day: string): 'start' | 'end' | 'mid' | 'one' {
  if (e.start === e.end) return 'one';
  if (day === e.start) return 'start';
  if (day === e.end) return 'end';
  return 'mid';
}
