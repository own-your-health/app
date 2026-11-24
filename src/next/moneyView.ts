// Money under ?next, bills first. Bills sets each open bill beside what the
// claims say you owe, then the shares no bill has asked for yet and the
// bills paid. Worth a call gives each bill that asks something else the
// facts to read out on the phone. Everyone's view is a shared screen:
// private bills stay off it, counted, and show on their person's own view.

import { claimLines } from '../model/claims';
import { formatMoney, fromCents, str } from '../model/records';
import type { Person } from '../model/types';
import { card, chip, driveLink, kv, link, row, type Ctx } from '../ui/components';
import { h, type Child } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import { href, type Route } from '../ui/router';
import { householdEvents, type PersonEvent } from './calendar';
import { daysBetween } from './needs';
import { eventRoute, eventWhen } from './eventView';
import { openBills, paidBills, unbilledShares, type OpenBill, type PaidBill, type Unbilled } from './money';

type MoneyRoute = Extract<Route, { name: 'money' }>;

const money = (cents: number) => formatMoney(fromCents(cents)) ?? '';
const num = (cents: number) => h('span', { class: 'num' }, money(cents));
const visitText = (x: PersonEvent) => `${x.event.title}, ${eventWhen(x.event)}`;
const privateChip = (area: string | undefined) => (area ? chip('Private', 'muted') : null);

interface Mine<T> {
  person: Person;
  item: T;
}

/** Everyone's bills, or one person's: private ones kept off the shared view and counted. */
function gather(ctx: Ctx, who: string | undefined) {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const all = householdEvents(store.household, (id) => store.index(id), today);
  const open: Mine<OpenBill>[] = [];
  const unbilled: Mine<Unbilled>[] = [];
  const paid: Mine<PaidBill>[] = [];
  let kept = 0;
  let loading = 0;
  for (const p of store.household.people) {
    if (who && p.id !== who) continue;
    const idx = store.index(p.id);
    if (!idx) {
      if (!store.indexErrors.has(p.id)) loading++;
      continue;
    }
    const mine = all.filter((x) => x.person.id === p.id);
    const keep = <T extends { private?: string }>(xs: T[]): Mine<T>[] => {
      const shownXs = who ? xs : xs.filter((x) => !x.private);
      kept += xs.length - shownXs.length;
      return shownXs.map((item) => ({ person: p, item }));
    };
    open.push(...keep(openBills(idx, mine, today)));
    unbilled.push(...keep(unbilledShares(idx, mine)));
    paid.push(...keep(paidBills(idx, mine)));
  }
  const byDue = (a: Mine<OpenBill>, b: Mine<OpenBill>) => Number(b.item.overdue) - Number(a.item.overdue) || (a.item.bill.due ?? '9999').localeCompare(b.item.bill.due ?? '9999');
  open.sort(byDue);
  unbilled.sort((a, b) => b.item.event.event.start.localeCompare(a.item.event.event.start));
  paid.sort((a, b) => (b.item.bill.date ?? '').localeCompare(a.item.bill.date ?? ''));
  return { today, all, open, unbilled, paid, kept, loading };
}

/** The view's heading, its choices and the line under them. */
function head(ctx: Ctx, route: MoneyRoute, title: string, lead: string, who: string | undefined): HTMLElement[] {
  const people = ctx.store.household.people;
  const whose = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Whose bills' },
    [{ id: '', name: 'Everyone' }, ...people].map((p) => {
      const on = p.id ? who === p.id : !who;
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href({ name: 'money', ...(route.view ? { view: route.view } : {}), ...(p.id ? { who: p.id } : {}) }), 'aria-current': on ? 'true' : false }, p.name);
    }),
  );
  return [h('h1', null, title), h('p', { class: 'lead' }, lead), whose];
}

const billWhen = (b: OpenBill | PaidBill) => {
  const d = b.bill.doc.statement?.statement_date ?? b.bill.date;
  return d ? `statement ${dateText(d)}` : null;
};

function dueChip(b: OpenBill, today: string): HTMLElement | null {
  const due = b.bill.due;
  if (!due) return null;
  if (!b.overdue) return chip(`Due ${dateText(due)}`, 'muted');
  const late = daysBetween(due, today);
  return chip(late === 1 ? `Was due yesterday, ${dateText(due)}` : `Was due ${dateText(due)}`, 'attention');
}

