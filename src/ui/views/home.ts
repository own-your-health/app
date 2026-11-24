// Home: what needs you, where everyone stands and what happened recently,
// then the search, the year's money at a glance and how fresh the records
// are. Every source's own state is on the Sources screen.

import { latestAnswered } from '../../model/sources';
import { h, icon } from '../dom';
import { card, empty, link, refreshControl, type Ctx } from '../components';
import { relative } from '../format';
import { nextHome } from '../../next/homeView';
import { moneyGlance } from '../../next/moneyYear';
import { macLine, requestAnswer, signInNotice } from './sources';

export function homeView(ctx: Ctx): HTMLElement {
  const store = ctx.store;
  const views = store.sources(ctx.now());
  const now = ctx.now();
  const mac = macLine(store.mac(now), now);
  const latest = views.map((v) => v.lastLoad?.at).filter(Boolean).sort().pop();
  const people = store.household.people;
  const failed = views.filter((v) => v.health === 'failed').length;
  // The Mac's last answer, while no request for everything waits.
  const answered = latestAnswered(store.done, now);
  const waiting = store.pendingFor({ all: true });

  // One line on how fresh the records are, Refresh, and the way to Sources.
  const freshness = h(
    'section',
    { class: 'card status-strip' },
    h(
      'div',
      { class: 'status-text' },
      h('p', { class: 'status-line' }, latest ? `Latest load ${relative(latest, now)}.` : 'Nothing loaded yet.'),
      answered && !waiting ? h('p', { class: 'small muted' }, requestAnswer(answered, { sources: views, people }, now)) : null,
      failed ? h('p', { class: 'small error-text' }, `${failed === 1 ? '1 source' : `${failed} sources`} failed to load; the Mac tries again on its own.`) : null,
      mac.attention || store.status.kind === 'missing' ? h('p', { class: ['small', mac.attention ? 'attention' : 'muted'] }, mac.text) : null,
      h('p', { class: 'small' }, link({ name: 'sources' }, 'Sources and sign-ins')),
    ),
    h('div', { class: 'status-action' }, refreshControl(ctx, { all: true }, 'everything', { primary: true })),
  );

  // A search field that opens the search page with what was typed.
  const field = h('input', {
    type: 'search',
    class: 'input',
    name: 'q',
    placeholder: 'Search records',
    'aria-label': 'Search everyone’s records',
    autocomplete: 'off',
    enterkeyhint: 'search',
    // A search is coming: start reading the documents' text it will need.
    on: { focus: () => people.forEach((p) => void store.text(p.id).catch(() => null)) },
  });
  const searchForm = people.length
    ? h(
        'form',
        {
          class: 'card home-search',
          role: 'search',
          on: {
            submit: (e: Event) => {
              e.preventDefault();
              const q = field.value.trim();
              ctx.go({ name: 'search', ...(q ? { query: q } : {}) });
            },
          },
        },
        field,
        h('button', { type: 'submit', class: 'button button-outline' }, icon('search', 18), h('span', null, 'Search')),
      )
    : null;

  // Quiet until something needs you: what needs you, where everyone stands and what happened recently lead.
  if (!people.length) return h('div', { class: 'stack' }, h('h1', { class: 'sr-only' }, 'Own Your Health'), card({ title: 'People' }, empty('No people in this records folder yet. Add them on the Mac with medrec people add.')), freshness);
  return h('div', { class: 'stack' }, h('h1', { class: 'sr-only' }, 'Own Your Health'), ...nextHome(ctx, signInNotice(views)), searchForm, moneyGlance(ctx), freshness);
}
