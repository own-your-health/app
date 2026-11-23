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

function sameUnit(rangeUnit: string | undefined, unit: string | undefined): boolean {
  const a = rangeUnit?.trim().toLowerCase();
  const b = unit?.trim().toLowerCase();
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

function fromRange(value: number, range: string, unit: string | undefined): FlagLevel | undefined {
  const r = rangeFor(range, unit);
  if (!r) return undefined;
  if (r.low !== undefined && (r.lowStrict ? value <= r.low : value < r.low)) return 'low';
  if (r.high !== undefined && (r.highStrict ? value >= r.high : value > r.high)) return 'high';
  return 'normal';
}

const LABELS: Record<FlagLevel, string> = { high: 'High', low: 'Low', abnormal: 'Abnormal', normal: 'Normal' };

/**
 * Whether a result is out of its range: the source's interpretation when it
 * gave one this app can read, otherwise the value against the reference
 * range, when both are numbers in the same unit. Undefined when neither says.
 */
export function resultFlag(p: Pick<ResultPoint, 'value' | 'unit' | 'range' | 'interpretation'>): ResultFlag | undefined {
  const said = p.interpretation ? fromInterpretation(p.interpretation) : undefined;
  if (said) {
    const label = !said.critical ? LABELS[said.level] : said.level === 'abnormal' ? 'Critical' : `Critical ${LABELS[said.level].toLowerCase()}`;
    return { ...said, from: 'source', label };
  }
  if (p.value === undefined || !p.range) return undefined;
  const level = fromRange(p.value, p.range, p.unit);
  if (!level) return undefined;
  return { level, critical: false, from: 'range', label: level === 'high' ? 'Above range' : level === 'low' ? 'Below range' : 'In range' };
}

export function isOutOfRange(f: ResultFlag | undefined): f is ResultFlag {
  return !!f && f.level !== 'normal';
}
