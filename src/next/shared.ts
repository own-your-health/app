// What every screen the household shares has in common: which claims it may
// not name, and the line that says whose items are held back, and why.

import { HELD, isHeld, leavesOff, recordPrivate, whyHeld } from '../model/private';
import { called } from '../model/people';
import type { Household, Person, PersonIndex } from '../model/types';
import type { Store } from '../data/store';
import type { Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { householdEvents, type PersonEvent } from './calendar';
import { eventPrivate } from './event';
import { eventInError } from './medrecEvents';

/** The area of the visit a claim entered in error would be in, as medrec has it; held where that is not here to judge. */
function visitPrivate(idx: PersonIndex, household: Household, events: PersonEvent[], claim: string): string | undefined {
  if (!idx.events) return HELD;
  const at = idx.events.errorAt.get(claim);
  if (!at) return undefined;
  const stands = events.find((x) => x.event.id === at);
  if (stands) return stands.private;
  const wrong = eventInError(idx, household, at);
  return wrong ? eventPrivate(wrong, idx) : HELD;
}

/** Claims a shared screen neither names, dates nor counts: private ones, and those of a private visit, each with its area. */
export function quietClaims(store: Store, today: string): Map<string, string> {
  const quiet = new Map<string, string>();
  const put = (id: string, area: string | undefined) => void (area && !quiet.has(id) && quiet.set(id, area));
  const events = householdEvents(store.household, (id) => store.index(id), today);
  for (const p of store.household.people) {
    const idx = store.index(p.id);
    for (const r of idx?.records ?? []) if (r.kind === 'claim') put(r.id, recordPrivate(idx!, r.id));
    for (const r of idx?.inError?.records ?? []) if (r.kind === 'claim') put(r.id, recordPrivate(idx!, r.id) ?? visitPrivate(idx!, store.household, events, r.id));
  }
  for (const x of events) for (const c of x.event.claims) put(c.record.id, x.private);
  return quiet;
}

/**
 * The line a shared screen says of private items. It reads the same whether
 * or not anything is private, as everything else there does: a count, or
 * words that change when something is left off, would say that there is.
 */
export const privateLine = (text: string): HTMLElement => h('p', { class: 'small muted private-line' }, text);

/** Everyone whose items are all held back from shared screens, with why. */
export function heldPeople(store: Store): { person: Person; why: string }[] {
  return store.household.people.flatMap((person) => {
    const idx = store.index(person.id);
    return idx && isHeld(idx) ? [{ person, why: whyHeld(idx)! }] : [];
  });
}

/** Whether shared screens leave anything off: an empty list on one can't say that there is nothing. It asks of the whole household, so no screen says whose. */
export const anyLeftOff = (store: Store): boolean =>
  store.household.people.some((p) => {
    const idx = store.index(p.id);
    return !!idx && leavesOff(idx);
  });

const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Sam’s items are left off Home. medrec has not written which items are private. … Sam’s own pages show them." One line for each reason. */
export function heldNotes(ctx: Ctx, where: string): HTMLElement[] {
  const byWhy = new Map<string, string[]>();
  for (const { person, why } of heldPeople(ctx.store)) byWhy.set(why, [...(byWhy.get(why) ?? []), called(person)]);
  return [...byWhy].map(([why, names]) =>
    h('p', { class: 'small held-note' }, `${andList(names.map((n) => `${n}’s`))} items are left off ${where}. ${why} ${names.length === 1 ? `${names[0]}’s` : 'Their'} own pages show them.`),
  );
}
