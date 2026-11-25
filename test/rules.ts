import { parseHousehold, parseIndex } from '../src/model/parse';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { fixture } from './helpers';

/** The household whose records give each reading rule a case, as medrec wrote it (scripts/rule-fixtures.mjs). */
export const RULES = parseHousehold(fixture('rules/household.json'));

/** One of its people's ids. */
export const ruled = (first: string): string => RULES.people.find((p) => p.name === `${first} Example`)!.id;
/** One of its people's records. */
export const recordsOf = (first: string): PersonIndex => parseIndex(fixture(`rules/${first.toLowerCase()}.json`), ruled(first));

/** A claim as a medrec before 0.8.2 filed it: no line marked, and no payer's notes. With `words`, as one before 0.5.0 did: its amounts in the payer's words alone, and no links. */
export function asFiledBefore(r: MedRecord, { words = false } = {}): MedRecord {
  const drop = (o: object) => Object.fromEntries(Object.entries(o).filter(([k]) => !(['counted', 'payer_notes'].includes(k) || (words && ['amounts', 'category', 'visit', 'results', 'records'].includes(k)))));
  const items = r.fields.items as object[];
  return { ...r, fields: { ...drop(r.fields), items: items.map(drop) } as MedRecord['fields'] };
}
