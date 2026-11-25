// Items in a person's chart that are about somebody else (medrec 0.9.9 and
// later): a screening a parent answers about themselves in a child's chart,
// or a result its source says is another person's. They are in no list, total
// or sheet of anyone's, and have no page. views.json names them by id for a
// reader of index.json (`people.<id>.about_another`); a result's own `key`
// starts with `about|`. The person's own lists may say how many, and no more.

import { isObject } from './parse';
import { atLeast } from './private';
import type { PersonIndex } from './types';
import type { Md5 } from './views';
import { withoutItems } from './without';

/** What views.json says of a person's items about somebody else. */
export interface About {
  /** They stay so: what a later file leaves out is not asked. */
  ids: ReadonlySet<string>;
  /** Why there may be others: the list could not be read, or is not known to be of these files. */
  unsure?: 'unreadable' | 'behind';
}

/** What views.json says, with these as the MD5s of the files it is made of. A medrec before 0.9.9 says nothing of it. */
export function aboutAnother(views: Record<string, unknown> | null, person: string, now: { household?: Md5 | undefined; index?: Md5 | undefined }): About {
  if (views === null) return { ids: new Set() };
  const p = isObject(views.people) ? views.people[person] : undefined;
  const named = isObject(p) ? p.about_another : undefined;
  const listed: unknown[] = Array.isArray(named) ? named : [];
  const ids = new Set(listed.filter((x): x is string => typeof x === 'string'));
  if ((p !== undefined && !isObject(p)) || (named !== undefined && !Array.isArray(named)) || listed.some((x) => typeof x !== 'string')) return { ids, unsure: 'unreadable' };
  if (!atLeast(typeof views.medrec === 'string' ? views.medrec : undefined, [0, 9, 9])) return { ids };
  const same = p !== undefined && typeof now.index === 'string' && p.index === now.index && typeof now.household === 'string' && views.household === now.household;
  return same ? { ids } : { ids, unsure: 'behind' };
}

/** An index without what is about somebody else, and without the links to it. */
export function withoutAbout(index: PersonIndex, { ids, unsure }: About): PersonIndex {
  const gone = new Set([...index.records, ...index.documents].flatMap((x) => (ids.has(x.id) || ('key' in x && String(x.key).startsWith('about|')) ? [x.id] : [])));
  const left = gone.size ? { ...withoutItems(index, gone), about: gone.size } : index;
  return unsure ? { ...left, aboutUnsure: unsure } : left;
}

/** What a list of the person's own says of them. */
export const aboutText = (n: number): string => `${n} ${n === 1 ? 'item' : 'items'} about another person, not shown`;

/** Why a list of the person's own, or their sheet, may hold some. */
export function unsureText(index: PersonIndex): string | undefined {
  if (!index.aboutUnsure) return undefined;
  return index.aboutUnsure === 'unreadable' ? 'medrec’s list of what is about another person could not be read, so some of these may be.' : 'Which of the newest items are about another person is not known yet.';
}
