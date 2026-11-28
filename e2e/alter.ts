import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO, type Overlay } from '../test/helpers';

type Json = Record<string, unknown>;
interface Views {
  medrec: string;
  people: Record<string, { index: string; text: string | null; in_error?: Json; linked: Record<string, { index: string; text: string | null }>; files: Record<string, string> }>;
}
interface Member {
  record?: string;
  document?: string;
  person?: string;
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
  events: { events: Item[]; pending: (Member & { could_join: string[] })[]; aliases?: { organization: string; document: string }[] };
  bills: { bills: Record<string, Json>; worth_a_call: { bill: string }[]; not_billed: { event: string }[] };
  list: { records: Json; documents: Json; events: Json; parts?: Json };
  text: { texts: Record<string, string> };
  /** Its entry in views.json. */
  view: { in_error?: Json };
}

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

/** The kinds of record medrec's standing.json says are current or not. */
const LISTED = new Set(['allergy', 'condition', 'medication']);

/** Of medrec's standing.json, what a rewrite keeps in step with the index. */
interface Standing {
  order: Record<string, string[]>;
  records: Record<string, unknown>;
}

/** The folder with each person's files changed, named and checked as medrec would, by this version of it. `base` is laid over the sample first. */
export function rewritten(base: Overlay, change: (files: PersonFiles) => void, medrec?: string): Overlay {
  const out: Overlay = { ...base };
  const read = <T>(path: string) => JSON.parse(out[path] ?? readFileSync(join(DEMO, path), 'utf8')) as T;
  const views = read<Views>('views/views.json');
  if (medrec) views.medrec = medrec;
  const { people } = read<{ people: { id: string; name: string; folder: string }[] }>('household.json');
  for (const p of people) {
    const v = views.people[p.id]!;
    const viewPath = (file: string) => `views/${p.id}/${file}.${v.files[`${file}.json`]!.slice(0, 12)}.json`;
    const files: PersonFiles = { name: p.name, index: read(`${p.folder}/index.json`), events: read(viewPath('events')), bills: read(viewPath('bills')), list: read(viewPath('private')), text: read(`${p.folder}/text.json`), view: v };
    const before = new Set(files.index.records.map((r) => r.id));
    change(files);
    // What is current, as medrec writes it again of the index: without the records no longer in it.
    // A condition, allergy or medicine added here is in none of its lists, so the app makes its own.
    const standing = v.files['standing.json'] ? read<Standing>(viewPath('standing')) : undefined;
    if (standing && files.index.records.some((r) => LISTED.has(r.kind ?? '') && !before.has(r.id))) delete v.files['standing.json'];
    else if (standing) {
      const kept = new Set(files.index.records.map((r) => r.id));
      const text = JSON.stringify({
        ...standing,
        order: Object.fromEntries(Object.entries(standing.order).map(([kind, ids]) => [kind, ids.filter((id) => kept.has(id))])),
        records: Object.fromEntries(Object.entries(standing.records).filter(([id]) => kept.has(id))),
      });
      v.files['standing.json'] = md5(text);
      out[viewPath('standing')] = text;
    }
    for (const [file, x] of [['events', files.events], ['bills', files.bills], ['private', files.list]] as const) {
      const text = JSON.stringify(x);
      v.files[`${file}.json`] = md5(text);
      out[viewPath(file)] = text;
    }
    const put = (file: string, x: object): string => {
      const text = JSON.stringify(x);
      out[`${p.folder}/${file}`] = text;
      return md5(text);
    };
    v.index = put('index.json', files.index);
    v.text = put('text.json', files.text);
    for (const other of Object.values(views.people)) if (other.linked[p.id]) other.linked[p.id] = { index: v.index, text: v.text };
  }
  out['views/views.json'] = JSON.stringify(views);
  return out;
}

