// One search over the household's records, documents and imaging, and the
// text medrec extracted from documents (each person's text.json), in the
// browser only. Every word (or "quoted phrase") must appear in an item's
// title, its fields or its text, ignoring case and accents. Title matches
// come first, then matches in a field, then matches only in a document's
// text, newest first within each.

import { KIND_LABELS, asMoney, docTypeLabel, documentTitle, formatMoney, studyTitle, valueText } from './records';
import { statusText } from './lists';
import { recordTitle } from './claims';
import type { Json, PersonIndex, PersonText } from './types';

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
}

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

function fieldsOf(fields: Record<string, Json>): [string, string][] {
  return Object.entries(fields)
    .filter(([k]) => !SKIP_FIELDS.has(k))
    .map(([k, v]): [string, string] => [fieldLabel(k), fieldText(v)])
    .filter(([, v]) => v.trim() !== '');
}

interface Candidate {
  id: string;
  kind: string;
  title: string;
  date?: string;
  /** What the title tier searches, folded: the name and what kind of thing it is. */
  names: string;
  fields: { label: string; value: string; folded: string }[];
  /** names and every field, folded. */
  all: string;
}

const allIn = (hay: string, ts: string[]) => ts.every((t) => hay.includes(t));

// Parts are joined with a newline, which no term holds (terms collapse
// whitespace to single spaces), so a phrase never matches across two fields.
const JOIN = '\n';

function candidate(id: string, kind: string, title: string, date: string | undefined, names: string[], fields: [string, string][]): Candidate {
  const f = fields.filter(([, v]) => v.trim() !== '').map(([label, value]) => ({ label, value, folded: normalize(value) }));
  const n = normalize(names.filter(Boolean).join(JOIN));
  return { id, kind, title, date, names: n, fields: f, all: [n, ...f.map((x) => x.folded)].join(JOIN) };
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
    out.push(candidate(r.id, r.kind, title, r.date, [title, r.code?.display ?? '', r.code?.code ?? '', KIND_LABELS[r.kind] ?? r.kind, statusText(r.status) ?? ''], fieldsOf(r.fields)));
  }
  for (const d of index.documents) {
    const fields: [string, string][] = [
      ['Statement', d.statement ? [d.statement.account ? `account ${d.statement.account}` : '', d.statement.amount_due ? `amount due ${formatMoney(d.statement.amount_due)}` : '', d.statement.due_date ? `due ${d.statement.due_date}` : ''].filter(Boolean).join(' · ') : ''],
      ['Original name', d.original_name ?? ''],
    ];
    out.push(candidate(d.id, 'document', documentTitle(d), d.date, [documentTitle(d), docTypeLabel(d.doc_type), d.organization ?? ''], fields));
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
  const base = { person, id: c.id, kind: c.kind, title: c.title, date: c.date };
  if (allIn(c.names, ts)) return { ...base, where: 'title' };
  if (allIn(c.all, ts)) {
    // Every term is in the name or in one field (none spans two), so some field holds one the name lacks.
    const missing = ts.filter((t) => !c.names.includes(t));
    const f = c.fields.find((x) => missing.some((t) => x.folded.includes(t)));
    const t = f && missing.find((x) => f.folded.includes(x));
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

/** One person's hits. */
export function search(index: PersonIndex, text: PersonText | null, query: string): Hit[] {
  return searchAll([{ person: index.person, index, text }], query);
}
