// One search over the household's records, documents and imaging, and the
// text medrec extracted from documents (each person's text.json), in the
// browser only. Every word (or "quoted phrase") must appear in an item's
// title, its fields or its text, ignoring case and accents. Title matches
// come first, then matches in a field, then matches only in a document's
// text, newest first within each.
//
// A few everyday words name a kind of thing rather than words to find:
// "blood tests" means lab results, "shots" vaccines, "bills" claims and
// statements, "visits" visits and "meds" medicines (CONCEPTS). `find` takes
// such a word out of the query and searches the other words within that kind;
// `{ words: true }` searches every word as written instead, and so does a
// concept with nothing that has the other words ("Example Lab").

import { claimAmounts, claimDiagnoses, claimLines, diagnosisText } from './claims';
import { panelFor } from './panels';
import { KIND_LABELS, asMoney, docTypeLabel, documentTitle, formatMoney, resultReading, seriesKey, str, studyTitle, toCents, valueText } from './records';
import { unitText } from './result';
import { statusText } from './lists';
import { recordTitle } from './titles';
import type { Json, MedRecord, PersonIndex, PersonText } from './types';

export type Where = 'title' | 'field' | 'text';

export interface Hit {
  person: string;
  id: string;
  kind: string;
  title: string;
  date?: string;
  where: Where;
  /** The field the words were found in ("Reason"), for a field match. */
  field?: string;
  /** The words around the match: the field's value, or a piece of the document's text. */
  snippet?: string;
  /** A result's test, so a screen can list each test once, by panel. */
  test?: { key: string; panel: string; panelOrder: number; value?: string };
  /** A claim's provider, and what it says you owe, else what was billed. */
  claim?: { provider?: string; amount?: string };
  /** A document's kind, in words. */
  docType?: string;
  /** The claim line that holds the words: "Blood draw (36415) · you owe $3.60". */
  line?: string;
}

export interface Concept {
  id: string;
  /** What it finds, as a heading: "Lab results". */
  label: string;
  /**
   * The words that name it, folded and singular; each word also matches with
   * -s or -es after it, so "blood test" is "blood tests" too.
   */
  phrases: string[];
  /** The records it takes in. */
  takes: (r: MedRecord) => boolean;
  /** The documents it takes in, by medrec's doc_type. */
  docTypes: string[];
}

/** A lab result: a result in a lab panel or a lab category, not a vital sign or a survey. */
function isLab(r: MedRecord): boolean {
  if (r.kind === 'report') {
    const category = str(r.fields.category);
    return !category || /\blab/i.test(category);
  }
  if (r.kind !== 'result') return false;
  const id = panelFor(seriesKey(r), str(r.fields.category)).id;
  return id !== 'vitals' && !id.startsWith('category:');
}

const ofKind = (kind: string) => (r: MedRecord) => r.kind === kind;

/** Everyday words that name a kind of thing: every concept, in one place. */
export const CONCEPTS = [
  {
    id: 'labs',
    label: 'Lab results',
    phrases: ['blood test', 'bloodwork', 'blood work', 'lab', 'lab result', 'lab test', 'lab work', 'test result'],
    takes: isLab,
    docTypes: ['lab_report'],
  },
  { id: 'shots', label: 'Vaccines', phrases: ['shot', 'vaccine', 'vaccination', 'immunization'], takes: ofKind('immunization'), docTypes: ['immunization_record'] },
  { id: 'bills', label: 'Claims and bills', phrases: ['bill', 'cost', 'claim', 'charge', 'statement', 'eob'], takes: ofKind('claim'), docTypes: ['bill', 'receipt', 'eob'] },
  { id: 'visits', label: 'Visits', phrases: ['visit', 'appointment'], takes: ofKind('encounter'), docTypes: ['visit_summary'] },
  { id: 'meds', label: 'Medicines', phrases: ['med', 'medication', 'medicine', 'prescription'], takes: ofKind('medication'), docTypes: ['prescription'] },
] as const satisfies readonly Concept[];

