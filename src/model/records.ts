// Views over one person's index: the timeline, results over time,
// medicines, lists, claims and bills.

import type { Household, ImagingStudy, ImportRun, Json, JsonObject, MedDocument, MedRecord, PersonIndex, Provenance } from './types';
import { parseRange, unitKey, type Bound } from './flags';
import { isObject } from './parse';
import { isLoinc, labTest, resultName } from './labtests';
import { practiceName, practiceOf } from './practices';
import { placeName } from './words';

export const KIND_LABELS: Record<string, string> = {
  encounter: 'Visit',
  result: 'Result',
  report: 'Report',
  condition: 'Condition',
  medication: 'Medicine',
  allergy: 'Allergy',
  immunization: 'Immunization',
  procedure: 'Procedure',
  coverage: 'Coverage',
  claim: 'Claim',
  document: 'Document',
  study: 'Imaging',
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  visit_summary: 'Visit summary',
  lab_report: 'Lab report',
  imaging_report: 'Imaging report',
  immunization_record: 'Immunization record',
  discharge_summary: 'Discharge summary',
  referral: 'Referral',
  prescription: 'Prescription',
  letter: 'Letter',
  bill: 'Bill',
  receipt: 'Receipt',
  eob: 'Explanation of benefits',
  insurance_card: 'Insurance card',
  other: 'Document',
};

export function docTypeLabel(t: string | undefined): string {
  return (t && DOC_TYPE_LABELS[t]) || 'Document';
}

const FILE_ENDING = /\.(pdf|png|jpe?g|gif|tiff?|heic|webp|html?|xml|txt|rtf|docx?|bin)$/i;

/** A paper's title, else its file's name without the ending, else its type. */
export function documentTitle(d: MedDocument): string {
  return d.title || d.original_name?.replace(FILE_ENDING, '').trim() || docTypeLabel(d.doc_type);
}

export function studyTitle(s: ImagingStudy): string {
  const what = s.description || [s.modalities.join('/'), s.body_part].filter(Boolean).join(' ');
  return what || 'Imaging study';
}

export type Item =
  | { type: 'record'; record: MedRecord; inError?: true }
  | { type: 'document'; document: MedDocument; inError?: true }
  | { type: 'study'; study: ImagingStudy };

export function findItem(index: PersonIndex, id: string): Item | undefined {
  const record = index.records.find((r) => r.id === id);
  if (record) return { type: 'record', record };
  const document = index.documents.find((d) => d.id === id);
  if (document) return { type: 'document', document };
  const study = index.studies.find((s) => s.id === id);
  if (study) return { type: 'study', study };
  const wrongRecord = index.inError?.records.find((r) => r.id === id);
  if (wrongRecord) return { type: 'record', record: wrongRecord, inError: true };
  const wrongDocument = index.inError?.documents.find((d) => d.id === id);
  if (wrongDocument) return { type: 'document', document: wrongDocument, inError: true };
  return undefined;
}

export interface TimelineEntry {
  id: string;
  kind: string;
  date?: string;
  title: string;
  detail?: string;
}

/** `YYYY-MM-DD` from a FHIR date or dateTime. */
export function day(d: string | undefined): string | undefined {
  return d && /^\d{4}(-\d{2}(-\d{2})?)?/.test(d) ? d.slice(0, 10) : undefined;
}

/** Every record, document and study by date. `title` names a record: claims.ts's recordTitle, which names a claim by its services. */
export function timeline(index: PersonIndex, title: (r: MedRecord) => string): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const r of index.records) {
    out.push({ id: r.id, kind: r.kind, date: day(r.date), title: title(r), detail: recordDetail(r) });
  }
  for (const d of index.documents) {
    out.push({ id: d.id, kind: 'document', date: day(d.date), title: documentTitle(d), detail: [docTypeLabel(d.doc_type), d.organization].filter(Boolean).join(' · ') });
  }
  for (const s of index.studies) {
    out.push({ id: s.id, kind: 'study', date: day(s.date), title: studyTitle(s), detail: s.facility });
  }
  return sortByDateDesc(out);
}

/** A record its source withdrew (FHIR entered-in-error): never shown as current. */
export function isWithdrawn(r: MedRecord): boolean {
  return r.status === 'entered-in-error' && !r.stands;
}

