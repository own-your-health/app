// Home: quiet until something needs you. What to do now, the bills, and what
// is coming up, each a few rows at most with the rest one tap away, so its
// length does not grow with how much waits; then where everyone stands and
// what happened recently. Home is a shared screen: anything private stays off
// it, and so does everything of a person's while nothing says which of it is
// private. A person's own Health (vaccines and refills) and Money (bills) list
// the same needs, private ones marked.

import { formatMoney, fromCents } from '../model/records';
import { knownArea, whyHeld } from '../model/private';
import type { Person, PersonIndex } from '../model/types';
import { card, chip, row, type Ctx } from '../ui/components';
import { h, type Child } from '../ui/dom';
import { count, dateText, localDay, monthDayText } from '../ui/format';
import { href, type Route } from '../ui/router';
import { aheadOf, type AheadLine } from './ahead';
import { aheadRow, signInRow } from './aheadView';
import { householdEvents, type PersonEvent } from './calendar';
import { recentCard } from './calendarView';
import { eventRoute, eventWhen } from './eventView';
import { markButton, markNote } from './markPaid';
import { forShared, mayBePaid, openBills, overdueLabel, PAID_ELSEWHERE, partText, worthACall, type OpenBill } from './money';
import { billNotes } from './moneyParts';
import { heldNotes, privateLine } from './shared';
import { daysBetween, type DoseVisit, type Refill, type VaccineNeeds } from './needs';
import { called } from '../model/people';

const money = (cents: number) => formatMoney(fromCents(cents)) ?? '';

/** The rows a card on Home has at most; a bill's are taller. */
export const HOME_ROWS = 3;
export const HOME_BILLS = 2;

type Tone = 'attention' | 'soon';

/** A row of Health's Due: what kind of thing it is above its title, and Private on a person's own page. */
function needRow(kind: string, tone: Tone, opts: { route: Route; title: string; meta: Child; aside?: Child; private?: string }): HTMLElement {
  return row({
    route: opts.route,
    // On a person's own page a row starts after the name: "Runs out about…".
    meta: typeof opts.meta === 'string' ? opts.meta.charAt(0).toUpperCase() + opts.meta.slice(1) : opts.meta,
    class: 'need',
    title: [h('span', { class: ['need-kind', `need-${tone}`] }, kind), h('span', { class: 'need-title' }, opts.title)],
    aside: [knownArea(opts.private) ? chip('Private', 'muted') : null, opts.aside ?? null],
  });
}

const inDays = (days: number) => (days === 0 ? 'Today' : days > 0 ? `In ${count(days, 'day')}` : `${count(-days, 'day')} ago`);

export function vaccinesDueRow(p: Person, v: VaccineNeeds, own: boolean): HTMLElement | null {
  const names = [...v.due.map((d) => `${d.name}, dose ${d.next.dose}`), ...(v.flu ? [`Flu, ${v.flu.season} season`] : [])];
  if (!names.length) return null;
  return needRow(names.length > 1 ? 'Vaccines due' : 'Vaccine due', 'attention', {
    route: { name: 'person', person: p.id, section: 'immunizations' },
    title: names.length > 1 ? count(names.length, 'dose') : names[0]!,
    meta: [...(own ? [] : [called(p)]), ...(names.length > 1 ? [names.join(', '), 'the schedule places them by now, and these records don’t show them'] : ['the schedule places it by now, and these records don’t show it'])].join(' · '),
  });
}

export function visitRow(p: Person, v: DoseVisit, own: boolean): HTMLElement {
  const one = v.doses.length === 1 ? v.doses[0]! : undefined;
  return needRow('Coming up', 'soon', {
    route: { name: 'person', person: p.id, section: 'immunizations' },
    title: one ? `${one.name}, dose ${one.next.dose}` : v.months !== undefined ? `${v.months}-month vaccines` : count(v.doses.length, 'vaccine dose'),
    meta: [own ? null : called(p), `from ${dateText(v.from)}`, one ? one.next.when : v.doses.map((d) => d.name.replace(/ \(.*\)$/, '')).join(', ')].filter(Boolean).join(' · '),
    aside: chip(inDays(v.days), 'muted'),
  });
}

export function refillRow(p: Person, r: Refill, own: boolean): HTMLElement {
  const f = r.medicine.lastFill!;
  return needRow('Refill', r.days < 0 ? 'attention' : 'soon', {
    route: { name: 'item', person: p.id, id: r.medicine.latest.id },
    title: r.medicine.name,
    meta: [own ? null : called(p), `${r.days < 0 ? 'ran' : 'runs'} out about ${dateText(r.runsOut)}`, `${f.daysSupply} days filled ${dateText(f.date)}${f.pharmacy ? ` at ${f.pharmacy}` : ''}`].filter(Boolean).join(' · '),
    aside: chip(inDays(r.days), r.days < 0 ? 'attention' : 'muted'),
    ...(r.private ? { private: r.private } : {}),
  });
}

