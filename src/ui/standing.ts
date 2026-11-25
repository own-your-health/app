// What standing.json says of an item (model/standing.ts), in words: what it
// is, what each source says of it with the day it was read, the sources not
// heard, and what a list says beside its rows.

import { isGiven, statusText, type ItemStanding, type ListNotes, type MedicineItem, type SaidBy } from '../model/lists';
import { groupOn, type Standing } from '../model/standing';
import type { MedRecord, PersonIndex } from '../model/types';
import { chip, type Ctx } from './components';
import { h, type Child } from './dom';
import { dateText } from './format';

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** A code as medrec compares them. */
const code = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '-');

/** "ruled out", "unconfirmed": a verification, in words. */
const verificationText = (v: string) => (code(v) === 'refuted' ? 'ruled out' : lower(statusText(code(v))!));

/** What one source says: "active", "resolved, ended Mar 2, 2024", "active, ends Mar 31, 2024 (prescription)". */
export function wordText({ word }: SaidBy): string {
  return [
    word.status ? lower(statusText(code(word.status))!) : 'no status',
    word.verification && code(word.verification) !== 'confirmed' && code(word.verification) !== code(word.status ?? '') ? verificationText(word.verification) : null,
    word.abatement ? `ended ${dateText(word.abatement)}` : null,
    word.end ? `ends ${dateText(word.end)}${word.endOf ? ` (${word.endOf})` : ''}` : null,
    word.read ? `read ${dateText(word.read)}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** What each source says of an item, and those not heard: "Example Health: active, read May 2, 2024". */
export function saidLines(s: Pick<ItemStanding, 'said' | 'unheard'>): string[] {
  return [...s.said.map((x) => `${x.name}: ${wordText(x)}`), ...s.unheard.map((name) => `${name}: not heard`)];
}

/** What a record is, on a day, in a word or two. */
export function isWord(of: Standing, day: string): string {
  switch (groupOn(of, day)) {
    case 'current':
      return 'Current';
    case 'onHold':
      return 'On hold';
    case 'endedByDate':
      return 'Ended by its date';
    case 'error':
      return 'Entered in error';
    case 'rest':
      return of.is === 'draft' ? 'Draft' : of.is === 'refuted' ? 'Ruled out' : of.is === 'visit' ? 'Diagnosis from a visit' : 'Ended';
  }
}

/** The same, with a medicine's day, what ended on it, and a fill after it. */
export function isText(of: Standing, day: string, filled?: string): string {
  if (groupOn(of, day) !== 'endedByDate') return isWord(of, day);
  return [`Ended by its date, ${dateText(of.until)}${of.untilOf ? ` (${of.untilOf})` : ''}`, filled ? `filled ${dateText(filled)}` : null].filter(Boolean).join(', ');
}

/** A row's words: what the records say, then whose word it is (a line for each source when there are several), and the chips under them. */
export function standingMeta(text: string | null, s: ItemStanding, ...chips: (HTMLElement | null)[]): Child {
  const lines = saidLines(s);
  const all = [...chips, ...differChips(s)].filter((x): x is HTMLElement => !!x);
  return [
    lines.length === 1 ? [text, lines[0]].filter(Boolean).join(' · ') : [text, lines.map((x) => h('span', { class: 'row-said' }, x))],
    all.length ? h('span', { class: 'row-chips' }, all) : null,
  ];
}

/** Beside a row whose sources differ, or of which one is not heard. */
export function differChips(s: ItemStanding | undefined): HTMLElement[] {
  if (!s) return [];
  return [s.differs ? chip('Sources differ', 'attention') : null, s.unheard.length ? chip('Not every source heard', 'muted') : null].filter((x): x is HTMLElement => !!x);
}

/** The same as a page's head has them, under its title: beside it, a long name has no room on a phone. */
export function differing(s: ItemStanding | undefined, ...chips: (HTMLElement | null)[]): HTMLElement | null {
  const all = [...chips, ...differChips(s)].filter((x): x is HTMLElement => !!x);
  return all.length ? h('p', { class: 'row-chips' }, all) : null;
}

/** What a fill is, which has no standing of its own: given, or what its status says. */
export function fillText(idx: PersonIndex, r: MedRecord): string | undefined {
  if (idx.standing?.inError.get('medication')?.includes(r.id)) return 'Entered in error';
  return isGiven(r) ? 'Filled' : (statusText(r.status) ?? undefined);
}

let groups = 0;

/** Rows under the name they share, one level under the list's own heading: a medicine's prescriptions, and what is said of them all. */
export function headedRows(level: 'h3' | 'h4', name: string, note: string | null, rows: HTMLElement[]): HTMLElement {
  const id = `list-group-${++groups}`;
  return h('div', { role: 'group', 'aria-labelledby': id }, h(level, { class: 'list-heading' }, h('span', { id }, name), note ? h('span', { class: 'small muted' }, ` · ${note}`) : null), rows);
}

/** What names one of several prescriptions of a medicine, where it gives no dosage. */
export const prescriptionOf = (m: MedicineItem): string => (m.latest.date ? `Prescription of ${dateText(m.latest.date)}` : 'A prescription');

export const inErrorText = (n: number): string => `${n} entered in error, not shown`;
export const noProblemListText = (source: string, where = 'listed under All'): string => `No problem list from ${source}; diagnoses from visits are ${where}`;

/** Why these lists go by each record's own status although medrec wrote what their sources say. Null where they do not, or it did not. */
export function standingNote(ctx: Ctx, idx: PersonIndex): HTMLElement | null {
  const why = ctx.store.standingNotes.get(idx.person);
  return why ? h('p', { class: 'small muted' }, `${why} Meanwhile each record’s own status says what is current.`) : null;
}

/** What a list says beside its rows. */
export function listNotes(notes: ListNotes | undefined, where?: string): HTMLElement[] {
  if (!notes) return [];
  const lines = [...notes.noProblemList.map((n) => noProblemListText(n, where)), ...(notes.inError ? [inErrorText(notes.inError)] : [])];
  return lines.map((x) => h('p', { class: 'small muted' }, `${x}.`));
}
