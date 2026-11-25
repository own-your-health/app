// Papers: the Drive folder, each file with the visit it belongs to, or "with
// no visit" and why, narrowed by kind of paper as the person lists of
// documents were. Everyone's list leaves private papers off, and its words
// are the same whether or not there are any; each shows, marked, on its
// person's own.

import { docTypeLabel, documentTitle } from '../model/records';
import { aboutNotes } from '../ui/about';
import { card, chip, driveLink, empty, filterChips, link, row, type Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import { href, type Route } from '../ui/router';
import { yearList } from '../ui/views/person';
import { eventRoute, eventWhen, headline } from './eventView';
import { papersOf, sharedPapers, type Paper, type PaperHow } from './papers';
import { called } from '../model/people';
import { knownArea } from '../model/private';
import { heldNotes, privateLine } from './shared';

type Show = 'all' | 'with' | 'none';

const HOW: Record<PaperHow, string> = {
  event: '',
  claim: ', through its claim',
  record: ', through the visit’s record',
  bill: ', as the receipt for its bill',
};

/** Where a paper belongs, in a line: its visit as a link, or why it has none. */
function placeLine(ctx: Ctx, p: Paper): HTMLElement {
  const name = (id: string) => (ctx.store.person(id) ? called(ctx.store.person(id)!) : 'someone else');
  const visit = (e: NonNullable<Paper['with']>['event'], person: string) => link(eventRoute(person, e.id), `${[headline(e).title, e.place].filter(Boolean).join(' at ')}, ${eventWhen(e)}`);
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
    meta: [docTypeLabel(p.doc.doc_type), dateText(p.doc.date), everyone && ctx.store.person(p.person) ? called(ctx.store.person(p.person)!) : null, p.doc.organization, p.doc.pages ? count(p.doc.pages, 'page') : null].filter(Boolean).join(' · '),
    aside: knownArea(p.private) ? chip('Private', 'muted') : undefined,
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
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href(route), 'aria-current': on ? 'page' : false }, called(p));
    }),
  );
  return [
    h('h1', null, person ? `${called(person)}’s papers` : 'Papers'),
    h('p', { class: 'lead' }, `${person ? 'Each paper of theirs' : 'Papers'} in the Drive folder, with the visit ${person ? 'it belongs' : 'each belongs'} to.`),
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
  const kept = who ? (store.index(who) ? papersOf(store.index(who)!, store.household, today, store.indexes) : []) : sharedPapers(store.household, store.indexes, today);
  const withVisit = kept.filter((p) => p.with).length;

  let show: Show = 'all';
  let kind = 'all';
  const kindOf = (p: Paper) => p.doc.doc_type ?? 'other';
  const kinds = [...new Set(kept.map(kindOf))].sort((a, b) => docTypeLabel(a).localeCompare(docTypeLabel(b)));
  const list = h('div');
  // A screen reader hears what a filter left, as the list changes.
  const said = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const draw = (announce = false) => {
    const items = kept
      .filter((p) => (show === 'all' || (show === 'with') === !!p.with) && (kind === 'all' || kindOf(p) === kind))
      .map((p) => ({ date: p.doc.date, paper: p }));
    const what = kind === 'all' ? 'paper' : docTypeLabel(kind).toLowerCase();
    const none = show === 'none' ? `Every ${what} here is with its visit.` : show === 'with' ? `No ${what} here is with a visit.` : 'No papers here yet.';
    list.replaceChildren(items.length ? yearList(items, (x) => paperRow(ctx, x.paper, !who)) : empty(none));
    if (announce) said.textContent = `${count(items.length, 'paper')} ${show === 'all' ? 'in all' : show === 'with' ? 'with a visit' : 'with no visit'}${kind === 'all' ? '' : `, ${docTypeLabel(kind).toLowerCase()}`}.`;
  };
  draw();

  const own = who ? store.index(who) : undefined;
  const notes = [
    loading ? h('p', { class: 'small muted' }, `Loading ${count(loading, 'person’s', 'people’s')} papers…`) : null,
    ...unreadable.map((p) => h('p', { class: 'small muted' }, `${called(p)}’s records could not be read.`)),
    ...(own ? aboutNotes(own) : []),
    who ? null : privateLine('Private papers are never listed here. Each shows on its person’s own Papers. This is discretion, not security: everyone the Drive folder is shared with can read every file in it.'),
    ...(who ? [] : heldNotes(ctx, 'this shared view')),
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
            (v) => ((show = v), draw(true)),
            'Show papers',
          )
        : null,
      kinds.length > 1
        ? filterChips<string>(
            [['all', 'Every kind'], ...kinds.map((k): [string, string] => [k, `${docTypeLabel(k)} (${kept.filter((p) => kindOf(p) === k).length})`])],
            kind,
            (v) => ((kind = v), draw(true)),
            'Kind of paper',
          )
        : null,
      said,
      list,
    ),
  );
}
