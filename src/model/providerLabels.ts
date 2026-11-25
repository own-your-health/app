// The labels medrec gives the providers a person's items print: a name,
// practice, role and phone, with how sure medrec is and why
// (views/<person id>/providers.json, `medrec-providers/v1`, medrec 0.9.7 and
// later). A label stands beside the source's own words on an item that is
// shown anyway, and changes nothing of them: nothing is listed, searched,
// sorted or filtered by one. Without a file that reads and matches the
// folder there is none, and nothing says so. No label holds an NPI.

import { isInError } from './inError';
import { FolderError, isObject } from './parse';
import { knownArea, paperPrivate, recordPrivate } from './private';
import type { PersonIndex } from './types';

/** Whose word it is, or how sure medrec is of it. One this app does not know is `likely`. */
export type LabelConfidence = 'household' | 'sure' | 'likely';

/** Why a label is given. One this app has no words for is `other`. */
export interface LabelEvidence {
  from: 'household' | 'npi' | 'only_match' | 'first_name' | 'paper' | 'other';
  state?: string;
  city?: string;
  /** The text a first name was told apart by. */
  printed?: string;
  /** The paper that prints the name. */
  document?: string;
  /** What the household said, in `said`; by whom and when. */
  id?: string;
  by?: string;
  at?: string;
}

/** Where a label's phone is from: the directory as of a day, a paper that gives a number to call, or the household. */
export interface PhoneFrom {
  from: 'directory' | 'paper' | 'household' | 'other';
  date?: string;
  document?: string;
  id?: string;
}

export interface ProviderLabel {
  id: string;
  name?: string;
  practice?: string;
  role?: string;
  phone?: string;
  phoneFrom?: PhoneFrom;
  confidence: LabelConfidence;
  evidence: LabelEvidence[];
}

/** What the household said of the names an item prints, or of one item's. */
export interface LabelSaid {
  id: string;
  kind: 'set' | 'same' | 'different' | 'wrong';
  printed: string[];
  /** The one item it is said of. */
  item?: string;
  by?: string;
  at?: string;
  /** Its item is entered in error, and it is kept and not applied. */
  applied?: false;
}

interface Part {
  labels: Map<string, ProviderLabel>;
  byName: Map<string, string>;
  byItem: Map<string, Map<string, string>>;
  said: LabelSaid[];
}

export interface ProviderLabels {
  /** What items that are not private say. */
  open: Part;
  /** What only private ones say: their labels, the evidence and phone a private paper gives, and what the household said of them. */
  closed: Part;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);

/** The fields of `raw` that are text, under these names. */
function texts<K extends string>(raw: Record<string, unknown>, ...keys: K[]): Partial<Record<K, string>> {
  return Object.fromEntries(keys.flatMap((k) => (text(raw[k]) ? [[k, text(raw[k])!]] : []))) as Partial<Record<K, string>>;
}

const EVIDENCE: ReadonlySet<string> = new Set<LabelEvidence['from']>(['household', 'npi', 'only_match', 'first_name', 'paper']);
const PHONES: ReadonlySet<string> = new Set<PhoneFrom['from']>(['directory', 'paper', 'household']);
const SAID: ReadonlySet<string> = new Set<LabelSaid['kind']>(['set', 'same', 'different', 'wrong']);

function label(id: string, raw: unknown): ProviderLabel[] {
  if (!isObject(raw)) return [];
  const { name, practice, role, phone } = texts(raw, 'name', 'practice', 'role', 'phone');
  const from = isObject(raw.phone_from) ? raw.phone_from : {};
  const confidence: LabelConfidence = raw.confidence === 'household' || raw.confidence === 'sure' ? raw.confidence : 'likely';
  return [
    {
      id,
      ...(name ? { name } : {}),
      ...(practice ? { practice } : {}),
      ...(role ? { role } : {}),
      ...(phone ? { phone, phoneFrom: { from: PHONES.has(String(from.from)) ? (from.from as PhoneFrom['from']) : 'other', ...texts(from, 'date', 'document', 'id') } } : {}),
      confidence,
      evidence: objects(raw.evidence).map((e): LabelEvidence => (EVIDENCE.has(String(e.from)) ? { from: e.from as LabelEvidence['from'], ...texts(e, 'state', 'city', 'printed', 'document', 'id', 'by', 'at') } : { from: 'other' })),
    },
  ];
}

