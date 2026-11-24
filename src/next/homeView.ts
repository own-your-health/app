// Home under ?next: quiet until something needs you. First what needs you
// (bills worth a call, bills to pay, vaccine doses, refills, doses coming
// up), then where everyone stands, then what happened recently. Home is a
// shared screen: anything private stays off it, counted and not named. A
// person's own overview lists the same needs, private ones marked.

import { formatMoney, fromCents } from '../model/records';
import { SCHEDULE_SOURCE } from '../model/schedule';
import type { Person, PersonIndex } from '../model/types';
import { card, chip, kv, link, row, type Ctx } from '../ui/components';
import { h, type Child } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import type { Route } from '../ui/router';
import { householdEvents, type PersonEvent } from './calendar';
import { recentCard } from './calendarView';
import { eventRoute, eventWhen } from './eventView';
import { openBills, type OpenBill } from './money';
import { daysBetween, refillsDue, vaccineNeeds, type DoseVisit, type Refill, type VaccineNeeds } from './needs';

const money = (cents: number) => formatMoney(fromCents(cents)) ?? '';

type Tone = 'attention' | 'soon';

/** A row of Needs you: what kind of thing it is above its title, and Private on a person's own page. */
function needRow(kind: string, tone: Tone, opts: { route: Route; title: string; meta: Child; aside?: Child; private?: string }): HTMLElement {
  return row({
    route: opts.route,
    // On a person's own page a row starts after the name: "Runs out about…".
    meta: typeof opts.meta === 'string' ? opts.meta.charAt(0).toUpperCase() + opts.meta.slice(1) : opts.meta,
    class: 'need',
    title: [h('span', { class: ['need-kind', `need-${tone}`] }, kind), h('span', { class: 'need-title' }, opts.title)],
    aside: [opts.private ? chip('Private', 'muted') : null, opts.aside ?? null],
  });
}

const visitText = (x: PersonEvent) => `${x.event.title}, ${eventWhen(x.event)}`;
const dueText = (b: OpenBill) => (b.bill.due ? `${b.overdue ? 'was due' : 'due'} ${dateText(b.bill.due)}` : null);

/** A row with the day it sorts by: a bill's due date. */
interface Dated {
  day: string;
  el: HTMLElement;
}

function callRow(p: Person, b: OpenBill, own: boolean): HTMLElement {
  const says =
    b.claimSays === undefined
      ? 'no claim in these records is for it'
      : `the ${b.claimSaysVisit ? 'visit’s claims say' : 'claim says'} you owe ${money(b.claimSays)}`;
  return needRow('Worth a call', 'attention', {
    route: { name: 'money', view: 'calls', bill: b.bill.doc.id, ...(own ? { who: p.id } : {}) },
    title: b.event ? visitText(b.event) : `Bill from ${b.bill.provider}`,
    meta: [own ? null : p.name, `${b.bill.provider} asks ${money(b.cents)}; ${says}`, dueText(b)].filter(Boolean).join(' · '),
    aside: h('span', { class: 'num' }, money(b.cents)),
    ...(b.private ? { private: b.private } : {}),
  });
}

/** One row per visit: its bills that ask what the claims say. */
function payRows(p: Person, bills: OpenBill[], own: boolean): Dated[] {
  const groups = new Map<string, OpenBill[]>();
  for (const b of bills) {
    const k = `${b.event?.event.id ?? b.bill.doc.id}|${b.private ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  return [...groups.values()].map((bs) => {
    const first = bs[0]!;
    const overdue = bs.some((b) => b.overdue);
    const dues = bs.map((b) => b.bill.due).filter((d): d is string => !!d).sort();
    const el = needRow(overdue ? 'No payment on file' : bs.length > 1 ? 'Bills to pay' : 'Bill to pay', overdue ? 'attention' : 'soon', {
      route: first.event ? eventRoute(p.id, first.event.event.id) : { name: 'item', person: p.id, id: first.bill.doc.id },
      title: first.event ? visitText(first.event) : `Bill from ${first.bill.provider}`,
      meta: [
        own ? null : p.name,
        ...bs.map((b) => `${b.bill.provider} ${money(b.cents)}`),
        bs.length === 1 && first.verdict === 'matches' ? 'matches the claim' : null,
        dues[0] ? `${overdue ? 'was due' : 'due'} ${dateText(dues[0])}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      aside: h('span', { class: 'num' }, money(bs.reduce((t, b) => t + b.cents, 0))),
      ...(first.private ? { private: first.private } : {}),
    });
    return { day: dues[0] ?? '9999', el };
  });
}

const inDays = (days: number) => (days === 0 ? 'Today' : days > 0 ? `In ${count(days, 'day')}` : `${count(-days, 'day')} ago`);

