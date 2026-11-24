// What medrec's views.json (`medrec-views/v2`) says of a person's view files
// (views/<person id>/): each one's stored name and MD5, and the MD5s of the
// files medrec read to write it. A reader compares those with the folder's
// to tell a fresh view from a stale one (the data contract's "A reader
// decides freshness by MD5").

import { isObject } from './parse';

export type Md5 = string | null;

/** A view the app reads. */
export type ViewFile = 'events.json' | 'private.json';

export interface PersonView {
  /** `events.<first 12 hex of its MD5>.json`, under views/<person id>/. */
  name: string;
  md5: string;
  household: Md5;
  index: Md5;
  text: Md5;
  overrides: Md5;
  /** marks.json's MD5, for private.json, which is made from it as well. */
  marks?: Md5;
  linked: Map<string, { index: Md5; text: Md5 }>;
}

const MD5 = /^[0-9a-f]{32}$/;
const md5Of = (v: unknown): Md5 | undefined => (v === null ? null : typeof v === 'string' && MD5.test(v) ? v : undefined);

/** Undefined when the views are not medrec's v2 layout, hold no such file for this person, or leave out what freshness needs. */
export function viewOf(views: unknown, person: string, file: ViewFile): PersonView | undefined {
  if (!isObject(views) || views.schema !== 'medrec-views/v2' || !isObject(views.people)) return undefined;
  const p = views.people[person];
  if (!isObject(p) || !isObject(p.files)) return undefined;
  const md5 = md5Of(p.files[file]);
  const [household, index, txt, overrides] = [md5Of(views.household), md5Of(p.index), md5Of(p.text), md5Of(p.overrides)];
  if (!md5 || household === undefined || index === undefined || txt === undefined || overrides === undefined || !isObject(p.linked)) return undefined;
  const marks = md5Of(p.marks);
  if (file === 'private.json' && marks === undefined) return undefined;
  const linked = new Map<string, { index: Md5; text: Md5 }>();
  for (const [id, l] of Object.entries(p.linked)) {
    const [li, lt] = isObject(l) ? [md5Of(l.index), md5Of(l.text)] : [undefined, undefined];
    if (li === undefined || lt === undefined) return undefined;
    linked.set(id, { index: li, text: lt });
  }
  const name = `${file.slice(0, -'.json'.length)}.${md5.slice(0, 12)}.json`;
  return { name, md5, household, index, text: txt, overrides, ...(file === 'private.json' ? { marks: marks! } : {}), linked };
}
