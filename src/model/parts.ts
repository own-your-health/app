// The private parts of open items (private.json `parts`, medrec 0.9.9 and
// later). A claim of several services, a bill and a visit stay open when only
// a part of them is private. A screen the household shares leaves that part
// out: the service, with its code and what came of it; the diagnosis; the
// payer's note; the line of a paper's text. It says how many it leaves out,
// and amounts stay. medrec alone judges what is private: this applies its
// places, which are of the index.json and text.json that private.json was made
// from, the only ones the store reads it with.

import { placeFrom, type PlaceFrom } from './events';
import { FolderError, isObject } from './parse';
import type { Json, MedRecord, PersonIndex, PersonText } from './types';

/** What a visit's open members and their open lines alone say, where events.json has it otherwise; null where they say nothing. */
export interface EventPart {
  kind?: string | null;
  title?: string | null;
  what?: string | null;
  place?: string | null;
  placeFrom?: PlaceFrom | null;
  expected?: { what: string; why: string; since?: string }[] | null;
}

export interface Part {
  /** A claim's name by the lines that are left. */
  display?: string;
  /** Their category, where it is another; null where none is left. */
  category?: string | null;
  /** The places of what is private, from 0, in a claim's `items`, `diagnoses` and `payer_notes`. */
  lines: number[];
  diagnoses: number[];
  payerNotes: number[];
  /** Byte offset and length in a paper's text of each line that is private. */
  text: [number, number][];
  event: EventPart;
  /** "1 service not shown", for the item's own row. */
  says?: string;
}

const bad = (): FolderError => new FolderError('malformed', 'a private part in it does not read.');
const place = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function places(v: unknown): number[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(place)) throw bad();
  return v;
}

function spans(v: unknown): [number, number][] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(place))) throw bad();
  return v;
}

/** Text that is given, or null where nothing is said. */
function textOrNull(raw: Record<string, unknown>, key: string): string | null | undefined {
  const v = raw[key];
  if (v !== undefined && v !== null && typeof v !== 'string') throw bad();
  return v;
}

function eventPart(raw: Record<string, unknown>): EventPart {
  const out: EventPart = {};
  const [kind, title, what, at, from] = ['kind', 'title', 'what', 'place', 'place_from'].map((k) => textOrNull(raw, k));
  if (kind !== undefined) out.kind = kind;
  if (title !== undefined) out.title = title;
  if (what !== undefined) out.what = what;
  if (at !== undefined) out.place = at;
  if (from !== undefined) out.placeFrom = placeFrom(from).placeFrom ?? null;
  if (raw.expected === null) out.expected = null;
  else if (raw.expected !== undefined) {
    if (!Array.isArray(raw.expected)) throw bad();
    out.expected = raw.expected.filter(isObject).flatMap((x) => (typeof x.what === 'string' && x.what ? [{ what: x.what, why: typeof x.why === 'string' ? x.why : '', ...(typeof x.since === 'string' ? { since: x.since } : {}) }] : []));
  }
  return out;
}

/** private.json's `parts`, by item; undefined in a list of before 0.9.9. A part that does not read is refused: what it would leave out is not known. */
export function parseParts(raw: unknown): Map<string, Part> | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw bad();
  return new Map(
    Object.entries(raw).map(([id, p]): [string, Part] => {
      if (!isObject(p)) throw bad();
      const [display, category, says] = ['display', 'category', 'says'].map((k) => textOrNull(p, k));
      return [
        id,
        {
          ...(display ? { display } : {}),
          ...(category !== undefined ? { category } : {}),
          lines: places(p.lines),
          diagnoses: places(p.diagnoses),
          payerNotes: places(p.payer_notes),
          text: spans(p.text),
          event: eventPart(p),
          ...(says ? { says } : {}),
        },
      ];
    }),
  );
}

/** The private part of an item: none of one that is private whole, or of a person whose private items are not known. */
export const partOf = (index: PersonIndex, id: string): Part | undefined => (index.privacy?.kind === 'known' ? index.privacy.parts?.get(id) : undefined);

/** What is left out of an item on a shared screen, for its own row: "1 service not shown". */
export const partSays = (index: PersonIndex, id: string): string | undefined => partOf(index, id)?.says;

/** A list without these places; nothing of one they are not places of. */
function without(list: Json | undefined, gone: number[]): Json | undefined {
  if (!gone.length) return list;
  return Array.isArray(list) && gone.every((i) => i < list.length) ? list.filter((_, i) => !gone.includes(i)) : undefined;
}

