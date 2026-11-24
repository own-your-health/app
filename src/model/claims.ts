// An insurer claim's lines: what was done, its code, and what each party
// paid; and the claim's title from its services, not its FHIR type
// ("Professional"). medrec keeps each line's adjudication in the payer's own
// words; they are named by records.ts's amount words, as the claim's totals
// are. A medrec that writes the claim fields of its data
// contract also gives fixed amount names, each line's category, the claim's
// diagnoses and links to what it paid for; where it does, those win. A line
// the claim's totals leave out (one the plan replaced with its own, or wrote
// off) is not counted, and is never owed.

import { AMOUNT_LABELS, amountNames, asMoney, claimTotals, fromCents, SHARE_PARTS, str, toCents, type AmountName, type Money } from './records';
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
  if (system && REVENUE_SYSTEM.test(system)) return 'facility';
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

/** A code as medrec gives one: `{system, code, display}`. */
export interface LineCode {
  code: string;
  system?: string;
  display?: string;
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
  /**
   * False for a line the claim's totals leave out, one the plan replaced
   * with its own or wrote off: none of it is owed.
   */
  counted: boolean;
  /** The payer's notes on this line, as medrec gives them (`payer_notes`, "XX -- …"). */
  payerNotes: string[];
  /**
   * A hospital's revenue code for the line (NUBC: 0450 is the emergency
   * room), beside its service code or, on a line with none, as its code.
   */
  revenue?: LineCode;
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

// ---- Amounts ----

/** Every amount but a discount, in the order a statement lists them. */
export const AMOUNTS: AmountName[] = ['billed', 'allowed', 'planPaid', ...SHARE_PARTS, 'youOwe'];

/** Amounts in whole cents, by the same names. */
export type Cents = Partial<Record<AmountName, number>>;

/** A line's amounts in cents. Your share is its parts added up when the payer gave only the parts. */
export function lineCents(amounts: LineAmounts): Cents {
  const out: Cents = {};
  for (const k of AMOUNTS) {
    const c = toCents(amounts[k]);
    if (c !== undefined) out[k] = c;
  }
  const given = SHARE_PARTS.filter((k) => out[k] !== undefined);
  if (out.youOwe === undefined && given.length) out.youOwe = given.reduce((t, k) => t + out[k]!, 0);
  return out;
}

/** A claim's totals by their names in records.ts's amount words. */
const TOTAL_FIELD: Partial<Record<AmountName, 'billed' | 'allowed' | 'planPaid' | 'yourShare'>> = { billed: 'billed', allowed: 'allowed', planPaid: 'planPaid', youOwe: 'yourShare' };

export interface ClaimAmounts {
  billed?: Money;
  allowed?: Money;
  planPaid?: Money;
  /** What you owe: the payer's own figure, else the parts it gives added up (`shareAdded`). */
  yourShare?: Money;
  /** Your share is the parts added up, as the payer gave no figure for it: "your share", not "you owe". */
  shareAdded?: boolean;
  /** What the provider took off the bill, when the payer says. */
  discount?: Money;
}

/** A part of your share, as the claim gives it: a deductible, a copay, coinsurance, what was not covered. */
export interface ClaimPart {
  name: AmountName;
  label: string;
  amount: Money;
}

/**
 * A claim's totals: medrec's fixed names (`amounts`) where it gives them,
 * else the payer's words for each, else the payment. Without the payer's
 * figure for what you owe, your share is the parts it gives (deductible,
 * copay, coinsurance, not covered) added up, never a discount.
 */
export function claimAmounts(r: MedRecord): ClaimAmounts & { parts: ClaimPart[] } {
  const named = namedAmounts(r.fields.amounts);
  const worded: Partial<Record<AmountName, Money>> = {};
  for (const t of claimTotals(r)) {
    const { total, share, other } = amountNames(t.label);
    for (const name of [total, share, other]) if (name && !worded[name]) worded[name] = t.amount;
  }
  const amount = (name: AmountName): Money | undefined => named[name] ?? worded[name];
  const out: ClaimAmounts & { parts: ClaimPart[] } = { parts: [] };
  for (const [name, field] of Object.entries(TOTAL_FIELD) as [AmountName, 'billed' | 'allowed' | 'planPaid' | 'yourShare'][]) {
    const m = amount(name);
    if (m) out[field] = m;
  }
  out.planPaid ??= asMoney(r.fields.payment);
  out.discount = amount('discount');
  for (const part of SHARE_PARTS) {
    const m = amount(part);
    if (m && (toCents(m) ?? 0) > 0) out.parts.push({ name: part, label: AMOUNT_LABELS[part], amount: m });
  }
  if (!out.yourShare) {
    const given = SHARE_PARTS.map(amount).filter((m): m is Money => !!m && toCents(m) !== undefined);
    const currencies = new Set(given.map((m) => m.currency));
    if (given.length && currencies.size === 1) {
      out.yourShare = fromCents(given.reduce((t, m) => t + toCents(m)!, 0), given[0]!.currency);
      out.shareAdded = true;
    }
  }
  return out;
}

/** A claim's own totals, in cents, by the same names as its lines'. */
export function claimCents(r: MedRecord): Cents {
  const a = claimAmounts(r);
  const parts: Cents = {};
  for (const p of a.parts) {
    const c = toCents(p.amount);
    if (c !== undefined) parts[p.name] = (parts[p.name] ?? 0) + c;
  }
  const out: Cents = { ...parts };
  for (const [k, m] of [['billed', a.billed], ['allowed', a.allowed], ['planPaid', a.planPaid], ['youOwe', a.yourShare]] as const) {
    const c = toCents(m);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/** The amounts compared to find the lines a claim's totals leave out, as medrec 0.8.2 compares them. */
const COMPARED = ['billed', 'planPaid', 'youOwe'] as const;

/** The sets of `size` lines that hold exactly `over` on each key, in index order; it stops at two, as two are a tie. */
function setsHolding(given: Cents[], keys: readonly AmountName[], over: number[], size: number): number[][] {
  const found: number[][] = [];
  const walk = (from: number, set: number[], left: number[]) => {
    if (found.length > 1) return;
    if (set.length === size) {
      if (left.every((d) => d === 0)) found.push(set);
      return;
    }
    for (let i = from; i <= given.length - (size - set.length); i += 1) walk(i + 1, [...set, i], left.map((d, j) => d - (given[i]![keys[j]!] ?? 0)));
  };
  walk(0, [], over);
  return found;
}

/**
 * The lines a claim's totals leave out, found as medrec 0.8.2 finds them
 * when it writes `counted: false`. A plan that recodes a service keeps the
 * provider's line, not covered, beside the one it paid, and a plan that
 * writes a line off keeps that too; its totals count neither. Only billed,
 * plan paid and you owe are compared, as the payer wrote them, and only
 * those the totals and some line both give, at least two. The lines left
 * out are the one smallest set of up to three whose removal makes every
 * compared sum agree. None when the sums agree already, when no such set
 * exists, or when two sets of the smallest size would do.
 */
function leftOut(lines: LineAmounts[], r: MedRecord): number[] {
  const a = claimAmounts(r);
  const totals: Cents = { billed: toCents(a.billed), planPaid: toCents(a.planPaid), youOwe: a.shareAdded ? undefined : toCents(a.yourShare) };
  const given = lines.map((l) => Object.fromEntries(COMPARED.map((k) => [k, toCents(l[k])])) as Cents);
  const keys = COMPARED.filter((k) => totals[k] !== undefined && given.some((l) => l[k] !== undefined));
  if (keys.length < 2) return [];
  // What the lines hold beyond the totals; a set is left out when it holds exactly that.
  const over = keys.map((k) => given.reduce((t, l) => t + (l[k] ?? 0), 0) - totals[k]!);
  if (over.every((d) => d === 0)) return [];
  for (let size = 1; size <= 3 && size < lines.length; size += 1) {
    const found = setsHolding(given, keys, over, size);
    if (found.length) return found.length === 1 ? found[0]! : [];
  }
  return [];
}

const REVENUE_SYSTEM = /revenue|nubc/i;

function lineCode(v: Json | undefined): LineCode | undefined {
  const code = isObject(v) ? str(v.code) : undefined;
  return code && isObject(v) ? { code, system: str(v.system), display: str(v.display) } : undefined;
}

/** A revenue code in words: "Emergency room, revenue code 0450". */
export function revenueText(r: LineCode): string {
  return r.display ? `${r.display}, revenue code ${r.code}` : `Revenue code ${r.code}`;
}

const texts = (v: Json | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

function dayOf(v: Json | undefined): string | undefined {
  if (typeof v === 'string') return v.slice(0, 10);
  if (isObject(v) && typeof v.start === 'string') return v.start.slice(0, 10);
  return undefined;
}

/** Each claim's lines, read once: finding the lines left out can try many sets on a long claim. */
const linesRead = new WeakMap<MedRecord, readonly Readonly<ClaimLine>[]>();

/** A claim's lines, in their order, shared between callers and so read-only. */
export function claimLines(r: MedRecord): readonly Readonly<ClaimLine>[] {
  let out = linesRead.get(r);
  if (!out) {
    out = readLines(r);
    linesRead.set(r, out);
  }
  return out;
}

function readLines(r: MedRecord): ClaimLine[] {
  const items = r.fields.items;
  if (!Array.isArray(items)) return [];
  const type = str(r.fields.type) ?? r.code?.code;
  const out: ClaimLine[] = [];
  for (const it of items) {
    if (!isObject(it)) continue;
    const service = isObject(it.service) ? it.service : undefined;
    const named = str(service?.display) ?? str(service?.text) ?? str(service?.code);
    // medrec 0.8.2 gives a facility line's revenue code on its own; an
    // earlier medrec put it where the service code goes.
    const revenue = lineCode(it.revenue) ?? (REVENUE_SYSTEM.test(str(service?.system) ?? '') ? lineCode(service) : undefined);
    const code = named ? str(service?.code) : revenue?.code;
    const system = named ? str(service?.system) : revenue?.system;
    const label = named ?? revenue?.display ?? revenue?.code;
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
      counted: it.counted !== false,
      payerNotes: texts(it.payer_notes),
      revenue,
    });
  }
  // medrec 0.8.2 and later marks the lines left out; before, the same rule finds them here.
  if (out.every((l) => l.counted)) for (const i of leftOut(out.map((l) => l.amounts), r)) out[i]!.counted = false;
  return out;
}

/** The lines a claim's totals count: never one they leave out. */
export function countedLines(r: MedRecord): readonly Readonly<ClaimLine>[] {
  return claimLines(r).filter((l) => l.counted);
}

/** The payer's notes on the claim that no line points at, as medrec gives them (`payer_notes`). */
export function claimNotes(r: MedRecord): string[] {
  return texts(r.fields.payer_notes);
}

/** A pharmacy claim: its type says so, or every line is a drug the pharmacy filled. */
export function isPharmacyClaim(r: MedRecord): boolean {
  if (/pharmacy/i.test(str(r.fields.type) ?? r.code?.code ?? '')) return true;
  const lines = countedLines(r);
  return lines.length > 0 && lines.every((l) => l.category === 'pharmacy');
}

/** What a claim paid for, each service once, in line order; never a line its totals leave out. */
export function claimServices(r: MedRecord): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of countedLines(r)) {
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
  const kinds = new Set(countedLines(r).map((l) => l.category));
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
