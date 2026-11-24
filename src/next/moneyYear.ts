// Money's landing under ?next, the year: what a period's care cost and how
// the price came down, what to do about bills, each person's deductible and
// out-of-pocket limit, the months, and the visits that cost most. Where the
// money went lists every visit of the period, by its network price or by
// your share. Totals and months count everyone's care without naming any;
// the lists that name visits keep private ones off the shared view, counted.

import { householdLines, inPeriod, monthLabel, monthsSpanned, periods, planYearsIn, type CostLine, type Period, type PlanBasis, type PlanYear } from '../model/costs';
import type { MedRecord, Person } from '../model/types';
import { getPlanStart } from '../settings';
import { card, chip, link, row, type Ctx } from '../ui/components';
import { limitMeter, monthChart, stackStrip } from '../ui/costchart';
import { h } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import { href, type Route } from '../ui/router';
import { legend, yearText } from '../ui/views/costs';
import { householdEvents } from './calendar';
import { eventRoute, eventWhen } from './eventView';
import { callsSummary } from './money';
import { gather, head, money, num, privateChip, type MoneyRoute } from './moneyParts';
import { eventCosts, monthMoney, planLimits, yearMoney, type CostOrder, type EventCost, type Limit, type LimitKind } from './year';

/** How many visits the year lists before linking to them all. */
export const BIGGEST = 5;

const PERIOD_WORDS: Record<string, string> = { plan: 'this plan year', 'plan-1': 'last plan year', all: 'every year' };
const periodWords = (p: Period | undefined) => (p ? (PERIOD_WORDS[p.id] ?? p.label) : 'this plan year');
const planPeriod = (p: Period | undefined) => p?.id === 'plan' || p?.id === 'plan-1';
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Each plan's year in a sentence; those the records don't date run by calendar year, said once, with where to set it. */
function planYearsNote(years: { insurer?: string; year: PlanYear; basis: PlanBasis }[]): HTMLElement | null {
  if (!years.length) return null;
  const dated = years.filter((y) => y.basis !== 'calendar');
  const assumed = [...new Set(years.filter((y) => y.basis === 'calendar').map((y) => y.insurer ?? 'A plan'))];
  return h(
    'p',
    { class: 'small muted' },
    dated.length ? `Plan years: ${dated.map((y) => `${y.insurer ?? 'A plan'}, ${yearText(y.year)}${y.basis === 'setting' ? ' (as set in Settings)' : ''}`).join('; ')}. ` : '',
    assumed.length ? [`${andList(assumed)} ${assumed.length === 1 ? 'runs' : 'run'} by calendar year here, because ${assumed.length === 1 ? 'its' : 'their'} records don’t say when the plan year starts. `, link({ name: 'settings' }, 'Set when your plan year starts')] : null,
  );
}

interface YearData {
  today: string;
  people: Person[];
  choices: Period[];
  chosen?: Period;
  /** The chosen period's lines. */
  lines: CostLine[];
  records: Map<string, MedRecord>;
  /** On everyone's view, the claims not to name or date: private ones, and those of a private visit. */
  quiet: Set<string>;
}

/** Everyone's claim lines, or one person's, and the period chosen among those they span. */
function yearData(ctx: Ctx, route: MoneyRoute, who: string | undefined): YearData {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const people = store.household.people.filter((p) => !who || p.id === who);
  const all = householdLines(
    people.map((p) => ({ id: p.id, index: store.index(p.id) })),
    { planStart: getPlanStart() ?? undefined },
  );
  const choices = periods(all, today);
  const chosen = choices.find((p) => p.id === route.period) ?? choices[0];
  const records = new Map(people.flatMap((p) => (store.index(p.id)?.records ?? []).map((r) => [r.id, r] as const)));
  const quiet = new Set<string>();
  if (!who) {
    for (const r of records.values()) if (r.kind === 'claim' && r.private) quiet.add(r.id);
    for (const x of householdEvents(store.household, (p) => store.index(p), today)) if (x.private) for (const c of x.event.claims) quiet.add(c.record.id);
  }
  return { today, people, choices, chosen, lines: chosen ? all.filter((l) => inPeriod(l, chosen.id, today)) : [], records, quiet };
}

