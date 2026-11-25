// A provider's page: what these records hold of one provider, newest first,
// for one person or everyone. It opens from any item that prints the name, so
// its address holds none. Everyone's page leaves private items off, and its
// words are the same whether or not there are any.

import { claimCents } from '../model/claims';
import { isOutOfRange, resultFlag } from '../model/flags';
import { called } from '../model/people';
import type { ProviderField } from '../model/providers';
import { docTypeLabel, documentTitle, formatMoney, resultPoint, resultReading, studyTitle } from '../model/records';
import { unitText } from '../model/result';
import { recordTitle } from '../model/titles';
import type { MedRecord, PersonIndex } from '../model/types';
import { button, card, chip, empty, flagChip, link, row, type Ctx } from '../ui/components';
import { h, icon, type Child } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import { href, type Route } from '../ui/router';
import { eventRoute, eventWhen, headline } from './eventView';
import { mayBePaid, paidText, partText, unreadText } from './money';
import { money, privateChip } from './moneyParts';
import { providerPage, type Alike, type Mine, type ProviderPage, type Seen, type Visit } from './provider';
import { namedOn, placeNamed, type Named } from './providerNames';
import { heldNotes, privateLine } from './shared';
import type { CareEvent } from './event';

type ProviderRoute = Extract<Route, { name: 'provider' }>;

const SHOWN = 3;

/** The page of the provider an item names. */
export const providerRoute = (n: Pick<Named, 'person' | 'id' | 'field'>, all = false): Route => ({ name: 'provider', person: n.person, id: n.id, field: n.field, ...(all ? { all: true as const } : {}) });

/**
 * A provider's name as a link to its page, from the first of the fields that
 * prints it; the words alone where none does. From a screen the household
 * shares it opens everyone's page, which holds no private item.
 */
export function providerLink(ctx: Ctx, idx: PersonIndex | undefined, id: string, fields: ProviderField[], text: string | undefined, shared = false): Child {
  const named = idx && fields.map((f) => namedOn(idx, ctx.store.household, id, f)).find(Boolean);
  return text && named ? link(providerRoute(named, shared), text) : text;
}

/** An event's place, as a link to its provider's page where one of its items prints it. */
export function placeLink(ctx: Ctx, idx: PersonIndex, e: CareEvent): Child {
  const named = placeNamed(idx, ctx.store.household, e);
  return e.place && named ? link(providerRoute(named), e.place) : e.place;
}

/** The first few rows, and the rest on a tap. */
function list<T>(what: string, items: T[], render: (x: T) => HTMLElement): HTMLElement {
  const box = h('div');
  const draw = (n: number) => {
    const rest = items.length > n ? h('div', { class: 'cost-actions' }, button(`Show all ${items.length} ${what}`, () => {
      draw(items.length);
      box.querySelectorAll<HTMLElement>('.row')[n]?.querySelector<HTMLElement>('a')?.focus();
    }, { small: true })) : null;
    box.replaceChildren(...items.slice(0, n).map(render), ...(rest ? [rest] : []));
  };
  // One more row is as short as the button that would show it.
  draw(items.length <= SHOWN + 1 ? items.length : SHOWN);
  return box;
}

function section<T>(title: string, what: string, items: T[], render: (x: T) => HTMLElement, note?: string): HTMLElement | null {
  if (!items.length) return null;
  return card({ title, actions: h('span', { class: 'small muted num' }, String(items.length)) }, note ? h('p', { class: 'small muted' }, note) : null, list(what, items, render));
}

const ITEM: Record<string, [string, string]> = {
  claim: ['claim', 'claims'],
  encounter: ['visit record', 'visit records'],
  medication: ['medicine record', 'medicine records'],
  immunization: ['vaccine', 'vaccines'],
  procedure: ['procedure', 'procedures'],
  study: ['imaging study', 'imaging studies'],
  document: ['paper', 'papers'],
};

/** Medicines by name, each person's apart: the newest record of each, and how many there are. */
function medicinesOf(all: Mine<MedRecord>[]): (Mine<MedRecord> & { n: number })[] {
  const by = new Map<string, Mine<MedRecord> & { n: number }>();
  for (const x of all) {
    const key = `${x.person}|${recordTitle(x.item).toLowerCase()}`;
    const held = by.get(key);
    if (held) {
      held.n += 1;
      // One row of several records is marked when any is private.
      if (!held.private && x.private) held.private = x.private;
    }
    else by.set(key, { ...x, n: 1 });
  }
  return [...by.values()];
}