function vaccinesDueRow(p: Person, v: VaccineNeeds, own: boolean): HTMLElement | null {
  const names = [...v.due.map((d) => `${d.name}, dose ${d.next.dose}`), ...(v.flu ? [`Flu, ${v.flu.season} season`] : [])];
  if (!names.length) return null;
  return needRow(names.length > 1 ? 'Vaccines due' : 'Vaccine due', 'attention', {
    route: { name: 'person', person: p.id, section: 'immunizations' },
    title: names.length > 1 ? count(names.length, 'dose') : names[0]!,
    meta: [...(own ? [] : [p.name]), ...(names.length > 1 ? [names.join(', '), 'the schedule places them by now, and these records don’t show them'] : ['the schedule places it by now, and these records don’t show it'])].join(' · '),
  });
}

function visitRow(p: Person, v: DoseVisit, own: boolean): HTMLElement {
  const one = v.doses.length === 1 ? v.doses[0]! : undefined;
  return needRow('Coming up', 'soon', {
    route: { name: 'person', person: p.id, section: 'immunizations' },
    title: one ? `${one.name}, dose ${one.next.dose}` : v.months !== undefined ? `${v.months}-month vaccines` : count(v.doses.length, 'vaccine dose'),
    meta: [own ? null : p.name, `from ${dateText(v.from)}`, one ? one.next.when : v.doses.map((d) => d.name.replace(/ \(.*\)$/, '')).join(', ')].filter(Boolean).join(' · '),
    aside: chip(inDays(v.days), 'muted'),
  });
}