/** A dose that was given: neither recorded as not done nor withdrawn. */
export function isDoseGiven(r: MedRecord): boolean {
  return r.status !== 'not-done' && !isWithdrawn(r);
}

export function sortByDateDesc<T extends { date?: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  });
}

/** A field that is a string with something in it, else undefined. */
export function str(v: Json | undefined): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** One line under a record's name. */
export function recordDetail(r: MedRecord): string | undefined {
  const f = r.fields;
  switch (r.kind) {
    case 'result':
      return [readingOf(r).text, str(f.interpretation)].filter(Boolean).join(' · ') || undefined;
    case 'encounter':
      return [str(f.class), str(f.practitioner), str(f.location) ?? str(f.service_provider)].filter(Boolean).join(' · ') || undefined;
    case 'medication':
      return [str(f.dosage), r.status].filter(Boolean).join(' · ') || undefined;
    case 'condition':
    case 'allergy':
      return r.status;
    case 'claim':
      return [str(f.provider), claimYourShare(r)].filter(Boolean).join(' · ') || undefined;
    case 'immunization':
      return str(f.performer);
    default:
      return r.status;
  }
}

const QUANTITY = new Set(['value', 'unit', 'system', 'code', 'comparator']);

/** Whether an object is a quantity: a value with its unit, and not a part of a result, whose code and value are objects. */
export const isQuantity = (v: JsonObject): boolean => 'value' in v && Object.entries(v).every(([k, x]) => QUANTITY.has(k) && (typeof x !== 'object' || x === null));

/** A result's value as one string: "5.4 mmol/L", "Positive". */
export function valueText(v: Json | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isObject(v) && 'value' in v) {
    const n = v.value;
    if (n === null || n === undefined) return undefined;
    const unit = str(v.unit as Json);
    const number = `${comparatorOf(v)}${String(n)}`;
    return unit ? `${number} ${unit}` : number;
  }
  return undefined;
}

/** A quantity's comparator as it stands before its number: "<", or a word and a space. */
function comparatorOf(v: JsonObject): string {
  const c = str(v.comparator as Json)?.trim();
  return !c ? '' : /^\w/.test(c) ? `${c} ` : c;
}

/**
 * A result's value as this app reads it. A quantity is a number in its unit,
 * and one with a comparator is a bound, or text where that is none this app
 * knows. A quantity whose value is text ("128/76") is text.
 * A bare number sent as text ("95", a FHIR valueString) is a number too,
 * in the unit the lab's range names, or none. A bound ("<0.5", ">60") stays
 * text, with that unit, and reads against the range only when it can.
 */
export interface Reading {
  value?: number;
  bound?: Bound;
  unit?: string;
  text?: string;
}

const BARE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const BOUND = /^(<=|>=|≤|≥|<|>)\s*(\d+(?:\.\d*)?|\.\d+)$/;
const OPS: Record<string, Bound['op']> = { '<': '<', '<=': '<=', '≤': '<=', '>': '>', '>=': '>=', '≥': '>=' };

export function resultReading(fields: JsonObject): Reading {
  const v = fields.value;
  if (typeof v !== 'string') {
    const [n, unit, text] = [numericValue(v), unitOf(v), valueText(v)];
    const comparator = isObject(v) ? comparatorOf(v) : '';
    if (!comparator) return { value: n, unit, text };
    const op = OPS[comparator];
    return op && n !== undefined ? { bound: { op, n }, unit, text } : { unit, text };
  }
  const t = v.trim();
  const range = str(fields.reference_range);
  const unit = range ? parseRange(range)?.unit : undefined;
  const text = unit ? `${t} ${unit}` : t;
  if (BARE.test(t)) return { value: Number(t), unit, text };
  const b = BOUND.exec(t);
  if (b) return { bound: { op: OPS[b[1]!]!, n: Number(b[2]) }, unit, text };
  return { text: v };
}

/** The records a report or a panel lists, in its order (medrec 0.9.10 and later). */
export const memberIds = (fields: JsonObject): string[] => (Array.isArray(fields.members) ? fields.members.filter((x): x is string => typeof x === 'string') : []);

/** Fields no screen prints and no search reads: the dates a record's date is one of, and the ids it lists. */
export const UNSAID: ReadonlySet<string> = new Set(['when', 'members']);