const OTHER = 'Something else entirely';
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
    if (typeof x === 'object' && x) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'benefit_period' ? v : change(v, k)]));
    if (typeof x !== 'string') return x;
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return month && x.startsWith(month.slice(0, 7)) ? nextTo(x) : x;
    return NAMES.has(key) ? OTHER : x;
  };
  return change(item) as T;
}

/** Whether a private paper says where an event is. */
const toldInPrivate = ({ events, list }: PersonFiles, e: Item): boolean => e.place_from === 'alias' && (events.aliases ?? []).some((a) => a.organization === e.place && a.document in list.documents);

/** The folder with everyone's private items, and the places private papers say, under other names and days. */
export const renamed = (base: Overlay): Overlay =>
  rewritten(base, (files) => {
    const { index, events, bills, list } = files;
    for (const e of events.events.filter((x) => toldInPrivate(files, x))) e.place = OTHER;
    for (const a of events.aliases ?? []) if (a.document in list.documents) a.organization = OTHER;
    const change = <T extends Item>(xs: T[], is: Json): T[] => xs.map((x) => (x.id in is ? disguised(x) : x));
    index.records = change(index.records, list.records);
    index.documents = change(index.documents, list.documents);
    events.events = change(events.events, list.events).map((e) => ({ ...e, members: e.members?.map((m) => ((m.record ?? '') in list.records || (m.document ?? '') in list.documents ? disguised(m) : m)) }));
    for (const id of Object.keys(bills.bills)) if (id in list.documents) bills.bills[id] = disguised(bills.bills[id]!);
    bills.not_billed = bills.not_billed.map((x) => (x.event in list.events ? disguised(x) : x));
  });

/**
 * The sample with parts of visits that are not private marked private: the
 * records of these kinds, as they stay where the household marked a visit not
 * private, with medrec giving it no place and no words of its own; or, with
 * none, all but its claims and portal visits. A fill or a vaccine is as
 * private as its record.
 */
export const partsPrivate = (...kinds: string[]): Overlay =>
  rewritten({}, ({ index, events, list }) => {
    const kindOf = new Map(index.records.map((r) => [r.id, r.kind ?? '']));
    const mark = { area: 'mental_health', from: 'records' };
    for (const e of events.events) {
      if (e.id in list.events || e.kind === 'fill' || e.kind === 'vaccine') continue;
      for (const m of e.members ?? []) {
        const kind = kindOf.get(m.record ?? '') ?? 'paper';
        if (kinds.length ? !kinds.includes(kind) : kind === 'claim' || kind === 'encounter') continue;
        if (m.record) list.records[m.record] = mark;
        else if (m.document && !m.person) list.documents[m.document] = mark;
      }
      if (!kinds.length) continue;
      delete e.what;
      delete e.place;
    }
  });

/** The sample with a private paper all that says where each visit is that is not private. */
export const placesPrivate = (): Overlay =>
  rewritten({}, ({ index, events, list }) => {
    const inEvents = new Set(events.events.flatMap((e) => e.members?.map((m) => m.document) ?? []));
    const paper = index.documents.find((d) => !inEvents.has(d.id) && !(d.id in list.documents) && d.doc_type !== 'receipt') ?? index.documents.find((d) => d.id in list.documents);
    if (!paper) return;
    list.documents[paper.id] = { area: 'mental_health', from: 'documents' };
    events.aliases = [{ clinician: 'Example', organization: 'Placeholder Practice', rule: 'N5', document: paper.id, confidence: 'likely' } as { organization: string; document: string }];
    for (const e of events.events) if (e.place && !(e.id in list.events)) Object.assign(e, { place: 'Placeholder Practice', place_from: 'alias' });
  });

