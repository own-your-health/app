// Which of a person's items are private: medrec's views/<person id>/
// private.json (`medrec-private/v1`, medrec 0.9.1 and later), made from
// codes, medicines, tests, practices and the household's own marks. It is
// discretion, not access control: private items stay off the screens the
// household shares (Home, everyone's calendar, Money, Papers, Health and
// search, and a doctor's sheet) and show on their person's own.
//
// Without a list that reads and matches the folder nobody can say which
// items are private, so all of that person's are held back from shared
// screens. Everything here answers for a person's loaded index; nothing
// else in the app decides what is private.

import { FolderError, isObject } from './parse';
import { parseParts, type Part } from './parts';
import type { ImagingStudy, PersonIndex } from './types';

/** Why a person's items are held back from shared screens: no current list says which are private. */
export type HeldWhy = 'none' | 'behind' | 'arriving' | 'unchecked' | 'newer_format' | 'unreadable' | 'marks' | 'labels' | 'older_medrec';

/** What medrec says of one person: each private item's area by id, or why that is not known. */
export type Privacy =
  | {
      kind: 'known';
      records: Map<string, string>;
      documents: Map<string, string>;
      events: Map<string, string>;
      /** medrec 0.9.5 and later, which also puts a paper a private record links in `documents`; null in an earlier list. */
      studies: Map<string, string> | null;
      /** Studies no report judges (0.9.5 and later). */
      unreported: Set<string>;
      /** medrec 0.9.6 and later, which also judges the papers tied to a private one: its copies, the statements before and after it, and its receipt. */
      ties: boolean;
      /** What is private in an open item, by id, and the MD5 of the text.json its places in papers are of; undefined in a list of before 0.9.9. */
      parts?: Map<string, Part>;
      text?: string;
      /** The events another person's place may be shown from (0.9.9 and later): open, and with no private member; undefined in an earlier list. */
      clear?: Set<string>;
    }
  | { kind: 'held'; why: HeldWhy; text: string };

/** In place of an area, for an item no current list can clear. */
export const HELD = '(held back)';

export const PRIVATE_AREAS: Record<string, string> = {
  mental_health: 'Mental health',
  reproductive: 'Reproductive care',
  sexual_health: 'Sexual health',
  substance_use: 'Substance use',
  household: 'Marked private',
};

/** An area's words; one the app does not know is private all the same. */
export const areaText = (area: string): string => PRIVATE_AREAS[area] ?? PRIVATE_AREAS.household!;

/** A private item's area, for what marks it as one: undefined for an item that is not private, or that is only held back. */
export const knownArea = (area: string | undefined): string | undefined => (area === HELD ? undefined : area);

export const held = (why: HeldWhy, text: string): Privacy => ({ kind: 'held', why, text });

const NO_LIST = 'medrec has not written which items are private. medrec 0.9.1 and later does, with its views.';

/** No list: the folder's medrec is older than 0.9.1, or its views are not there yet. */
export const noList = (): Privacy => held('none', NO_LIST);

/** A map of item id to area. An entry is private whatever its area says. */
function areas(v: unknown): Map<string, string> {
  if (!isObject(v)) throw new FolderError('malformed', 'a list of private items is missing.');
  return new Map(Object.entries(v).map(([id, x]) => [id, isObject(x) && typeof x.area === 'string' && x.area && x.area !== HELD ? x.area : 'household']));
}

/** A person's private.json, as the medrec that wrote it (views.json's `medrec`) judged. Refused when it is not one, is a newer format, or is another person's. */
export function parsePrivate(raw: unknown, person: string, medrec?: string): Privacy {
  if (!isObject(raw) || typeof raw.schema !== 'string' || !raw.schema.startsWith('medrec-private/')) throw new FolderError('malformed', 'it is not medrec’s list of private items.');
  if (raw.schema !== 'medrec-private/v1') throw new FolderError('newer_format', 'it is written by a newer medrec. Update the app.');
  if (raw.person !== person) throw new FolderError('malformed', 'it is another person’s.');
  // provider-state.json is lost (0.9.7 and later): a provider's specialty can make an item private. `marks_unreadable` is true with it.
  if (raw.labels_unreadable !== undefined && raw.labels_unreadable !== false) return held('labels', 'What a provider directory gave medrec (provider-state.json) is gone or does not read, so it is not known which items a provider makes private. On the computer medrec runs on, run medrec tables fetch nppes, then medrec views write. If a newer medrec wrote the file, update medrec there.');
  // The household's marks did not read: any item may be one it marked private.
  if (raw.marks_unreadable !== undefined && raw.marks_unreadable !== false) return held('marks', 'The household’s own private marks could not be read.');
  const unreported = raw.unreported_studies ?? [];
  if (!Array.isArray(unreported) || !unreported.every((x) => typeof x === 'string')) throw new FolderError('malformed', 'its list of imaging studies with no report does not read.');
  const parts = parseParts(raw.parts);
  const clear = atLeast(medrec, [0, 9, 9]) ? { clear: new Set(Array.isArray(raw.clear_events) ? raw.clear_events.filter((x): x is string => typeof x === 'string') : []) } : {};
  return { kind: 'known', records: areas(raw.records), documents: areas(raw.documents), events: areas(raw.events), studies: raw.studies === undefined ? null : areas(raw.studies), unreported: new Set(unreported), ties: atLeast(medrec, [0, 9, 6]), ...(parts ? { parts } : {}), ...clear };
}

