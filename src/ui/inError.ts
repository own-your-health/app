// What a page says of an item that a source says is entered in error: what
// each of its sources says, and of one every source says it of, what the
// household decided of it. A list says how many it leaves out.

import { documentSays, recordSays, saysError, type Says } from '../model/inError';
import { isWithdrawn, originNames, type Item } from '../model/records';
import type { PersonIndex } from '../model/types';
import { card, chip, type Ctx } from './components';
import { h } from './dom';
import { count } from './format';
import { inErrorText, wordText } from './standing';

const saysOf = (item: Item): Says[] => (item.type === 'record' ? recordSays(item.record) : item.type === 'document' ? documentSays(item.document) : []);

/** Whether its sources differ on it: some say it is entered in error, and some do not. A record its own status withdraws, as an earlier medrec's does, has no part in it. */
export const differs = (item: Item): boolean => (item.type !== 'record' || !!item.record.stands || (!!item.record.words?.length && !isWithdrawn(item.record))) && !saysOf(item).every(saysError);

/** Beside an item whose sources differ on it. */
export const differChip = (item: Item): HTMLElement | null => (differs(item) ? chip('Sources differ', 'attention') : null);

/** "Example Health: entered in error, read Jul 3, 2024", one line for each source. */
export function saysLines(ctx: Ctx, idx: PersonIndex, says: Says[]): string[] {
  return says.map((s) => {
    if (s.household) return 'The household’s own file';
    const name = (s.provenance ? originNames([s.provenance], ctx.store.household, idx.person)[0] : undefined) ?? 'A source with no name';
    if (s.unheard) return `${name}: not heard`;
    return `${name}: ${wordText({ word: s })}`;
  });
}

/** What the household decided of an item entered in error: kept, and not applied while it is. */
export function keptText(idx: PersonIndex, id: string): string | undefined {
  const decisions = idx.events?.notApplied.get(id) ?? 0;
  const paid = idx.bills?.errors.find((b) => b.document === id)?.marked ?? 0;
  const parts = [decisions ? `${count(decisions, 'decision')} about its visit` : null, paid ? `${count(paid, 'payment')} on it` : null].filter(Boolean);
  return parts.length ? `Kept and not applied: ${parts.join(', ')}.` : undefined;
}

/** At the top of an item's page: that it is entered in error, or that its sources differ on it. Null for any other. */
export function errorCard(ctx: Ctx, idx: PersonIndex, id: string, item: Item): HTMLElement | null {
  if (item.type === 'study') return null;
  // A condition's, an allergy's or a medicine's words are on its page already.
  const lines = idx.standing?.records.has(id) ? [] : saysLines(ctx, idx, saysOf(item));
  const list = lines.length ? h('ul', { class: 'said-list' }, lines.map((x) => h('li', null, x))) : null;
  if (item.inError) {
    const kept = keptText(idx, id);
    return card({ title: 'Entered in error', class: 'in-error' }, h('p', null, 'It is in no list, visit, bill or total.'), list, kept ? h('p', null, kept) : null);
  }
  return list && differs(item) ? card({ title: 'Its sources differ' }, h('p', { class: 'small muted' }, 'Some say it is entered in error. It stays while any does not.'), list) : null;
}

/** Under a list: how many it leaves out. */
export const errorsNote = (n: number): HTMLElement | null => (n ? h('p', { class: 'small muted' }, `${inErrorText(n)}.`) : null);

/** Under a list of bills: how many it leaves out, and how many of those the household marked a payment on, since money may be owed back. */
export function billErrorsText(n: number, marked: number): string {
  const bills = `${count(n, 'bill')} entered in error`;
  if (!marked) return `${bills}, not shown`;
  if (n === 1) return `${bills}, with a payment you marked`;
  return marked === n ? `${bills}, each with a payment you marked` : `${bills}, ${marked} with a payment you marked`;
}