/**
 * A result with no value that its source lists results for, whether they are
 * filed or not: their heading, and no test. `members` alone says so where an
 * earlier medrec wrote the index last, and has lost what was listed.
 */
export const isHeading = (r: MedRecord): boolean => r.kind === 'result' && !valueText(r.fields.value) && ((isObject(r.lists) && Object.keys(r.lists).length > 0) || r.fields.members !== undefined);

/** What a result's page and the lists give as its value: a blood pressure in its one form. */
export function readingOf(r: MedRecord): Reading {
  if (isHeading(r)) return { text: 'Panel' };
  const reading = resultReading(r.fields);
  const pressure = pressureText(resultParts(r));
  return pressure ? { ...reading, text: pressure } : reading;
}

/** Whether a part is coded as LOINC's `code`; `resultParts` keys a coded part by its system and code. */
const isCode = (p: ResultPart, code: string): boolean => {
  const at = p.key.lastIndexOf('|');
  return p.key.slice(at + 1) === code && isLoinc(p.key.slice(0, at));
};
/** A part with no code: `resultParts` keys it by its name. */
const uncoded = (p: ResultPart): boolean => p.key.startsWith('display|');
/** A blood pressure's top and bottom numbers, by their LOINC codes, or by name where a source gives a part no code. */
const isTop = (p: ResultPart): boolean => isCode(p, '8480-6') || (uncoded(p) && /^systolic\b/i.test(p.name));
const isBottom = (p: ResultPart): boolean => isCode(p, '8462-4') || (uncoded(p) && /^diastolic\b/i.test(p.name));
/** A part that says something: a number, a bound, or words. */
const said = (p: ResultPart): boolean => p.point.value !== undefined || p.point.bound !== undefined || p.point.text !== '—';

/** A part's number without its unit: "122", ">260". */
const bare = ({ text, unit }: ResultPoint): string => (unit && text.endsWith(` ${unit}`) ? text.slice(0, -unit.length - 1) : text);

/** A part's name in plain words after a blood pressure: "mean" for "Mean blood pressure", "heart rate". */
const plainName = (name: string): string => {
  const word = name.replace(/\s*\bblood pressure\b\s*/i, ' ').trim() || name;
  return /^[A-Z][a-z]/.test(word) ? word[0]!.toLowerCase() + word.slice(1) : word;
};

/**
 * A blood pressure in one form, made from its parts, whatever its source
 * wrote as the whole: "118/74 mmHg", ">260/80 mmHg", two top numbers as
 * "122 and 124/78 mmHg", a reading of one as "122 mmHg, top number only", and
 * any other part after it in plain words, "122/78 mmHg, mean 93". A part
 * with no value is left out. None where no part left is a top or a bottom
 * number: the source's own words stand.
 */
export function pressureText(all: ResultPart[]): string | undefined {
  const parts = all.filter(said);
  const tops = parts.filter(isTop);
  const bottoms = parts.filter(isBottom);
  if (!tops.length && !bottoms.length) return undefined;
  const both = [...tops, ...bottoms];
  // One unit is said once, at the end; numbers in different units each keep theirs.
  const unit = new Set(both.map((p) => unitKey(p.point.unit))).size === 1 ? both[0]!.point.unit : undefined;
  const numbers = (of: ResultPart[]) => of.map((p) => (unit ? bare(p.point) : p.point.text)).join(' and ');
  const withUnit = (t: string) => (unit ? `${t} ${unit}` : t);
  const form = !tops.length || !bottoms.length ? `${withUnit(numbers(both))}, ${tops.length ? 'top' : 'bottom'} number only` : withUnit(`${numbers(tops)}/${numbers(bottoms)}`);
  const others = parts.filter((p) => !isTop(p) && !isBottom(p)).map((p) => `${plainName(p.name)} ${unit && unitKey(p.point.unit) === unitKey(unit) ? bare(p.point) : p.point.text}`);
  return [form, ...others].join(', ');
}

/** A result's part: what it names, and the part as a point of its own. */
export interface ResultPart {
  key: string;
  name: string;
  point: ResultPoint;
}

