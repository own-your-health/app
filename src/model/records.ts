// Views over one person's index: the timeline, results over time,
// medicines, lists, claims and bills.

import type { Household, ImagingStudy, ImportRun, Json, JsonObject, MedDocument, MedRecord, PersonIndex, Provenance } from './types';
import { parseRange, type Bound } from './flags';
import { isObject } from './parse';
import { resultName } from './labtests';

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

export function documentTitle(d: MedDocument): string {
  return d.title || d.original_name || docTypeLabel(d.doc_type);
}

export function studyTitle(s: ImagingStudy): string {
  const what = s.description || [s.modalities.join('/'), s.body_part].filter(Boolean).join(' ');
  return what || 'Imaging study';
}

export type Item =
  | { type: 'record'; record: MedRecord }
  | { type: 'document'; document: MedDocument }
  | { type: 'study'; study: ImagingStudy };

export function findItem(index: PersonIndex, id: string): Item | undefined {
  const record = index.records.find((r) => r.id === id);
  if (record) return { type: 'record', record };
  const document = index.documents.find((d) => d.id === id);
  if (document) return { type: 'document', document };
  const study = index.studies.find((s) => s.id === id);
  if (study) return { type: 'study', study };
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
  return r.status === 'entered-in-error';
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
      return [resultReading(f).text, str(f.interpretation)].filter(Boolean).join(' · ') || undefined;
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

/** A result's value as one string: "5.4 mmol/L", "Positive". */
export function valueText(v: Json | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isObject(v) && 'value' in v) {
    const n = v.value;
    if (n === null || n === undefined) return undefined;
    const unit = str(v.unit as Json);
    return unit ? `${String(n)} ${unit}` : String(n);
  }
  return undefined;
}

/**
 * A result's value as this app reads it. A quantity is a number in its unit.
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
  if (typeof v !== 'string') return { value: numericValue(v), unit: unitOf(v), text: valueText(v) };
  const t = v.trim();
  const range = str(fields.reference_range);
  const unit = range ? parseRange(range)?.unit : undefined;
  const text = unit ? `${t} ${unit}` : t;
  if (BARE.test(t)) return { value: Number(t), unit, text };
  const b = BOUND.exec(t);
  if (b) return { bound: { op: OPS[b[1]!]!, n: Number(b[2]) }, unit, text };
  return { text: v };
}

/** A result as a point of its series. */
export function resultPoint(r: MedRecord): ResultPoint {
  const { value, bound, unit, text } = resultReading(r.fields);
  return { id: r.id, date: r.date, value, bound, text: text ?? '—', unit, range: str(r.fields.reference_range), interpretation: str(r.fields.interpretation) };
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
}

export interface ResultSeries {
  key: string;
  name: string;
  unit?: string;
  latest?: ResultPoint;
  points: ResultPoint[];
}

export function resultSeries(index: PersonIndex): ResultSeries[] {
  const groups = new Map<string, MedRecord[]>();
  for (const r of index.records) {
    if (r.kind !== 'result') continue;
    const k = seriesKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: ResultSeries[] = [];
  for (const [key, rs] of groups) {
    const points = rs.map(resultPoint).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const units = new Set(points.map((p) => p.unit).filter(Boolean));
    // The newest record's own name: what medrec shows, and what the source
    // calls the test today.
    const named = [...rs].sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''))[0]!;
    out.push({
      key,
      name: resultName(named),
      unit: units.size === 1 ? [...units][0] : undefined,
      latest: points[points.length - 1],
      points,
    });
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

/** "$1,234.56"; money stays a decimal string, never a float sum. */
export function formatMoney(m: Money | undefined): string | undefined {
  if (!m) return undefined;
  const neg = m.amount.trim().startsWith('-');
  const [whole = '0', frac = ''] = m.amount.trim().replace(/^[-+]/, '').split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (frac + '00').slice(0, 2);
  const symbol = m.currency === 'USD' ? '$' : `${m.currency} `;
  return `${neg ? '−' : ''}${symbol}${grouped}.${cents}`;
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

/** Each amount's name, in the order a claim's line lists them. */
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
 * What a payer's amount label names: at most one of the totals and one
 * other amount, a part of your share or a discount ("Member liability",
 * "Coinsurance").
 */
export function amountNames(label: string): { total?: AmountName; part?: AmountName } {
  const total = AMOUNT_WORDS.find(([k, re]) => TOTALS.includes(k) && re.test(label))?.[0];
  const part = AMOUNT_WORDS.find(([k, re]) => !TOTALS.includes(k) && re.test(label))?.[0];
  return { total, part };
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

/** A source's name as the household knows it: its organization, by slug. */
export function organizationName(household: Household, person: string, slug: string): string {
  const own = household.sources.find((s) => s.person === person && s.organization === slug && s.organization_name);
  if (own?.organization_name) return own.organization_name;
  const org = household.organizations.find((o) => o.id === slug || o.aliases?.includes(slug));
  return org?.name ?? slug;
}

/** The distinct names of the sources a record or document came from. */
export function originNames(provenance: Provenance[], household: Household, person: string): string[] {
  const names = provenance.map((p) => (p.source.organization_id ? organizationName(household, person, p.source.organization_id) : ORIGIN_KIND[p.source.kind] ?? p.source.kind));
  return [...new Set(names)];
}
