// What medrec's views.json (`medrec-views/v2`) says of a person's view files
// (views/<person id>/): each one's stored name and MD5, and the MD5s of the
// files medrec read to write it. A reader compares those with the folder's
// to tell a fresh view from a stale one (the data contract's "A reader
// decides freshness by MD5").

import { FolderError, isObject } from './parse';

export type Md5 = string | null;

/** A view the app reads. */
export type ViewFile = 'events.json' | 'bills.json' | 'private.json' | 'code-names.json' | 'providers.json' | 'standing.json';

export interface PersonView {
  /** `events.<first 12 hex of its MD5>.json`, under views/<person id>/. */
  name: string;
  md5: string;
  household: Md5;
  index: Md5;
  text: Md5;
  /** overrides.json's MD5, for the views made from it as well: every one but standing.json. */
  overrides?: Md5;
  /** marks.json's MD5, for the views made from it as well: every one but events.json and standing.json. */
  marks?: Md5;
  /** provider-state.json's MD5, for the views made from it as well: private.json, code-names.json and providers.json. */
  providerState?: Md5;
  /** The linked people whose files it was made from as well; standing.json is made from the person's own. */
  linked: Map<string, { index: Md5; text: Md5 }>;
}

const MD5 = /^[0-9a-f]{32}$/;
const md5Of = (v: unknown): Md5 | undefined => (v === null ? null : typeof v === 'string' && MD5.test(v) ? v : undefined);

/**
 * views.json, once it is in the layout this app reads (v2, every medrec's so
 * far). Null for v1, which medrec never wrote: there are no views to read. A
 * later layout is refused as newer, anything else as malformed.
 */
export function parseViews(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw) || typeof raw.schema !== 'string' || !raw.schema.startsWith('medrec-views/')) throw new FolderError('malformed', 'views/views.json is not medrec’s list of views.');
  if (raw.schema === 'medrec-views/v1') return null;
  if (raw.schema !== 'medrec-views/v2') throw new FolderError('newer_format', 'They are written by a newer medrec. Update the app.');
  if (!isObject(raw.people)) throw new FolderError('malformed', 'views/views.json names no people.');
  return raw;
}

/**
 * A person's view file as views.json names it, or undefined when it names
 * none for them: medrec has not written it. An entry that leaves out what
 * freshness needs is refused as malformed.
 */
export function viewOf(views: Record<string, unknown> | null, person: string, file: ViewFile): PersonView | undefined {
  const p = isObject(views?.people) ? views.people[person] : undefined;
  if (p === undefined) return undefined;
  const bad = () => new FolderError('malformed', 'views/views.json does not say which files it was made from.');
  if (!isObject(p) || !isObject(p.files)) throw bad();
  if (p.files[file] === undefined) return undefined;
  const md5 = md5Of(p.files[file]);
  const [household, index, txt, overrides] = [md5Of(views!.household), md5Of(p.index), md5Of(p.text), md5Of(p.overrides)];
  if (!md5 || household === undefined || index === undefined || txt === undefined || overrides === undefined || !isObject(p.linked)) throw bad();
  const name = `${file.slice(0, -'.json'.length)}.${md5.slice(0, 12)}.json`;
  if (file === 'standing.json') return { name, md5, household, index, text: txt, linked: new Map() };
  const marks = md5Of(p.marks);
  const fromMarks = file !== 'events.json';
  if (fromMarks && marks === undefined) throw bad();
  const fromLabels = file === 'private.json' || file === 'code-names.json' || file === 'providers.json';
  // Absent when there is none, as in every views.json before medrec 0.9.7.
  const providerState = md5Of(p.provider_state ?? null);
  if (fromLabels && providerState === undefined) throw bad();
  const linked = new Map<string, { index: Md5; text: Md5 }>();
  for (const [id, l] of Object.entries(p.linked)) {
    const [li, lt] = isObject(l) ? [md5Of(l.index), md5Of(l.text)] : [undefined, undefined];
    if (li === undefined || lt === undefined) throw bad();
    linked.set(id, { index: li, text: lt });
  }
  return { name, md5, household, index, text: txt, overrides, ...(fromMarks ? { marks: marks! } : {}), ...(fromLabels ? { providerState: providerState! } : {}), linked };
}