function openRow(ctx: Ctx, m: Mine<OpenBill>, today: string, named: boolean): HTMLElement {
  const b = m.item;
  const e = b.event;
  return row({
    route: e ? eventRoute(m.person.id, e.event.id) : { name: 'item', person: m.person.id, id: b.bill.doc.id },
    title: b.bill.provider ?? 'A provider',
    meta: [named ? m.person.name : null, e ? visitText(e) : null, billWhen(b)].filter(Boolean).join(' · '),
    aside: num(b.cents),
    extra: h(
      'div',
      { class: 'bill-line' },
      h('div', { class: 'chips' }, dueChip(b, today), b.verdict === 'matches' ? chip('Matches the claim', 'ok') : null, privateChip(b.private)),
      h('div', { class: 'bill-links' }, link({ name: 'item', person: m.person.id, id: b.bill.doc.id }, 'The bill'), driveLink(ctx, b.bill.doc.path, 'Open the bill in Drive')),
    ),
  });
}

/** What the claims say, in a few words: "the claim says $53.68", "the visit's claims say $50.70". */
function saysText(b: OpenBill): string {
  if (b.claimSays === undefined) return 'no claim in these records is for it';
  return `the ${b.claimSaysVisit ? 'visit’s claims say' : 'claim says'} you owe ${money(b.claimSays)}`;
}

/** Bills: each open bill beside its claim, then what is not billed yet, then what is paid. */
function billsPage(ctx: Ctx, route: MoneyRoute, who: string | undefined): HTMLElement {
  const g = gather(ctx, who);
  const named = !who;
  const ready = g.open.filter((m) => m.item.verdict === 'matches');
  const check = g.open.filter((m) => m.item.verdict !== 'matches');
  const readyCents = ready.reduce((t, m) => t + m.item.cents, 0);
  const unbilledCents = g.unbilled.reduce((t, m) => t + m.item.cents, 0);
  const callsRoute: Route = { name: 'money', view: 'calls', ...(who ? { who } : {}) };

  const hero = card(
    { class: 'money-hero' },
    h('p', { class: 'money-hero-label' }, 'Ready to pay'),
    h('p', { class: 'money-hero-number num' }, money(readyCents)),
    h(
      'p',
      null,
      ready.length ? `${count(ready.length, 'bill')}, each asking what its claim says you owe.` : 'No bill that matches its claim is waiting.',
      check.length ? [' ', link(callsRoute, `${count(check.length, 'more bill')} ${check.length === 1 ? 'is' : 'are'} worth a call first.`)] : ready.length ? ' None asks for more than the claims say.' : null,
    ),
  );

  const dueNow = ready.length ? card({ title: 'Due now', actions: h('span', { class: 'small muted' }, String(ready.length)) }, ready.map((m) => openRow(ctx, m, g.today, named))) : null;

  const checkCard = check.length
    ? card(
        { title: 'Check before paying', actions: h('span', { class: 'small muted' }, String(check.length)) },
        h('p', { class: 'small muted' }, 'These ask for something other than what the claims say you owe, or no claim backs them.'),
        check.map((m) =>
          row({
            route: callsRoute,
            title: m.item.bill.provider ?? 'A provider',
            meta: [named ? m.person.name : null, m.item.event ? visitText(m.item.event) : null, `asks ${money(m.item.cents)}; ${saysText(m.item)}`].filter(Boolean).join(' · '),
            aside: [privateChip(m.item.private), num(m.item.cents)],
          }),
        ),
      )
    : null;

  const unbilledCard = g.unbilled.length
    ? card(
        { title: 'Not billed yet', actions: h('span', { class: 'num small' }, money(unbilledCents)) },
        h('p', { class: 'small muted' }, 'The claims say you owe these, and no bill or receipt from the provider is in the folder yet. A copay is often paid at the desk without one.'),
        g.unbilled.map((m) =>
          row({
            route: eventRoute(m.person.id, m.item.event.event.id),
            title: m.item.provider,
            meta: [named ? m.person.name : null, visitText(m.item.event)].filter(Boolean).join(' · '),
            aside: [privateChip(m.item.private), num(m.item.cents)],
          }),
        ),
      )
    : null;

  const paidCard = g.paid.length
    ? card(
        { title: 'Paid' },
        h('p', { class: 'small muted' }, 'A bill is paid here when a receipt from its provider is filed after it.'),
        g.paid.map((m) =>
          row({
            route: m.item.event ? eventRoute(m.person.id, m.item.event.event.id) : { name: 'item', person: m.person.id, id: m.item.bill.doc.id },
            title: m.item.bill.provider ?? 'A provider',
            meta: [named ? m.person.name : null, m.item.event ? visitText(m.item.event) : billWhen(m.item), `receipt ${dateText(m.item.bill.receipt!.date)}`].filter(Boolean).join(' · '),
            aside: [privateChip(m.item.private), m.item.cents !== undefined ? num(m.item.cents) : null],
          }),
        ),
      )
    : null;

  return h(
    'div',
    { class: 'stack money' },
    ...head(ctx, route, 'Bills', 'Each bill beside what the claims say you owe, and the receipts in the folder.', who),
    g.loading ? h('p', { class: 'small muted' }, `Still loading the records of ${count(g.loading, 'person', 'people')}.`) : null,
    hero,
    dueNow,
    checkCard,
    unbilledCard,
    paidCard,
    g.kept ? h('p', { class: 'small muted' }, `${count(g.kept, 'private item')} ${g.kept === 1 ? 'is' : 'are'} kept off this shared view. Each shows on its person’s own Bills.`) : null,
    !g.open.length && !g.unbilled.length && !g.paid.length ? card({}, h('p', null, 'No bills, receipts or claim shares in these records yet.')) : null,
  );
}

