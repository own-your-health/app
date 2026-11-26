// One result in context, for its page: how it reads against the lab's
// range, the other tests from the same draw, and the visit and report it
// came with.

import { isOutOfRange, outsidePart, rangeFor, resultFlag, type Range, type ResultFlag } from './flags';
import { panelOf } from './panels';
import { samePractice, through } from './practices';
import { day, isHeading, isWithdrawn, memberIds, resultSeries, seriesKey, type ResultPoint, type ResultSeries } from './records';
import { recordTitle } from './titles';
import type { Household, MedDocument, MedRecord, PersonIndex } from './types';
import { visitTimeline, type Visit } from './visits';

/** "uL" read as "µL", "ug" as "µg", "umol" as "µmol", as a lab report prints them. */
export function unitText(unit: string | undefined): string | undefined {
  return unit?.replace(/(^|[^A-Za-z])u(?=(L|l|g|mol|IU|U|m)\b)/g, '$1µ');
}

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

/** A range in words: "160–435 K/µL", "under 130 mg/dL", "40 or more mg/dL". */
export function rangeWords(r: Range, unit: string | undefined): string {
  const u = unitText(r.unit ?? unit);
  const tail = u ? ` ${u}` : '';
  if (r.low !== undefined && r.high !== undefined) return `${num(r.low)}–${num(r.high)}${tail}`;
  if (r.high !== undefined) return r.highStrict ? `under ${num(r.high)}${tail}` : `${num(r.high)}${tail} or less`;
  if (r.low !== undefined) return r.lowStrict ? `over ${num(r.low)}${tail}` : `${num(r.low)}${tail} or more`;
  return '';
}

/** What a row says of a result's range: its own, or that of the part out of its range that flags it, by name. */
export function rangeText(p: ResultPoint, test: string): string {
  if (p.range) return unitText(p.range) ?? p.range;
  const part = outsidePart(p.parts);
  if (!part?.point.range) return '';
  const range = rangeFor(part.point.range, part.point.unit);
  const name = part.name.startsWith(`${test}, `) ? part.name.slice(test.length + 2) : part.name;
  return `${name}: ${range ? rangeWords(range, part.point.unit) : (unitText(part.point.range) ?? part.point.range)}`;
}

export interface Verdict {
  /** One sentence: where the value sits against the lab's range, or what the lab said. */
  text: string;
  outOfRange: boolean;
  flag?: ResultFlag;
  range?: Range;
}

/**
 * How a result reads: against the lab's range when both are numbers in one
 * unit, else what the lab marked. Never more than that: what it means for
 * the person is for their doctor.
 */
export function verdict(p: Pick<ResultPoint, 'value' | 'bound' | 'unit' | 'range' | 'interpretation' | 'parts'>): Verdict {
  const flag = resultFlag(p);
  // Of several parts, with nothing said of the whole: each part outside its range, by name.
  if (p.parts?.length && !resultFlag({ ...p, parts: undefined })) {
    const read = p.parts.map((x) => ({ name: x.name, verdict: verdict(x.point) }));
    const outside = read.filter((x) => x.verdict.outOfRange);
    if (outside.length) return { text: outside.map((x) => `${x.name}: ${x.verdict.text}`).join(' '), outOfRange: true, flag };
    // Each part that has a range read against it, or the rows below say each.
    const ranged = read.filter((_, i) => p.parts![i]!.point.range);
    if (!p.range && ranged.length) return { text: ranged.every((x) => x.verdict.flag) ? 'No part that has a range is outside it.' : 'Its parts and their ranges are below.', outOfRange: false };
  }
  const range = rangeFor(p.range, p.unit);
  const words = range ? rangeWords(range, p.unit) : p.range;
  const out = isOutOfRange(flag);
  // The range read on its own, to say where the value sits when the lab's mark agrees with it.
  const byRange = range && (p.value !== undefined || p.bound) ? resultFlag({ value: p.value, bound: p.bound, unit: p.unit, range: p.range }) : undefined;
  if (flag && byRange && range && (flag.from === 'range' || flag.level === byRange.level)) {
    const where = byRange.level === 'high' ? 'Above' : byRange.level === 'low' ? 'Below' : 'Within';
    const of = range.low !== undefined && range.high !== undefined ? `of ${words}` : `(${words})`;
    const critical = flag.critical ? ' The lab marked it critical.' : '';
    return { text: `${where} the lab’s range ${of}.${critical}`, outOfRange: out, flag, range };
  }
  if (flag?.from === 'source') {
    const said = flag.label.toLowerCase();
    return { text: `The lab marked it ${said}${words ? `. Its range is ${words}` : ''}.`, outOfRange: out, flag, range };
  }
  return { text: words ? `The lab’s range is ${words}.` : 'The lab gave no range for this result.', outOfRange: false, range };
}

