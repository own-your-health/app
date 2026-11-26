// Whether a result is out of its range: the source's own interpretation
// when it gave one this app can read, otherwise the value read against the
// reference range in the same unit.

import type { ResultPoint } from './records';

export type FlagLevel = 'high' | 'low' | 'abnormal' | 'normal';

export interface ResultFlag {
  level: FlagLevel;
  critical: boolean;
  /** Who said so: the source's own interpretation, or this app reading the range. */
  from: 'source' | 'range';
  label: string;
}

const NUM = '(-?\\d+(?:\\.\\d+)?)';
const BETWEEN = new RegExp(`^\\s*${NUM}\\s*([^\\d\\s–—-][^–—-]*?)?\\s*(?:-|–|—|to)\\s*${NUM}\\s*(.*)$`, 'i');
const BELOW = new RegExp(`^\\s*(<=|≤|<|less than|under)\\s*${NUM}\\s*(.*)$`, 'i');
const ABOVE = new RegExp(`^\\s*(>=|≥|>|greater than|over)\\s*${NUM}\\s*(.*)$`, 'i');

/** A unit as its spellings read alike: case, spaces and µ for u aside. */
export const unitKey = (unit: string | undefined): string => (unit ?? '').toLowerCase().replace(/\s+/g, '').replace(/[µμ]/g, 'u');

function sameUnit(rangeUnit: string | undefined, unit: string | undefined): boolean {
  const [a, b] = [unitKey(rangeUnit), unitKey(unit)];
  return !a || !b || a === b;
}

function fromInterpretation(text: string): Omit<ResultFlag, 'from' | 'label'> | undefined {
  const s = text.trim().toLowerCase();
  if (/^(hh|ll|aa|hu|lu)$/.test(s) || /critical|panic|alert/.test(s)) {
    const level: FlagLevel = /^(hh|hu)$/.test(s) || /high|above/.test(s) ? 'high' : /^(ll|lu)$/.test(s) || /low|below/.test(s) ? 'low' : 'abnormal';
    return { level, critical: true };
  }
  if (/^(h|>)$/.test(s) || /high|above/.test(s)) return { level: 'high', critical: false };
  if (/^(l|<)$/.test(s) || /low|below/.test(s)) return { level: 'low', critical: false };
  // "abnormal" before "normal": the one contains the other.
  if (/^(a|abn)$/.test(s) || /abnormal|out of range|outside/.test(s)) return { level: 'abnormal', critical: false };
  if (/^n$/.test(s) || /normal|^wnl$|within/.test(s)) return { level: 'normal', critical: false };
  return undefined;
}

/** A value a lab gave only as a bound: "<0.5" is { op: '<', n: 0.5 }. */
export interface Bound {
  op: '<' | '<=' | '>' | '>=';
  n: number;
}

/** A reference range as numbers, when it reads as one. */
export interface Range {
  low?: number;
  high?: number;
  /** A value equal to the bound is out of range ("<130": 130 is high). */
  lowStrict?: boolean;
  highStrict?: boolean;
  unit?: string;
}

/**
 * Reads "70-99 mg/dL", "11 g/dL – 15 g/dL" (medrec's form for a structured
 * range), "<130 mg/dL", "≤ 5", "> 40", "≥ 40 mg/dL", "10 to 20".
 */
export function parseRange(range: string): Range | undefined {
  const between = BETWEEN.exec(range);
  if (between) {
    const [, lo, unitLo, hi, unitHi] = between;
    return { low: Number(lo), high: Number(hi), unit: (unitHi || unitLo)?.trim() || undefined };
  }
  const below = BELOW.exec(range);
  if (below) {
    const [, op, hi, unit] = below;
    return { high: Number(hi), highStrict: op === '<' || /less|under/i.test(op!), unit: unit?.trim() || undefined };
  }
  const above = ABOVE.exec(range);
  if (above) {
    const [, op, lo, unit] = above;
    return { low: Number(lo), lowStrict: op === '>' || /greater|over/i.test(op!), unit: unit?.trim() || undefined };
  }
  return undefined;
}