/** The periods to choose from, as links that keep the page, the person and the order. */
function yearChips(route: MoneyRoute, d: YearData, who: string | undefined): HTMLElement | null {
  if (d.choices.length < 2) return null;
  return h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Which year' },
    d.choices.map((p) => {
      const on = p.id === d.chosen?.id;
      const to: Route = { name: 'money', ...(route.view ? { view: route.view } : {}), ...(who ? { who } : {}), ...(route.sort ? { sort: route.sort } : {}), ...(p.id === 'plan' ? {} : { period: p.id }) };
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href(to), 'aria-current': on ? 'true' : false }, p.label);
    }),
  );
}

/** The period's care in four figures: what was charged, the network's discount, what the plans paid and your share. */
function heroCard(d: YearData, who: string | undefined): HTMLElement {
  const words = periodWords(d.chosen);
  const y = yearMoney(d.lines);
  if (!y.claims) return card({ class: 'money-hero' }, h('p', null, `No claims in ${words} yet.`));
  const whose = who ? `${d.people[0]?.name ?? 'Their'}’s` : 'The household’s';
  const step = (swatch: string | null, label: string, cents: number | undefined) =>
    cents === undefined ? null : h('div', { class: 'kv-row' }, h('dt', null, swatch ? h('span', { class: ['swatch', swatch], 'aria-hidden': 'true' }) : null, label), h('dd', { class: 'num' }, money(cents)));
  const off = y.charged && y.discount && y.discount > 0 ? Math.round((y.discount / y.charged) * 100) : 0;
  const plans = new Set(d.lines.map((l) => l.insurer ?? '')).size;
  // The dates come from claims the view may name: a private claim's day is not a bound of the range.
  const named = yearMoney(d.lines.filter((l) => !d.quiet.has(l.claim)));
  const span = named.first && named.last ? ` for care between ${dateText(named.first)} and ${dateText(named.last)}` : '';
  return card(
    { class: 'money-hero' },
    h('p', { class: 'money-hero-label' }, `${whose} share of ${words}’s care`),
    h('p', { class: 'money-hero-number num' }, money(y.share ?? 0)),
    h('p', null, `${plans === 1 ? 'The plan’s' : 'The plans’'} figures, from ${count(y.claims, 'claim')}${span}.`),
    // On a track as wide as the charges: what the plans paid, then your share; the empty track is what the network took off.
    y.adds ? stackStrip({ planPaid: y.planPaid!, share: y.share! }, y.charged!) : null,
    h('dl', { class: 'kv money-steps' }, step(null, 'Providers charged', y.charged), step('swatch-track', 'The network took off', y.discount), step('swatch-plan', 'The plans paid', y.planPaid), step('swatch-share', 'Your share', y.share)),
    off ? h('div', { class: 'chips' }, chip(`${off}% off what providers charged`, 'muted')) : null,
    y.adds ? null : h('p', { class: 'small muted' }, 'Some claims leave a figure out, so these don’t add up from one to the next; each claim’s page has its own.'),
    planPeriod(d.chosen) ? planYearsNote(planYearsIn(d.lines)) : null,
  );
}