/** The parts of a result of several (a blood pressure's two), in the source's order (medrec 0.9.10 and later). */
export function resultParts(r: MedRecord): ResultPart[] {
  const list = r.kind === 'result' && Array.isArray(r.fields.components) ? r.fields.components : [];
  return list.flatMap((c): ResultPart[] => {
    if (!isObject(c)) return [];
    const code: JsonObject = isObject(c.code) ? c.code : {};
    const [system, id, display] = [str(code.system), str(code.code), str(code.display)];
    const name = labTest({ system, code: id })?.name ?? display ?? id;
    return name ? [{ key: id ? `${system ?? ''}|${id}` : `display|${name.toLowerCase()}`, name, point: pointOf(r, c) }] : [];
  });
}

/** The parts a chart can follow: those named once. One named twice is two readings of one thing. */
const oncePerKey = (parts: ResultPart[]): ResultPart[] => parts.filter((p) => parts.filter((q) => q.key === p.key).length === 1);

function pointOf(r: MedRecord, fields: JsonObject, { value, bound, unit, text }: Reading = resultReading(fields)): ResultPoint {
  return { id: r.id, date: r.date, value, bound, text: text ?? '—', unit, range: str(fields.reference_range), interpretation: str(fields.interpretation) };
}

/** A result as a point of its series. */
export function resultPoint(r: MedRecord): ResultPoint {
  const parts = resultParts(r);
  return { ...pointOf(r, r.fields, readingOf(r)), ...(parts.length ? { parts } : {}) };
}

const resultsOf = (index: PersonIndex, key: string): MedRecord[] => index.records.filter((x) => x.kind === 'result' && seriesKey(x) === key);

/** One part of these results over time, oldest first. */
const partPoints = (all: MedRecord[], key: string): ResultPoint[] =>
  all.flatMap((x) => oncePerKey(resultParts(x)).filter((p) => p.key === key).map((p) => p.point)).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

/** Each part of a result over time: the same part of each result of its test. */
export function partSeries(index: PersonIndex, r: MedRecord): ResultSeries[] {
  const all = resultsOf(index, seriesKey(r));
  return oncePerKey(resultParts(r)).map((part) => seriesOf(part.key, part.name, partPoints(all, part.key)));
}

/** Each part any result of a test gives, over time: named and placed as the newest result that names it. */
export function testPartSeries(index: PersonIndex, key: string): ResultSeries[] {
  const all = resultsOf(index, key);
  const named = new Map<string, string>();
  for (const x of [...all].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))) for (const p of resultParts(x)) if (!named.has(p.key)) named.set(p.key, p.name);
  return [...named].map(([part, name]) => seriesOf(part, name, partPoints(all, part))).filter((s) => s.points.length);
}

export function numericValue(v: Json | undefined): number | undefined {
  if (isObject(v) && typeof v.value === 'number' && Number.isFinite(v.value)) return v.value;
  return undefined;
}

export function unitOf(v: Json | undefined): string | undefined {
  return isObject(v) ? str(v.unit as Json) : undefined;
}

export function seriesKey(r: MedRecord): string {
  if (r.code?.code) return `${r.code.system ?? ''}|${r.code.code}`;
  return `display|${r.display.toLowerCase()}`;
}

export interface ResultPoint {
  id: string;
  date?: string;
  value?: number;
  /** A value given only as a bound ("<0.5"): never plotted. */
  bound?: Bound;
  text: string;
  unit?: string;
  range?: string;
  interpretation?: string;
  /** The parts of a result of several. */
  parts?: ResultPart[];
}

export interface ResultSeries {
  key: string;
  name: string;
  unit?: string;
  latest?: ResultPoint;
  points: ResultPoint[];
}

/** Points, oldest first, as a series. */
function seriesOf(key: string, name: string, points: ResultPoint[]): ResultSeries {
  const units = new Set(points.map((p) => p.unit).filter(Boolean));
  return { key, name, unit: units.size === 1 ? [...units][0] : undefined, latest: points[points.length - 1], points };
}

export function resultSeries(index: PersonIndex): ResultSeries[] {
  const groups = new Map<string, MedRecord[]>();
  for (const r of index.records) {
    if (r.kind !== 'result' || isHeading(r)) continue;
    const k = seriesKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: ResultSeries[] = [];
  for (const [key, rs] of groups) {
    const points = rs.map(resultPoint).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    // The newest record's own name: what medrec shows, and what the source
    // calls the test today.
    const named = [...rs].sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''))[0]!;
    out.push(seriesOf(key, resultName(named), points));
  }
  return out.sort((a, b) => (b.latest?.date ?? '').localeCompare(a.latest?.date ?? '') || a.name.localeCompare(b.name));
}