/** The range, when its unit (if it names one) is the value's. */
export function rangeFor(range: string | undefined, unit: string | undefined): Range | undefined {
  const r = range ? parseRange(range) : undefined;
  return r && sameUnit(r.unit, unit) ? r : undefined;
}

/** Values from lo to hi; an open end leaves the bound itself out. */
interface Span {
  lo: number;
  loOpen: boolean;
  hi: number;
  hiOpen: boolean;
}

const inside = (a: Span, b: Span) =>
  (a.lo > b.lo || (a.lo === b.lo && (a.loOpen || !b.loOpen))) && (a.hi < b.hi || (a.hi === b.hi && (a.hiOpen || !b.hiOpen)));

function boundSpan({ op, n }: Bound): Span {
  return op === '<' || op === '<='
    ? { lo: -Infinity, loOpen: true, hi: n, hiOpen: op === '<' }
    : { lo: n, loOpen: op === '>', hi: Infinity, hiOpen: true };
}

/**
 * Where a value sits against the range. A bound ("<0.5") reads only when
 * every value it allows sits on the same side: "<0.5" against 0–1 could be
 * either, so it says nothing.
 */
function fromRange(p: { value?: number; bound?: Bound }, range: string, unit: string | undefined): FlagLevel | undefined {
  const r = rangeFor(range, unit);
  if (!r) return undefined;
  const span: Span | undefined = p.value !== undefined ? { lo: p.value, loOpen: false, hi: p.value, hiOpen: false } : p.bound ? boundSpan(p.bound) : undefined;
  if (!span) return undefined;
  if (r.low !== undefined && inside(span, { lo: -Infinity, loOpen: true, hi: r.low, hiOpen: !r.lowStrict })) return 'low';
  if (r.high !== undefined && inside(span, { lo: r.high, loOpen: !r.highStrict, hi: Infinity, hiOpen: true })) return 'high';
  const normal: Span = { lo: r.low ?? -Infinity, loOpen: r.low === undefined || !!r.lowStrict, hi: r.high ?? Infinity, hiOpen: r.high === undefined || !!r.highStrict };
  // A single value is always somewhere; only a bound can straddle the range's edge.
  return p.value !== undefined || inside(span, normal) ? 'normal' : undefined;
}

const LABELS: Record<FlagLevel, string> = { high: 'High', low: 'Low', abnormal: 'Abnormal', normal: 'Normal' };

/**
 * Whether a result is out of its range: the source's interpretation when it
 * gave one this app can read, otherwise the value against the reference
 * range, when both are numbers in the same unit. A result of several parts of
 * which neither says is as the part out of range (outsidePart). Undefined when
 * nothing says.
 */
export function resultFlag(p: Pick<ResultPoint, 'value' | 'bound' | 'unit' | 'range' | 'interpretation' | 'parts'>): ResultFlag | undefined {
  const said = p.interpretation ? fromInterpretation(p.interpretation) : undefined;
  if (said) {
    const label = !said.critical ? LABELS[said.level] : said.level === 'abnormal' ? 'Critical' : `Critical ${LABELS[said.level].toLowerCase()}`;
    return { ...said, from: 'source', label };
  }
  const level = (p.value !== undefined || p.bound) && p.range ? fromRange(p, p.range, p.unit) : undefined;
  if (level) return { level, critical: false, from: 'range', label: level === 'high' ? 'Above range' : level === 'low' ? 'Below range' : 'In range' };
  const part = outsidePart(p.parts);
  return part ? resultFlag(part.point) : undefined;
}

/** The part a result of several is flagged by where the whole says nothing: the first out of its range, a critical one first. */
export function outsidePart<P extends { point: Pick<ResultPoint, 'value' | 'bound' | 'unit' | 'range' | 'interpretation'> }>(parts: P[] | undefined): P | undefined {
  const out = (parts ?? []).filter((x) => isOutOfRange(resultFlag(x.point)));
  return out.find((x) => resultFlag(x.point)!.critical) ?? out[0];
}

export function isOutOfRange(f: ResultFlag | undefined): f is ResultFlag {
  return !!f && f.level !== 'normal';
}