/** Printed names and the labels they have. A name is kept exactly as it is printed. */
const ids = (raw: unknown): Map<string, string> => new Map(isObject(raw) ? Object.entries(raw).flatMap(([k, v]): [string, string][] => (text(v) ? [[k, text(v)!]] : [])) : []);

function part(raw: Record<string, unknown>): Part {
  const entries = (v: unknown) => (isObject(v) ? Object.entries(v) : []);
  return {
    labels: new Map(entries(raw.labels).flatMap(([id, x]) => label(id, x).map((l): [string, ProviderLabel] => [id, l]))),
    byName: ids(raw.by_name),
    byItem: new Map(entries(raw.by_item).map(([item, x]) => [item, ids(x)])),
    said: objects(raw.overrides).flatMap((o): LabelSaid[] => (text(o.id) && SAID.has(String(o.kind)) ? [{ id: text(o.id)!, kind: o.kind as LabelSaid['kind'], printed: strings(o.printed), ...texts(o, 'item', 'by', 'at'), ...(o.applied === false ? { applied: false as const } : {}) }] : [])),
  };
}

/** A person's providers.json. Refused when it is not one, is a newer format, or is another person's. */
export function parseProviderLabels(raw: unknown, person: string): ProviderLabels {
  if (!isObject(raw) || raw.schema !== 'medrec-providers/v1' || raw.person !== person) throw new FolderError('malformed', 'it is not medrec’s labels for this person’s providers.');
  return { open: part(raw), closed: part(isObject(raw.private) ? raw.private : {}) };
}

/** What is said of a name on an item, and whether it may be said only there: on a private item, to its own person's pages. */
export interface OnItem {
  label: ProviderLabel;
  closed: boolean;
}

/** Whether an item is known to be in a private area: a record, a paper or an event. */
function closedItem(index: PersonIndex, item: string): boolean {
  if (item.startsWith('e_')) return index.privacy?.kind === 'known' && index.privacy.events.has(item);
  return !!knownArea(item.startsWith('d_') ? paperPrivate(index, item) : recordPrivate(index, item));
}

/**
 * The label of a name as an item prints it, by the data contract's "Looking
 * one up": the exact text, on the item, then wherever it is printed. A
 * private item has what is only private as well; any other never. One entered
 * in error prints no labelled provider.
 */
export function labelOn(index: PersonIndex, item: string, printed: string | undefined): OnItem | undefined {
  const all = index.providerLabels;
  if (!all || !printed || isInError(index, item)) return undefined;
  const closed = closedItem(index, item);
  const from = closed ? all.closed : all.open;
  const id = from.byItem.get(item)?.get(printed) ?? from.byName.get(printed);
  if (!id) return undefined;
  const label = (closed ? all.closed.labels.get(id) : undefined) ?? all.open.labels.get(id);
  return label ? { label, closed } : undefined;
}

/**
 * A label as a screen the household shares may show it: without the evidence
 * and the phone of a paper `paper` does not let it name, or of what the
 * household said of private items. None for a likely one left with nothing to
 * say why.
 */
export function sharedLabel(index: PersonIndex, label: ProviderLabel, paper: (id: string) => boolean): ProviderLabel | undefined {
  const closed = new Set(index.providerLabels?.closed.said.map((s) => s.id));
  const may = (x: { document?: string; id?: string }) => (x.document === undefined || paper(x.document)) && (x.id === undefined || !closed.has(x.id));
  const { phone, phoneFrom, ...rest } = label;
  const evidence = label.evidence.filter(may);
  if (label.confidence === 'likely' && !evidence.length && label.evidence.length) return undefined;
  return { ...rest, evidence, ...(phone && phoneFrom && may(phoneFrom) ? { phone, phoneFrom } : {}) };
}

/** What the household said of a name on an item, newest first; what is private of it, where the item is. None of it is applied on one entered in error. */
export function saidOn(index: PersonIndex, item: string, printed: string): LabelSaid[] {
  const all = index.providerLabels;
  if (!all || isInError(index, item)) return [];
  const said = [...all.open.said, ...(closedItem(index, item) ? all.closed.said : [])];
  return said.filter((s) => (s.item ? s.item === item && (!s.printed.length || s.printed.includes(printed)) : s.printed.includes(printed))).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}
