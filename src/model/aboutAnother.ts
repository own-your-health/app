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

/**
 * Why there may be others: views.json could not be read or is a newer
 * medrec's, its list is not known to be of these files, or it has none, as an
 * earlier medrec's.
 */
export type Unsure = 'unreadable' | 'newer_format' | 'behind' | 'unsaid';

/** What views.json says of a person's items about somebody else. */
export interface About {
  ids: ReadonlySet<string>;
  /** Absent where it is all of them. */
  unsure?: Unsure;
}

/** What views.json says, with these as the MD5s of the files it is made of. */
export function aboutAnother(views: Record<string, unknown> | null, person: string, now: { household?: Md5 | undefined; index?: Md5 | undefined }): About {
  if (views === null) return { ids: new Set(), unsure: 'unsaid' };
  const p = isObject(views.people) ? views.people[person] : undefined;
  const named = isObject(p) ? p.about_another : undefined;
  const listed: unknown[] = Array.isArray(named) ? named : [];
  const ids = new Set(listed.filter((x): x is string => typeof x === 'string'));
  if ((p !== undefined && !isObject(p)) || (named !== undefined && !Array.isArray(named)) || listed.some((x) => typeof x !== 'string')) return { ids, unsure: 'unreadable' };
  if (!atLeast(typeof views.medrec === 'string' ? views.medrec : undefined, [0, 9, 9])) return { ids, unsure: 'unsaid' };
  const same = p !== undefined && typeof now.index === 'string' && p.index === now.index && typeof now.household === 'string' && views.household === now.household;
  return same ? { ids } : { ids, unsure: 'behind' };
}

/** The same, after what an earlier read said: that stands until a list of these files reads. A folder with no list yet (`earlier` undefined) has nothing to say. */
export function stillAbout(said: About, earlier: ReadonlySet<string> | undefined): About {
  if (!said.unsure) return said;
  return { ids: new Set([...(earlier ?? []), ...said.ids]), ...(said.unsure === 'unsaid' && !earlier ? {} : { unsure: said.unsure }) };
}

/** An index without what is about somebody else, and without the links to it. */
export function withoutAbout(index: PersonIndex, { ids, unsure }: About): PersonIndex {
  const gone = new Set([...index.records, ...index.documents].flatMap((x) => (ids.has(x.id) || ('key' in x && String(x.key).startsWith('about|')) ? [x.id] : [])));
  const left = gone.size ? { ...withoutItems(index, gone), about: gone.size } : index;
  return unsure ? { ...left, aboutUnsure: unsure } : left;
}

/** What a list of the person's own says of them. */
export const aboutText = (n: number): string => `${n} ${n === 1 ? 'item' : 'items'} about another person, not shown`;

const UNSURE: Record<Unsure, string> = {
  unreadable: 'medrec’s list of what is about another person could not be read, so some of these may be.',
  newer_format: 'medrec’s list of what is about another person is written by a newer medrec. Update the app. Until then some of these may be.',
  behind: 'Which of the newest items are about another person is not known yet, so some of these may be. medrec writes its list again after its next import or refresh.',
  unsaid: 'An older medrec wrote the folder’s views last, without its list of what is about another person, so some of these may be. Update medrec on every computer that writes the folder.',
};

/** Why a list of the person's own, or their sheet, may hold some. */
export const unsureText = (index: PersonIndex): string | undefined => index.aboutUnsure && UNSURE[index.aboutUnsure];
