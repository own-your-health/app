import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO, type Overlay } from '../test/helpers';

type Json = Record<string, unknown>;
interface Views {
  people: Record<string, { index: string; linked: Record<string, { index: string }>; files: Record<string, string> }>;
}
interface Member {
  record?: string;
  document?: string;
}
interface Item extends Json {
  id: string;
  documents?: string[];
  members?: Member[];
}

/** One person's files that name their private items. */
export interface PersonFiles {
  name: string;
  index: { records: (Item & { kind?: string; date?: string; fields: Json })[]; documents: Item[] };
  events: { events: Item[]; pending: (Member & { could_join: string[] })[] };
  bills: { bills: Record<string, Json>; worth_a_call: { bill: string }[]; not_billed: { event: string }[] };
  list: { records: Json; documents: Json; events: Json };
}

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

/** The folder with each person's files changed, named and checked as medrec would. `base` is laid over the sample first. */
export function rewritten(base: Overlay, change: (files: PersonFiles) => void): Overlay {
  const out: Overlay = { ...base };
  const read = <T>(path: string) => JSON.parse(out[path] ?? readFileSync(join(DEMO, path), 'utf8')) as T;
  const views = read<Views>('views/views.json');
  const { people } = read<{ people: { id: string; name: string; folder: string }[] }>('household.json');
  for (const p of people) {
    const v = views.people[p.id]!;
    const viewPath = (file: string) => `views/${p.id}/${file}.${v.files[`${file}.json`]!.slice(0, 12)}.json`;
    const files: PersonFiles = { name: p.name, index: read(`${p.folder}/index.json`), events: read(viewPath('events')), bills: read(viewPath('bills')), list: read(viewPath('private')) };
    change(files);
    for (const [file, x] of [['events', files.events], ['bills', files.bills], ['private', files.list]] as const) {
      const text = JSON.stringify(x);
      v.files[`${file}.json`] = md5(text);
      out[viewPath(file)] = text;
    }
    const text = JSON.stringify(files.index);
    out[`${p.folder}/index.json`] = text;
    v.index = md5(text);
    for (const other of Object.values(views.people)) if (other.linked[p.id]) other.linked[p.id]!.index = md5(text);
  }
  out['views/views.json'] = JSON.stringify(views);
  return out;
}

const NAMES = new Set(['display', 'title', 'what', 'place', 'provider', 'organization', 'location', 'practitioner', 'prescriber', 'pharmacy', 'reason', 'clinicians', 'account']);

/** A day's neighbour in the same month. */
const nextTo = (day: string) => {
  const n = Number(day.slice(8));
  return `${day.slice(0, 8)}${String(n > 1 ? n - 1 : 2).padStart(2, '0')}`;
};

/** An item under other names, and on other days of its month. Its ids and amounts stay, and what is its plan's: the insurer, the plan year. */
function disguised<T extends object>(item: T): T {
  const month = Object.entries(item).find(([k]) => k === 'date' || k === 'start')?.[1] as string | undefined;
  const change = (x: unknown, key = ''): unknown => {
    if (Array.isArray(x)) return x.map((v) => change(v, key));
    if (typeof x === 'object' && x) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, change(v, k)]));
    if (typeof x !== 'string') return x;
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return month && x.startsWith(month.slice(0, 7)) ? nextTo(x) : x;
    return NAMES.has(key) ? 'Something else entirely' : x;
  };
  return change(item) as T;
}

/** The folder with everyone's private items under other names and days. */
export const renamed = (base: Overlay): Overlay =>
  rewritten(base, ({ index, events, bills, list }) => {
    const change = <T extends Item>(xs: T[], is: Json): T[] => xs.map((x) => (x.id in is ? disguised(x) : x));
    index.records = change(index.records, list.records);
    index.documents = change(index.documents, list.documents);
    events.events = change(events.events, list.events).map((e) => ({ ...e, members: e.members?.map((m) => ((m.record ?? '') in list.records || (m.document ?? '') in list.documents ? disguised(m) : m)) }));
    for (const id of Object.keys(bills.bills)) if (id in list.documents) bills.bills[id] = disguised(bills.bills[id]!);
    bills.not_billed = bills.not_billed.map((x) => (x.event in list.events ? disguised(x) : x));
  });

/** The folder with none of them in it. A visit the household marked not private stays as it is when only private records make it one. */
export const removed = (base: Overlay): Overlay =>
  rewritten(base, ({ index, events, bills, list }) => {
    const kept: Json = {};
    const gone = (m: Member) => ((m.record ?? '') in list.records && !((m.record ?? '') in kept)) || (m.document ?? '') in list.documents;
    for (const e of events.events) if (!(e.id in list.events) && e.members?.every(gone)) for (const m of e.members) if (m.record) kept[m.record] = list.records[m.record];
    index.records = index.records.filter((x) => !gone({ record: x.id })).map((r) => ({ ...r, documents: r.documents?.filter((d) => !(d in list.documents)) }));
    index.documents = index.documents.filter((x) => !(x.id in list.documents));
    events.events = events.events.filter((x) => !(x.id in list.events)).map((e) => ({ ...e, members: e.members?.filter((m) => !gone(m)) }));
    events.pending = events.pending.filter((x) => !gone(x)).map((x) => ({ ...x, could_join: x.could_join.filter((e) => !(e in list.events)) }));
    for (const id of Object.keys(bills.bills)) if (id in list.documents) delete bills.bills[id];
    bills.worth_a_call = bills.worth_a_call.filter((x) => !(x.bill in list.documents));
    bills.not_billed = bills.not_billed.filter((x) => !(x.event in list.events));
    Object.assign(list, { records: kept, documents: {}, events: {} });
  });
