// Papers under ?next: the Drive folder, each file with the visit it belongs
// to, or "with no visit" and why. Everyone's list leaves private papers off
// and counts them; each shows, marked, on its person's own.

import { docTypeLabel, documentTitle } from '../model/records';
import { card, chip, driveLink, empty, filterChips, link, row, type Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import { href, type Route } from '../ui/router';
import { yearList } from '../ui/views/person';
import { eventRoute, eventWhen, headline } from './eventView';
import { householdPapers, papersOf, type Paper, type PaperHow } from './papers';

type Show = 'all' | 'with' | 'none';

const HOW: Record<PaperHow, string> = {
  event: '',
  claim: ', through its claim',
  record: ', through the visit’s record',
  bill: ', as the receipt for its bill',
};

/** Where a paper belongs, in a line: its visit as a link, or why it has none. */
function placeLine(ctx: Ctx, p: Paper): HTMLElement {
  const name = (id: string) => ctx.store.person(id)?.name ?? 'someone else';
  const visit = (e: NonNullable<Paper['with']>['event'], person: string) => link(eventRoute(person, e.id), `${headline(e).title}, ${eventWhen(e)}`);
  if (p.with) {
    const w = p.with;
    return h(
      'p',
      { class: 'paper-place small' },
      'With ',
      visit(w.event, w.person),
      w.person !== p.person ? ` (${name(w.person)}’s visit)` : null,
      HOW[w.how],
      w.confidence === 'sure' ? '.' : ', likely.',
    );
  }
  const could = p.could ?? [];
  return h(
    'p',
    { class: 'paper-place paper-none small' },
    'With no visit. ',
    p.why ?? null,
    could.length ? [' It could be ', ...could.flatMap((e, i) => [i ? (i === could.length - 1 ? ' or ' : ', ') : '', visit(e, p.person)]), '.'] : null,
  );
}

function paperRow(ctx: Ctx, p: Paper, everyone: boolean): HTMLElement {
  return row({
    route: { name: 'item', person: p.person, id: p.doc.id },
    title: documentTitle(p.doc),
    meta: [docTypeLabel(p.doc.doc_type), dateText(p.doc.date), everyone ? ctx.store.person(p.person)?.name : null, p.doc.organization].filter(Boolean).join(' · '),
    aside: p.privateArea ? chip('Private', 'muted') : undefined,
    extra: h('div', null, placeLine(ctx, p), h('div', { class: 'row-actions' }, driveLink(ctx, p.doc.path))),
  });
}

function head(ctx: Ctx, who: string | undefined): HTMLElement[] {
  const person = who ? ctx.store.person(who) : undefined;
  const whose = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Whose papers' },
    [{ id: '', name: 'Everyone' }, ...ctx.store.household.people].map((p) => {
      const on = p.id ? who === p.id : !who;
      const route: Route = { name: 'papers', ...(p.id ? { who: p.id } : {}) };
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href(route), 'aria-current': on ? 'page' : false }, p.name);
    }),
  );
  return [
    h('h1', null, person ? `${person.name}’s papers` : 'Papers'),
    h('p', { class: 'lead' }, person ? 'Each paper of theirs in the Drive folder, with the visit it belongs to.' : 'Every paper in the Drive folder, with the visit it belongs to.'),
    whose,
  ];
}

export function papersView(ctx: Ctx, route: Extract<Route, { name: 'papers' }>): HTMLElement {
  const { store } = ctx;
  const who = route.who && store.person(route.who) ? route.who : undefined;
  const today = localDay(ctx.now());
  const people = who ? store.household.people.filter((p) => p.id === who) : store.household.people;
  const loading = people.filter((p) => !store.index(p.id) && !store.indexErrors.has(p.id)).length;
  const unreadable = people.filter((p) => store.indexErrors.has(p.id));
  const all = who ? (store.index(who) ? papersOf(store.index(who)!, store.household, today, store.indexes) : []) : householdPapers(store.household, store.indexes, today);
  // Everyone's list is shared: a private paper shows only on its person's own.
  const kept = who ? all : all.filter((p) => !p.privateArea);
  const hidden = all.length - kept.length;
  const withVisit = kept.filter((p) => p.with).length;

  let show: Show = 'all';
  const list = h('div');
  const draw = () => {
    const items = kept.filter((p) => show === 'all' || (show === 'with') === !!p.with).map((p) => ({ date: p.doc.date, paper: p }));
    list.replaceChildren(items.length ? yearList(items, (x) => paperRow(ctx, x.paper, !who)) : empty(show === 'none' ? 'Every paper here is with its visit.' : 'No papers here yet.'));
  };
  draw();

  const notes = [
    loading ? h('p', { class: 'small muted' }, `Loading ${count(loading, 'person’s', 'people’s')} papers…`) : null,
    ...unreadable.map((p) => h('p', { class: 'small muted' }, `${p.name}’s records could not be read.`)),
    hidden
      ? h(
          'div',
          { class: 'papers-private' },
          h('p', { class: 'small' }, `${count(hidden, 'private paper is', 'private papers are')} kept off this shared view. Each shows on its person’s own Papers.`),
          h('p', { class: 'small muted' }, 'This is discretion, not security: everyone the Drive folder is shared with can still read those files.'),
        )
      : null,
  ];

  return h(
    'div',
    { class: 'stack papers' },
    ...head(ctx, who),
    card(
      { title: 'In the folder' },
      kept.length ? h('p', { class: 'papers-count' }, `${count(kept.length, 'paper')}: ${withVisit} with a visit, ${kept.length - withVisit} with none.`) : null,
      ...notes,
      kept.length
        ? filterChips<Show>(
            [
              ['all', 'All'],
              ['with', `With a visit (${withVisit})`],
              ['none', `With none (${kept.length - withVisit})`],
            ],
            show,
            (v) => ((show = v), draw()),
            'Show papers',
          )
        : null,
      list,
    ),
  );
}
