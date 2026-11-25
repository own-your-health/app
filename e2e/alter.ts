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

const md5 = (text: string) => createHash('md5').update(text).digest('hex');
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

/**
 * The folder with everyone's private items under other names and days
 * (`renamed`), or with none of them in it (`removed`), and its lists as
 * medrec would write them then. `base` is laid over the sample first.
 */
export function altered(base: Overlay, how: 'renamed' | 'removed'): Overlay {
  const out: Overlay = { ...base };
  const read = <T>(path: string) => JSON.parse(out[path] ?? readFileSync(join(DEMO, path), 'utf8')) as T;
  const views = read<Views>('views/views.json');
  const { people } = read<{ people: { id: string; folder: string }[] }>('household.json');
  for (const p of people) {
    const v = views.people[p.id]!;
    const viewPath = (file: string) => `views/${p.id}/${file}.${v.files[`${file}.json`]!.slice(0, 12)}.json`;
    const list = read<{ records: Json; documents: Json; events: Json }>(viewPath('private'));
    const index = read<{ records: Item[]; documents: Item[] }>(`${p.folder}/index.json`);
    const events = read<{ events: Item[]; pending: (Member & { could_join: string[] })[] }>(viewPath('events'));
    const bills = read<{ bills: Record<string, Json>; worth_a_call: { bill: string }[]; not_billed: { event: string }[] }>(viewPath('bills'));
    const kept: Json = {};
    const quiet = (m: Member) => !(m.record !== undefined && m.record in kept) && ((m.record !== undefined && m.record in list.records) || (m.document !== undefined && m.document in list.documents));
    // A visit the household marked not private stays as it is when only private records make it one.
    if (how === 'removed') {
      for (const e of events.events) {
        const ms = e.members ?? [];
        if (!(e.id in list.events) && ms.every(quiet)) for (const m of ms) if (m.record) kept[m.record] = list.records[m.record];
      }
    }
    const change = (xs: Item[], is: Json): Item[] => (how === 'renamed' ? xs.map((x) => (x.id in is ? disguised(x) : x)) : xs.filter((x) => x.id in kept || !(x.id in is)));
    index.records = change(index.records, list.records);
    index.documents = change(index.documents, list.documents);
    events.events = change(events.events, list.events);
    if (how === 'renamed') {
      for (const e of events.events) e.members = e.members?.map((m) => (quiet(m) ? disguised(m) : m));
      for (const id of Object.keys(bills.bills)) if (id in list.documents) bills.bills[id] = disguised(bills.bills[id]!);
      bills.not_billed = bills.not_billed.map((x) => (x.event in list.events ? disguised(x) : x));
    } else {
      for (const r of index.records) r.documents = r.documents?.filter((d) => !(d in list.documents));
      for (const e of events.events) e.members = e.members?.filter((m) => !quiet(m));
      events.pending = events.pending.filter((x) => !quiet(x)).map((x) => ({ ...x, could_join: x.could_join.filter((e) => !(e in list.events)) }));
      for (const id of Object.keys(bills.bills)) if (id in list.documents) delete bills.bills[id];
      bills.worth_a_call = bills.worth_a_call.filter((x) => !(x.bill in list.documents));
      bills.not_billed = bills.not_billed.filter((x) => !(x.event in list.events));
      Object.assign(list, { records: kept, documents: {}, events: {} });
    }
    const write = (file: string, x: object) => {
      const text = JSON.stringify(x);
      v.files[`${file}.json`] = md5(text);
      out[viewPath(file)] = text;
    };
    write('events', events);
    write('bills', bills);
    write('private', list);
    const text = JSON.stringify(index);
    out[`${p.folder}/index.json`] = text;
    v.index = md5(text);
    for (const other of Object.values(views.people)) if (other.linked[p.id]) other.linked[p.id]!.index = md5(text);
  }
  out['views/views.json'] = JSON.stringify(views);
  return out;
}