/** What to read out on the call, in the household's words. */
function script(b: OpenBill): string {
  const s = b.bill.doc.statement;
  const dated = s?.statement_date ?? b.bill.date;
  const visit = b.event ? ` for the visit on ${dateText(b.event.event.start)}` : '';
  const opening = `I have a statement${dated ? ` dated ${dateText(dated)}` : ''} for ${money(b.cents)}${s?.account ? `, account ${s.account}${visit ? ',' : ''}` : ''}`;
  if (b.claimSays === undefined) return `“${opening}${visit}. I can’t find an insurance claim for it. Was it billed to my insurance, and if so, under which claim?”`;
  if (b.claimSaysVisit) {
    const to = (b.event?.money.charges ?? []).filter((c) => (c.share ?? 0) > 0).map((c) => c.provider);
    return `“${opening}${visit}. My plan’s claims for that visit say I owe ${money(b.claimSays)} in all${to.length ? `, to ${to.join(' and ')}` : ''}. Which claim is this bill for, and can you check the balance?”`;
  }
  return `“${opening}${visit}. My plan’s claim for that visit says I owe ${money(b.claimSays)}. Can you check the balance, or send an itemized bill?”`;
}

function callCard(ctx: Ctx, m: Mine<OpenBill>, named: boolean): HTMLElement {
  const b = m.item;
  const e = b.event;
  const over = b.claimSays !== undefined ? b.cents - b.claimSays : undefined;
  const s = b.bill.doc.statement;
  const shares = (e?.money.charges ?? []).filter((c) => (c.share ?? 0) > 0);
  return card(
    { title: b.bill.provider ?? 'A provider', class: 'call', actions: privateChip(b.private) },
    h('p', { class: 'call-claim' }, b.claimSays === undefined ? `Asks ${money(b.cents)}. No claim in these records is for it.` : `Asks ${money(b.cents)}. The ${b.claimSaysVisit ? 'visit’s claims say' : 'claim says'} ${money(b.claimSays)}.`),
    over !== undefined && over > 0 ? h('p', { class: 'call-number' }, num(over), h('span', null, ' may not be owed')) : null,
    b.claimSays === undefined ? h('p', { class: 'small' }, 'If it went through insurance, its claim may not be in these records yet. If it didn’t, it may not be an insurance bill.') : null,
    kv([
      ['Whose', named ? m.person.name : null],
      ['Visit', e ? link(eventRoute(m.person.id, e.event.id), visitText(e)) : 'None in these records'],
      ['Statement', [dateText(s?.statement_date ?? b.bill.date), s?.account ? `account ${s.account}` : null, b.bill.due ? `${b.overdue ? 'was due' : 'due'} ${dateText(b.bill.due)}` : null].filter(Boolean).join(' · ')],
      ['The claims say', shares.length ? shares.map((c) => `${money(c.share!)} to ${c.provider}`).join(', ') : b.claimSays === undefined ? null : money(b.claimSays)],
      ['The bill asks', money(b.cents)],
    ]),
    h('div', { class: 'call-script' }, h('p', { class: 'call-script-label' }, 'What to say'), h('p', null, script(b))),
    h('p', { class: 'small muted' }, 'The bill’s phone number isn’t in these records yet; it is on the paper.'),
    h('div', { class: 'bill-links' }, link({ name: 'item', person: m.person.id, id: b.bill.doc.id }, 'The bill'), driveLink(ctx, b.bill.doc.path, 'Open the bill in Drive')),
  );
}

