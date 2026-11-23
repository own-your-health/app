// What care cost, across the household: every claim line with what was
// billed, what the plan allowed and paid, and your share, by plan year or by
// calendar year (for taxes), and by person, provider, kind of care and month.
//
// Money is whole cents. A claim's totals are the record: where its lines do
// not add up to them, the difference is a line of its own ("Not split by
// line"), so a year's totals always equal its claims'. A plan year starts on
// the day the plan's claims give for it (their benefit period), else on the
// day set in Settings, else on January 1. Never on a coverage's start: that
// is the day a coverage took effect, which can fall mid-year (a new child, a
// new job), not the day the plan's year begins.

import { claimAmounts, toCents } from './billing';
import { CATEGORY_LABELS, categoryOf, claimCategory, claimLines, claimTitle, type Category } from './claims';
import { providerKey, sameProvider } from './providers';
import { asMoney, isWithdrawn, str, type AmountName } from './records';
import type { Json, MedRecord, PersonIndex } from './types';

export type Amount = AmountName;

/** Every amount, in the order a statement lists them. */
export const AMOUNTS: Amount[] = ['billed', 'allowed', 'planPaid', 'deductible', 'copay', 'coinsurance', 'notCovered', 'youOwe'];

export type Cents = Partial<Record<Amount, number>>;

export interface PlanYear {
  /** The day each plan year starts, "MM-DD"; "01-01" for a calendar year. */
  anniversary: string;
  /** This plan year's first and last days. */
  start: string;
  end: string;
}

export interface CostLine {
  person: string;
  /** The claim record's id. */
  claim: string;
  claimTitle: string;
  /** The day of service: the line's own, else the claim's. */
  date: string;
  provider: string;
  insurer?: string;
  category: Category;
  /** What was done, as the payer wrote it. */
  service: string;
  code?: string;
  system?: string;
  cents: Cents;
  planYear: PlanYear;
  /** Where the plan year's start came from. */
  planBasis: PlanBasis;
  /** False for the part of a claim's totals its lines do not account for. */
  split: boolean;
}

const UNKNOWN_PROVIDER = 'Provider not named';

// ---- Plan years ----

const pad = (n: number) => String(n).padStart(2, '0');

