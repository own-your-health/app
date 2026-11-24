// Money. Its landing is the year (moneyYear.ts). Bills sets each
// open bill beside what the claims say you owe, then the shares no bill has
// asked for yet and the bills paid. Worth a call gives each bill that asks
// something else the facts to read out on the phone. Everyone's view is a
// shared screen: private bills stay off it, counted, and show on their
// person's own view.

import { formatMoney } from '../model/records';
import { card, chip, driveLink, kv, link, row, type Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { count, dateText } from '../ui/format';
import type { Route } from '../ui/router';
import { daysBetween } from './needs';
import { eventRoute, eventWhen } from './eventView';
import { callsSummary, type OpenBill, type PaidBill } from './money';
import { forBill, gather, head, keptNote, money, num, privateChip, visitText, type Mine, type MoneyRoute } from './moneyParts';
import { eventsPage, overviewPage } from './moneyYear';
import { called } from '../model/people';

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
    meta: [named ? called(m.person) : null, e ? visitText(e) : null, billWhen(b)].filter(Boolean).join(' · '),
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
  const callsRoute = (bill?: string): Route => ({ name: 'money', view: 'calls', ...(who ? { who } : {}), ...(bill ? { bill } : {}) });

  const hero = card(
    { class: 'money-hero' },
    h('p', { class: 'money-hero-label' }, 'Ready to pay'),
    h('p', { class: 'money-hero-number num' }, money(readyCents)),
    h(
      'p',
      null,
      ready.length ? `${count(ready.length, 'bill')}, each asking what its claim says you owe.` : 'No bill that matches its claim is waiting.',
      check.length ? [' ', link(callsRoute(), `${count(check.length, 'more bill')} ${check.length === 1 ? 'is' : 'are'} worth a call first.`)] : ready.length ? ' None asks for more than the claims say.' : null,
    ),
  );

  const dueNow = ready.length ? card({ title: 'Due now', actions: h('span', { class: 'small muted' }, String(ready.length)) }, ready.map((m) => openRow(ctx, m, g.today, named))) : null;

  const checkCard = check.length
    ? card(
        { title: 'Check before paying', actions: h('span', { class: 'small muted' }, String(check.length)) },
        h('p', { class: 'small muted' }, 'These ask for something other than what the claims say you owe, or no claim backs them.'),
        check.map((m) =>
          row({
            route: callsRoute(m.item.bill.doc.id),
            title: m.item.bill.provider ?? 'A provider',
            meta: [named ? called(m.person) : null, m.item.event ? visitText(m.item.event) : null, `asks ${money(m.item.cents)}; ${saysText(m.item)}`].filter(Boolean).join(' · '),
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
            meta: [named ? called(m.person) : null, visitText(m.item.event)].filter(Boolean).join(' · '),
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
            meta: [named ? called(m.person) : null, m.item.event ? visitText(m.item.event) : billWhen(m.item), `receipt ${dateText(m.item.bill.receipt!.date)}`].filter(Boolean).join(' · '),
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
    keptNote(g.hidden.open.length + g.hidden.unbilled.length + g.hidden.paid, 'Bills'),
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
  const el = card(
    { title: b.bill.provider ?? 'A provider', class: 'call', actions: privateChip(b.private) },
    h('p', { class: 'call-claim' }, b.claimSays === undefined ? `Asks ${money(b.cents)}. No claim in these records is for it.` : `Asks ${money(b.cents)}. The ${b.claimSaysVisit ? 'visit’s claims say' : 'claim says'} ${money(b.claimSays)}.`),
    over !== undefined && over > 0 ? h('p', { class: 'call-number' }, num(over), h('span', null, ' may not be owed')) : null,
    b.claimSays === undefined ? h('p', { class: 'small' }, 'If it went through insurance, its claim may not be in these records yet. If it didn’t, it may not be an insurance bill.') : null,
    kv([
      ['Whose', named ? called(m.person) : null],
      ['Visit', e ? link(eventRoute(m.person.id, e.event.id), visitText(e)) : 'None in these records'],
      ['Statement', [dateText(s?.statement_date ?? b.bill.date), s?.account ? `account ${s.account}` : null, b.bill.due ? `${b.overdue ? 'was due' : 'due'} ${dateText(b.bill.due)}` : null].filter(Boolean).join(' · ')],
      ['The claims say', shares.length ? shares.map((c) => `${money(c.share!)} to ${c.provider}`).join(', ') : b.claimSays === undefined ? null : money(b.claimSays)],
      ['The bill asks', money(b.cents)],
    ]),
    h('div', { class: 'call-script' }, h('p', { class: 'call-script-label' }, 'What to say'), h('p', null, script(b))),
    h('p', { class: 'small muted' }, 'The bill’s phone number isn’t in these records yet; it is on the paper.'),
    h('div', { class: 'bill-links' }, link({ name: 'item', person: m.person.id, id: b.bill.doc.id }, 'The bill'), driveLink(ctx, b.bill.doc.path, 'Open the bill in Drive')),
  );
  return forBill(el, b.bill.doc.id);
}

/** Worth a call: the bills to ask about, with the figures and the words; then those worth a look, and what the plan changed. */
function callsPage(ctx: Ctx, route: MoneyRoute, who: string | undefined): HTMLElement {
  const g = gather(ctx, who);
  const named = !who;
  const sum = callsSummary(g.open, (m) => m.item);
  // What this page would have shown on someone's own view: the bills that don't match, and what the plan changed.
  const left = callsSummary(g.hidden.open, (b) => b);
  const kept = left.asksMore.length + left.asksLess.length + g.hidden.explained;

  const hero = sum.asksMore.length
    ? card(
        { class: 'money-hero' },
        h('p', { class: 'money-hero-label' }, 'May not be owed'),
        h('p', { class: 'money-hero-number num' }, money(sum.overCents)),
        h(
          'p',
          null,
          [`Across ${count(sum.providers, 'provider')}.`, sum.unbacked ? `${count(sum.unbacked, 'bill')} no claim backs ${sum.unbacked === 1 ? 'is' : 'are'} not counted in it.` : null, 'Each below has the dates and amounts to read out on the call.'].filter(Boolean).join(' '),
        ),
      )
    : card({}, h('p', null, 'No bill asks for more than the claims say you owe.'));

  const look = sum.asksLess.length
    ? card(
        { title: 'Worth a look' },
        sum.asksLess.map((m) =>
          forBill(
            row({
              route: m.item.event ? eventRoute(m.person.id, m.item.event.event.id) : { name: 'item', person: m.person.id, id: m.item.bill.doc.id },
              title: m.item.bill.provider ?? 'A provider',
              meta: [named ? called(m.person) : null, `The bill asks ${money(m.item.claimSays! - m.item.cents)} less than ${saysText(m.item)}. Ask for an itemized bill if you want to be sure.`].filter(Boolean).join(' · '),
              aside: privateChip(m.item.private),
            }),
            m.item.bill.doc.id,
          ),
        ),
      )
    : null;

  const explained = g.explained.length
    ? card(
        { title: 'Explained, nothing to do' },
        g.explained.map(({ person, item: x }) =>
          row({
            route: eventRoute(person.id, x.event.event.id),
            title: `${x.provider ?? 'A provider'}, ${eventWhen(x.event.event)}`,
            meta: [named ? called(person) : null, `${x.insurer} left “${x.line.label}”${x.line.amounts.billed ? ` (${formatMoney(x.line.amounts.billed)})` : ''} out of the claim’s totals${x.share !== undefined ? `; you owe ${money(x.share)} for it all` : ''}.`].filter(Boolean).join(' · '),
            aside: privateChip(x.private),
          }),
        ),
      )
    : null;

  const page = h(
    'div',
    { class: 'stack money' },
    ...head(ctx, route, 'Worth a call', 'Bills that don’t match what the claims say you owe.', who),
    g.loading ? h('p', { class: 'small muted' }, `Still loading the records of ${count(g.loading, 'person', 'people')}.`) : null,
    hero,
    ...sum.asksMore.map((m) => callCard(ctx, m, named)),
    look,
    explained,
    keptNote(kept, 'view'),
    h('p', { class: 'small' }, link({ name: 'money', view: 'bills', ...(who ? { who } : {}) }, 'All bills')),
  );
  // A row elsewhere named one bill: mark it, and take the reader and the keyboard to it once the page is in place.
  const picked = route.bill ? page.querySelector<HTMLElement>(`[data-bill="${CSS.escape(route.bill)}"]`) : null;
  if (picked) {
    picked.classList.add('bill-picked');
    picked.tabIndex = -1;
    queueMicrotask(() => picked.focus());
  }
  return page;
}

export function moneyView(ctx: Ctx, route: MoneyRoute): HTMLElement {
  const who = route.who && ctx.store.household.people.some((p) => p.id === route.who) ? route.who : undefined;
  switch (route.view) {
    case 'bills':
      return billsPage(ctx, route, who);
    case 'calls':
      return callsPage(ctx, route, who);
    case 'events':
      return eventsPage(ctx, route, who);
    default:
      return overviewPage(ctx, route, who);
  }
}