/** An age in the words a parent uses: days, weeks, months, then years. */
export function ageWords(birth: string, today: string): string | null {
  const days = daysBetween(birth, today);
  if (!(days >= 0)) return null;
  if (days < 14) return `${count(days, 'day')} old`;
  if (days < 61) return `${count(Math.floor(days / 7), 'week')} old`;
  const [y1, m1, d1] = birth.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split('-').map(Number) as [number, number, number];
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return `${months < 24 ? count(months, 'month') : count(Math.floor(months / 12), 'year')} old`;
}

/** A person's bills that may be named on a shared screen. */
interface Owing {
  person: Person;
  idx: PersonIndex;
  bills: OpenBill[];
}

/** One visit's bills, or one bill: a row. */
interface BillGroup {
  person: Person;
  idx: PersonIndex;
  bills: OpenBill[];
  /** Past due first, then those worth a call, then those to pay. */
  rank: number;
  day: string;
}

/** Nothing chases a bill that is marked paid, or that a receipt in the folder may be for. */
const isQuiet = (b: OpenBill) => b.marked || mayBePaid(b);

/** The most urgent first. A bill worth a call has a row of its own; the others of a visit share one. */
export function billGroups(owing: Owing[]): BillGroup[] {
  const groups = owing.flatMap(({ person, idx, bills }) => {
    const by = new Map<string, OpenBill[]>();
    for (const b of bills) {
      if (isQuiet(b)) continue;
      const k = worthACall(b) ? b.bill.doc.id : `${b.event?.event.id ?? b.bill.doc.id}|to pay`;
      by.set(k, [...(by.get(k) ?? []), b]);
    }
    return [...by.values()].map((bs): BillGroup => {
      const due = bs.map((b) => b.bill.due).filter((d): d is string => !!d).sort();
      return { person, idx, bills: bs, rank: bs.some((b) => b.overdue) ? 0 : worthACall(bs[0]!) ? 1 : 2, day: due[0] ?? '9999' };
    });
  });
  return groups.sort((a, b) => a.rank - b.rank || a.day.localeCompare(b.day));
}

const biller = (b: OpenBill) => b.bill.provider ?? 'a provider';

/** A bill's row: what it is above its title, what it asks on the right, and Mark paid once it is past due. */
function billRow(ctx: Ctx, g: BillGroup, today: string): HTMLElement {
  const { person: p, bills: bs } = g;
  const first = bs[0]!;
  const call = worthACall(first);
  const overdue = bs.some((b) => b.overdue);
  const unpaid = bs.every((b) => !b.bill.payments.length);
  const says = first.claimSays === undefined ? 'no claim in these records is for it' : `the ${first.claimSaysVisit ? 'visit’s claims say' : 'claim says'} you owe ${money(first.claimSays)}`;
  const due = g.day === '9999' ? null : `${overdue ? 'was due' : 'due'} ${dayShort(g.day, today)}`;
  const kind = call ? 'Worth a call' : overdue ? overdueLabel(first, unpaid) : bs.length > 1 ? 'Bills to pay' : 'Bill to pay';
  const part = bs.length === 1 ? [partText(first), markNote(ctx, g.idx, first.bill)] : [];
  const meta = call
    ? [called(p), says, ...part, due]
    : [
        called(p),
        ...(bs.length > 1 ? [count(bs.length, 'bill')] : part),
        due,
        bs.length === 1 && first.verdict === 'matches' ? 'matches the claim' : null,
        overdue && unpaid ? PAID_ELSEWHERE : null,
      ];
  // A visit's several bills are marked on its page, each beside its own amount.
  const mark = call || !overdue || bs.length > 1 ? null : markButton(ctx, g.idx, first.bill);
  return row({
    route: call ? { name: 'money', view: 'calls', bill: first.bill.doc.id } : first.event ? eventRoute(p.id, first.event.event.id) : { name: 'item', person: p.id, id: first.bill.doc.id },
    class: mark ? 'need home-bill home-bill-mark' : 'need home-bill',
    title: [
      h('span', { class: ['need-kind', call || overdue ? 'need-attention' : 'need-soon'] }, kind),
      h('span', { class: 'need-title' }, first.event ? `${first.event.event.title}, ${whenShort(first.event.event, today)}` : `Bill from ${biller(first)}`),
    ],
    meta: meta.filter(Boolean).join(' · '),
    aside: h('span', { class: 'num' }, money(bs.reduce((t, b) => t + b.cents, 0))),
    extra: mark ? h('div', { class: 'home-mark' }, mark) : null,
  });
}

const more = (text: string, route: Route, attrs: Record<string, string> = {}): HTMLElement => h('p', { class: 'card-all' }, h('a', { href: href(route), ...attrs }, text));

/** A day, with its year when that is not this one. */
const dayShort = (day: string, today: string): string => (day.slice(0, 4) === today.slice(0, 4) && day.length === 10 ? monthDayText(day) : dateText(day));
const whenShort = (e: PersonEvent['event'], today: string): string => (e.end > e.start ? eventWhen(e) : dayShort(e.start, today));

/** The way to a whole list: "All 4 bills". */
const allOf = (n: number, what: string, one: string): string => (n === 1 ? one : `All ${n} ${what}`);

const headCount = (text: string) => h('span', { class: 'small muted num' }, text);

