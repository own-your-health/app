// Items in a person's chart that are about somebody else (medrec 0.9.9 and
// later): a screening a parent answers about themselves in a child's chart,
// or a result its source says is another person's. They are in no list, total
// or sheet of anyone's, and have no page. views.json names them by id for a
// reader of index.json (`people.<id>.about_another`); a result's own `key`
// starts with `about|`. The person's own lists may say how many, and no more.

import { isObject } from './parse';
import type { Json, PersonIndex } from './types';

/** The items views.json says are about somebody else. They stay so: what a later file leaves out is not asked. */
export function aboutAnother(views: Record<string, unknown> | null, person: string): ReadonlySet<string> {
  const p = isObject(views?.people) ? views.people[person] : undefined;
  const ids = isObject(p) ? p.about_another : undefined;
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
}

/** An index without what is about somebody else, and without the links to it. */
export function withoutAbout(index: PersonIndex, named: ReadonlySet<string>): PersonIndex {
  const gone = new Set([...index.records, ...index.documents].flatMap((x) => (named.has(x.id) || ('key' in x && String(x.key).startsWith('about|')) ? [x.id] : [])));
  if (!gone.size) return index;
  const kept = (ids: Json | undefined): Json | undefined => (Array.isArray(ids) ? ids.filter((id) => typeof id !== 'string' || !gone.has(id)) : ids);
  return {
    ...index,
    records: index.records
      .filter((r) => !gone.has(r.id))
      .map((r) => {
        const { results, items } = r.fields;
        return {
          ...r,
          documents: r.documents.filter((d) => !gone.has(d)),
          fields: {
            ...r.fields,
            ...(results === undefined ? {} : { results: kept(results)! }),
            ...(Array.isArray(items) ? { items: items.map((l) => (isObject(l) && l.records !== undefined ? { ...l, records: kept(l.records as Json)! } : l)) as Json } : {}),
          },
        };
      }),
    documents: index.documents.filter((d) => !gone.has(d.id)),
    about: gone.size,
  };
}

/** What a list of the person's own says of them. */
export const aboutText = (n: number): string => `${n} ${n === 1 ? 'item' : 'items'} about another person, not shown`;
