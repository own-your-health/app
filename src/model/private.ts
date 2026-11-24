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
import type { ImagingStudy, PersonIndex } from './types';

/** Why a person's items are held back from shared screens: no current list says which are private. */
export type HeldWhy = 'none' | 'behind' | 'arriving' | 'unchecked' | 'newer_format' | 'unreadable' | 'marks';

/** What medrec says of one person: each private item's area by id, or why that is not known. */
export type Privacy =
  | { kind: 'known'; records: Map<string, string>; documents: Map<string, string>; events: Map<string, string> }
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

/** A person's private.json. Refused when it is not one, is a newer format, or is another person's. */
export function parsePrivate(raw: unknown, person: string): Privacy {
  if (!isObject(raw) || typeof raw.schema !== 'string' || !raw.schema.startsWith('medrec-private/')) throw new FolderError('malformed', 'it is not medrec’s list of private items.');
  if (raw.schema !== 'medrec-private/v1') throw new FolderError('newer_format', 'it is written by a newer medrec. Update the app.');
  if (raw.person !== person) throw new FolderError('malformed', 'it is another person’s.');
  // The household's marks did not read: any item may be one it marked private.
  if (raw.marks_unreadable !== undefined && raw.marks_unreadable !== false) return held('marks', 'The household’s own private marks could not be read.');
  return { kind: 'known', records: areas(raw.records), documents: areas(raw.documents), events: areas(raw.events) };
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

/** Whether medrec's events put one of the person's own papers in a visit, and so judged it with that visit. */
export const inVisit = (index: PersonIndex, id: string): boolean => !!index.events?.events.some((e) => e.members.some((m) => m.document === id && !m.person));

/**
 * Why a paper is private, where it is named by itself. medrec judges a paper
 * by its practice and its visit. One that only a record links (an explanation
 * of benefits names its claim) is in no visit of medrec's, so it is also as
 * private as that record.
 */
export function paperPrivate(index: PersonIndex, id: string): string | undefined {
  const own = documentPrivate(index, id);
  if (own || inVisit(index, id)) return own;
  return recordsPrivate(index, index.records.filter((r) => r.documents.includes(id)).map((r) => r.id));
}

/** medrec's list has no imaging studies: one is as private as its report, and held back without one. */
export function studyPrivate(index: PersonIndex, study: ImagingStudy): string | undefined {
  const p = known(index);
  if (!p || !study.report) return HELD;
  if (!index.records.some((r) => r.id === study.report) && !index.documents.some((d) => d.id === study.report)) return HELD;
  return p.records.get(study.report) ?? p.documents.get(study.report);
}

/** Why one item of a kind is private, as a search finds it. */
export function itemPrivate(index: PersonIndex, kind: string, id: string): string | undefined {
  if (kind === 'document') return paperPrivate(index, id);
  if (kind !== 'study') return recordPrivate(index, id);
  const study = index.studies.find((s) => s.id === id);
  return study ? studyPrivate(index, study) : HELD;
}