/** Whether a medrec version ("0.9.6") is this one or later; one that does not read is not. */
export function atLeast(version: string | undefined, than: [number, number, number]): boolean {
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')?.slice(1).map(Number);
  if (!v) return false;
  const i = v.findIndex((n, j) => n !== than[j]);
  return i < 0 || v[i]! > than[i]!;
}

const known = (index: PersonIndex) => (index.privacy?.kind === 'known' ? index.privacy : undefined);

/** Whether all of a person's items are held back from shared screens. Someone with none yet has nothing to hold back. */
export const isHeld = (index: PersonIndex): boolean => !known(index) && index.records.length + index.documents.length + index.studies.length + (index.events?.events.length ?? 0) > 0;

/** Why all of a person's items are held back, in a sentence or two; undefined when they are not. */
export const whyHeld = (index: PersonIndex): string | undefined => (!isHeld(index) ? undefined : index.privacy?.kind === 'held' ? index.privacy.text : NO_LIST);

/** Whether any of a person's records, papers or events stay off shared screens: the private ones, or all of them. */
export function leavesOff(index: PersonIndex): boolean {
  const p = known(index);
  return p ? p.records.size + p.documents.size + p.events.size > 0 : isHeld(index);
}

/** The same, imaging too, which only a search names. */
export const anyPrivate = (index: PersonIndex): boolean => leavesOff(index) || index.studies.some((s) => studyPrivate(index, s));

/** Why a record is private: its area, or HELD; undefined when it is not. */
export function recordPrivate(index: PersonIndex, id: string): string | undefined {
  const p = known(index);
  return p ? p.records.get(id) : HELD;
}

/** Why any of these records is private. */
export function recordsPrivate(index: PersonIndex, ids: Iterable<string>): string | undefined {
  const p = known(index);
  if (!p) return HELD;
  for (const id of ids) {
    const area = p.records.get(id);
    if (area) return area;
  }
  return undefined;
}

export function documentPrivate(index: PersonIndex, id: string): string | undefined {
  const p = known(index);
  return p ? p.documents.get(id) : HELD;
}

/** The visits medrec's events put one of the person's own papers in, which judged it with them. */
const visitsWith = (index: PersonIndex, id: string) => (index.events?.events ?? []).filter((e) => e.members.some((m) => m.document === id && !m.person));
export const inVisit = (index: PersonIndex, id: string): boolean => visitsWith(index, id).length > 0;

/** The area of a private record that links a paper. */
const linkPrivate = (index: PersonIndex, id: string) => recordsPrivate(index, index.records.filter((r) => r.documents.includes(id)).map((r) => r.id));

/**
 * Whether the household took a paper out itself: its list leaves the paper
 * off though a rule makes it private, as part of a private visit or, from
 * 0.9.5, as linked by a private record. Their own mark decides, whatever else
 * would make it private.
 */
export function takenOut(index: PersonIndex, id: string): boolean {
  const p = known(index);
  if (!p || p.documents.has(id)) return false;
  return visitsWith(index, id).some((e) => p.events.has(e.id)) || (p.studies !== null && linkPrivate(index, id) !== undefined);
}

/** Why a paper is private by itself, its copies aside. */
function ownPrivate(index: PersonIndex, id: string): string | undefined {
  const own = documentPrivate(index, id);
  if (own || takenOut(index, id)) return own;
  return linkPrivate(index, id);
}

/**
 * Why a paper is private: medrec's answer for it, else that of a record that
 * links it, else that of a copy of the same statement. medrec 0.9.5 and later
 * judges those links itself, and 0.9.6 the copies; a list from an earlier one
 * does not, so they are judged here the same way.
 */
export function paperPrivate(index: PersonIndex, id: string): string | undefined {
  const own = ownPrivate(index, id);
  const p = known(index);
  if (own || !p || p.ties || takenOut(index, id)) return own;
  const first = index.documents.find((d) => d.id === id)?.same_statement_as ?? id;
  for (const d of index.documents) {
    if (d.id === id || (d.id !== first && d.same_statement_as !== first)) continue;
    const area = ownPrivate(index, d.id);
    if (area) return area;
  }
  return undefined;
}

/**
 * An imaging study is as private as its report, and held back without one:
 * medrec 0.9.5 and later lists both, and for an earlier list its report says.
 */
export function studyPrivate(index: PersonIndex, study: ImagingStudy): string | undefined {
  const p = known(index);
  if (!p) return HELD;
  const area = p.studies?.get(study.id);
  if (area) return area;
  if (p.unreported.has(study.id)) return HELD;
  // medrec looked for another report of one whose report is in error, and lists it when that is private.
  if (!study.report) return study.reportInError && p.studies ? undefined : HELD;
  if (index.records.some((r) => r.id === study.report)) return p.records.get(study.report);
  return index.documents.some((d) => d.id === study.report) ? paperPrivate(index, study.report) : HELD;
}

/** Why one item of a kind is private, as a search finds it. */
export function itemPrivate(index: PersonIndex, kind: string, id: string): string | undefined {
  if (kind === 'document') return paperPrivate(index, id);
  if (kind !== 'study') return recordPrivate(index, id);
  const study = index.studies.find((s) => s.id === id);
  return study ? studyPrivate(index, study) : HELD;
}