/** What it charged and what came of it, in the words of the claims and the bills. */
function totalsCard(p: ProviderPage): HTMLElement | null {
  const figures = (
    [
      ['Charged', p.charged],
      ['Plan paid', p.planPaid],
      ['Your share', p.share],
      ['Still open', p.open],
      ['Not billed yet', p.unbilled],
    ] as const
  ).flatMap(([label, cents]) => (cents === undefined ? [] : [h('div', { class: 'event-step' }, h('span', null, label), h('span', { class: 'num' }, money(cents)))]));
  if (!figures.length) return null;
  const says = [
    p.claims.length ? `Charged, plan paid and your share are what ${p.claims.length === 1 ? 'the claim below says' : `the ${count(p.claims.length, 'claim')} below say`}.` : null,
    p.open !== undefined ? 'Still open leaves out a bill marked paid, and one whose receipt could not be read.' : null,
  ];
  return card({ title: 'In all' }, h('div', { class: 'event-ladder' }, figures), h('p', { class: 'small muted' }, says.filter(Boolean).join(' ')));
}

export function providerView(ctx: Ctx, route: ProviderRoute): HTMLElement {
  const { store } = ctx;
  const everyone = !!route.all;
  const person = store.person(route.person);
  const back = h('p', null, everyone || !person ? link({ name: 'health' }, icon('back', 16), ' Health') : link({ name: 'health', who: person.id }, icon('back', 16), ` ${called(person)}`));
  const loading = store.household.people.filter((p) => (everyone || p.id === route.person) && !store.index(p.id) && !store.indexErrors.has(p.id)).length;
  const wait = loading ? h('p', { class: 'small muted' }, `Still loading the records of ${count(loading, 'person', 'people')}.`) : null;
  const notes = everyone ? [privateLine('Private items are never listed here. Each shows on its person’s own pages.'), ...heldNotes(ctx, 'this page')] : [];
  const page = providerPage({ household: store.household, indexes: store.indexes, today: localDay(ctx.now()), marks: store.marks }, route, everyone);
  if (!page) return h('div', { class: 'stack' }, back, card({}, wait ?? empty('No provider to show here is named by this item.')), notes);

  const name = (id: string) => (store.person(id) ? called(store.person(id)!) : 'Someone');
  const whose = (id: string) => (everyone ? name(id) : null);
  const meta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
  const item = (id: string, of: string): Route => ({ name: 'item', person: id, id: of });
  const priv = (x: { private?: string }) => privateChip(x.private);
  const num = (cents: number) => h('span', { class: 'num' }, money(cents));
  const owed = (cents: number | undefined) => (cents === undefined ? null : h('span', { class: 'num' }, cents === 0 ? 'Nothing to pay' : money(cents)));

  const claimRow = (x: Mine<MedRecord>) => row({ route: item(x.person, x.item.id), title: recordTitle(x.item), meta: meta(dateText(x.item.date), whose(x.person)), aside: [priv(x), owed(claimCents(x.item).youOwe)] });
  const recordRow = (x: Mine<MedRecord>) => row({ route: item(x.person, x.item.id), title: recordTitle(x.item), meta: meta(dateText(x.item.date), whose(x.person)), aside: priv(x) });
  const testRow = (x: Mine<MedRecord>) => {
    const reading = x.item.kind === 'result' ? resultReading(x.item.fields).text : undefined;
    const flag = x.item.kind === 'result' ? resultFlag(resultPoint(x.item)) : undefined;
    return row({ route: item(x.person, x.item.id), title: recordTitle(x.item), meta: meta(dateText(x.item.date), reading ? (unitText(reading) ?? reading) : null, whose(x.person)), aside: [priv(x), isOutOfRange(flag) ? flagChip(flag) : null] });
  };
  const visitRow = (v: Visit) => {
    const { event: x, share } = v;
    const { title, kind } = headline(x.event);
    const elsewhere = x.event.place && x.event.place !== page.named.name && !page.also.includes(x.event.place) ? x.event.place : null;
    return row({ route: eventRoute(x.person.id, x.event.id), title, meta: meta(kind, eventWhen(x.event), elsewhere, whose(x.person.id), x.event.what), aside: [priv(v), owed(share)] });
  };
  const billRow = (x: ProviderPage['bills'][number]) => {
    const { person: id, item: { bill, open } } = x;
    return row({
      route: item(id, bill.doc.id),
      title: `Bill from ${bill.provider ?? 'a provider'}`,
      meta: meta(dateText(bill.date), whose(id), bill.settled ? paidText(bill) : null, open ? partText(open) : null, open?.overdue && bill.due ? `was due ${dateText(bill.due)}` : open && bill.due ? `due ${dateText(bill.due)}` : null, unreadText(bill.unread), open?.marked ? 'marked paid, waiting for the Mac' : null, !bill.settled && bill.replacedBy ? 'a later statement has its balance' : null),
      aside: [priv(x), open && !open.marked && !mayBePaid(open) ? num(open.cents) : bill.amount ? h('span', { class: 'num muted' }, formatMoney(bill.amount)) : null],
    });
  };
  const paperRow = (x: ProviderPage['papers'][number]) => row({ route: item(x.person, x.item.id), title: documentTitle(x.item), meta: meta(docTypeLabel(x.item.doc_type), dateText(x.item.date), x.item.doc_type === 'receipt' && x.item.statement?.amount_paid ? `${formatMoney(x.item.statement.amount_paid)} paid` : null, whose(x.person)), aside: priv(x) });
  const studyRow = (x: ProviderPage['studies'][number]) => row({ route: item(x.person, x.item.id), title: studyTitle(x.item), meta: meta(dateText(x.item.date), whose(x.person)), aside: priv(x) });
  const seenRow = (s: Seen) => row({ route: providerRoute(s.named, everyone), title: s.named.name, meta: count(s.visits, 'visit') });
  const alikeRow = (a: Alike) => row({ route: providerRoute(a.named, everyone), title: a.names.join(', '), meta: meta(everyone && a.people.map(name).join(', '), ...a.items.map(({ kind, n }) => count(n, ...(ITEM[kind] ?? ['record', 'records']))), `${a.from.length === 1 ? 'source' : 'sources'}: ${a.from.join(', ')}`) });

  const choice = (on: boolean, to: Route, text: string) => h('a', { class: ['filter', on ? 'filter-on' : null], href: href(to), 'aria-current': on ? 'page' : false }, text);
  const everyones = everyone ? page.named : page.everyone;
  const period = page.first && page.last ? (page.first === page.last ? dateText(page.first) : `${dateText(page.first)} to ${dateText(page.last)}`) : null;
  return h(
    'div',
    { class: 'stack provider' },
    back,
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'event-kind small muted' }, 'Provider'),
      h('div', { class: 'card-head' }, h('h1', null, page.named.name)),
      period ? h('p', { class: 'muted' }, period) : null,
      h('p', { class: 'small muted' }, `${page.from.length === 1 ? 'Source' : 'Sources'}: ${page.from.join(', ')}.${page.also.length ? ` Also printed as ${page.also.join(', ')}.` : ''}`),
      page.private ? h('p', { class: 'event-private small' }, chip('Private', 'muted'), ' Private items are marked. Everyone’s page leaves them off.') : null,
      h(
        'div',
        { class: 'chips', role: 'group', 'aria-label': 'Whose records' },
        everyones ? choice(everyone, providerRoute(everyones, true), 'Everyone') : null,
        everyone ? page.whose.map((n) => choice(false, providerRoute(n), name(n.person))) : choice(true, route, name(route.person)),
      ),
    ),
    wait,
    totalsCard(page),
    section('Visits', 'visits', page.visits, visitRow, page.claims.length ? 'An amount is what this provider’s own claims say you owe for the visit.' : undefined),
    section('Visits its papers are with', 'visits', page.paperVisits, visitRow),
    section('Bills and payments', 'bills', page.bills, billRow),
    section('Receipts', 'receipts', page.receipts, paperRow, 'Payments for none of the bills above.'),
    section('Claims', 'claims', page.claims, claimRow),
    section('Claims others billed for care there', 'claims', page.placeOf, claimRow, 'In none of the amounts above.'),
    section('Tests', 'tests', page.tests, testRow, 'From these claims, and from visits with no other provider.'),
    section('Imaging', 'studies', page.studies, studyRow),
    section('Medicines', 'medicines', medicinesOf(page.medicines), (x) => row({ route: item(x.person, x.item.id), title: recordTitle(x.item), meta: meta(x.n > 1 ? `${count(x.n, 'record')}, the last ${dateText(x.item.date)}` : dateText(x.item.date), whose(x.person)), aside: priv(x) })),
    section('Vaccines', 'vaccines', page.vaccines, recordRow),
    section('Procedures', 'procedures', page.procedures, recordRow),
    section('Papers', 'papers', page.papers, paperRow),
    section('People seen', 'people', page.people, seenRow, 'Named by the visits here.'),
    section('Places', 'places', page.places, seenRow, 'Named by the visits here.'),
    section('May be the same', 'names', page.alike, alikeRow, 'Names like this one that nothing in these records says are the same provider. None of theirs is on this page.'),
    h('p', { class: 'small muted' }, 'Names are taken as one provider when the records give one National Provider Identifier for them, or one source of one person’s prints the same name. Names that are only alike are never put together.'),
    notes,
  );
}