/** A record as a shared screen goes by it: a claim without its private lines, named by the rest. Its totals are its own. */
export function sharedRecord(index: PersonIndex, r: MedRecord): MedRecord {
  const part = r.without ? undefined : partOf(index, r.id);
  if (!part) return r;
  const fields = { ...r.fields };
  const put = (key: string, v: Json | undefined) => {
    if (v === undefined) delete fields[key];
    else fields[key] = v;
  };
  put('items', without(fields.items, part.lines));
  put('diagnoses', without(fields.diagnoses, part.diagnoses));
  put('payer_notes', without(fields.payer_notes, part.payerNotes));
  if (part.category !== undefined) put('category', part.category ?? undefined);
  // A name medrec gave the whole claim can be a private line's.
  const display = part.display ?? (part.lines.length ? '' : r.display);
  return { ...r, display, fields, without: { whole: r, ...(part.says ? { says: part.says } : {}) } };
}

const twins = new WeakMap<PersonIndex, PersonIndex>();

/** An index as a shared screen goes by it: each record without its private part. What is private whole is still here, to be left out by what judges it. */
export function sharedIndex(index: PersonIndex): PersonIndex {
  if (index.privacy?.kind !== 'known' || !index.privacy.parts?.size) return index;
  let twin = twins.get(index);
  const cut = (rs: MedRecord[]) => rs.map((r) => sharedRecord(index, r));
  if (!twin) twins.set(index, (twin = { ...index, records: cut(index.records), ...(index.inError ? { inError: { ...index.inError, records: cut(index.inError.records) } } : {}) }));
  return twin;
}

/** A piece of a paper's text, and whether shared screens leave it out. */
export interface TextPiece {
  text: string;
  off: boolean;
}

/** A paper's text in pieces, by its private lines; undefined where they are not places of it. */
function textPieces(text: string, gone: [number, number][]): TextPiece[] | undefined {
  const bytes = new TextEncoder().encode(text);
  // A place is the start of a character, or the end of the text.
  const starts = (i: number) => i <= bytes.length && (i === bytes.length || (bytes[i]! & 0xc0) !== 0x80);
  const order = [...gone].sort((a, b) => a[0] - b[0]);
  const decoder = new TextDecoder();
  const out: TextPiece[] = [];
  const put = (from: number, to: number, off: boolean) => from < to && out.push({ text: decoder.decode(bytes.subarray(from, to)), off });
  let at = 0;
  for (const [from, length] of order) {
    if (from < at || !starts(from) || !starts(from + length)) return undefined;
    put(at, from, false);
    put(from, from + length, true);
    at = from + length;
  }
  put(at, bytes.length, false);
  return out;
}

/** A paper's text without its private lines; none of it where they are not places of it. */
export function sharedText(text: string, gone: [number, number][]): string | undefined {
  return textPieces(text, gone)?.flatMap((p) => (p.off ? [] : [p.text])).join('');
}

/**
 * A paper's text on its person's own pages, with each line shared screens
 * leave out said; one piece where medrec said them of another text.
 */
export function ownText(index: PersonIndex, text: PersonText, id: string): TextPiece[] {
  const body = text.texts[id] ?? '';
  const gone = partOf(index, id)?.text ?? [];
  const fits = index.privacy?.kind === 'known' && text.md5 !== undefined && text.md5 === index.privacy.text;
  return (fits && gone.length && textPieces(body, gone)) || [{ text: body, off: false }];
}

/** Names once each, in their order: one of several claims is left out of shared screens where it is left out of each. */
export function offInEach(pairs: [string, boolean][]): { text: string; off: boolean }[] {
  const off = new Map<string, boolean>();
  for (const [text, gone] of pairs) off.set(text, (off.get(text) ?? true) && gone);
  return [...off].map(([text, gone]) => ({ text, off: gone }));
}

/**
 * On its person's own pages, whether shared screens leave out what is at this
 * place of a claim's `items`, `diagnoses` or `payer_notes`. A record already
 * cut for them has none.
 */
export function leftOff(index: PersonIndex, r: MedRecord, list: 'lines' | 'diagnoses' | 'payerNotes', at: number | undefined): boolean {
  return !r.without && at !== undefined && !!partOf(index, r.id)?.[list].includes(at);
}

const texts = new WeakMap<PersonIndex, { of: PersonText; twin: PersonText }>();

/**
 * A person's texts as a shared screen goes by them: null for a text.json other
 * than the one medrec said the private lines of.
 */
export function sharedTexts(index: PersonIndex, text: PersonText | null): PersonText | null {
  if (!text || index.privacy?.kind !== 'known' || !index.privacy.parts) return text;
  if (text.md5 === undefined || text.md5 !== index.privacy.text) return null;
  const hit = texts.get(index);
  if (hit?.of === text) return hit.twin;
  const left = Object.entries(text.texts).flatMap(([id, body]) => {
    const now = sharedText(body, partOf(index, id)?.text ?? []);
    return now === undefined ? [] : [[id, now] as const];
  });
  const twin = { ...text, texts: Object.fromEntries(left) };
  texts.set(index, { of: text, twin });
  return twin;
}