export type ConceptId = (typeof CONCEPTS)[number]['id'];

const recordConcept = (r: MedRecord): ConceptId | undefined => CONCEPTS.find((c) => c.takes(r))?.id;
const documentConcept = (docType: string | undefined): ConceptId | undefined => (docType ? CONCEPTS.find((c) => (c.docTypes as readonly string[]).includes(docType))?.id : undefined);

/** Words that only frame a request ("show my blood tests"), dropped beside a concept. */
const FRAME = new Set(['my', 'me', 'show', 'all', 'the', 'a', 'an', 'of', 'for', 'from', 'in', 'on', 'at', 'with', 'and', 'to', 'our', 'his', 'her', 'their', 'what', 'which', 'did', 'i', 'have', 'had', 'results', 'result', 'recent', 'latest', 'past', 'list', 'history', 'any']);

export interface Searchable {
  person: string;
  index: PersonIndex;
  /** Null when the person's text.json is missing or not loaded: their titles and fields are still searched. */
  text: PersonText | null;
}

const MARKS = /\p{M}/gu;
const MAX_TERMS = 12;

/** Lower case without accents, one character at a time, with where each came from in the original. */
interface Folded {
  text: string;
  at: number[];
}

function fold(s: string): Folded {
  let text = '';
  const at: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize('NFKD').replace(MARKS, '').toLowerCase();
    text += f;
    for (let k = 0; k < f.length; k += 1) at.push(i);
    i += ch.length;
  }
  at.push(i);
  return { text, at };
}

/** Lower case without accents, for matching. Whole strings at once: the per-character map is only for showing a match. */
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(MARKS, '').toLowerCase();
}

/** Where a folded term starts and ends in `text`, in its own characters; `folded` is normalize(text) when known. */
function locate(text: string, term: string, folded = normalize(text)): [number, number] | undefined {
  const i = folded.indexOf(term);
  if (i < 0) return undefined;
  // Folding usually keeps every character one character; then positions carry over as they are.
  if (folded.length === text.length) return [i, i + term.length];
  const f = fold(text);
  const j = f.text.indexOf(term);
  return j < 0 ? undefined : [f.at[j]!, f.at[j + term.length]!];
}

/** Words, and "quoted phrases" kept whole, folded. */
export function terms(q: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    const t = normalize((m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim()).replace(/^"+|"+$/g, '');
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_TERMS);
}

