// An insurer claim's lines: what was done, its code, and what each party
// paid; and the claim's title from its services, not its FHIR type
// ("Professional"). medrec keeps each line's adjudication in the payer's own
// words; they are named by records.ts's amount words, as the claim's totals
// are in billing.ts.

import { amountNames, asMoney, KIND_LABELS, str, type AmountName, type Money } from './records';
import { isObject } from './parse';
import type { Json, MedRecord } from './types';

export type LineAmounts = Partial<Record<AmountName, Money>>;

/** medrec's fixed amount names, once it writes them (`amounts`), mapped to these. */
const AMOUNT_NAMES: Record<string, AmountName> = {
  billed: 'billed',
  allowed: 'allowed',
  plan_paid: 'planPaid',
  deductible: 'deductible',
  copay: 'copay',
  coinsurance: 'coinsurance',
  not_covered: 'notCovered',
  you_owe: 'youOwe',
};

export type Category = 'visit' | 'lab' | 'imaging' | 'vaccine' | 'medicine' | 'procedure' | 'anesthesia' | 'drug' | 'supply' | 'pharmacy' | 'other';

/** Each category's name for one line, and for a group of them. */
export const CATEGORY_LABELS: Record<Category, { one: string; many: string }> = {
  visit: { one: 'Visit', many: 'Visits' },
  lab: { one: 'Lab test', many: 'Lab tests' },
  imaging: { one: 'Imaging', many: 'Imaging' },
  vaccine: { one: 'Vaccine', many: 'Vaccines' },
  medicine: { one: 'Medical service', many: 'Other medical services' },
  procedure: { one: 'Procedure', many: 'Procedures' },
  anesthesia: { one: 'Anesthesia', many: 'Anesthesia' },
  drug: { one: 'Drug given', many: 'Drugs given' },
  supply: { one: 'Supply or equipment', many: 'Supplies and equipment' },
  pharmacy: { one: 'Pharmacy', many: 'Pharmacy' },
  other: { one: 'Other', many: 'Other' },
};

/**
 * A line's category from its code: CPT ranges (AMA), HCPCS level II's first
 * letter, and a pharmacy claim's drug codes. A medrec `category` wins.
 */
export function categoryOf(code: string | undefined, system?: string, claimType?: string): Category {
  if (/pharmacy/i.test(claimType ?? '')) return 'pharmacy';
  if (system && /rxnorm|ndc/i.test(system)) return 'pharmacy';
  const c = (code ?? '').trim().toUpperCase();
  if (/^\d{5}$/.test(c)) {
    const n = Number(c);
    if (n >= 99202 && n <= 99499) return 'visit';
    if ((n >= 80047 && n <= 89398) || n === 36415 || n === 36416) return 'lab';
    if (n >= 70010 && n <= 79999) return 'imaging';
    if (n >= 90460 && n <= 90756) return 'vaccine';
    if (n >= 90281 && n <= 99199) return 'medicine';
    if (n >= 10004 && n <= 69990) return 'procedure';
    if (n >= 100 && n <= 1999) return 'anesthesia';
    return 'other';
  }
  if (/^J\d{4}$/.test(c)) return 'drug';
  if (/^[AEL]\d{4}$/.test(c)) return 'supply';
  if (/^G\d{4}$/.test(c)) return 'medicine';
  return 'other';
}

export interface ClaimLine {
  sequence?: number;
  /** What was done, as the payer wrote it, or its code when it gave no words. */
  label: string;
  code?: string;
  system?: string;
  /** The day of service, when the line has one of its own. */
  date?: string;
  category: Category;
  amounts: LineAmounts;
}

function amountsFrom(o: Json | undefined): LineAmounts {
  const out: LineAmounts = {};
  if (!isObject(o)) return out;
  for (const [k, v] of Object.entries(o)) {
    const name = Object.hasOwn(AMOUNT_NAMES, k) ? AMOUNT_NAMES[k] : undefined;
    const m = asMoney(v);
    if (name && m) out[name] = m;
  }
  return out;
}

function adjudicated(list: Json | undefined): LineAmounts {
  const out: LineAmounts = {};
  if (!Array.isArray(list)) return out;
  for (const a of list) {
    if (!isObject(a) || typeof a.category !== 'string') continue;
    const m = asMoney(a.amount);
    if (!m) continue;
    const { total, part } = amountNames(a.category);
    for (const name of [total, part]) if (name && !out[name]) out[name] = m;
  }
  return out;
}

function dayOf(v: Json | undefined): string | undefined {
  if (typeof v === 'string') return v.slice(0, 10);
  if (isObject(v) && typeof v.start === 'string') return v.start.slice(0, 10);
  return undefined;
}

/** A claim's lines, in their order. */
export function claimLines(r: MedRecord): ClaimLine[] {
  const items = r.fields.items;
  if (!Array.isArray(items)) return [];
  const type = str(r.fields.type) ?? r.code?.code;
  const out: ClaimLine[] = [];
  for (const it of items) {
    if (!isObject(it)) continue;
    const service = isObject(it.service) ? it.service : undefined;
    const code = str(service?.code);
    const system = str(service?.system);
    const label = str(service?.display) ?? str(service?.text) ?? code;
    if (!label) continue;
    const given = str(it.category);
    const amounts = { ...adjudicated(it.adjudication), ...amountsFrom(it.amounts) };
    amounts.billed ??= asMoney(it.net);
    out.push({
      sequence: typeof it.sequence === 'number' ? it.sequence : undefined,
      label,
      code,
      system,
      date: dayOf(it.serviced),
      category: given && Object.hasOwn(CATEGORY_LABELS, given) ? (given as Category) : categoryOf(code, system, type),
      amounts,
    });
  }
  return out;
}

/** What a claim paid for, each service once, in line order. */
export function claimServices(r: MedRecord): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of claimLines(r)) {
    const k = l.label.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(l.label);
    }
  }
  return out;
}

/** "Lipid panel" reads "lipid panel" mid-sentence; "HbA1c", "MRI" and "CBC" keep their capitals. */
function midSentence(label: string): string {
  return /^[A-Z][a-z]+(?![\w])/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label;
}

/**
 * A claim's title: its services ("Lipid panel", "Office visit and lipid
 * panel", "Office visit, lipid panel and 2 more"). Without lines, the name
 * medrec gave unless it is only the claim's type, then the provider.
 */
export function claimTitle(r: MedRecord): string {
  const [first, ...rest] = claimServices(r);
  if (first !== undefined) {
    const later = rest.map(midSentence);
    if (later.length === 0) return first;
    if (later.length === 1) return `${first} and ${later[0]}`;
    return `${first}, ${later[0]} and ${later.length - 1} more`;
  }
  const type = str(r.fields.type) ?? r.code?.display;
  const display = str(r.display);
  if (display && display.toLowerCase() !== type?.toLowerCase()) return display;
  const provider = str(r.fields.provider);
  return provider ? `Claim from ${provider}` : 'Claim';
}

/** A record's title as every list shows it: a claim by its services, the rest by their names, else their kind. */
export function recordTitle(r: MedRecord): string {
  if (r.kind === 'claim') return claimTitle(r);
  return r.display || r.code?.display || KIND_LABELS[r.kind] || r.kind;
}