export interface MedicineGroup {
  key: string;
  name: string;
  latest: MedRecord;
  records: MedRecord[];
  active: boolean;
}

export function medicines(index: PersonIndex): MedicineGroup[] {
  const groups = new Map<string, MedRecord[]>();
  for (const r of index.records) {
    if (r.kind !== 'medication') continue;
    const k = r.code?.code ? `${r.code.system ?? ''}|${r.code.code}` : `display|${r.display.toLowerCase()}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: MedicineGroup[] = [];
  for (const [key, rs] of groups) {
    const sorted = sortByDateDesc(rs);
    const latest = sorted[0]!;
    out.push({
      key,
      name: latest.display || latest.code?.display || 'Medicine',
      latest,
      records: sorted,
      active: rs.some((r) => r.status === 'active'),
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || (b.latest.date ?? '').localeCompare(a.latest.date ?? ''));
}

// ---- Money ----

export interface Money {
  amount: string;
  currency: string;
}

export function asMoney(v: Json | undefined): Money | undefined {
  if (isObject(v) && typeof v.amount === 'string') {
    return { amount: v.amount, currency: typeof v.currency === 'string' ? v.currency : 'USD' };
  }
  return undefined;
}

/**
 * A decimal string's whole cents, rounded half away from zero ("12.345" is
 * 1235): medrec writes a sum to four places when several entries give it.
 * Undefined for anything but a plain decimal.
 */
export function decimalCents(amount: string): number | undefined {
  const t = amount.trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return undefined;
  const [whole = '0', frac = ''] = t.replace(/^[-+]/, '').split('.');
  const c = Number(whole) * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? '0') >= 5 ? 1 : 0);
  return t.startsWith('-') && c !== 0 ? -c : c;
}

/** Whole cents from a decimal string; undefined when it is not one. */
export function toCents(m: Money | undefined): number | undefined {
  return m ? decimalCents(m.amount) : undefined;
}

export function fromCents(cents: number, currency = 'USD'): Money {
  const a = Math.abs(cents);
  return { amount: `${cents < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`, currency };
}

/** "$1,234.56"; money stays a decimal string, never a float sum. */
export function formatMoney(m: Money | undefined): string | undefined {
  if (!m) return undefined;
  const symbol = m.currency === 'USD' ? '$' : `${m.currency} `;
  const c = decimalCents(m.amount);
  if (c !== undefined) {
    const a = Math.abs(c);
    const grouped = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${c < 0 ? '−' : ''}${symbol}${grouped}.${String(a % 100).padStart(2, '0')}`;
  }
  return `${symbol}${m.amount.trim()}`;
}

export interface ClaimTotal {
  label: string;
  amount: Money;
}

export function claimTotals(r: MedRecord): ClaimTotal[] {
  const totals = r.fields.total;
  if (!Array.isArray(totals)) return [];
  const out: ClaimTotal[] = [];
  for (const t of totals) {
    if (!isObject(t)) continue;
    const amount = asMoney(t.amount);
    const label = typeof t.category === 'string' ? t.category : 'Total';
    if (amount) out.push({ label, amount });
  }
  return out;
}

/** A claim total that is the member's share, by its category's words. */
export const YOUR_SHARE = /member ?liability|patient ?pay|paid ?by ?patient|your share|patient responsibility|you owe/i;

/** The amounts a claim or a claim line can carry. */
export type AmountName = 'billed' | 'allowed' | 'planPaid' | 'deductible' | 'copay' | 'coinsurance' | 'notCovered' | 'discount' | 'youOwe';

/** The four a claim totals: what was billed, allowed, paid by the plan, and left to you. */
const TOTALS: AmountName[] = ['billed', 'allowed', 'planPaid', 'youOwe'];

/** A payer's words for each amount, in the order they are tried. */
const AMOUNT_WORDS: [AmountName, RegExp][] = [
  ['billed', /submitted|billed|charge/i],
  ['allowed', /eligible|allowed/i],
  ['planPaid', /^benefit|plan ?paid|paid ?to ?provider|paid ?by ?plan/i],
  ['youOwe', YOUR_SHARE],
  ['deductible', /^deductible/i],
  ['copay', /co-?pay/i],
  ['coinsurance', /co-?insurance/i],
  ['notCovered', /non-?covered|not covered/i],
  ['discount', /discount/i],
];

/** The amounts that make up your share, in the order a claim reads them. */
export const SHARE_PARTS: AmountName[] = ['deductible', 'copay', 'coinsurance', 'notCovered'];

/** A claim line's amounts as its page lists them: billed, taken off, allowed, paid, then your share and its parts. */
export const LINE_AMOUNT_ORDER: AmountName[] = ['billed', 'discount', 'allowed', 'planPaid', ...SHARE_PARTS, 'youOwe'];

export const AMOUNT_LABELS: Record<AmountName, string> = {
  billed: 'Billed',
  discount: 'Discount',
  allowed: 'Allowed',
  planPaid: 'Plan paid',
  deductible: 'Deductible',
  copay: 'Copay',
  coinsurance: 'Coinsurance',
  notCovered: 'Not covered',
  youOwe: 'You owe',
};

/**
 * What a payer's amount label names: at most one of the totals, one part of
 * your share, and one other amount, a discount ("Member liability",
 * "Coinsurance", "Discount").
 */
export function amountNames(label: string): { total?: AmountName; share?: AmountName; other?: AmountName } {
  const named = (keep: (k: AmountName) => boolean) => AMOUNT_WORDS.find(([k, re]) => keep(k) && re.test(label))?.[0];
  return {
    total: named((k) => TOTALS.includes(k)),
    share: named((k) => SHARE_PARTS.includes(k)),
    other: named((k) => !TOTALS.includes(k) && !SHARE_PARTS.includes(k)),
  };
}

export function claimYourShare(r: MedRecord): string | undefined {
  const t = claimTotals(r).find((x) => YOUR_SHARE.test(x.label));
  return t ? `Your share ${formatMoney(t.amount)}` : undefined;
}

// ---- Provenance ----

/**
 * The import that filed a provenance: the earliest ImportRun of the same
 * source folder that finished at or after the provenance was filed.
 */
export function importFor(p: Provenance, imports: ImportRun[]): ImportRun | undefined {
  if (!p.raw_path) return undefined;
  const candidates = imports
    .filter((i) => i.source_dir && p.raw_path!.startsWith(i.source_dir.endsWith('/') ? i.source_dir : `${i.source_dir}/`))
    .sort((a, b) => a.imported_at.localeCompare(b.imported_at));
  return candidates.find((i) => i.imported_at >= p.filed_at) ?? candidates[candidates.length - 1];
}

/** Keys of an object other than the ones a view already shows. */
export function extraFields(o: JsonObject, shown: string[]): [string, Json][] {
  return Object.entries(o).filter(([k, v]) => !shown.includes(k) && v !== null && v !== undefined);
}

// ---- Where a record came from ----

const ORIGIN_KIND: Record<string, string> = { scan: 'Scanned', media: 'Imaging disc', inbox: 'Filed by hand' };

/**
 * How many of these records each portal gave, by practice, in the order they
 * come. A record through two sign-ins counts once, for the first practice
 * they name; one that only names a records connection counts for that; one
 * that names neither counts as "Portal".
 */
export function portalCounts(records: MedRecord[], household: Household, person: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    const names = r.provenance.map((p) => practiceName(household, person, p.source)).filter((x): x is string => !!x);
    const name = names.find((x) => placeName(x)) ?? names[0] ?? 'Portal';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/**
 * The distinct names of the sources a record or document came from. A bare
 * number is no name, nor is an id several practices share, so its CLI stands
 * for it, once for all of its practices that nothing names.
 */
export function originNames(provenance: Provenance[], household: Household, person: string): string[] {
  const names = provenance.map(({ source: s }) => {
    if (!s.organization_id) return ORIGIN_KIND[s.kind] ?? s.kind;
    const practice = practiceOf(household, person, s);
    if (practice.kind === 'named') return practice.name;
    return practice.kind === 'unnamed' && /[a-z]/i.test(s.organization_id) ? s.organization_id : (s.cli ?? s.kind);
  });
  return [...new Set(names)];
}
