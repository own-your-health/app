// The Calendar screen: a month with a lane per person and the
// month's events listed below it, or every event as one list. A person's
// own calendar shows their private events; the Everyone calendar leaves
// them off unless the household turns that on for this visit to the page.

import type { Person } from '../model/types';
import { button, card, chip, empty, link, type Ctx } from '../ui/components';
import { h, icon } from '../ui/dom';
import { formatMoney, fromCents } from '../model/records';
import { count, dateText, localDay } from '../ui/format';
import { errorsNote } from '../ui/inError';
import { href, type Route } from '../ui/router';
import { barPart, errorsLeft, householdEvents, inMonth, isMonth, listPage, markShape, monthLabel, monthOf, MONTHS, monthWeeks, onDay, shiftMonth, shown, type PersonEvent } from './calendar';
import { doseCount } from './event';
import { areaText, knownArea } from '../model/private';
import { anyLeftOff, heldNotes } from './shared';
import { aheadView } from './aheadView';
import { signInWords } from '../ui/views/sources';
import { eventNumber, eventRoute, headline } from './eventView';
import { called } from '../model/people';

type CalendarRoute = Extract<Route, { name: 'calendar' }>;

// Shown while the calendar stays open: never stored, and hidden again when
// the calendar is left (the app calls hidePrivateEvents) or the page reloads.
let showPrivate = false;