/** The plan year with this anniversary that holds `day`. */
export function planYearOf(anniversary: string, day: string): PlanYear {
  const year = Number(day.slice(0, 4));
  const startYear = day.slice(5) >= anniversary ? year : year - 1;
  const start = `${startYear}-${anniversary}`;
  const next = new Date(Date.UTC(startYear + 1, Number(anniversary.slice(0, 2)) - 1, Number(anniversary.slice(3))));
  next.setUTCDate(next.getUTCDate() - 1);
  return { anniversary, start, end: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}` };
}

/** The plan year before or after this one, `n` years on. */
export function shiftPlanYear(p: PlanYear, n: number): PlanYear {
  return planYearOf(p.anniversary, `${Number(p.start.slice(0, 4)) + n}-${p.start.slice(5)}`);
}

/** Where a plan year's start came from: the plan's claims, Settings, or neither (January 1). */
export type PlanBasis = 'claims' | 'setting' | 'calendar';

const DAY = /^\d{4}-\d{2}-\d{2}/;

/** A claim's benefit period (FHIR ExplanationOfBenefit.benefitPeriod), when it is a plan year: about a year long. */
export function benefitPeriodOf(r: MedRecord): { start: string; end: string } | undefined {
  const p = r.fields.benefit_period;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;
  const start = str(p.start);
  const end = str(p.end);
  if (!start || !end || !DAY.test(start) || !DAY.test(end)) return undefined;
  const days = (Date.parse(end.slice(0, 10)) - Date.parse(start.slice(0, 10))) / 86_400_000;
  return days >= 330 && days <= 370 ? { start: start.slice(0, 10), end: end.slice(0, 10) } : undefined;
}

/**
 * The day this person's plan with this insurer starts its year, "MM-DD": the
 * benefit period its newest claim gives, else the day set in Settings, else
 * January 1.
 */
function anniversaryFor(index: PersonIndex, insurer: string | undefined, planStart: string | undefined): { anniversary: string; basis: PlanBasis } {
  const given = index.records
    .filter((r) => r.kind === 'claim' && !isWithdrawn(r) && (insurer ? sameProvider(str(r.fields.insurer), insurer) : !str(r.fields.insurer)))
    .map(benefitPeriodOf)
    .filter((p): p is { start: string; end: string } => !!p)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  if (given) return { anniversary: given.start.slice(5), basis: 'claims' };
  if (planStart) return { anniversary: planStart, basis: 'setting' };
  return { anniversary: '01-01', basis: 'calendar' };
}

/** What the household set in Settings: the day its plans' years start, for plans whose claims do not say. */
export interface CostOptions {
  planStart?: string;
}

// ---- Lines ----

function lineCents(amounts: Partial<Record<Amount, { amount: string; currency: string }>>): Cents {
  const out: Cents = {};
  for (const k of AMOUNTS) {
    const c = toCents(amounts[k]);
    if (c !== undefined) out[k] = c;
  }
  // Your share is its parts when the payer gave only the parts.
  if (out.youOwe === undefined && (out.deductible !== undefined || out.copay !== undefined || out.coinsurance !== undefined || out.notCovered !== undefined)) {
    out.youOwe = (out.deductible ?? 0) + (out.copay ?? 0) + (out.coinsurance ?? 0) + (out.notCovered ?? 0);
  }
  return out;
}

/** A claim's own totals, in cents, by the same names as its lines'. */
function claimCents(r: MedRecord): Cents {
  const a = claimAmounts(r);
  const parts: Cents = {};
  for (const p of a.parts) {
    const name = (Object.entries({ deductible: 'Deductible', copay: 'Copay', coinsurance: 'Coinsurance', notCovered: 'Not covered' }) as [Amount, string][]).find(([, l]) => l === p.label)?.[0];
    const c = toCents(p.amount);
    if (name && c !== undefined) parts[name] = (parts[name] ?? 0) + c;
  }
  const out: Cents = { ...parts };
  for (const [k, m] of [['billed', a.billed], ['allowed', a.allowed], ['planPaid', a.planPaid], ['youOwe', a.yourShare]] as const) {
    const c = toCents(m);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

const dayOf = (v: Json | undefined): string | undefined => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.start === 'string') return v.start.slice(0, 10);
  return undefined;
};

/** A claim without lines: the one category medrec gave it, else its type's. */
function wholeClaimCategory(r: MedRecord): Category {
  const given = claimCategory(r);
  return given && given !== 'mixed' ? given : categoryOf(undefined, undefined, str(r.fields.type) ?? r.code?.code);
}

/** One person's claim lines, and the part of each claim's totals its lines leave out. */
export function costLines(person: string, index: PersonIndex, opts: CostOptions = {}): CostLine[] {
  const out: CostLine[] = [];
  const anniversaries = new Map<string, { anniversary: string; basis: PlanBasis }>();
  for (const r of index.records) {
    if (r.kind !== 'claim' || isWithdrawn(r)) continue;
    const service = dayOf(r.fields.billable_period) ?? r.date?.slice(0, 10);
    if (!service) continue;
    const insurer = str(r.fields.insurer);
    const plan = anniversaries.get(insurer ?? '') ?? anniversaryFor(index, insurer, opts.planStart);
    anniversaries.set(insurer ?? '', plan);
    const { anniversary, basis: planBasis } = plan;
    const base = {
      person,
      claim: r.id,
      claimTitle: claimTitle(r),
      provider: str(r.fields.provider) ?? UNKNOWN_PROVIDER,
      insurer,
    };
    const lines = claimLines(r);
    const sums: Cents = {};
    for (const l of lines) {
      const cents = lineCents(l.amounts);
      for (const k of AMOUNTS) if (cents[k] !== undefined) sums[k] = (sums[k] ?? 0) + cents[k]!;
      const date = l.date ?? service;
      out.push({ ...base, date, category: l.category, service: l.label, code: l.code, system: l.system, cents, planYear: planYearOf(anniversary, date), planBasis, split: true });
    }
    // What the claim's totals hold beyond its lines.
    const totals = claimCents(r);
    const rest: Cents = {};
    for (const k of AMOUNTS) {
      const left = (totals[k] ?? 0) - (sums[k] ?? 0);
      if (totals[k] !== undefined && left !== 0) rest[k] = left;
    }
    if (Object.keys(rest).length) {
      out.push({
        ...base,
        date: service,
        category: lines.length ? 'other' : wholeClaimCategory(r),
        service: lines.length ? 'Not split by line' : base.claimTitle,
        cents: rest,
        planYear: planYearOf(anniversary, service),
        planBasis,
        split: false,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.claim.localeCompare(b.claim));
}

/** Everyone's lines, newest first. */
export function householdLines(people: { id: string; index: PersonIndex | undefined }[], opts: CostOptions = {}): CostLine[] {
  return people.flatMap((p) => (p.index ? costLines(p.id, p.index, opts) : [])).sort((a, b) => b.date.localeCompare(a.date) || a.claim.localeCompare(b.claim));
}

// ---- Periods ----

/** "plan" (this plan year), "plan-1" (the one before), a calendar year ("2026"), or "all". */
export type PeriodId = string;

export interface Period {
  id: PeriodId;
  label: string;
}

/** The periods the lines span: this and last plan year, then each calendar year, newest first. */
export function periods(lines: CostLine[], today: string): Period[] {
  const years = [...new Set(lines.map((l) => l.date.slice(0, 4)))].sort().reverse();
  const out: Period[] = [];
  if (lines.some((l) => inPeriod(l, 'plan', today))) out.push({ id: 'plan', label: 'This plan year' });
  if (lines.some((l) => inPeriod(l, 'plan-1', today))) out.push({ id: 'plan-1', label: 'Last plan year' });
  for (const y of years) out.push({ id: y, label: y });
  if (years.length > 1) out.push({ id: 'all', label: 'All years' });
  return out;
}

export function inPeriod(l: CostLine, period: PeriodId, today: string): boolean {
  if (period === 'all') return true;
  if (/^\d{4}$/.test(period)) return l.date.startsWith(period);
  const back = period === 'plan' ? 0 : period === 'plan-1' ? 1 : undefined;
  if (back === undefined) return false;
  return l.planYear.start === shiftPlanYear(planYearOf(l.planYear.anniversary, today), -back).start;
}

/** The plan years a period covers, each once: "Example Care Plan: Jul 1, 2026 – Jun 30, 2027". */
export function planYearsIn(lines: CostLine[]): { insurer?: string; year: PlanYear; basis: PlanBasis }[] {
  const seen = new Map<string, { insurer?: string; year: PlanYear; basis: PlanBasis }>();
  for (const l of lines) {
    const k = `${l.insurer ?? ''}|${l.planYear.start}|${l.planBasis}`;
    if (!seen.has(k)) seen.set(k, { insurer: l.insurer, year: l.planYear, basis: l.planBasis });
  }
  return [...seen.values()].sort((a, b) => (a.insurer ?? '').localeCompare(b.insurer ?? '') || a.year.start.localeCompare(b.year.start));
}

/** Whether a day falls in a period, for one person's lines in it: their plan years, the calendar year, or any day. */
export function dayInPeriod(d: string, period: PeriodId, lines: CostLine[]): boolean {
  if (period === 'all') return true;
  if (/^\d{4}$/.test(period)) return d.startsWith(period);
  return planYearsIn(lines).some((y) => y.year.start <= d && d <= y.year.end);
}

// ---- Totals and breakdowns ----

export interface Totals {
  cents: Cents;
  claims: number;
  lines: number;
}

export function totals(lines: CostLine[]): Totals {
  const cents: Cents = {};
  for (const l of lines) for (const k of AMOUNTS) if (l.cents[k] !== undefined) cents[k] = (cents[k] ?? 0) + l.cents[k]!;
  return { cents, claims: new Set(lines.map((l) => l.claim)).size, lines: lines.length };
}

export type Dimension = 'person' | 'provider' | 'category' | 'month';

export const DIMENSION_LABELS: Record<Dimension, string> = { person: 'Person', provider: 'Provider', category: 'Kind of care', month: 'Month' };

/** What a line is under a dimension: its key and its name. */
export function keyOf(l: CostLine, by: Dimension, names: Map<string, string>): { key: string; label: string } {
  switch (by) {
    case 'person':
      return { key: l.person, label: names.get(l.person) ?? 'Someone' };
    case 'provider':
      return { key: providerKey(l.provider) || l.provider.toLowerCase(), label: l.provider };
    case 'category':
      return { key: l.category, label: CATEGORY_LABELS[l.category].many };
    case 'month':
      return { key: l.date.slice(0, 7), label: monthLabel(l.date.slice(0, 7)) };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;

export interface Group extends Totals {
  key: string;
  label: string;
}

/** The lines grouped under a dimension: months in order, anything else by your share, then by what the plan allowed. */
export function breakdown(lines: CostLine[], by: Dimension, names: Map<string, string>): Group[] {
  const groups = new Map<string, { label: string; lines: CostLine[] }>();
  for (const l of lines) {
    const { key, label } = keyOf(l, by, names);
    const g = groups.get(key);
    if (g) g.lines.push(l);
    else groups.set(key, { label, lines: [l] });
  }
  const out = [...groups.entries()].map(([key, g]): Group => ({ key, label: g.label, ...totals(g.lines) }));
  if (by === 'month') return out.sort((a, b) => a.key.localeCompare(b.key));
  return out.sort((a, b) => (b.cents.youOwe ?? 0) - (a.cents.youOwe ?? 0) || (b.cents.allowed ?? 0) - (a.cents.allowed ?? 0) || a.label.localeCompare(b.label));
}

/**
 * Every month of a period up to today, or from the first line's to the
 * last's for every year, so a chart shows the quiet months too.
 */
export function monthsSpanned(lines: CostLine[], period: PeriodId, today: string): string[] {
  if (!lines.length) return [];
  const sorted = lines.map((l) => l.date.slice(0, 7)).sort();
  let first = sorted[0]!;
  let last = sorted[sorted.length - 1]!;
  const now = today.slice(0, 7);
  const min = (...xs: string[]) => xs.reduce((a, b) => (b < a ? b : a));
  const max = (...xs: string[]) => xs.reduce((a, b) => (b > a ? b : a));
  // A year's months run from its start to its end or to this month, whichever comes first, and always reach the last line.
  if (/^\d{4}$/.test(period)) {
    first = `${period}-01`;
    last = max(last, min(`${period}-12`, now));
  } else if (period === 'plan' || period === 'plan-1') {
    first = min(first, ...lines.map((l) => l.planYear.start.slice(0, 7)));
    last = max(last, min(max(...lines.map((l) => l.planYear.end.slice(0, 7))), now));
  }
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number) as [number, number];
  for (let guard = 0; guard < 240; guard += 1) {
    const ym = `${y}-${pad(m)}`;
    out.push(ym);
    if (ym >= last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ---- One code's prices ----

const SYSTEM_NAMES: [RegExp, string][] = [
  [/ama-assn|\/cpt/i, 'CPT'],
  [/hcpcs/i, 'HCPCS'],
  [/ndc/i, 'NDC'],
  [/rxnorm/i, 'RxNorm'],
  [/icd-10/i, 'ICD-10'],
  [/snomed/i, 'SNOMED CT'],
];

/** A code system's short name: "CPT", "NDC"; the address itself when it is none of these. */
export function systemName(system: string | undefined): string {
  if (!system) return '';
  return SYSTEM_NAMES.find(([re]) => re.test(system))?.[1] ?? system;
}

export interface CodeSummary {
  /** As `codeKey` writes it. */
  key: string;
  code: string;
  system?: string;
  /** What the payers called it most often. */
  label: string;
  count: number;
  providers: number;
  /** The lowest and highest the plans allowed. */
  minAllowed?: number;
  maxAllowed?: number;
}

/** A code as the address carries it: "CPT:36415". */
export const codeKey = (l: Pick<CostLine, 'code' | 'system'>) => `${systemName(l.system) || 'Code'}:${l.code ?? ''}`;

/** The codes billed more than once, most often first: the ones whose prices can be compared. */
export function comparableCodes(lines: CostLine[]): CodeSummary[] {
  const byCode = new Map<string, CostLine[]>();
  for (const l of lines) {
    if (!l.code || !l.split) continue;
    const k = codeKey(l);
    byCode.set(k, [...(byCode.get(k) ?? []), l]);
  }
  const out: CodeSummary[] = [];
  for (const [key, ls] of byCode) {
    if (ls.length < 2) continue;
    const labels = new Map<string, number>();
    for (const l of ls) labels.set(l.service, (labels.get(l.service) ?? 0) + 1);
    const allowed = ls.map((l) => l.cents.allowed).filter((c): c is number => c !== undefined);
    out.push({
      key,
      code: ls[0]!.code!,
      system: ls[0]!.system,
      label: [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
      count: ls.length,
      providers: new Set(ls.map((l) => providerKey(l.provider) || l.provider)).size,
      minAllowed: allowed.length ? Math.min(...allowed) : undefined,
      maxAllowed: allowed.length ? Math.max(...allowed) : undefined,
    });
  }
  return out.sort((a, b) => b.providers - a.providers || b.count - a.count || a.label.localeCompare(b.label));
}

/** Every line for one code, newest first. */
export function codeLines(lines: CostLine[], key: string): CostLine[] {
  return lines.filter((l) => l.code && l.split && codeKey(l) === key);
}

// ---- Plan balances in a period ----

export interface BalanceItem {
  /** "Deductible", "Out-of-pocket limit". */
  label: string;
  /** "in network, individual". */
  scope: string;
  used?: number;
  limit?: number;
}

/** What one person's plan printed on its newest claim in a plan year: the deductible and out-of-pocket limit so far. */
export interface Balance {
  person: string;
  insurer?: string;
  planYear: PlanYear;
  asOf: string;
  /** The claim that printed them. */
  claim: string;
  items: BalanceItem[];
}

const NETWORK: Record<string, string> = { in: 'in network', out: 'out of network' };

/** Each person's plan balances, one for each plan and plan year in the lines, from the newest claim that printed them. */
export function balances(lines: CostLine[], records: Map<string, MedRecord>): Balance[] {
  const byPlan = new Map<string, CostLine[]>();
  for (const l of lines) {
    const k = `${l.person}|${l.insurer ?? ''}|${l.planYear.start}`;
    byPlan.set(k, [...(byPlan.get(k) ?? []), l]);
  }
  const out: Balance[] = [];
  for (const ls of byPlan.values()) {
    const newest = [...new Set(ls.map((l) => l.claim))]
      .map((id) => records.get(id))
      .filter((r): r is MedRecord => !!r && Array.isArray(r.fields.benefit_balance) && r.fields.benefit_balance.length > 0)
      .sort((a, b) => (dayOf(b.fields.billable_period) ?? b.date ?? '').localeCompare(dayOf(a.fields.billable_period) ?? a.date ?? ''))[0];
    if (!newest) continue;
    const items: BalanceItem[] = [];
    for (const b of newest.fields.benefit_balance as Json[]) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      const scope = [NETWORK[str(b.network) ?? ''] ?? str(b.network), str(b.unit)].filter(Boolean).join(', ');
      for (const f of Array.isArray(b.financial) ? b.financial : []) {
        if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
        items.push({ label: str(f.type) ?? 'Balance', scope, used: toCents(asMoney(f.used)), limit: toCents(asMoney(f.allowed)) });
      }
    }
    if (!items.length) continue;
    const l = ls[0]!;
    out.push({ person: l.person, insurer: l.insurer, planYear: l.planYear, asOf: dayOf(newest.fields.billable_period) ?? newest.date?.slice(0, 10) ?? '', claim: newest.id, items });
  }
  return out.sort((a, b) => a.person.localeCompare(b.person) || (a.insurer ?? '').localeCompare(b.insurer ?? '') || b.planYear.start.localeCompare(a.planYear.start));
}

// ---- CSV ----

const CSV_HEAD = ['Date', 'Person', 'Provider', 'Insurer', 'Plan year', 'Service', 'Code', 'Code system', 'Kind of care', 'Billed', 'Allowed', 'Plan paid', 'Deductible', 'Copay', 'Coinsurance', 'Not covered', 'You owe', 'Claim'];

/** A text cell as a spreadsheet reads it safely: quoted when it must be, and never taken as a formula. */
export function csvText(v: string | undefined): string {
  let t = v ?? '';
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const csvMoney = (c: number | undefined) => (c === undefined ? '' : `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${pad(Math.abs(c) % 100)}`);

/** The lines as CSV, one row each, amounts in dollars. */
export function toCsv(lines: CostLine[], names: Map<string, string>): string {
  const rows = lines.map((l) =>
    [
      csvText(l.date),
      csvText(names.get(l.person) ?? ''),
      csvText(l.provider),
      csvText(l.insurer),
      csvText(`${l.planYear.start} to ${l.planYear.end}`),
      csvText(l.service),
      csvText(l.code),
      csvText(systemName(l.system)),
      csvText(CATEGORY_LABELS[l.category].one),
      ...(['billed', 'allowed', 'planPaid', 'deductible', 'copay', 'coinsurance', 'notCovered', 'youOwe'] as Amount[]).map((k) => csvMoney(l.cents[k])),
      csvText(l.claim),
    ].join(','),
  );
  return `${[CSV_HEAD.join(','), ...rows].join('\r\n')}\r\n`;
}