/** The folder with none of them in it. A visit the household marked not private stays as it is when only private records make it one. */
export const removed = (base: Overlay): Overlay =>
  rewritten(base, (files) => {
    const { index, events, bills, list } = files;
    for (const e of events.events.filter((x) => toldInPrivate(files, x))) delete e.place;
    events.aliases = events.aliases?.filter((a) => !(a.document in list.documents));
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

const BILLS = new Set(['bill', 'receipt', 'eob']);

/**
 * The sample with a private part in each open claim of several lines, each
 * open bill, receipt and explanation of benefits, and each visit those claims
 * are of, as medrec 0.9.9 and later says them. With `words`, what is private
 * there says those; its amounts and its days, which are not, stay.
 */
export const linesPrivate = (words?: string): Overlay =>
  rewritten({}, ({ index, events, list, text }) => {
    const parts: Json = {};
    for (const r of index.records) {
      const items = r.fields.items as Json[] | undefined;
      if (r.kind !== 'claim' || r.id in list.records || !items || items.length < 2) continue;
      const diagnoses = r.fields.diagnoses as Json[] | undefined;
      parts[r.id] = { display: 'Sample care', category: 'other', lines: [0], ...(diagnoses?.length ? { diagnoses: [0] } : {}), payer_notes: [0], says: '1 service, 1 diagnosis and 1 payer note not shown' };
      r.fields.payer_notes = [words ?? 'Sample note', 'Placeholder note'];
      if (words === undefined) continue;
      items[0] = { ...items[0], service: { system: 'http://www.ama-assn.org/go/cpt', code: '00001', display: words }, category: 'imaging', payer_notes: [words] };
      delete items[0].records;
      if (diagnoses?.length) diagnoses[0] = { ...diagnoses[0], code: { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'Z00.0', display: words } };
      Object.assign(r, { display: words });
      r.fields.category = 'imaging';
    }
    for (const e of events.events) {
      if (e.id in list.events || !e.members?.some((m) => (m.record ?? '') in parts)) continue;
      parts[e.id] = { kind: 'service', title: 'Sample visit', what: 'Sample words', what_from: 'claims', place: null, place_from: null, expected: null, says: '1 service not shown' };
      if (words !== undefined) Object.assign(e, { kind: 'er', title: words, what: words, place: words, place_from: 'portal', expected: [{ what: 'bill', why: words }], members: e.members.map((m) => ((m.record ?? '') in parts ? { ...m, title: words } : m)) });
    }
    for (const d of index.documents) {
      const body = text.texts[d.id];
      if (body === undefined || d.id in list.documents || !BILLS.has(String(d.doc_type))) continue;
      const lines = body.split('\n');
      const at = lines.findIndex((l) => /[a-z]{4}/i.test(l));
      if (words !== undefined) lines[at] = words;
      text.texts[d.id] = lines.join('\n');
      const before = lines.slice(0, at).reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
      parts[d.id] = { text: [[before, Buffer.byteLength(lines[at]!)]], says: '1 line not shown' };
    }
    list.parts = parts;
  });

const ERROR = { status: 'entered-in-error' };
const FIRST = 'Records/first/Binary/a.json';

/**
 * The sample with items of Robin's entered in error, as medrec 0.9.9 and later
 * leaves them: a result of a visit, a bill with a payment marked on it, and
 * the claim and the medicine of a fill; and a result and a bill some source
 * still stands by. A bill of Sam's is too, with no payment on it.
 */
export const enteredInError = (): Overlay =>
  rewritten(
    {},
    ({ name, index, events, bills, view }) => {
      view.in_error = {};
      const doc = (amount: string) => index.documents.find((d) => d.doc_type === 'bill' && (d.statement as { amount_due?: { amount: string } }).amount_due?.amount === amount)!;
      if (name === 'Sam Example') {
        const { id } = Object.assign(doc('90.50'), ERROR);
        view.in_error = { document: [id] };
        for (const e of events.events) {
          const its = e.members!.length;
          e.members = e.members!.filter((m) => m.document !== id);
          if (e.members.length < its) Object.assign(e, { in_error: [id] });
        }
        delete bills.bills[id];
        Object.assign(bills, { in_error: { [id]: { as: 'bill' } } });
      }
      if (name !== 'Robin Example') return;
      const record = (fits: (r: (typeof index.records)[number]) => boolean) => index.records.find(fits)!;
      const event = (start: string) => events.events.find((e) => e.start === start)!;
      const member = (e: Item, m: Member) => e.members!.some((x) => (x.record ?? x.document) === (m.record ?? m.document));
      const visit = event('2026-11-18');
      const result = record((r) => r.kind === 'result' && r.display === 'Potassium' && member(visit, { record: r.id }));
      const fill = event('2026-10-08');
      const gone = [result, ...index.records.filter((r) => member(fill, { record: r.id }))];
      for (const r of gone) Object.assign(r, ERROR);
      const wrong = doc('19.28');
      const word = (path: unknown, more: object) => ({ raw_path: path, read: '2026-11-20T12:00:00Z', ...more });
      const from = (x: Item) => x.provenance as Json;
      Object.assign(from(wrong), { raw_path: FIRST });
      Object.assign(wrong, { words: [word(FIRST, ERROR)] });
      const differs = doc('53.68');
      Object.assign(from(differs), { raw_path: FIRST });
      Object.assign(differs, { also_from: [{ ...from(differs), raw_path: 'Records/second/Binary/b.json' }], words: [word(FIRST, ERROR), word('Records/second/Binary/b.json', { status: 'current' })] });
      const held = record((r) => r.kind === 'result' && r.display === 'Creatinine' && member(visit, { record: r.id }));
      const [source] = held.provenance as Json[];
      held.provenance = [{ ...source, raw_path: FIRST }, { ...source, raw_path: 'Records/second/Observation/b.json' }];
      Object.assign(held, { fields_from: 'Records/second/Observation/b.json', words: [word(FIRST, ERROR), word('Records/second/Observation/b.json', { status: 'final' })] });
      view.in_error = { result: [result.id], claim: gone.filter((r) => r.kind === 'claim').map((r) => r.id), medication: gone.filter((r) => r.kind === 'medication').map((r) => r.id), document: [wrong.id] };
      // Its visits: one without the result, one without the bill, and one that is none.
      const out = new Set([result.id, wrong.id]);
      for (const e of events.events) {
        const its = e.members!.map((m) => (m.record ?? m.document)!).filter((id) => out.has(id));
        if (!its.length) continue;
        e.members = e.members!.filter((m) => !out.has((m.record ?? m.document)!));
        e.in_error = its;
      }
      const { events: list } = events;
      events.events = list.filter((e) => e !== fill);
      Object.assign(events, {
        events_in_error: [{ ...fill, in_error: gone.slice(1).map((r) => r.id) }],
        in_error: { [result.id]: { event: visit.id, not_applied: [{ id: 'o_aaaaaaaaaaaaaaaaaaaa', kind: 'apart', members: [result.id], at: '2026-11-19T12:00:00Z' }] }, ...Object.fromEntries(gone.slice(1).map((r) => [r.id, { event: fill.id }])), [wrong.id]: { event: list.find((e) => (e.in_error as string[] | undefined)?.includes(wrong.id))!.id } },
      });
      delete bills.bills[wrong.id];
      bills.not_billed = bills.not_billed.filter((x) => x.event !== fill.id);
      Object.assign(bills, { in_error: { [wrong.id]: { as: 'bill', not_applied: [{ from: 'household', id: 'o_bbbbbbbbbbbbbbbbbbbb', on: '2026-11-04', amount: '19.28', currency: 'USD' }] } } });
      Object.assign(bills.bills[differs.id]!, { differs: true });
    },
    '0.9.9',
  );

/** The sample as a medrec before 0.9.9 would leave it, which writes no one's standing.json: the app makes its lists itself. */
export function withoutStanding(): Overlay {
  const views = JSON.parse(readFileSync(join(DEMO, 'views', 'views.json'), 'utf8')) as Views;
  for (const v of Object.values(views.people)) delete v.files['standing.json'];
  return { 'views/views.json': JSON.stringify(views) };
}