/** Worth a call: the bills to ask about, with the figures and the words; then those worth a look, and what the plan changed. */
function callsPage(ctx: Ctx, route: MoneyRoute, who: string | undefined): HTMLElement {
  const g = gather(ctx, who);
  const named = !who;
  const asksMore = g.open.filter((m) => m.item.verdict === 'no_claim' || (m.item.verdict === 'differs' && m.item.cents > m.item.claimSays!));
  const asksLess = g.open.filter((m) => m.item.verdict === 'differs' && m.item.cents < m.item.claimSays!);
  const over = asksMore.reduce((t, m) => t + Math.max(0, m.item.cents - (m.item.claimSays ?? m.item.cents)), 0);
  const unbacked = asksMore.filter((m) => m.item.verdict === 'no_claim').length;
  const providers = new Set(asksMore.map((m) => m.item.bill.provider)).size;

  const hero = asksMore.length
    ? card(
        { class: 'money-hero' },
        h('p', { class: 'money-hero-label' }, 'May not be owed'),
        h('p', { class: 'money-hero-number num' }, money(over)),
        h(
          'p',
          null,
          [`Across ${count(providers, 'provider')}.`, unbacked ? `${count(unbacked, 'bill')} no claim backs ${unbacked === 1 ? 'is' : 'are'} not counted in it.` : null, 'Each below has the dates and amounts to read out on the call.'].filter(Boolean).join(' '),
        ),
      )
    : card({}, h('p', null, 'No bill asks for more than the claims say you owe.'));

  const look = asksLess.length
    ? card(
        { title: 'Worth a look' },
        asksLess.map((m) =>
          row({
            route: m.item.event ? eventRoute(m.person.id, m.item.event.event.id) : { name: 'item', person: m.person.id, id: m.item.bill.doc.id },
            title: m.item.bill.provider ?? 'A provider',
            meta: [named ? m.person.name : null, `The bill asks ${money(m.item.claimSays! - m.item.cents)} less than ${saysText(m.item)}. Ask for an itemized bill if you want to be sure.`].filter(Boolean).join(' · '),
            aside: privateChip(m.item.private),
          }),
        ),
      )
    : null;

  // Claims in the last year with a line the plan left out of its totals: explained, nothing to pay for it.
  const since = new Date(Date.parse(`${g.today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const changed = g.all
    .filter((x) => (!who ? !x.private : x.person.id === who) && x.event.start >= since)
    .flatMap((x) => x.event.claims.flatMap((c) => claimLines(c.record).filter((l) => !l.counted).map((l) => ({ x, c, l }))));
  const explained = changed.length
    ? card(
        { title: 'Explained, nothing to do' },
        changed.map(({ x, c, l }) => {
          const insurer = str(c.record.fields.insurer) ?? 'The plan';
          const share = x.money.charges.find((ch) => ch.provider === c.provider)?.share;
          return row({
            route: eventRoute(x.person.id, x.event.id),
            title: `${c.provider ?? 'A provider'}, ${eventWhen(x.event)}`,
            meta: [named ? x.person.name : null, `${insurer} left “${l.label}”${l.amounts.billed ? ` (${formatMoney(l.amounts.billed)})` : ''} out of the claim’s totals${share !== undefined ? `; you owe ${money(share)} for it all` : ''}.`].filter(Boolean).join(' · '),
            aside: privateChip(x.private),
          });
        }),
      )
    : null;

  const back: Child = h('p', { class: 'small' }, link({ name: 'money', ...(who ? { who } : {}) }, 'All bills'));
  return h(
    'div',
    { class: 'stack money' },
    ...head(ctx, route, 'Worth a call', 'Bills that don’t match what the claims say you owe.', who),
    g.loading ? h('p', { class: 'small muted' }, `Still loading the records of ${count(g.loading, 'person', 'people')}.`) : null,
    hero,
    ...asksMore.map((m) => callCard(ctx, m, named)),
    look,
    explained,
    g.kept ? h('p', { class: 'small muted' }, `${count(g.kept, 'private item')} ${g.kept === 1 ? 'is' : 'are'} kept off this shared view. Each shows on its person’s own view.`) : null,
    back,
  );
}

export function moneyView(ctx: Ctx, route: MoneyRoute): HTMLElement {
  const who = route.who && ctx.store.household.people.some((p) => p.id === route.who) ? route.who : undefined;
  return route.view === 'calls' ? callsPage(ctx, route, who) : billsPage(ctx, route, who);
}
