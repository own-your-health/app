// The parts every Money page shares: the bills gathered for
// everyone or one person (private ones kept off the shared view, counted),
// the heading with its Whose choices, and the money formats.

import { formatMoney, fromCents } from '../model/records';
import type { Person } from '../model/types';
import { chip, link, type Ctx } from '../ui/components';
import { h, icon } from '../ui/dom';
import { count, localDay } from '../ui/format';
import { href, type Route } from '../ui/router';
import { householdEvents, type PersonEvent } from './calendar';
import { eventWhen } from './eventView';
import { byDue, explainedLines, openBills, paidBills, unbilledShares, type Explained, type OpenBill, type PaidBill, type Unbilled } from './money';
import { called } from '../model/people';

export type MoneyRoute = Extract<Route, { name: 'money' }>;

export const money = (cents: number) => formatMoney(fromCents(cents)) ?? '';
export const num = (cents: number) => h('span', { class: 'num' }, money(cents));
export const visitText = (x: PersonEvent) => `${x.event.title}, ${eventWhen(x.event)}`;
export const privateChip = (area: string | undefined) => (area ? chip('Private', 'muted') : null);

export interface Mine<T> {
  person: Person;
  item: T;
}

/** Everyone's bills, or one person's: private ones kept off the shared view, and how many each part left off. */
export function gather(ctx: Ctx, who: string | undefined) {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const all = householdEvents(store.household, (id) => store.index(id), today);
  const open: Mine<OpenBill>[] = [];
  const unbilled: Mine<Unbilled>[] = [];
  const paid: Mine<PaidBill>[] = [];
  const explained: Mine<Explained>[] = [];
  const hidden = { open: [] as OpenBill[], unbilled: [] as Unbilled[], paid: 0, explained: 0 };
  let loading = 0;
  for (const p of store.household.people) {
    if (who && p.id !== who) continue;
    const idx = store.index(p.id);
    if (!idx) {
      if (!store.indexErrors.has(p.id)) loading++;
      continue;
    }
    const mine = all.filter((x) => x.person.id === p.id);
    const keep = <T extends { private?: string }>(xs: T[]): { shown: Mine<T>[]; left: T[] } => ({
      shown: (who ? xs : xs.filter((x) => !x.private)).map((item) => ({ person: p, item })),
      left: who ? [] : xs.filter((x) => x.private),
    });
    const o = keep(openBills(idx, mine, today));
    const u = keep(unbilledShares(idx, mine));
    const pd = keep(paidBills(idx, mine));
    const ex = keep(explainedLines(mine, today));
    open.push(...o.shown);
    unbilled.push(...u.shown);
    paid.push(...pd.shown);
    explained.push(...ex.shown);
    hidden.open.push(...o.left);
    hidden.unbilled.push(...u.left);
    hidden.paid += pd.left.length;
    hidden.explained += ex.left.length;
  }
  open.sort((a, b) => byDue(a.item, b.item));
  unbilled.sort((a, b) => b.item.event.event.start.localeCompare(a.item.event.event.start));
  paid.sort((a, b) => (b.item.bill.date ?? '').localeCompare(a.item.bill.date ?? ''));
  explained.sort((a, b) => b.item.event.event.start.localeCompare(a.item.event.event.start));
  return { today, open, unbilled, paid, explained, hidden, loading };
}

/** "2 private items are kept off this shared view. Each shows on its person's own view." */
export function keptNote(n: number, where: string): HTMLElement | null {
  return n ? h('p', { class: 'small muted' }, `${count(n, 'private item')} ${n === 1 ? 'is' : 'are'} kept off this shared view. Each shows on its person’s own ${where}.`) : null;
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
