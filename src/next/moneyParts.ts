// The parts every Money page shares: the bills gathered for
// everyone or one person (private ones kept off the shared view),
// the heading with its Whose choices, and the money formats.

import { receiptDay } from '../model/billing';
import { knownArea, paperPrivate } from '../model/private';
import { formatMoney, fromCents } from '../model/records';
import type { Person } from '../model/types';
import { chip, link, type Ctx } from '../ui/components';
import { h, icon } from '../ui/dom';
import { localDay } from '../ui/format';
import { billErrorsText } from '../ui/inError';
import { href, type Route } from '../ui/router';
import { householdEvents, sharedEvents, type PersonEvent } from './calendar';
import { eventWhen } from './eventView';
import { anyBill, byDue, deskPayments, explainedLines, forShared, openBills, paidBills, sharedDesk, sharedOpen, unbilledShares, type DeskPayment, type Explained, type OpenBill, type PaidBill, type Unbilled } from './money';
import { called } from '../model/people';
import { privateLine } from './shared';

export type MoneyRoute = Extract<Route, { name: 'money' }>;

export const money = (cents: number) => formatMoney(fromCents(cents)) ?? '';
export const num = (cents: number) => h('span', { class: 'num' }, money(cents));
export const visitText = (x: PersonEvent) => `${x.event.title}, ${eventWhen(x.event)}`;
export const privateChip = (area: string | undefined) => (knownArea(area) ? chip('Private', 'muted') : null);

export interface Mine<T> {
  person: Person;
  item: T;
}

/** Everyone's bills, or one person's: private ones kept off the shared view. */
export function gather(ctx: Ctx, who: string | undefined) {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const all = (who ? householdEvents : sharedEvents)(store.household, (id) => store.index(id), today);
  const open: Mine<OpenBill>[] = [];
  const unbilled: Mine<Unbilled>[] = [];
  const paid: Mine<PaidBill>[] = [];
  const desk: Mine<DeskPayment>[] = [];
  const explained: Mine<Explained>[] = [];
  let loading = 0;
  for (const p of store.household.people) {
    if (who && p.id !== who) continue;
    const idx = store.index(p.id);
    if (!idx) {
      if (!store.indexErrors.has(p.id)) loading++;
      continue;
    }
    const mine = all.filter((x) => x.person.id === p.id);
    const keep = <T extends { private?: string }>(xs: T[], share: (xs: T[]) => T[]): Mine<T>[] => (who ? xs : share(xs)).map((item) => ({ person: p, item }));
    const cleared = <T extends { private?: string }>(xs: T[]) => xs.filter((x) => !x.private);
    open.push(...keep(openBills(idx, mine, today, store.marks), (xs) => sharedOpen(idx, xs)));
    unbilled.push(...keep(unbilledShares(idx, mine, !who), cleared));
    paid.push(...keep(paidBills(idx, mine), (xs) => forShared(idx, xs)));
    desk.push(...keep(deskPayments(idx, mine), sharedDesk));
    explained.push(...keep(explainedLines(idx, mine, today), cleared));
  }
  open.sort((a, b) => byDue(a.item, b.item));
  unbilled.sort((a, b) => b.item.event.event.start.localeCompare(a.item.event.event.start));
  paid.sort((a, b) => (b.item.bill.date ?? '').localeCompare(a.item.bill.date ?? ''));
  desk.sort((a, b) => (receiptDay(b.item.receipt) ?? '').localeCompare(receiptDay(a.item.receipt) ?? ''));
  explained.sort((a, b) => b.item.event.event.start.localeCompare(a.item.event.event.start));
  return { today, open, unbilled, paid, desk, explained, loading };
}

/** What everyone's lists say of private items, whether or not there are any; one person's lists hold theirs. */
export const listLine = (who: string | undefined, where: string): HTMLElement | null => (who ? null : privateLine(`Private items are never listed here. Each shows on its person’s own ${where}.`));

/** Whose bills go by the receipts alone, or without the household's marks, and why: one line for each person with a bill the page may speak of. */
export function billNotes(ctx: Ctx, who: string | undefined): HTMLElement[] {
  const all = householdEvents(ctx.store.household, (id) => ctx.store.index(id), localDay(ctx.now()));
  return ctx.store.household.people.flatMap((p) => {
    const idx = who && p.id !== who ? undefined : ctx.store.index(p.id);
    if (!idx || !anyBill(idx, all.filter((x) => x.person.id === p.id), !who)) return [];
    const why = ctx.store.billsNotes.get(p.id);
    const unread = idx.bills?.marksUnreadable;
    if (why) return [h('p', { class: 'small muted' }, `${why} Meanwhile only receipts say which of ${called(p)}’s bills are paid.`)];
    return unread ? [h('p', { class: 'small muted' }, `The payments marked for ${called(p)} could not be read, so none of them is counted.`)] : [];
  });
}

/** The bills entered in error that a page of bills may count: all of a person's own, and of everyone's those that are not private. */
export function billErrors(ctx: Ctx, who: string | undefined): HTMLElement | null {
  const errors = ctx.store.household.people.flatMap((p) => {
    const idx = who && p.id !== who ? undefined : ctx.store.index(p.id);
    return (idx?.bills?.errors ?? []).filter((b) => who || !paperPrivate(idx!, b.document));
  });
  return errors.length ? h('p', { class: 'small muted' }, `${billErrorsText(errors.length, errors.filter((b) => b.marked).length)}.`) : null;
}

/** A row or card for one bill, so Worth a call can find the one a row named. */
export function forBill<T extends HTMLElement>(el: T, id: string): T {
  el.dataset.bill = id;
  return el;
}

/** The view's heading, the way back to Money from a page under it, its choices and the line under them. */
export function head(ctx: Ctx, route: MoneyRoute, title: string, lead: string, who: string | undefined): HTMLElement[] {
  const people = ctx.store.household.people;
  const whose = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Whose money' },
    [{ id: '', name: 'Everyone' }, ...people].map((p) => {
      const on = p.id ? who === p.id : !who;
      // The same page, year and order for someone else; a bill a row named stays behind.
      const to: Route = { name: 'money', ...(route.view ? { view: route.view } : {}), ...(route.period ? { period: route.period } : {}), ...(route.sort ? { sort: route.sort } : {}), ...(p.id ? { who: p.id } : {}) };
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href(to), 'aria-current': on ? 'page' : false }, called(p));
    }),
  );
  const back = route.view ? h('p', null, link({ name: 'money', ...(who ? { who } : {}) }, icon('back', 16), ' Money')) : null;
  const out: (HTMLElement | null)[] = [back, h('h1', null, title), h('p', { class: 'lead' }, lead), whose];
  return out.filter((x): x is HTMLElement => x !== null);
}
