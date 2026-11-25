// What is current among a person's conditions, allergies and medicines, by
// what each of their sources says of it (views/<person id>/standing.json,
// `medrec-standing/v1`, medrec 0.9.9 and later). No source's word wins over
// another's: a record is current while any of them says so, and where they
// differ each is shown with what it says. Without a file that reads and
// matches the folder, the lists go by each record's own status, as before,
// and nothing is said of sources that differ.

import { FolderError, isObject } from './parse';

/** A kind with a standing. A kind this app does not know is left out. */
export type StandingKind = 'condition' | 'allergy' | 'medication';

/** What a word, or a record by all its words, is. */
export type Is = 'current' | 'on_hold' | 'draft' | 'ended' | 'refuted' | 'visit' | 'error';

/** What one source says of a record. */
export interface Said {
  /** Its place in `sources`. */
  source: number;
  /** The day it was last read saying so. */
  read?: string;
  is: Is;
  status?: string;
  verification?: string;
  abatement?: string;
  end?: string;
  endOf?: string;
}

/** A fill of a medicine after its end. */
export interface Filled {
  record: string;
  date?: string;
}

export interface Standing {
  kind: StandingKind;
  is: Is;
  /** Conditions, or allergies, with one line are one; medicines with one may share a heading. */
  line: string;
  words: Said[];
  /** Sources of it whose words it does not keep. */
  unheard: number[];
  /** Its words differ, now or after a day. */
  differs: boolean;
  differsAfter?: string;
  /** A current medicine's last day, and what ends on it. */
  until?: string;
  untilOf?: string;
  /** Its fills after that day, newest first. */
  filled: Filled[];
}

export interface Standings {
  /** The sources' names; null for one with none. */
  sources: (string | null)[];
  /** Each kind's records, in the order a reader lists them. */
  order: ReadonlyMap<StandingKind, readonly string[]>;
  records: ReadonlyMap<string, Standing>;
  /** What is entered in error, by kind: records of any kind, and papers as `document`. */
  inError: ReadonlyMap<string, readonly string[]>;
  noProblemList: readonly { source: number; records: readonly string[] }[];
}

const KINDS: ReadonlySet<string> = new Set<StandingKind>(['condition', 'allergy', 'medication']);
const IS: ReadonlySet<string> = new Set<Is>(['current', 'on_hold', 'draft', 'ended', 'refuted', 'visit', 'error']);

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const place = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** One this app does not know is current, and its word is shown. */
const isOf = (v: unknown): Is => (IS.has(String(v)) ? (v as Is) : 'current');

function said(raw: Record<string, unknown>): Said[] {
  if (!place(raw.source)) return [];
  const out: Said = { source: raw.source, is: isOf(raw.is) };
  for (const [key, from] of [['read', 'read'], ['status', 'status'], ['verification', 'verification'], ['abatement', 'abatement'], ['end', 'end'], ['endOf', 'end_of']] as const) {
    const v = text(raw[from]);
    if (v) out[key] = v;
  }
  return [out];
}

function standing(id: string, raw: unknown): [string, Standing][] {
  if (!isObject(raw) || !KINDS.has(String(raw.kind))) return [];
  const [until, untilOf, differsAfter] = [text(raw.until), text(raw.until_of), text(raw.differs_after)];
  return [
    [
      id,
      {
        kind: raw.kind as StandingKind,
        is: isOf(raw.is),
        line: text(raw.line) ?? id,
        words: objects(raw.words).flatMap(said),
        unheard: Array.isArray(raw.unheard) ? raw.unheard.filter(place) : [],
        differs: raw.differs === true,
        ...(differsAfter ? { differsAfter } : {}),
        ...(until ? { until } : {}),
        ...(untilOf ? { untilOf } : {}),
        filled: objects(raw.filled).flatMap((f): Filled[] => (text(f.record) ? [{ record: text(f.record)!, ...(text(f.date) ? { date: text(f.date)! } : {}) }] : [])),
      },
    ],
  ];
}

/** Ids by kind, as `order` and `in_error` have them. views.json has the second too. */
export function idsByKind(raw: unknown): Map<string, string[]> {
  return new Map(isObject(raw) ? Object.entries(raw).map(([kind, v]): [string, string[]] => [kind, strings(v)]) : []);
}

/** A person's standing.json. Refused when it is not one, is a newer format, or is another person's. */
export function parseStanding(raw: unknown, person: string): Standings {
  if (!isObject(raw) || typeof raw.schema !== 'string' || !raw.schema.startsWith('medrec-standing/')) throw new FolderError('malformed', 'it is not medrec’s standing of a person’s records.');
  if (raw.schema !== 'medrec-standing/v1') throw new FolderError('newer_format', 'it is written by a newer medrec. Update the app.');
  if (raw.person !== person || !isObject(raw.records)) throw new FolderError('malformed', 'it is not medrec’s standing of this person’s records.');
  const records = new Map(Object.entries(raw.records).flatMap(([id, x]) => standing(id, x)));
  const order = idsByKind(raw.order);
  return {
    sources: (Array.isArray(raw.sources) ? raw.sources : []).map((s) => text(s) ?? null),
    order: new Map(
      ([...KINDS] as StandingKind[]).map((kind): [StandingKind, string[]] => {
        // Every record is listed, one the order leaves out last.
        const listed = (order.get(kind) ?? []).filter((id) => records.get(id)?.kind === kind);
        return [kind, [...new Set([...listed, ...[...records].flatMap(([id, s]) => (s.kind === kind ? [id] : []))])]];
      }),
    ),
    records,
    inError: idsByKind(raw.in_error),
    noProblemList: objects(raw.no_problem_list).flatMap((n) => (place(n.source) ? [{ source: n.source, records: strings(n.records) }] : [])),
  };
}