/** What to do about bills now: those ready to pay, those worth a call, and the shares not billed yet. */
function billsCard(ctx: Ctx, who: string | undefined): { el: HTMLElement; kept: string[] } {
  const g = gather(ctx, who);
  const to = (view: 'bills' | 'calls'): Route => ({ name: 'money', view, ...(who ? { who } : {}) });
  const ready = g.open.filter((m) => m.item.verdict === 'matches');
  const readyCents = ready.reduce((t, m) => t + m.item.cents, 0);
  const late = ready.filter((m) => m.item.overdue).length;
  const calls = callsSummary(g.open, (m) => m.item);
  const unbilled = g.unbilled.reduce((t, m) => t + m.item.cents, 0);
  const rows = [
    ready.length
      ? row({ route: to('bills'), title: `${count(ready.length, 'bill')} ready to pay`, meta: `They match their claims.${late ? ` ${late === 1 ? (ready.length === 1 ? 'It is' : 'One is') : `${late} are`} past due.` : ''}`, aside: num(readyCents) })
      : null,
    calls.asksMore.length
      ? row({
          route: to('calls'),
          title: `${count(calls.asksMore.length, 'bill')} worth a call`,
          meta: [calls.overCents ? `${money(calls.overCents)} may not be owed.` : null, calls.unbacked ? `${count(calls.unbacked, 'bill')} no claim backs.` : null].filter(Boolean).join(' '),
          aside: calls.overCents ? num(calls.overCents) : null,
        })
      : null,
    g.unbilled.length ? row({ route: to('bills'), title: 'Not billed yet', meta: 'What the claims say you owe, with no bill or receipt yet.', aside: num(unbilled) }) : null,
  ];
  return {
    el: card({ title: 'Bills' }, rows.some(Boolean) ? rows : h('p', null, 'No open bills.'), h('p', { class: 'small' }, link(to('bills'), 'All bills, beside their claims'))),
    // What the rows left off: a private visit once, however many of its bills and shares; a bill with no visit by itself.
    kept: [...g.hidden.open.map((b) => b.event?.event.id ?? b.bill.doc.id), ...g.hidden.unbilled.map((u) => u.event.event.id)],
  };
}

const LIMIT_WORDS: Record<LimitKind, { title: string; what: string }> = {
  deductible: { title: 'Deductible', what: 'What you pay for some care before the plan starts paying its part.' },
  out_of_pocket: { title: 'Out-of-pocket limit', what: 'The most you pay for covered care in a plan year. After it, the plan pays all of it.' },
};

function limitRow(l: Limit, p: Person, who: string | undefined, scoped: boolean, quiet: Set<string>): HTMLElement {
  const met = l.used >= l.limit;
  // A private claim is neither dated nor linked on a shared view.
  const source = quiet.has(l.claim) ? ['As of their plan’s newest claim.'] : ['As of ', link({ name: 'item', person: l.person, id: l.claim }, `the claim for ${dateText(l.asOf)}`), '.'];
  const metText = l.metOn && !(l.metClaim && quiet.has(l.metClaim)) ? `Met with the claim for ${dateText(l.metOn)}` : 'Met';
  const claims = l.fromClaims === undefined || l.fromClaims === l.used ? '' : l.fromClaims ? ` Claims in these records account for ${money(l.fromClaims)} of it.` : ' None of it comes from claims in these records.';
  return row({
    title: who ? capital(l.scope || 'Your plan') : p.name,
    meta: !who && scoped ? capital(l.scope) : null,
    aside: h('span', { class: 'num' }, `${money(l.used)} of ${money(l.limit)}`),
    extra: h(
      'div',
      { class: 'limit-line' },
      limitMeter(l.used, l.limit),
      met ? h('div', { class: 'chips' }, chip(metText, 'ok')) : null,
      h('p', { class: 'small muted' }, met ? '' : `${money(l.limit - l.used)} to go. `, ...source, claims),
    ),
  });
}

/** Each person's deductible, or out-of-pocket limit, as their plan printed it; who has none in these records, and why. */
function limitCard(kind: LimitKind, d: YearData, limits: Limit[], who: string | undefined): HTMLElement {
  const words = periodWords(d.chosen);
  const these = limits.filter((l) => l.kind === kind);
  const scopes = [...new Set(these.map((l) => l.scope))];
  const shared = scopes.length === 1 && scopes[0] ? ` ${capital(scopes[0])}, as each plan printed it on its newest claim.` : ' As each plan printed it on its newest claim.';
  return card(
    { title: LIMIT_WORDS[kind].title },
    h('p', { class: 'small muted' }, LIMIT_WORDS[kind].what, these.length ? shared : ''),
    d.people.flatMap((p) => {
      const mine = these.filter((l) => l.person === p.id);
      if (mine.length) return mine.map((l) => limitRow(l, p, who, scopes.length > 1, d.quiet));
      const lines = d.lines.filter((l) => l.person === p.id);
      const toward = kind === 'deductible' ? lines.reduce((t, l) => t + (l.cents.deductible ?? 0), 0) : 0;
      const meta = lines.length
        ? `${who ? 'The' : 'Their'} plan’s limit isn’t in these records yet.${toward ? ` ${who ? 'The' : 'Their'} claims put ${money(toward)} toward a deductible.` : ''}`
        : `No claims in ${words} yet.`;
      return [row({ title: who ? 'Not in these records yet' : p.name, meta })];
    }),
  );
}

