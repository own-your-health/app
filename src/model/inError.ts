// What is entered in error (medrec 0.9.9 and later): a record or a paper that
// every one of its sources says is. It is in no list, search, visit, bill or
// total, so it is taken out of the index when that is read and kept aside: a
// list says how many it leaves out, and one opened by its id says what each
// source says. views.json names them (`people.<id>.in_error`), for the index
// it was made from. Where it does not read, or was made from another, what the
// index itself keeps of each source says it, item by item, by the same rule.
// The views of an earlier medrec are made of the whole index, so nothing is
// taken out beside those: a record's own status says it is withdrawn, as
// before (records.ts isWithdrawn).

import { isObject } from './parse';
import { atLeast } from './private';
import type { BillInError } from './bills';
import type { MedDocument, MedRecord, PersonIndex, Provenance, SourceWord } from './types';
import type { Md5 } from './views';

/** The items views.json says are entered in error, of an index with this MD5: 'unsaid' by an earlier medrec's, and undefined where it is of no such index, or has no lists of ids. */
export function inErrorIds(views: Record<string, unknown> | null, person: string, index: Md5 | undefined): ReadonlySet<string> | 'unsaid' | undefined {
  const p = isObject(views?.people) ? views.people[person] : undefined;
  if (!isObject(p) || typeof index !== 'string' || p.index !== index) return undefined;
  if (!atLeast(typeof views!.medrec === 'string' ? views!.medrec : undefined, [0, 9, 9])) return 'unsaid';
  if (p.in_error === undefined) return new Set();
  if (!isObject(p.in_error)) return undefined;
  const lists: unknown[] = Object.values(p.in_error);
  const ids = lists.flatMap((list): unknown[] => (Array.isArray(list) ? list : [undefined]));
  return ids.every((x) => typeof x === 'string') ? new Set(ids) : undefined;
}

/** The items every source says it of, by what an index keeps of each. */
const byWords = (index: PersonIndex): ReadonlySet<string> => new Set([...index.records.filter((r) => everySays(recordSays(r))), ...index.documents.filter((d) => everySays(documentSays(d)))].map((x) => x.id));

/** An index without what is entered in error, as medrec's own views are made of it. */
export function withoutErrors(index: PersonIndex, listed: ReturnType<typeof inErrorIds>): PersonIndex {
  if (listed === 'unsaid') return index;
  const ids = listed ?? byWords(index);
  const gone = { records: index.records.filter((r) => ids.has(r.id)), documents: index.documents.filter((d) => ids.has(d.id)) };
  // A statement whose first paper is in error is its next copy's.
  const next = new Map<string, string>();
  const again = (doc: MedDocument): MedDocument => {
    const d = Array.isArray(doc.near_duplicates) ? { ...doc, near_duplicates: doc.near_duplicates.filter((n) => !ids.has(n.document)) } : doc;
    const { same_statement_as: of, ...rest } = d;
    if (!of || !ids.has(of)) return d;
    const first = next.get(of);
    if (!first) next.set(of, d.id);
    return first ? { ...rest, same_statement_as: first } : rest;
  };
  const documents = index.documents.filter((d) => !ids.has(d.id)).map(again);
  // One that some source stands by stands, whichever source's status it has. With no list to say so, its sources' words do.
  const stands = (r: MedRecord) => saysError(r) && (!!listed || !!r.words?.length);
  return {
    ...index,
    records: index.records.filter((r) => !ids.has(r.id)).map((r) => (stands(r) ? { ...r, stands: true as const } : r)),
    documents,
    studies: index.studies.map((s) => (s.report && ids.has(s.report) ? { ...s, report: undefined, reportInError: true as const } : s)),
    inError: { ...gone, carried: new Set(next.keys()) },
  };
}

/** A code as medrec compares them. */
const code = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase().replace(/[\s_]+/g, '-') : '');
export const saysError = (w: { status?: string; verification?: string }): boolean => code(w.status) === 'entered-in-error' || code(w.verification) === 'entered-in-error';

/** What one of an item's sources says of it. */
export interface Says {
  /** Absent where it is not known which source it is. */
  provenance?: Provenance;
  status?: string;
  verification?: string;
  /** The day it was last read saying so. */
  read?: string;
  /** Its word is not kept. */
  unheard?: true;
  /** It is the household's own file. */
  household?: true;
}

const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);

function says(provenance: Provenance | undefined, word: SourceWord | undefined): Says {
  const of = provenance ? { provenance } : {};
  if (!word) return { ...of, ...(provenance?.source.cli ? { unheard: true } : { household: true }) };
  const read = day(word.read) ?? day(provenance?.fetched_at);
  return { ...of, ...(word.status ? { status: word.status } : {}), ...(word.verification ? { verification: word.verification } : {}), ...(read ? { read } : {}) };
}

const wordOf = (words: SourceWord[] | undefined, p: Provenance) => words?.find((w) => w.raw_path === p.raw_path);
const toldError = (all: Says[]): Says[] => (all.some(saysError) ? all : []);
const everySays = (all: Says[]): boolean => all.length > 0 && all.every(saysError);

/** What each source of a record says, where one says it is entered in error. Its own status is the word of its only source, or of the one that wrote its fields. */
export function recordSays(r: MedRecord): Says[] {
  const verification = r.fields.verification_status;
  const own: SourceWord = { ...(r.status ? { status: r.status } : {}), ...(typeof verification === 'string' ? { verification } : {}) };
  const wrote = (p: Provenance) => r.provenance.length === 1 || (p.raw_path !== undefined && p.raw_path === r.fields_from);
  const words = r.provenance.map((p) => ({ p, word: wordOf(r.words, p) ?? (wrote(p) ? own : undefined) }));
  return toldError([...(words.some((x) => x.word) ? [] : [says(undefined, own)]), ...words.map((x) => says(x.p, x.word))]);
}

/** What each source of a paper says, where one says it is entered in error. */
export function documentSays(d: MedDocument): Says[] {
  return toldError([d.provenance, ...(d.also_from ?? [])].map((p) => says(p, wordOf(d.words, p))));
}

/** Whether a record or a paper is entered in error, by medrec's word. */
export const isInError = (index: PersonIndex, id: string): boolean => !!index.inError && [...index.inError.records, ...index.inError.documents].some((x) => x.id === id);

const apart = new WeakMap<PersonIndex, PersonIndex>();

/** The items of an index that are entered in error, as an index of their own: a search of it says how many of them the words would have found. */
export function errorsIndex(index: PersonIndex): PersonIndex {
  let own = apart.get(index);
  if (!own) apart.set(index, (own = { ...index, records: index.inError?.records ?? [], documents: index.inError?.documents ?? [], studies: [] }));
  return own;
}

/** How many of these a list leaves out. */
export function errorsOf(index: PersonIndex, fits: { record?: (r: MedRecord) => boolean; document?: (d: MedDocument) => boolean }): number {
  const { records, documents } = index.inError ?? { records: [], documents: [] };
  return (fits.record ? records.filter(fits.record).length : 0) + (fits.document ? documents.filter(fits.document).length : 0);
}

/** A person's bills entered in error: medrec's, and where its list of bills is not here, those none of whose papers stands. */
export function billsInError(index: PersonIndex): BillInError[] {
  if (index.bills) return index.bills.errors;
  const { documents = [], carried } = index.inError ?? {};
  const here = new Set([...documents, ...index.documents].map((d) => d.id));
  return documents.filter((d) => d.doc_type === 'bill' && !(d.same_statement_as && here.has(d.same_statement_as)) && !carried?.has(d.id)).map((d) => ({ document: d.id, marked: 0 }));
}