/** A line of a list: its records, the first of which names it, and what is shown beside them. */
export interface Line {
  records: string[];
  /** Records of the line that say otherwise: ended or refuted, by a source of which nothing on the line is current. */
  against: string[];
  differs: boolean;
  /** The sources not heard. */
  unheard: number[];
  /** Of a medicine ended by its date, the last fill after it that may be shown. */
  filled?: Filled;
}

export interface StandingLists {
  current: Line[];
  onHold: Line[];
  endedByDate: Line[];
  /** The rest, each record by itself: ended, refuted, drafts, and diagnoses from visits. */
  rest: Line[];
  /** Every record by itself, but those entered in error. */
  all: Line[];
  /** How many are entered in error, which no list shows. */
  inError: number;
  /** The sources with no problem list, of which a diagnosis from a visit may be shown. */
  withoutProblemList: number[];
}

export type Group = 'current' | 'onHold' | 'endedByDate' | 'rest' | 'error';

/** Where a record is on a day. */
export function groupOn(s: Standing, day: string): Group {
  switch (s.is) {
    case 'current':
      return s.until !== undefined && s.until < day ? 'endedByDate' : 'current';
    case 'on_hold':
      return 'onHold';
    case 'error':
      return 'error';
    default:
      return 'rest';
  }
}

const differsOn = (s: Standing, day: string): boolean => s.differs || (s.differsAfter !== undefined && s.differsAfter < day);

/** The lists of one kind on a day, of the records `may` lets an answer show; the rest count for nothing. */
export function standingLists(st: Standings, kind: StandingKind, day: string, may: (id: string) => boolean): StandingLists {
  const shown = (st.order.get(kind) ?? []).filter(may).map((id) => ({ id, s: st.records.get(id)! }));
  const alone = (x: { id: string; s: Standing }): Line => {
    const filled = groupOn(x.s, day) === 'endedByDate' ? x.s.filled.find((f) => may(f.record)) : undefined;
    return { records: [x.id], against: [], differs: differsOn(x.s, day), unheard: x.s.unheard, ...(filled ? { filled } : {}) };
  };
  const out: StandingLists = { current: [], onHold: [], endedByDate: [], rest: [], all: shown.filter((x) => x.s.is !== 'error').map(alone), inError: (st.inError.get(kind) ?? []).filter(may).length, withoutProblemList: [] };
  const done = new Set<string>();
  for (const x of shown) {
    const group = groupOn(x.s, day);
    if (group === 'error') continue;
    if (group !== 'current' || kind === 'medication') {
      out[group].push(alone(x));
      continue;
    }
    // At the first of its line, and once.
    if (done.has(x.s.line)) continue;
    done.add(x.s.line);
    out.current.push(lineOf(shown.filter((y) => y.s.line === x.s.line), day));
  }
  if (kind === 'condition') out.withoutProblemList = st.noProblemList.filter((n) => n.records.some(may)).map((n) => n.source);
  return out;
}

function lineOf(all: { id: string; s: Standing }[], day: string): Line {
  const words = all.flatMap((x) => x.s.words);
  const says = (source: number, w: Said) => w.source === source;
  const against = (w: Said) => w.is === 'ended' || w.is === 'refuted';
  // The sources that say it is not so, and nowhere that it is.
  const other = new Set(words.filter((w) => against(w) && !words.some((x) => says(w.source, x) && x.is === 'current')).map((w) => w.source));
  const current = all.filter((x) => groupOn(x.s, day) === 'current');
  return {
    records: current.map((x) => x.id),
    against: all.filter((x) => !current.includes(x) && x.s.words.some((w) => against(w) && other.has(w.source))).map((x) => x.id),
    differs: (other.size > 0 && words.some((w) => w.is === 'current')) || current.some((x) => differsOn(x.s, day)),
    unheard: [...new Set(all.flatMap((x) => x.s.unheard))],
  };
}

/** A source's name, as a reader says it. */
export function sourceName(st: Standings, source: number): string {
  return st.sources[source] ?? 'a source with no name';
}

/** What each source says on a line, each word once. */
export function saidOnLine(st: Standings, line: Pick<Line, 'records' | 'against'>): Said[] {
  const out = new Map<string, Said>();
  for (const id of [...line.records, ...line.against]) {
    for (const w of st.records.get(id)?.words ?? []) {
      const key = JSON.stringify([sourceName(st, w.source), w.read, w.is, w.status, w.verification, w.abatement, w.end, w.endOf]);
      if (!out.has(key)) out.set(key, w);
    }
  }
  return [...out.values()];
}