export function hidePrivateEvents(): void {
  showPrivate = false;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Five validated lane colors, one per person in household order; a sixth person on keeps a lane in plain ink. */
const LANE_COLORS = 5;
const laneClass = (lane: number) => (lane < LANE_COLORS ? `lane-${lane}` : 'lane-other');

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const dayLabel = (day: string) => `${WEEKDAYS[weekday(day)]}, ${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
const money = (cents: number) => formatMoney(fromCents(cents)) ?? '';

/** What the events were, by kind, in plain words: "2 visits, 1 day of tests, 1 pharmacy trip". */
function kindsText(events: PersonEvent[]): string {
  const n = (kinds: string[]) => events.filter((x) => kinds.includes(x.event.kind)).length;
  const visits = events.length - n(['tests', 'fill', 'vaccine']);
  const doses = events.filter((x) => x.event.kind === 'vaccine').reduce((sum, x) => sum + doseCount(x.event), 0);
  return [
    visits ? count(visits, 'visit') : null,
    n(['tests']) ? count(n(['tests']), 'day of tests', 'days of tests') : null,
    n(['fill']) ? count(n(['fill']), 'pharmacy trip') : null,
    doses ? count(doses, 'vaccine') : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The events' summed share, from the claims that give one. */
function shareText(events: PersonEvent[]): string | null {
  const shares = events.map((x) => x.money.share).filter((c): c is number => c !== undefined);
  return shares.length ? `your share ${money(shares.reduce((a, b) => a + b, 0))}` : null;
}

/** One event as a row: its day, what it was and where ("Office visit · Example Pediatrics"), whose it is and its one number. `brief` is Home's, a line each. */
function eventRow(x: PersonEvent, opts: { person: boolean; month?: string; brief?: true }): HTMLElement {
  const e = x.event;
  const { title, kind } = headline(e);
  const n = eventNumber(x.money);
  const first = opts.month && monthOf(e.start) !== opts.month ? MONTHS[Number(e.start.slice(5, 7)) - 1]!.slice(0, 3) : WEEKDAYS[weekday(e.start)]!.slice(0, 3);
  return h(
    'div',
    { class: 'row cal-row' },
    h(
      'div',
      { class: 'row-line' },
      h(
        'a',
        { class: 'row-main', href: href(eventRoute(x.person.id, e.id)) },
        h('span', { class: 'cal-when' }, h('span', { class: 'cal-when-top' }, first), h('span', { class: 'cal-when-day' }, String(Number(e.start.slice(8, 10))))),
        h('span', { class: ['cal-row-lane', laneClass(x.lane)], 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'row-body' },
          h('div', { class: 'row-title' }, [title, opts.brief ? null : e.place].filter(Boolean).join(' · ')),
          h('div', { class: 'row-meta' }, [opts.person ? called(x.person) : null, ...(opts.brief ? [e.place ?? kind ?? e.what] : [kind, e.what]), e.end > e.start ? `to ${dateText(e.end)}` : null].filter(Boolean).join(' · ')),
        ),
        h('div', { class: 'row-aside' }, knownArea(x.private) ? chip('Private', 'muted') : null, n ? h('span', { class: 'num' }, n) : null),
        h('span', { class: 'row-chevron' }, icon('next', 18)),
      ),
    ),
  );
}

/** The marks of one person's events on one day, in their lane. */
function laneMarks(events: PersonEvent[], day: string): HTMLElement[] {
  const marks = events.slice(0, 3).map((x) => {
    const shape = markShape(x.event);
    return h('span', { class: ['mark', `mark-${shape}`, shape === 'bar' ? `bar-${barPart(x.event, day)}` : null] });
  });
  return marks;
}

function monthGrid(route: CalendarRoute, month: string, events: PersonEvent[], lanes: Person[], laneOf: Map<string, number>, today: string): HTMLElement {
  const rows = monthWeeks(month).map((week) =>
    h(
      'tr',
      null,
      week.map((day) => {
        const inside = monthOf(day) === month;
        const date = h('span', { class: 'cal-date' }, String(Number(day.slice(8, 10))));
        if (!inside) return h('td', { class: 'cal-out' }, h('span', { class: 'cal-day' }, date));
        const those = onDay(events, day);
        const laneEls = h(
          'span',
          { class: 'cal-lanes', 'aria-hidden': 'true' },
          lanes.map((p) => h('span', { class: ['cal-lane', laneClass(laneOf.get(p.id)!)] }, laneMarks(those.filter((x) => x.person.id === p.id), day))),
        );
        const classes = ['cal-day', day === today ? 'cal-today' : null, day === route.day ? 'cal-selected' : null];
        if (!those.length) return h('td', null, h('span', { class: classes }, date, laneEls));
        const said = those.map((x) => `${lanes.length > 1 ? `${called(x.person)}, ` : ''}${headline(x.event).title}`).join('; ');
        return h(
          'td',
          null,
          h('a', { class: classes, href: href({ ...route, month, day }), 'aria-label': `${dayLabel(day)}: ${said}`, 'aria-current': day === route.day ? 'date' : false }, date, laneEls),
        );
      }),
    ),
  );
  return h(
    'table',
    { class: 'cal-grid' },
    h('caption', { class: 'sr-only' }, `${monthLabel(month)}. A day with care opens its list below.`),
    h('thead', null, h('tr', null, WEEKDAYS.map((d) => h('th', { scope: 'col' }, h('span', { 'aria-hidden': 'true' }, d.slice(0, 1)), h('span', { class: 'sr-only' }, d))))),
    h('tbody', null, rows),
  );
}

function legend(lanes: Person[], laneOf: Map<string, number>): HTMLElement {
  const key = (shape: string, text: string, extra?: string) => h('span', { class: 'cal-key' }, h('span', { class: ['mark', `mark-${shape}`, extra ?? null], 'aria-hidden': 'true' }), text);
  return h(
    'div',
    { class: 'cal-legend small' },
    h('p', { class: 'cal-keys' }, key('dot', 'Visit or tests'), key('ring', 'Pharmacy or vaccine'), key('bar', 'Emergency room or hospital stay', 'bar-one')),
    lanes.length > 1
      ? h(
          'p',
          { class: 'cal-keys' },
          h('span', { class: 'muted' }, 'Lanes, top to bottom:'),
          lanes.map((p) => h('span', { class: ['cal-key', laneClass(laneOf.get(p.id)!)] }, h('span', { class: 'mark mark-dot', 'aria-hidden': 'true' }), called(p))),
        )
      : null,
  );
}

function monthView(route: CalendarRoute, events: PersonEvent[], laneOf: Map<string, number>, people: Person[], today: string, left: boolean): HTMLElement[] {
  const month = isMonth(route.month) ? route.month : monthOf(today);
  const these = inMonth(events, month);
  const lanes = route.who ? people.filter((p) => p.id === route.who) : people.filter((p) => these.some((x) => x.person.id === p.id));
  const nav = (n: number, label: string, iconName: string) => {
    const m = shiftMonth(month, n);
    return h('a', { class: 'icon-button cal-nav', href: href({ name: 'calendar', month: m, ...(route.who ? { who: route.who } : {}) }), 'aria-label': `${label}: ${monthLabel(m)}` }, icon(iconName));
  };
  const earlier = events.find((x) => monthOf(x.event.start) < month);
  const head = h('div', { class: 'cal-head' }, h('h2', null, monthLabel(month)), h('div', { class: 'cal-navs' }, nav(-1, 'Previous month', 'back'), nav(1, 'Next month', 'next')));
  const grid = card({ class: 'cal-month' }, head, monthGrid(route, month, events, lanes.length ? lanes : people.slice(0, 1), laneOf, today), legend(lanes, laneOf));

  const day = route.day && monthOf(route.day) === month ? route.day : undefined;
  const listed = day ? onDay(these, day) : these;
  const monthDays = monthWeeks(month).flat().filter((d) => monthOf(d) === month);
  const days = new Set(these.flatMap((x) => monthDays.filter((d) => x.event.start <= d && d <= x.event.end))).size;
  const summary = these.length ? [`${kindsText(these)} on ${count(days, 'day')}`, shareText(these)].filter(Boolean).join(' · ') : null;
  const list = card(
    { title: day ? dayLabel(day) : `What happened in ${monthLabel(month)}` },
    day ? h('p', { class: 'small' }, link({ name: 'calendar', month, ...(route.who ? { who: route.who } : {}) }, `All of ${monthLabel(month)}`)) : summary ? h('p', { class: 'small muted' }, `${summary}.`) : null,
    listed.length
      ? listed.map((x) => eventRow(x, { person: !route.who, month }))
      : empty(left ? `Nothing to show ${day ? 'on this day' : `in ${monthLabel(month)}`}.` : day ? 'Nothing recorded on this day.' : `Nothing recorded in ${monthLabel(month)}.`),
    !these.length && earlier ? h('p', { class: 'small' }, link({ name: 'calendar', month: monthOf(earlier.event.start), ...(route.who ? { who: route.who } : {}) }, `The latest before it: ${monthLabel(monthOf(earlier.event.start))}`)) : null,
  );
  return [grid, list];
}

function listView(route: CalendarRoute, events: PersonEvent[], left: boolean): HTMLElement[] {
  if (!events.length) return [card({}, empty(left ? 'Nothing to show here.' : 'Nothing recorded yet.'))];
  const { months, earlier } = listPage(events, route.before);
  const page = (before?: string): Route => ({ name: 'calendar', view: 'list', ...(before ? { before } : {}), ...(route.who ? { who: route.who } : {}) });
  return [
    ...(route.before ? [h('p', { class: 'small' }, link(page(), 'Newest months'))] : []),
    ...months.map((m) => {
      const these = events.filter((x) => monthOf(x.event.start) === m);
      return card(
        { title: monthLabel(m) },
        h('p', { class: 'small muted' }, `${[kindsText(these), shareText(these)].filter(Boolean).join(' · ')}.`),
        these.map((x) => eventRow(x, { person: !route.who })),
      );
    }),
    ...(earlier ? [h('p', { class: 'small' }, link(page(earlier), `Earlier months, before ${monthLabel(earlier)}`))] : []),
  ];
}

export function calendarView(ctx: Ctx, route: CalendarRoute): HTMLElement {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const people = store.household.people;
  const who = route.who && people.some((p) => p.id === route.who) ? route.who : undefined;
  const r: CalendarRoute = { ...route, ...(who ? { who } : { who: undefined }) };
  const all = householdEvents(store.household, (id) => store.index(id), today);
  const laneOf = new Map(people.map((p, i) => [p.id, i]));
  const loading = people.filter((p) => !store.index(p.id) && !store.indexErrors.has(p.id)).length;
  const month = isMonth(r.month) ? r.month : monthOf(today);
  // What this view would show with private events: the month's, or the list's.
  const inView = r.view === 'list' ? all : inMonth(all, month);

  const views = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'View' },
    (
      [
        ['Month', undefined],
        ['List', 'list'],
        ['Ahead', 'ahead'],
      ] as const
    ).map(([text, view]) => {
      const on = r.view === view;
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href({ name: 'calendar', ...(view ? { view } : { month: r.month }), ...(who ? { who } : {}) }), 'aria-current': on ? 'page' : false }, text);
    }),
  );
  const whose = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Whose calendar' },
    [{ id: '', name: 'Everyone' }, ...people].map((p) => {
      const on = p.id ? who === p.id : !who;
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href({ name: 'calendar', ...(r.view ? { view: r.view } : { month: r.month }), ...(p.id ? { who: p.id } : {}) }), 'aria-current': on ? 'page' : false }, called(p));
    }),
  );

  // Showing or hiding private events redraws what is below; this says what changed. It is never redrawn itself.
  const said = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const body = h('div', { class: 'stack' });
  const isPrivate = (x: PersonEvent) => !!knownArea(x.private);
  const areas = (xs: PersonEvent[]) => [...new Set(xs.map((x) => areaText(x.private!)))].join(', ').toLowerCase();

  const left = !who && anyLeftOff(ctx.store);
  const draw = (focusToggle = false) => {
    const { events } = shown(all, who, showPrivate);
    const { hidden } = shown(inView, who, showPrivate);
    const privateShown = !who && showPrivate ? inView.filter(isPrivate) : [];
    const toggle = (on: boolean) =>
      button(
        on ? 'Show them' : 'Hide them again',
        () => {
          showPrivate = on;
          const n = inView.filter(isPrivate).length;
          said.textContent = on ? `${count(n, 'private event')} now shown.` : `${count(n, 'private event')} hidden again.`;
          draw(true);
        },
        { small: true },
      );
    const privacy =
      hidden || privateShown.length
        ? h(
            'div',
            { class: 'cal-private' },
            hidden
              ? h('p', null, `${count(hidden, 'private event')} (${areas(inView.filter(isPrivate))}) ${hidden === 1 ? 'is' : 'are'} kept off this shared view. Each shows on its person’s own calendar.`)
              : h('p', null, 'Private events are shown here until you leave the calendar or reload.'),
            h('p', { class: 'small muted' }, 'This is discretion, not security: everyone the Drive folder is shared with can still read those files.'),
            toggle(!!hidden),
          )
        : null;
    const list = () => [...listView(r, events, left), r.before ? null : errorsNote(errorsLeft(people, (id) => store.index(id), who))];
    body.replaceChildren(...[privacy, ...(r.view === 'list' ? list() : monthView(r, events, laneOf, people, today, left))].filter((x): x is HTMLElement => !!x));
    if (focusToggle) body.querySelector<HTMLButtonElement>('.cal-private button')?.focus();
  };
  if (r.view !== 'ahead') draw();

  return h(
    'div',
    { class: 'stack calendar' },
    h('h1', null, 'Calendar'),
    views,
    whose,
    loading ? h('p', { class: 'small muted' }, `Still loading the records of ${count(loading, 'person', 'people')}.`) : null,
    ...(who ? [] : heldNotes(ctx, 'this shared view')),
    said,
    r.view === 'ahead' ? aheadView(ctx, who, signInWords(store.sources(ctx.now()).filter((v) => !who || v.person?.id === who))) : body,
  );
}

/** Home's way into the calendar: the household's latest events, private ones left off. */
export function recentCard(ctx: Ctx, shownCount = 2): HTMLElement {
  const all = householdEvents(ctx.store.household, (id) => ctx.store.index(id), localDay(ctx.now()));
  const { events } = shown(all, undefined, false);
  return card(
    { title: 'Recently' },
    events.length ? events.slice(0, shownCount).map((x) => eventRow(x, { person: true, brief: true })) : empty('Nothing to show here.'),
    h('p', { class: 'card-all' }, link({ name: 'calendar' }, 'Calendar')),
  );
}