function refillRow(p: Person, r: Refill, own: boolean): HTMLElement {
  const f = r.medicine.lastFill!;
  return needRow('Refill', r.days < 0 ? 'attention' : 'soon', {
    route: { name: 'item', person: p.id, id: r.medicine.latest.id },
    title: r.medicine.name,
    meta: [own ? null : p.name, `${r.days < 0 ? 'ran' : 'runs'} out about ${dateText(r.runsOut)}`, `${f.daysSupply} days filled ${dateText(f.date)}${f.pharmacy ? ` at ${f.pharmacy}` : ''}`].filter(Boolean).join(' · '),
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

interface Standing {
  person: Person;
  idx?: PersonIndex;
  latest?: PersonEvent;
  bills: OpenBill[];
  refills: Refill[];
  vaccines?: VaccineNeeds;
}

/** One person's lines: open bills, what comes next, current medicines, the latest visit. */
function standing(s: Standing, today: string, error?: string): HTMLElement {
  const p = s.person;
  const head = h('h3', { class: 'card-sub stand-name' }, link({ name: 'person', person: p.id, section: 'overview' }, p.name));
  if (!s.idx) return h('div', { class: 'stand' }, head, h('p', { class: 'small muted' }, error ?? 'Loading…'));
  const calls = s.bills.filter((b) => b.verdict !== 'matches').length;
  const owed = s.bills.reduce((t, b) => t + b.cents, 0);
  const v = s.vaccines;
  const dueNow = v ? v.due.length + (v.flu ? 1 : 0) : 0;
  const dueNames = v ? [...v.due.map((d) => `${d.name}, dose ${d.next.dose}`), ...(v.flu ? [`Flu, ${v.flu.season} season`] : [])] : [];
  const nexts: { day: string; text: string }[] = [
    ...(dueNow ? [{ day: today, text: dueNow === 1 ? `${dueNames[0]!}, due now` : `${count(dueNow, 'vaccine dose')} due now` }] : []),
    ...(v?.visits[0] ? [{ day: v.visits[0].from, text: `${v.visits[0].doses.length === 1 ? `${v.visits[0].doses[0]!.name}, dose ${v.visits[0].doses[0]!.next.dose}` : v.visits[0].months !== undefined ? `${v.visits[0].months}-month vaccines` : count(v.visits[0].doses.length, 'vaccine dose')} from ${dateText(v.visits[0].from)}` }] : []),
    ...s.refills.map((r) => ({ day: r.runsOut, text: `${r.medicine.name} ${r.days < 0 ? 'ran' : 'runs'} out about ${dateText(r.runsOut)}` })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  return h(
    'div',
    { class: 'stand' },
    head,
    h(
      'p',
      { class: 'small muted' },
      [
        p.birth_date ? ageWords(p.birth_date, today) : null,
        s.latest ? `last visit ${dateText(s.latest.event.start)}${s.latest.event.place ? ` at ${s.latest.event.place}` : ''}` : 'no visits in these records',
      ]
        .filter(Boolean)
        .join(' · '),
    ),
    owed || nexts.length
      ? kv([
          ['To pay', owed ? `${money(owed)} in ${count(s.bills.length, 'bill')}${calls ? `, ${calls} worth a call` : ''}` : null],
          ['Next', nexts[0]?.text ?? null],
        ])
      : h('p', null, 'Nothing due'),
  );
}

interface PersonNeeds {
  calls: Dated[];
  pay: Dated[];
  vaccines: HTMLElement[];
  refills: HTMLElement[];
  soon: HTMLElement[];
  /** Private needs left out. */
  kept: number;
  standing: Standing;
}

/** One person's needs as rows. On their own page (`own`) private ones are in and marked, and rows leave out the name; elsewhere private ones are left out and counted. */
function personNeeds(p: Person, idx: PersonIndex, mine: PersonEvent[], today: string, own: boolean): PersonNeeds {
  const allBills = openBills(idx, mine, today);
  const allRefills = refillsDue(idx, today);
  const bills = own ? allBills : allBills.filter((b) => !b.private);
  const refills = own ? allRefills : allRefills.filter((r) => !r.private);
  const vaccines = vaccineNeeds(p.birth_date, idx, today);
  const vRow = vaccines ? vaccinesDueRow(p, vaccines, own) : null;
  return {
    calls: bills.filter((b) => b.verdict !== 'matches').map((b) => ({ day: b.bill.due ?? '9999', el: callRow(p, b, own) })),
    pay: payRows(p, bills.filter((b) => b.verdict === 'matches'), own),
    vaccines: vRow ? [vRow] : [],
    refills: refills.map((r) => refillRow(p, r, own)),
    soon: (vaccines?.visits ?? []).map((v) => visitRow(p, v, own)),
    kept: allBills.length - bills.length + allRefills.length - refills.length,
    standing: { person: p, idx, latest: mine.find((x) => own || !x.private), bills, refills, ...(vaccines ? { vaccines } : {}) },
  };
}

/** The Needs you card over one or more people's needs (one person's on their own page), with the notes its rows call for. */
function needsCard(all: PersonNeeds[], own?: string): HTMLElement | null {
  const byDay = (k: 'calls' | 'pay') => all.flatMap((n) => n[k]).sort((a, b) => a.day.localeCompare(b.day)).map((x) => x.el);
  const pick = (k: 'vaccines' | 'refills' | 'soon') => all.flatMap((n) => n[k]);
  const [calls, pay, vaccines, refills, soon] = [byDay('calls'), byDay('pay'), pick('vaccines'), pick('refills'), pick('soon')];
  const rows = [...calls, ...pay, ...vaccines, ...refills, ...soon];
  const kept = all.reduce((t, n) => t + n.kept, 0);
  if (!rows.length && own) return null;
  return card(
    { title: 'Needs you', actions: rows.length ? h('span', { class: 'small muted' }, count(rows.length, 'thing')) : null },
    rows.length ? rows : h('p', null, 'Nothing needs you: no open bill, no vaccine dose due or coming up, and no refill running out.'),
    vaccines.length || soon.length
      ? h(
          'p',
          { class: 'small muted' },
          'Vaccines by the ',
          h('a', { href: SCHEDULE_SOURCE.url, target: '_blank', rel: 'noopener noreferrer' }, 'CDC child schedule'),
          ` of ${dateText(SCHEDULE_SOURCE.date)}, restored after a court stayed the January 2026 changes on ${dateText(SCHEDULE_SOURCE.stayed)}. Doses given elsewhere may not be in these records.`,
        )
      : null,
    calls.length || pay.length
      ? h('p', { class: 'small muted' }, 'A bill stays here until a receipt from its provider is filed after it. ', link({ name: 'money', ...(own ? { who: own } : {}) }, 'Bills: each one beside its claim'))
      : null,
    kept ? h('p', { class: 'small muted' }, `${count(kept, 'private item')} ${kept === 1 ? 'is' : 'are'} kept off Home. Each shows on its person’s own overview.`) : null,
  );
}

/** Under ?next, what needs this person, private items included and marked; nothing when nothing does. */
export function personNeedsCard(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement | null {
  const today = localDay(ctx.now());
  const mine = householdEvents(ctx.store.household, (id) => (id === person.id ? idx : undefined), today);
  return needsCard([personNeeds(person, idx, mine, today, true)], person.id);
}

/** Home's first sections under ?next: what needs you, where everyone stands, and what happened recently. */
export function nextHome(ctx: Ctx, signIn: HTMLElement | null): HTMLElement[] {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const all = householdEvents(store.household, (id) => store.index(id), today);
  const needs: PersonNeeds[] = [];
  const stands: HTMLElement[] = [];
  for (const p of store.household.people) {
    const idx = store.index(p.id);
    if (!idx) {
      stands.push(standing({ person: p, bills: [], refills: [] }, today, store.indexErrors.get(p.id)));
      continue;
    }
    const n = personNeeds(p, idx, all.filter((x) => x.person.id === p.id), today, false);
    needs.push(n);
    stands.push(standing(n.standing, today));
  }
  return [needsCard(needs)!, ...(signIn ? [signIn] : []), card({ title: 'Where everyone stands' }, stands), recentCard(ctx)];
}
