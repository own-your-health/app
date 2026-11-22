// Home: the household's people, and, at the top, anything that needs a
// person at the Mac. Every source's own state is on the Sources screen.

import { headline, latestAnswered, needsPerson } from '../../model/sources';
import { h } from '../dom';
import { card, empty, link, refreshControl, row, type Ctx } from '../components';
import { count, relative } from '../format';
import { macLine, requestAnswer, sourceRow } from './sources';

export function homeView(ctx: Ctx): HTMLElement {
  const store = ctx.store;
  const views = store.sources();
  const now = ctx.now();
  const mac = macLine(store.mac(now), now);
  const latest = views.map((v) => v.lastLoad?.at).filter(Boolean).sort().pop();
  const people = store.household.people;
  const attention = needsPerson(views);
  const failed = views.filter((v) => v.health === 'failed').length;
  // The Mac's last answer, while no request for everything waits.
  const answered = latestAnswered(store.done, now);
  const waiting = store.pendingFor({ all: true });

  // Only when something needs a person: the sign-in to make, with its command.
  const alert = attention.length
    ? h(
        'section',
        { class: 'card card-attention glance glance-needs' },
        h('h2', { class: 'glance-answer attention' }, headline(attention).text),
        attention.map((v) => sourceRow(ctx, v, { showPerson: people.length > 1 })),
      )
    : null;

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

  const peopleCard = card(
    { title: 'People' },
    people.length === 0
      ? empty('No people in this records folder yet. Add them on the Mac with medrec people add.')
      : people.map((p) => {
          const idx = store.index(p.id);
          const err = store.indexErrors.get(p.id);
          const meta = err
            ? err
            : idx
              ? [count(idx.records.length, 'record'), count(idx.documents.length, 'document'), idx.studies.length ? count(idx.studies.length, 'imaging study', 'imaging studies') : null].filter(Boolean).join(' · ')
              : 'Loading…';
          return row({ route: { name: 'person', person: p.id, section: 'timeline' }, title: p.name, meta });
        }),
  );

  return h('div', { class: 'stack' }, h('h1', { class: 'sr-only' }, 'Own Your Health'), alert, freshness, peopleCard);
}