/** Where the terms appear in `s`, in its own characters, merged and in order. */
export function matchRanges(s: string, ts: string[]): [number, number][] {
  if (!s || ts.length === 0) return [];
  const f = fold(s);
  const raw: [number, number][] = [];
  for (const t of ts) {
    for (let i = f.text.indexOf(t); i >= 0; i = f.text.indexOf(t, i + t.length)) raw.push([f.at[i]!, f.at[i + t.length]!]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

/** About `around` characters each side of the first place a term appears, with cut ends marked. */
export function snippet(text: string, term: string, around = 60, folded?: string): string {
  const at = locate(text, normalize(term), folded);
  if (!at) return '';
  const [from, to] = at;
  const start = Math.max(0, from - around);
  const end = Math.min(text.length, to + around);
  const piece = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`;
}

function fieldLabel(k: string): string {
  const t = k.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A field's value as words: money and quantities as they read, everything else by its leaves. */
function fieldText(v: Json | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join(' · ');
  const money = asMoney(v);
  if (money && Object.keys(v).length <= 2) return formatMoney(money) ?? '';
  if ('value' in v && Object.keys(v).every((k) => ['value', 'unit', 'system', 'code'].includes(k))) return valueText(v) ?? '';
  return Object.entries(v)
    .filter(([k]) => k !== 'system' && k !== 'currency')
    .map(([, x]) => fieldText(x))
    .filter(Boolean)
    .join(' ');
}

const SKIP_FIELDS = new Set(['when']);

function fieldsOf(fields: Record<string, Json>, skip: string[] = []): [string, string][] {
  return Object.entries(fields)
    .filter(([k]) => !SKIP_FIELDS.has(k) && !skip.includes(k))
    .map(([k, v]): [string, string] => [fieldLabel(k), fieldText(v)])
    .filter(([, v]) => v.trim() !== '');
}

interface Candidate {
  id: string;
  kind: string;
  title: string;
  date?: string;
  concept?: ConceptId;
  extra: Pick<Hit, 'test' | 'claim' | 'docType'>;
  /** What the title tier searches, folded: the name and what kind of thing it is. */
  names: string;
  /** `line` marks one of a claim's lines, so a hit can name the line that matched. */
  fields: { label: string; value: string; folded: string; line?: true }[];
  /** names and every field, folded. */
  all: string;
}

const allIn = (hay: string, ts: string[]) => ts.every((t) => hay.includes(t));

// Parts are joined with a newline, which no term holds (terms collapse
// whitespace to single spaces), so a phrase never matches across two fields.
const JOIN = '\n';

function candidate(
  id: string,
  kind: string,
  title: string,
  date: string | undefined,
  names: string[],
  fields: [string, string, true?][],
  concept?: ConceptId,
  extra: Candidate['extra'] = {},
): Candidate {
  const f = fields.filter(([, v]) => v.trim() !== '').map(([label, value, line]) => ({ label, value, folded: normalize(value), ...(line ? { line } : {}) }));
  const n = normalize(names.filter(Boolean).join(JOIN));
  return { id, kind, title, date, concept, extra, names: n, fields: f, all: [n, ...f.map((x) => x.folded)].join(JOIN) };
}

/** A claim's parts searched in their own words, or not at all: lines, diagnoses, and medrec's amounts and links. */
const CLAIM_PARTS = ['items', 'diagnoses', 'amounts', 'visit', 'results'];

/** One field per claim line, "Lipid panel (80061) · billed $180.00", so a hit can say which line matched. */
function lineFields(r: MedRecord): [string, string, true][] {
  return claimLines(r).map((l): [string, string, true] => {
    const amount = l.amounts.youOwe ?? l.amounts.billed;
    const said = amount ? `${l.amounts.youOwe ? 'you owe' : 'billed'} ${formatMoney(amount)}` : '';
    return ['Line', [`${l.label}${l.code && l.code !== l.label ? ` (${l.code})` : ''}`, said].filter(Boolean).join(' · '), true];
  });
}

function recordExtra(r: MedRecord): Candidate['extra'] {
  if (r.kind === 'result') {
    const key = seriesKey(r);
    const panel = panelFor(key, str(r.fields.category));
    const v = resultReading(r.fields).text;
    return { test: { key, panel: panel.name, panelOrder: panel.order, value: v ? (unitText(v) ?? v) : undefined } };
  }
  if (r.kind === 'claim') {
    const a = claimAmounts(r);
    const owed = a.yourShare ? (toCents(a.yourShare) === 0 ? 'you owe nothing' : `${a.shareAdded ? 'your share' : 'you owe'} ${formatMoney(a.yourShare)}`) : undefined;
    const amount = owed ?? (a.billed ? `billed ${formatMoney(a.billed)}` : undefined);
    return { claim: { provider: str(r.fields.provider), amount } };
  }
  return {};
}

/** Each index's candidates, folded once: typing searches them again without folding. */
const prepared = new WeakMap<PersonIndex, Candidate[]>();

/** Folded document texts, kept per loaded text.json so typing does not fold them again. */
const foldedTexts = new WeakMap<PersonText, Map<string, string>>();

function foldedBody(text: PersonText | null, id: string): string | undefined {
  if (!text) return undefined;
  let m = foldedTexts.get(text);
  if (!m) foldedTexts.set(text, (m = new Map()));
  let f = m.get(id);
  if (f === undefined) {
    const body = text.texts[id];
    if (body === undefined) return undefined;
    f = normalize(body);
    m.set(id, f);
  }
  return f;
}

function candidates(index: PersonIndex): Candidate[] {
  const cached = prepared.get(index);
  if (cached) return cached;
  const out: Candidate[] = [];
  for (const r of index.records) {
    const title = recordTitle(r);
    // A claim's lines are searched one by one, so a hit names the line.
    const fields = r.kind === 'claim' ? [...fieldsOf(r.fields, CLAIM_PARTS), ...claimDiagnoses(r).map((d): [string, string] => ['Diagnosis', diagnosisText(d)]), ...lineFields(r)] : fieldsOf(r.fields);
    out.push(candidate(r.id, r.kind, title, r.date, [title, r.code?.display ?? '', r.code?.code ?? '', KIND_LABELS[r.kind] ?? r.kind, statusText(r.status) ?? ''], fields, recordConcept(r), recordExtra(r)));
  }
  for (const d of index.documents) {
    const fields: [string, string][] = [
      ['Statement', d.statement ? [d.statement.account ? `account ${d.statement.account}` : '', d.statement.amount_due ? `amount due ${formatMoney(d.statement.amount_due)}` : '', d.statement.due_date ? `due ${d.statement.due_date}` : ''].filter(Boolean).join(' · ') : ''],
      ['Original name', d.original_name ?? ''],
    ];
    out.push(candidate(d.id, 'document', documentTitle(d), d.date, [documentTitle(d), docTypeLabel(d.doc_type), d.organization ?? ''], fields, documentConcept(d.doc_type), { docType: docTypeLabel(d.doc_type) }));
  }
  for (const st of index.studies) {
    const fields: [string, string][] = [
      ['Facility', st.facility ?? ''],
      ['Series', st.series.map((x) => x.description).filter(Boolean).join(' · ')],
      ['Accession', st.accession ?? ''],
    ];
    out.push(candidate(st.id, 'study', studyTitle(st), st.date, [studyTitle(st), st.body_part ?? '', st.modalities.join(' '), KIND_LABELS.study ?? 'Imaging'], fields));
  }
  prepared.set(index, out);
  return out;
}

function match(c: Candidate, ts: string[], text: PersonText | null, person: string): Hit | undefined {
  const base = { person, id: c.id, kind: c.kind, title: c.title, date: c.date, ...c.extra };
  if (allIn(c.names, ts)) {
    // A claim found by its services still says which line holds the words.
    const line = c.fields.find((x) => x.line && ts.some((t) => x.folded.includes(t)));
    return line ? { ...base, where: 'title', line: line.value } : { ...base, where: 'title' };
  }
  if (allIn(c.all, ts)) {
    // Every term is in the name or in one field (none spans two), so some field holds one the name lacks.
    const missing = ts.filter((t) => !c.names.includes(t));
    const f = c.fields.find((x) => missing.some((t) => x.folded.includes(t)));
    const t = f && missing.find((x) => f.folded.includes(x));
    if (f?.line) return { ...base, where: 'field', line: f.value };
    if (f && t) return { ...base, where: 'field', field: f.label, snippet: f.value.length > 160 ? snippet(f.value, t, 60, f.folded) : f.value };
  }
  if (c.kind !== 'document') return undefined;
  const body = foldedBody(text, c.id);
  if (body === undefined || !allIn(`${c.all}${JOIN}${body}`, ts)) return undefined;
  const t = ts.find((x) => !c.all.includes(x)) ?? ts[0]!;
  return { ...base, where: 'text', snippet: snippet(text!.texts[c.id]!, t, 60, body) };
}

const RANK: Record<Where, number> = { title: 0, field: 1, text: 2 };

/** Every hit across the people given, best first. */
export function searchAll(people: Searchable[], query: string): Hit[] {
  const ts = terms(query);
  if (ts.length === 0) return [];
  const hits: Hit[] = [];
  for (const p of people) {
    for (const c of candidates(p.index)) {
      const hit = match(c, ts, p.text, p.person);
      if (hit) hits.push(hit);
    }
  }
  return hits.sort((a, b) => RANK[a.where] - RANK[b.where] || (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title));
}

interface Token {
  text: string;
  quoted: boolean;
}

function tokens(q: string): Token[] {
  const out: Token[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    const quoted = m[1] !== undefined;
    // Punctuation at a word's ends ("bills?") is not part of it.
    const t = normalize((m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim()).replace(quoted ? /^"+|"+$/g : /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (t) out.push({ text: t, quoted });
  }
  return out;
}

const PHRASES = CONCEPTS.flatMap((c) => c.phrases.map((p) => ({ concept: c as Concept, words: p.split(' ') }))).sort((a, b) => b.words.length - a.words.length);

/** A query's word against a phrase's: the same, or with -s or -es after it. */
const sameWord = (token: string, word: string) => token === word || token === `${word}s` || token === `${word}es`;

/**
 * The concept a query names, outside quotes, and the words left to find
 * within it: "flu shot" is vaccines with "flu", "my blood tests" is lab
 * results with nothing left.
 */
export function conceptOf(q: string): { concept: Concept; rest: string[] } | undefined {
  const ts = tokens(q);
  for (let i = 0; i < ts.length; i += 1) {
    for (const p of PHRASES) {
      const span = ts.slice(i, i + p.words.length);
      if (span.length !== p.words.length || span.some((t, k) => t.quoted || !sameWord(t.text, p.words[k]!))) continue;
      const rest = [...ts.slice(0, i), ...ts.slice(i + p.words.length)].filter((t) => t.quoted || !FRAME.has(t.text)).map((t) => t.text);
      return { concept: p.concept, rest: [...new Set(rest)].slice(0, MAX_TERMS) };
    }
  }
  return undefined;
}

export interface Found {
  hits: Hit[];
  /** The concept the query names, whether or not the search was within it. */
  named?: Concept;
  /**
   * How the search was made: within the concept; every word, because that
   * was asked for or no concept was named; or every word because nothing of
   * the concept had the other words ("Example Lab").
   */
  how: 'concept' | 'words' | 'fallback';
  /** The other words, beside a concept. */
  rest: string[];
  /** The words searched, to mark in the results. */
  terms: string[];
}

/**
 * The search a person means. A query that names a concept finds that kind,
 * newest first, narrowed by its other words. Anything else, `words`, or a
 * concept with nothing that has the other words, finds every word as written.
 */
export function find(people: Searchable[], query: string, opts: { words?: boolean } = {}): Found {
  const named = conceptOf(query);
  const asWords = (how: Found['how']): Found => ({ hits: searchAll(people, query), named: named?.concept, how, rest: named?.rest ?? [], terms: terms(query) });
  if (!named || opts.words) return asWords('words');
  const { concept, rest } = named;
  const hits: Hit[] = [];
  for (const p of people) {
    for (const c of candidates(p.index)) {
      if (c.concept !== concept.id) continue;
      const hit = rest.length ? match(c, rest, p.text, p.person) : { person: p.person, id: c.id, kind: c.kind, title: c.title, date: c.date, where: 'title' as const, ...c.extra };
      if (hit) hits.push(hit);
    }
  }
  if (hits.length === 0 && rest.length) return asWords('fallback');
  hits.sort((a, b) => RANK[a.where] - RANK[b.where] || (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title));
  return { hits, named: concept, how: 'concept', rest, terms: rest };
}

/** One person's hits. */
export function search(index: PersonIndex, text: PersonText | null, query: string): Hit[] {
  return searchAll([{ person: index.person, index, text }], query);
}