/** What the plans paid and your share, month by month, each month a link to it in the calendar. */
function monthsCard(d: YearData, who: string | undefined): HTMLElement | null {
  if (!d.chosen || !d.lines.length) return null;
  const months = monthMoney(d.lines, monthsSpanned(d.lines, d.chosen.id, d.today)).map((m) => ({ ...m, label: monthLabel(m.ym) }));
  const chart = monthChart(months, (ym) => ({ name: 'calendar', month: ym, ...(who ? { who } : {}) }), 'Open the month in the calendar.');
  if (!chart) return null;
  return card(
    { title: 'When the money happened' },
    legend([
      ['swatch-plan', 'The plans paid'],
      ['swatch-share', 'Your share'],
    ]),
    h('div', { class: 'chart-box' }, chart),
    h(
      'details',
      { class: 'cost-table' },
      h('summary', null, 'The months as a table'),
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Month'), h('th', { scope: 'col', class: 'num' }, 'The plans paid'), h('th', { scope: 'col', class: 'num' }, 'Your share'))),
        h(
          'tbody',
          null,
          months.map((m) => h('tr', null, h('td', null, m.label), h('td', { class: 'num' }, money(m.planPaid)), h('td', { class: 'num' }, money(m.share)))),
        ),
      ),
    ),
  );
}

/** The period's visits by cost: everyone's leave private ones off, counted. */
function costsOf(ctx: Ctx, d: YearData, who: string | undefined, order: CostOrder): { shown: EventCost[]; kept: string[] } {
  const store = ctx.store;
  const events = householdEvents(store.household, (id) => store.index(id), d.today).filter((x) => !who || x.person.id === who);
  const all = d.chosen ? eventCosts(events, d.lines, d.chosen.id, order) : [];
  const shown = who ? all : all.filter((c) => !c.event.private);
  return { shown, kept: all.filter((c) => c.event.private).map((c) => c.event.event.id) };
}

function costRow(c: EventCost, max: number, who: string | undefined, order: CostOrder): HTMLElement {
  const x = c.event;
  return row({
    route: eventRoute(x.person.id, x.event.id),
    title: x.event.title,
    meta: [eventWhen(x.event), x.event.place, who ? null : x.person.name].filter(Boolean).join(' · '),
    aside: num(order === 'share' ? c.share : c.price),
    extra: h('div', { class: 'cost-row-strip' }, stackStrip({ planPaid: c.planPaid, share: c.share }, max), privateChip(x.private)),
  });
}

const PRICE_NOTE = 'Network price: what the plan agreed to pay the provider, its part and yours.';
const costLegend = () =>
  legend([
    ['swatch-plan', 'The plan paid'],
    ['swatch-share', 'Your share'],
  ]);

/** "Totals and months count everyone's care without naming any. 1 private item is kept off the lists on this shared view. …", each item once. */
function privateNote(keys: string[]): HTMLElement | null {
  const kept = new Set(keys).size;
  return kept
    ? h('p', { class: 'small muted' }, `Totals and months count everyone’s care without naming any. ${count(kept, 'private item')} ${kept === 1 ? 'is' : 'are'} kept off the lists on this shared view. Each shows on its person’s own Money.`)
    : null;
}

