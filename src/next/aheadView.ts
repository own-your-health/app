// The calendar's Ahead: what is due, then what is coming up, by month, for
// everyone or one person. Everyone's leaves private items off; a person's own
// has theirs, marked.

import { called } from '../model/people';
import { knownArea } from '../model/private';
import { COMING_UP_DAYS, SCHEDULE_SOURCE } from '../model/schedule';
import { card, chip, empty, row, type Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { dateText, localDay } from '../ui/format';
import type { Route } from '../ui/router';
import { aheadAll, type AheadLine } from './ahead';
import { monthLabel, monthOf } from './calendar';
import { REFILL_DAYS } from './needs';
import { privateLine } from './shared';

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** One line of what is ahead. `brief` is Home's, held to a few lines of text. */
export function aheadRow(l: AheadLine, opts: { person: boolean; brief?: true }): HTMLElement {
  const said = opts.brief ? l.brief : l.text;
  return row({
    route: l.route,
    class: 'ahead',
    title: l.title,
    meta: opts.person ? `${called(l.person)} · ${said}` : capital(said),
    aside: [knownArea(l.private) ? chip('Private', 'muted') : null, chip(l.tag, l.late ? 'attention' : 'muted')],
  });
}

/** The sign-ins only a person can make, as a line: what medrec asks for, where it is made and where it leads. */
export const signInRow = (words: { text: string; route: Route }): HTMLElement => row({ route: words.route, class: 'signin-notice', title: words.text, meta: 'On the Mac' });

/** Which schedule the doses are by. */
export const scheduleNote = (): HTMLElement =>
  h(
    'p',
    { class: 'small muted' },
    'Vaccines by the ',
    h('a', { href: SCHEDULE_SOURCE.url, target: '_blank', rel: 'noopener noreferrer' }, 'CDC child schedule'),
    ` of ${dateText(SCHEDULE_SOURCE.date)}, restored after a court stayed the January 2026 changes on ${dateText(SCHEDULE_SOURCE.stayed)}. Doses given elsewhere may not be in these records.`,
  );

export function aheadView(ctx: Ctx, who: string | undefined, signIn: { text: string; route: Route } | undefined): HTMLElement[] {
  const store = ctx.store;
  const today = localDay(ctx.now());
  const lines = aheadAll(store.household.people, (id) => store.index(id), today, who);
  const now = lines.filter((l) => l.now);
  const later = lines.filter((l) => !l.now);
  const n = (of: unknown[]) => h('span', { class: 'small muted' }, String(of.length));
  const due = [...now.map((l) => aheadRow(l, { person: !who })), ...(signIn ? [signInRow(signIn)] : [])];
  const months = [...new Set(later.map((l) => monthOf(l.day)))];
  return [
    ...(due.length ? [card({ title: 'Do now', actions: n(due) }, due)] : []),
    ...months.map((m) => {
      const these = later.filter((l) => monthOf(l.day) === m);
      return card({ title: monthLabel(m), actions: n(these) }, these.map((l) => aheadRow(l, { person: !who })));
    }),
    ...(due.length || months.length ? [] : [card({}, empty(`Nothing ahead ${who ? 'in these records' : 'listed here'}: no vaccine dose due or coming up, and no refill running out.`))]),
    h(
      'div',
      { class: 'card-notes' },
      h('p', { class: 'small muted' }, `A refill is listed within ${REFILL_DAYS} days of the day its last fill runs out, and a child’s vaccine dose from ${COMING_UP_DAYS} days before. Bills are under Money.`),
      scheduleNote(),
      who ? null : privateLine('Private items are never listed here. Each shows on its person’s own Ahead.'),
    ),
  ];
}