function billsCard(ctx: Ctx, owing: Owing[], today: string): HTMLElement | null {
  const all = owing.flatMap((o) => o.bills);
  if (!all.length) return null;
  const groups = billGroups(owing);
  const open = all.filter((b) => !isQuiet(b));
  const maybe = all.filter(mayBePaid).length;
  const marked = all.filter((b) => b.marked).length;
  const quiet = [maybe ? `${maybe} may be paid` : null, marked ? `${marked} ${marked === 1 ? 'is' : 'are'} marked paid` : null].filter(Boolean).join(', and ');
  return card(
    { title: 'Bills', class: 'home-bills', actions: open.length ? headCount(`${open.length} · ${money(open.reduce((t, b) => t + b.cents, 0))}`) : null },
    groups.slice(0, HOME_BILLS).map((g) => billRow(ctx, g, today)),
    quiet ? h('p', { class: 'small muted home-quiet' }, `${open.length ? 'Besides, ' : ''}${quiet}.`.replace(/^./, (c) => c.toUpperCase())) : null,
    more(allOf(all.length, 'bills', '1 bill'), { name: 'money', view: 'bills' }, { 'data-mark-rest': '' }),
  );
}

interface Standing {
  person: Person;
  idx?: PersonIndex;
  latest?: PersonEvent;
  bills: OpenBill[];
  ahead: AheadLine[];
  /** Why all their items are held back. */
  held?: string;
}

/** One person's line: their name, their latest visit, and the most urgent thing. */
function standing(s: Standing, today: string, error?: string): HTMLElement {
  const bills = s.bills.filter((b) => !isQuiet(b)).length;
  const now = s.ahead.find((l) => l.now);
  const next = s.ahead.find((l) => !l.now);
  const said = !s.idx ? (error ?? 'Loading…') : s.held ? 'Left off Home' : s.latest ? `Last visit ${dayShort(s.latest.event.start, today)}` : null;
  const tag = now ? chip(now.short, 'attention') : bills ? chip(count(bills, 'bill'), 'muted') : next ? chip(next.short, 'muted') : null;
  return row({
    route: { name: 'health', who: s.person.id },
    class: 'stand',
    title: [h('span', { class: 'stand-name' }, called(s.person)), said ? h('span', { class: 'stand-said' }, said) : null],
    aside: tag,
  });
}

/** Home's first sections: what to do now, the bills, what is coming up, where everyone stands, and what happened recently. */
export function nextHome(ctx: Ctx, signIn: { text: string; route: Route } | undefined): HTMLElement[] {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const all = householdEvents(store.household, (id) => store.index(id), today);
  const owing: Owing[] = [];
  const lines: AheadLine[] = [];
  const stands: HTMLElement[] = [];
  for (const p of store.household.people) {
    const idx = store.index(p.id);
    if (!idx) {
      stands.push(standing({ person: p, bills: [], ahead: [] }, today, store.indexErrors.get(p.id)));
      continue;
    }
    const held = whyHeld(idx);
    const mine = all.filter((x) => x.person.id === p.id);
    const bills = held ? [] : forShared(idx, openBills(idx, mine, today, store.marks));
    const ahead = aheadOf(p, idx, today, false);
    if (bills.length) owing.push({ person: p, idx, bills });
    lines.push(...ahead);
    // A pharmacy fill is not a visit.
    stands.push(standing({ person: p, idx, latest: held ? undefined : mine.find((x) => x.event.kind !== 'fill' && !x.private), bills, ahead, ...(held ? { held } : {}) }, today));
  }
  const bySoonest = (a: AheadLine, b: AheadLine) => a.day.localeCompare(b.day);
  const now = lines.filter((l) => l.now).sort(bySoonest);
  const later = lines.filter((l) => !l.now).sort(bySoonest);
  const ahead: Route = { name: 'calendar', view: 'ahead' };
  const rows = (of: AheadLine[], n: number) => of.slice(0, n).map((l) => aheadRow(l, { person: true, brief: true }));
  const n = now.length + (signIn ? 1 : 0);
  const doNow = n ? card({ title: 'Do now', actions: headCount(String(n)) }, rows(now, HOME_ROWS - (signIn ? 1 : 0)), signIn ? signInRow(signIn) : null, n > HOME_ROWS ? more(`All ${n} to do now`, ahead) : null) : null;
  const bills = billsCard(ctx, owing, today);
  const coming = later.length ? card({ title: 'Coming up', actions: headCount(String(later.length)) }, rows(later, HOME_ROWS), more(allOf(later.length, 'coming up', '1 coming up'), ahead)) : null;
  const quiet = !doNow && !bills && !coming ? card({ title: 'Needs you' }, h('p', null, 'Nothing listed here needs you: no open bill, no vaccine dose due or coming up, and no refill running out.')) : null;
  return [
    doNow,
    bills,
    coming,
    quiet,
    h('div', { class: 'card-notes' }, privateLine('Private items show only on their person’s own pages.'), billNotes(ctx, undefined), heldNotes(ctx, 'Home')),
    card({ title: 'Where everyone stands', class: 'home-stands' }, stands),
    recentCard(ctx),
  ].filter((x): x is HTMLElement => !!x);
}