/** Money's landing: the year. */
export function overviewPage(ctx: Ctx, route: MoneyRoute, who: string | undefined): HTMLElement {
  const d = yearData(ctx, route, who);
  const bills = billsCard(ctx, who);
  const limits = planPeriod(d.chosen) ? planLimits(d.lines, d.records) : [];
  const costs = costsOf(ctx, d, who, 'price');
  const top = costs.shown.slice(0, BIGGEST);
  const max = Math.max(0, ...top.map((c) => c.price));
  const eventsRoute: Route = { name: 'money', view: 'events', ...(who ? { who } : {}), ...(route.period ? { period: route.period } : {}) };
  const explorer: Route = { name: 'costs', ...(d.chosen ? { period: d.chosen.id } : {}), ...(who ? { only: [{ by: 'person' as const, key: who }] } : {}) };
  return h(
    'div',
    { class: 'stack money' },
    ...head(ctx, route, 'Money', 'What care cost, and what is left to do.', who),
    yearChips(route, d, who),
    heroCard(d, who),
    bills.el,
    d.lines.length
      ? planPeriod(d.chosen)
        ? [limitCard('deductible', d, limits, who), limitCard('out_of_pocket', d, limits, who)]
        : h('p', { class: 'small muted' }, 'Deductibles and out-of-pocket limits run by plan year. Choose this plan year or last to see them.')
      : null,
    monthsCard(d, who),
    top.length
      ? card(
          { title: 'Biggest costs' },
          costLegend(),
          top.map((c) => costRow(c, max, who, 'price')),
          h('p', { class: 'small muted' }, PRICE_NOTE),
          h('p', { class: 'small' }, link(eventsRoute, `Where the money went: all ${costs.shown.length}, by price or by your share`)),
        )
      : null,
    privateNote(who ? [] : [...bills.kept, ...costs.kept]),
    h('p', { class: 'small' }, link(explorer, 'Every claim, by provider, kind of care and month')),
  );
}

/** Where the money went: every visit of the period, by network price or by your share; fills paid at the counter as one line. */
export function eventsPage(ctx: Ctx, route: MoneyRoute, who: string | undefined): HTMLElement {
  const d = yearData(ctx, route, who);
  const order: CostOrder = route.sort === 'share' ? 'share' : 'price';
  const costs = costsOf(ctx, d, who, order);
  const visits = costs.shown.filter((c) => !c.fill);
  const fills = costs.shown.filter((c) => c.fill);
  const fillSum = { price: fills.reduce((t, c) => t + c.price, 0), planPaid: fills.reduce((t, c) => t + c.planPaid, 0), share: fills.reduce((t, c) => t + c.share, 0) };
  const key = (c: { price: number; share: number }) => (order === 'share' ? c.share : c.price);
  const max = Math.max(0, ...visits.map((c) => c.price), fills.length ? fillSum.price : 0);
  const sortChips = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Order by' },
    (['price', 'share'] as const).map((o) => {
      const on = o === order;
      const to: Route = { name: 'money', view: 'events', ...(who ? { who } : {}), ...(route.period ? { period: route.period } : {}), ...(o === 'share' ? { sort: 'share' as const } : {}) };
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href(to), 'aria-current': on ? 'true' : false }, o === 'share' ? 'Your share' : 'Network price');
    }),
  );
  const pharmacies = [...new Set(fills.map((c) => c.event.event.place).filter(Boolean))];
  const fillRow = fills.length
    ? row({
        title: count(fills.length, 'prescription fill'),
        meta: [pharmacies.join(', '), 'paid at the counter'].filter(Boolean).join(' · '),
        aside: num(key(fillSum)),
        extra: h('div', { class: 'cost-row-strip' }, stackStrip(fillSum, max)),
      })
    : null;
  return h(
    'div',
    { class: 'stack money' },
    ...head(ctx, route, 'Where the money went', `${capital(periodWords(d.chosen))}’s care, visit by visit.`, who),
    yearChips(route, d, who),
    sortChips,
    visits.length || fills.length
      ? card({ class: 'money-events' }, costLegend(), visits.map((c) => costRow(c, max, who, order)), fillRow, h('p', { class: 'small muted' }, PRICE_NOTE))
      : card({}, h('p', null, `No visits with a price in ${periodWords(d.chosen)}.`)),
    privateNote(who ? [] : costs.kept),
  );
}

/** Home's glance at Money under ?next: the household's share this plan year. */
export function moneyGlance(ctx: Ctx): HTMLElement | null {
  const d = yearData(ctx, { name: 'money' }, undefined);
  if (!d.choices.length) return null;
  const y = yearMoney(d.lines);
  return card(
    { title: 'Money' },
    y.claims ? h('p', { class: 'glance-answer' }, `${money(y.share ?? 0)} your share ${periodWords(d.chosen)}`) : h('p', null, 'No claims yet this plan year.'),
    h('p', { class: 'small' }, link({ name: 'money' }, 'The year, the bills and the biggest costs')),
  );
}