export interface ResultContext {
  series?: ResultSeries;
  point?: ResultPoint;
  /** The panel it is in ("Blood count (CBC)"), by its code or category. */
  panel: string;
  /** Other results from the same day and practice, its own panel first. */
  sameDraw: { panel: string; records: MedRecord[] }[];
  visit?: Visit;
  /** The lab report documents and report records it came with. */
  documents: MedDocument[];
  reports: MedRecord[];
}

export function resultContext(index: PersonIndex, household: Household, person: string, today: string, r: MedRecord): ResultContext {
  // A heading is no result of the test it may share a code with.
  const series = isHeading(r) ? undefined : resultSeries(index).find((s) => s.key === seriesKey(r));
  const point = series?.points.find((p) => p.id === r.id);
  const categoryOf = (x: MedRecord) => (typeof x.fields.category === 'string' ? x.fields.category : undefined);
  const own = panelOf(index, seriesKey(r), categoryOf(r));
  const d = day(r.date);
  // Its visit's records, or those its sign-in shows to be the same practice's.
  const visit = visitTimeline(index, household, person, today).visits.find((v) => v.recorded.some((g) => g.records.includes(r)));
  const atVisit = new Set(visit?.recorded.flatMap((g) => g.records));
  const mine = through(household, person, r.provenance);
  const together = (x: MedRecord) => atVisit.has(x) || through(household, person, x.provenance).some((t) => mine.some((m) => samePractice(m, t)));
  const listed = new Set(memberIds(r.fields));
  const draw = index.records.filter((x) => x !== r && !listed.has(x.id) && x.kind === 'result' && !isHeading(x) && !isWithdrawn(x) && day(x.date) === d && together(x));
  const byPanel = new Map<string, { panel: string; order: number; records: { r: MedRecord; order: number }[] }>();
  for (const x of draw) {
    const p = panelOf(index, seriesKey(x), categoryOf(x));
    let g = byPanel.get(p.id);
    if (!g) byPanel.set(p.id, (g = { panel: p.name, order: p.id === own.id ? -1 : byPanel.size, records: [] }));
    g.records.push({ r: x, order: p.order });
  }
  const sameDraw = [...byPanel.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ panel: g.panel, records: g.records.sort((a, b) => a.order - b.order || recordTitle(a.r).localeCompare(recordTitle(b.r))).map((x) => x.r) }));
  const linked = r.documents.map((id) => index.documents.find((x) => x.id === id)).filter((x): x is MedDocument => !!x);
  const fromVisit = (visit?.documents ?? []).map((x) => x.doc).filter((x) => x.doc_type === 'lab_report' && day(x.date) === d);
  const documents = [...new Map([...linked, ...fromVisit].map((x) => [x.id, x])).values()];
  const reports = index.records.filter((x) => x.kind === 'report' && !isWithdrawn(x) && day(x.date) === d && together(x));
  return { series, point, panel: own.name, sameDraw, visit, documents, reports };
}
