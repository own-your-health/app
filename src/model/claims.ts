// An insurer claim's lines: what was done, its code, and what each party
// paid; and the claim's title from its services, not its FHIR type
// ("Professional"). medrec keeps each line's adjudication in the payer's own
// words; they are named by records.ts's amount words, as the claim's totals
// are in billing.ts. A medrec that writes the claim fields of its data
// contract also gives fixed amount names, each line's category, the claim's
// diagnoses and links to what it paid for; where it does, those win.

import { amountNames, asMoney, str, type AmountName, type Money } from './records';
import { isObject } from './parse';
import type { Json, MedRecord } from './types';

export type LineAmounts = Partial<Record<AmountName, Money>>;

/** medrec's fixed amount names (`amounts`, on a claim and on each line), mapped to these. */
const AMOUNT_NAMES: Record<string, AmountName> = {
  billed: 'billed',
  allowed: 'allowed',
  plan_paid: 'planPaid',
  deductible: 'deductible',
  copay: 'copay',
  coinsurance: 'coinsurance',
  not_covered: 'notCovered',
  discount: 'discount',
  you_owe: 'youOwe',
};

export type Category = 'visit' | 'lab' | 'imaging' | 'vaccine' | 'medicine' | 'procedure' | 'anesthesia' | 'drug' | 'supply' | 'dental' | 'facility' | 'pharmacy' | 'other';

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
  dental: { one: 'Dental', many: 'Dental care' },
  facility: { one: 'Facility charge', many: 'Facility charges' },
  pharmacy: { one: 'Pharmacy', many: 'Pharmacy' },
  other: { one: 'Other', many: 'Other' },
};

/**
 * A line's category from its code, by the table in medrec's data contract,
 * so a claim from an earlier medrec reads as medrec now files one: CPT
 * ranges (AMA), CPT's lab codes (PLA, MAAA), HCPCS level II's first letter,
 * CDT, a hospital's revenue codes, and a pharmacy claim's drug codes. A
 * medrec `category` wins.
 */
export function categoryOf(code: string | undefined, system?: string, claimType?: string): Category {
  if (/pharmacy/i.test(claimType ?? '')) return 'pharmacy';
  if (system && /rxnorm|ndc/i.test(system)) return 'pharmacy';
  if (system && /revenue|nubc/i.test(system)) return 'facility';
  const c = (code ?? '').trim().toUpperCase();
  if (/^\d{5}$/.test(c)) {
    const n = Number(c);
    if (n >= 99202 && n <= 99499) return 'visit';
    if ((n >= 80047 && n <= 89398) || n === 36415 || n === 36416) return 'lab';
    if (n >= 70010 && n <= 79999) return 'imaging';
    if (n >= 90460 && n <= 90756) return 'vaccine';
    if ((n >= 90281 && n <= 99199) || (n >= 99500 && n <= 99607)) return 'medicine';
    if (n >= 10004 && n <= 69990) return 'procedure';
    if (n >= 100 && n <= 1999) return 'anesthesia';
    return 'other';
  }
  if (/^\d{4}[UM]$/.test(c)) return 'lab';
  if (/^J\d{4}$/.test(c)) return 'drug';
  if (/^[AEL]\d{4}$/.test(c)) return 'supply';
  if (/^D\d{4}$/.test(c)) return 'dental';
  return 'other';
}

/**
 * A claim medrec filed in the shape of its data contract (0.5.0 and later):
 * it has `amounts` or a `category`. Its links are medrec's, recomputed on
 * every write of the index, so a link it leaves out means none.
 */
export function isContractClaim(r: MedRecord): boolean {
  return r.fields.amounts !== undefined || r.fields.category !== undefined;
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
  /** The records this line paid for, as medrec linked them. */
  records: string[];
}

const isCategory = (v: string | undefined): v is Category => !!v && Object.hasOwn(CATEGORY_LABELS, v);

const ids = (v: Json | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** Amounts under medrec's fixed names; a name it leaves out is unknown, not zero. */
export function namedAmounts(o: Json | undefined): LineAmounts {
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
    const { total, share, other } = amountNames(a.category);
    for (const name of [total, share, other]) if (name && !out[name]) out[name] = m;
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
    const amounts = { ...adjudicated(it.adjudication), ...namedAmounts(it.amounts) };
    amounts.billed ??= asMoney(it.net);
    out.push({
      sequence: typeof it.sequence === 'number' ? it.sequence : undefined,
      label,
      code,
      system,
      date: dayOf(it.serviced),
      category: isCategory(given) ? given : categoryOf(code, system, type),
      amounts,
      records: ids(it.records),
    });
  }
  return out;
}

/** A pharmacy claim: its type says so, or every line is a drug the pharmacy filled. */
export function isPharmacyClaim(r: MedRecord): boolean {
  if (/pharmacy/i.test(str(r.fields.type) ?? r.code?.code ?? '')) return true;
  const lines = claimLines(r);
  return lines.length > 0 && lines.every((l) => l.category === 'pharmacy');
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
 * medrec gave unless it is only the claim's type, then the provider. medrec
 * ends its name with " · " and the provider, which the page shows apart.
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
  const provider = str(r.fields.provider);
  let display = str(r.display);
  if (display && provider && display.endsWith(` · ${provider}`)) display = display.slice(0, -` · ${provider}`.length).trim() || undefined;
  if (display && display.toLowerCase() !== type?.toLowerCase()) return display;
  return provider ? `Claim from ${provider}` : 'Claim';
}

/**
 * What kind of care a claim paid for: the category medrec gave the claim,
 * else its lines' one category, else `mixed`. Undefined for a claim without
 * either.
 */
export function claimCategory(r: MedRecord): Category | 'mixed' | undefined {
  const given = str(r.fields.category);
  if (given === 'mixed' || isCategory(given)) return given;
  const kinds = new Set(claimLines(r).map((l) => l.category));
  if (kinds.size === 0) return undefined;
  return kinds.size === 1 ? [...kinds][0] : 'mixed';
}

export interface Diagnosis {
  code?: string;
  system?: string;
  display?: string;
}

/** The diagnoses a claim names, in the payer's order. */
export function claimDiagnoses(r: MedRecord): Diagnosis[] {
  const list = r.fields.diagnoses;
  if (!Array.isArray(list)) return [];
  const out: { sequence: number; d: Diagnosis }[] = [];
  list.forEach((x, i) => {
    if (!isObject(x)) return;
    const c = isObject(x.code) ? x.code : undefined;
    const d: Diagnosis = { code: str(c?.code), system: str(c?.system), display: str(c?.display) };
    if (d.code || d.display) out.push({ sequence: typeof x.sequence === 'number' ? x.sequence : i + 1, d });
  });
  return out.sort((a, b) => a.sequence - b.sequence).map((x) => x.d);
}

/** "Ear infection (H66.90)", or whichever of the two the claim gives. */
export function diagnosisText(d: Diagnosis): string {
  return d.display && d.code ? `${d.display} (${d.code})` : (d.display ?? d.code ?? '');
}

/** The visit a claim paid for, as medrec linked it. */
export function claimVisitId(r: MedRecord): string | undefined {
  return str(r.fields.visit) || undefined;
}

/** The results and reports from the claim's service, as medrec linked them. */
export function claimResultIds(r: MedRecord): string[] {
  return ids(r.fields.results);
}
