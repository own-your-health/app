// A person's overview: what is going on now, read from the index's merged
// records (medrec has already merged each record across its sources, by
// kind, code and date). Each list here is one card on the person's first
// screen; the sections show everything.

import { medicines, resultSeries, seriesKey, sortByDateDesc, type MedicineGroup, type ResultPoint, type ResultSeries } from './records';
import type { MedDocument, MedRecord, PersonIndex } from './types';

/** Records a source withdrew: never shown as current. */
const WITHDRAWN = new Set(['entered-in-error']);

function live(r: MedRecord): boolean {
  return !WITHDRAWN.has(r.status ?? '');
}

// ---- Results against their range ----

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

function fromRange(value: number, range: string, unit: string | undefined): FlagLevel | undefined {
  const between = BETWEEN.exec(range);
  if (between) {
    const [, lo, unitLo, hi, unitHi] = between;
    if (!sameUnit(unitHi || unitLo, unit)) return undefined;
    return value < Number(lo) ? 'low' : value > Number(hi) ? 'high' : 'normal';
  }
  const below = BELOW.exec(range);
  if (below) {
    const [, op, hi, rangeUnit] = below;
    if (!sameUnit(rangeUnit, unit)) return undefined;
    const over = op === '<' || /less|under/i.test(op!) ? value >= Number(hi) : value > Number(hi);
    return over ? 'high' : 'normal';
  }
  const above = ABOVE.exec(range);
  if (above) {
    const [, op, lo, rangeUnit] = above;
    if (!sameUnit(rangeUnit, unit)) return undefined;
    const under = op === '>' || /greater|over/i.test(op!) ? value <= Number(lo) : value < Number(lo);
    return under ? 'low' : 'normal';
  }
  return undefined;
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

export interface LatestResult {
  series: ResultSeries;
  latest: ResultPoint;
  flag?: ResultFlag;
}

/** Each test's newest result: critical first, then other out-of-range ones, then the rest, newest first within each. */
export function latestResults(index: PersonIndex): LatestResult[] {
  const rank = (x: LatestResult) => (x.flag?.critical ? 0 : isOutOfRange(x.flag) ? 1 : 2);
  return resultSeries(index)
    .filter((s): s is ResultSeries & { latest: ResultPoint } => !!s.latest)
    .map((s) => ({ series: s, latest: s.latest, flag: resultFlag(s.latest) }))
    .sort((a, b) => rank(a) - rank(b) || (b.latest.date ?? '').localeCompare(a.latest.date ?? '') || a.series.name.localeCompare(b.series.name));
}

// ---- Conditions, allergies, medicines, immunizations, visits ----

/** One per code: the newest record of each, as medrec merged them per date. */
function newestPerCode(records: MedRecord[]): MedRecord[] {
  const seen = new Map<string, MedRecord>();
  for (const r of sortByDateDesc(records)) if (!seen.has(seriesKey(r))) seen.set(seriesKey(r), r);
  return [...seen.values()];
}

const ACTIVE_CONDITION = new Set(['active', 'recurrence', 'relapse']);

/** Conditions whose newest record is active (FHIR clinical status active, recurrence or relapse). */
export function activeConditions(index: PersonIndex): { active: MedRecord[]; other: number } {
  const all = newestPerCode(index.records.filter((r) => r.kind === 'condition' && live(r)));
  const active = all.filter((r) => ACTIVE_CONDITION.has(r.status ?? ''));
  return { active, other: all.length - active.length };
}

const ENDED_ALLERGY = new Set(['inactive', 'resolved']);

/** Allergies not marked inactive or resolved. One without a status is shown: an allergy list errs on the side of showing. */
export function currentAllergies(index: PersonIndex): MedRecord[] {
  return newestPerCode(index.records.filter((r) => r.kind === 'allergy' && live(r))).filter((r) => !ENDED_ALLERGY.has(r.status ?? ''));
}

export function currentMedicines(index: PersonIndex): MedicineGroup[] {
  return medicines(index).filter((g) => g.active);
}

const NOT_GIVEN = new Set(['not-done', 'entered-in-error']);

/** Doses given, newest first. */
export function immunizationsGiven(index: PersonIndex): MedRecord[] {
  return sortByDateDesc(index.records.filter((r) => r.kind === 'immunization' && !NOT_GIVEN.has(r.status ?? '')));
}

const NOT_A_VISIT = new Set(['cancelled', 'entered-in-error', 'planned']);

/** Visits that happened, newest first. */
export function recentVisits(index: PersonIndex, today: string): MedRecord[] {
  return sortByDateDesc(index.records.filter((r) => r.kind === 'encounter' && !NOT_A_VISIT.has(r.status ?? '') && (!r.date || r.date.slice(0, 10) <= today)));
}

// ---- New in the latest loads ----

export interface NewInLoad {
  cli: string;
  organization: string;
  at: string;
  records: MedRecord[];
  documents: MedDocument[];
}

/** How far back a load still counts as recent. */
export const RECENT_LOAD_MS = 30 * 86_400_000;

/**
 * What each source's newest import added, within RECENT_LOAD_MS. medrec
 * stamps a record's first provenance, and a document, with the import's
 * own `imported_at`, so a record first filed at that moment is new in it.
 * Newest load first; a load that added nothing is left out.
 */
export function newInLatestLoads(index: PersonIndex, now: Date): NewInLoad[] {
  const newest = new Map<string, PersonIndex['imports'][number]>();
  for (const run of index.imports) {
    const k = `${run.cli}|${run.organization}`;
    const prev = newest.get(k);
    if (!prev || run.imported_at > prev.imported_at) newest.set(k, run);
  }
  const firstFiled = (r: MedRecord) => r.provenance.map((p) => p.filed_at).sort()[0];
  const fromRun = (orgs: (string | undefined)[], run: PersonIndex['imports'][number]) => orgs.includes(run.organization);
  const out: NewInLoad[] = [];
  for (const run of newest.values()) {
    const age = now.getTime() - Date.parse(run.imported_at);
    if (age < 0 || age > RECENT_LOAD_MS) continue;
    const records = sortByDateDesc(
      index.records.filter((r) => firstFiled(r) === run.imported_at && fromRun(r.provenance.filter((p) => p.filed_at === run.imported_at).map((p) => p.source.organization_id), run)),
    );
    const documents = sortByDateDesc(index.documents.filter((d) => d.filed_at === run.imported_at && d.provenance.source.organization_id === run.organization));
    if (records.length || documents.length) out.push({ cli: run.cli, organization: run.organization, at: run.imported_at, records, documents });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
