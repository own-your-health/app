// A person's coverage over time: each insurer and plan, from when to when,
// newest first. Two sources often describe the same coverage (the insurer's
// own records and a provider portal's copy), and they may spell the insurer
// differently ("Example Health Plan", "EXAMPLE HEALTH PLAN, INC."): the same insurer
// starting on the same day is one coverage, whichever source names it.
//
// No source in these records says why a coverage changed. FHIR's Coverage has
// no element for it. When a coverage starts on the day someone in the
// household was born, the app says so, as a date the two share; it does not
// claim that the birth is the reason.

import { dayInPeriod, type CostLine, type PeriodId } from './costs';
import { practiceOrId } from './practices';
import { sameProvider } from './providers';
import { day, isWithdrawn, str } from './records';
import type { Household, JsonObject, MedRecord, PersonIndex } from './types';
import { called } from './people';

export interface CoverageSegment {
  /** The insurer, as the insurer's own records spell it when they are here. */
  insurer: string;
  plan?: string;
  /** "self", "child", "spouse", as the coverage gives it. */
  relationship?: string;
  start?: string;
  /** The last day, when a record gives one; none for a coverage that runs on. */
  end?: string;
  /** Every record of this coverage, from every source that has one. */
  records: MedRecord[];
  /** The sources whose records these are, by name. */
  sources: string[];
  /** The person's earliest coverage in these records. */
  first: boolean;
  /** Someone in the household born the day this coverage started. */
  born?: { id: string; name: string; short?: string };
}

/** An insurer prints "runs on" as the end of time. */
const RUNS_ON = /^9999-/;

function payerOf(r: MedRecord): string | undefined {
  return str(r.fields.payer) ?? (r.display || undefined);
}

function periodOf(r: MedRecord): { start?: string; end?: string } {
  const p = r.fields.period;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const o = p as JsonObject;
  const end = day(str(o.end));
  return { start: day(str(o.start)), end: end && !RUNS_ON.test(end) ? end : undefined };
}

/** The person's coverage, newest first: one entry for each insurer and start day, whichever sources name it. */
export function coverageHistory(index: PersonIndex, household: Household, person: string): CoverageSegment[] {
  const groups: { start?: string; records: MedRecord[] }[] = [];
  for (const r of index.records) {
    if (r.kind !== 'coverage' || isWithdrawn(r)) continue;
    const start = periodOf(r).start;
    const name = payerOf(r);
    const g = groups.find((x) => x.start === start && x.records.some((o) => sameProvider(payerOf(o), name)));
    if (g) g.records.push(r);
    else groups.push({ start, records: [r] });
  }
  const sourcesOf = (r: MedRecord) => r.provenance.map((p) => practiceOrId(household, person, p.source)).filter((x): x is string => !!x);
  const segments = groups.map(({ start, records }): CoverageSegment => {
    // The insurer's own record (its source is the insurer) names it; else the first that names it at all.
    const own = records.find((r) => sourcesOf(r).some((name) => sameProvider(name, payerOf(r))));
    const named = own ?? records.find((r) => payerOf(r)) ?? records[0]!;
    // An end is something a record says; a record without one only says nothing.
    const ends = records.map((r) => periodOf(r).end).filter((e): e is string => !!e);
    const born = start ? household.people.find((p) => p.birth_date && day(p.birth_date) === start) : undefined;
    return {
      insurer: payerOf(named) ?? 'A plan',
      plan: records.map((r) => str(r.fields.plan)).find(Boolean),
      relationship: records.map((r) => str(r.fields.relationship)).find(Boolean),
      start,
      end: ends.sort().at(-1),
      records,
      sources: [...new Set(records.flatMap(sourcesOf))],
      first: false,
      born: born ? { id: born.id, name: born.name, ...(born.short ? { short: born.short } : {}) } : undefined,
    };
  });
  segments.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
  const earliest = segments.filter((s) => s.start).at(-1);
  if (earliest) earliest.first = true;
  return segments;
}

/** A coverage that began after the person's first in these records, or that began on someone's birthday. */
export function isChange(s: CoverageSegment): s is CoverageSegment & { start: string } {
  return !!s.start && (!s.first || !!s.born);
}

/** "the day Wren was born". Nothing when no one was born the day the coverage started. */
export function bornClause(s: CoverageSegment): string | undefined {
  return s.born && s.start ? `the day ${called(s.born)} was born` : undefined;
}

/** "Changed on May 17, 2016, the day Casey was born." Nothing when no one was born that day. */
export function birthWords(s: CoverageSegment, dateText: (d: string) => string): string | undefined {
  const born = bornClause(s);
  return born ? `${s.first ? 'Started' : 'Changed'} on ${dateText(s.start!)}, ${born}.` : undefined;
}

/**
 * The coverage changes inside a period, for the people whose cost lines are
 * in it: each judged against that person's own lines (their plan years, the
 * calendar year, or any day), in the order the people first appear.
 */
export function coverageChangesIn(
  lines: CostLine[],
  period: PeriodId,
  indexOf: (person: string) => PersonIndex | undefined,
  household: Household,
): { person: string; change: CoverageSegment & { start: string } }[] {
  return [...new Set(lines.map((l) => l.person))].flatMap((person) => {
    const index = indexOf(person);
    if (!index) return [];
    const own = lines.filter((l) => l.person === person);
    return coverageHistory(index, household, person)
      .filter(isChange)
      .filter((c) => dayInPeriod(c.start, period, own))
      .map((change) => ({ person, change }));
  });
}
