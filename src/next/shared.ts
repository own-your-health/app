// What every screen the household shares has in common: which claims it may
// not name, and the line that says whose items are held back, and why.

import { isHeld, leavesOff, recordPrivate, whyHeld } from '../model/private';
import { called } from '../model/people';
import type { Person } from '../model/types';
import type { Store } from '../data/store';
import type { Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { householdEvents } from './calendar';

/** Claims a shared screen neither names nor dates: private ones, and those of a private visit, each with its area. */
export function quietClaims(store: Store, today: string): Map<string, string> {
  const quiet = new Map<string, string>();
  for (const p of store.household.people) {
    const idx = store.index(p.id);
    for (const r of idx?.records ?? []) {
      const area = r.kind === 'claim' ? recordPrivate(idx!, r.id) : undefined;
      if (area) quiet.set(r.id, area);
    }
  }
  for (const x of householdEvents(store.household, (id) => store.index(id), today)) if (x.private) for (const c of x.event.claims) if (!quiet.has(c.record.id)) quiet.set(c.record.id, x.private);
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
