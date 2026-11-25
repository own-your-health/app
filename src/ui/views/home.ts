// Home: what to do now, the bills and what is coming up, where everyone stands
// and what happened recently, then one line each for the year's money and how
// fresh the records are. Every source's own state is on the Sources screen.

import { latestAnswered } from '../../model/sources';
import { h } from '../dom';
import { card, empty, link, refreshControl, type Ctx } from '../components';
import { relative } from '../format';
import { nextHome } from '../../next/homeView';
import { moneyLine } from '../../next/moneyYear';
import { macLine, requestAnswer, signInWords } from './sources';

const JUST_NOW_MS = 15 * 60_000;

export function homeView(ctx: Ctx): HTMLElement {
  const store = ctx.store;
  const views = store.sources(ctx.now());
  const now = ctx.now();
  const mac = macLine(store.mac(now), now);
  const latest = views.map((v) => v.lastLoad?.at).filter(Boolean).sort().pop();
  const people = store.household.people;
  const failed = views.filter((v) => v.health === 'failed').length;
  // What the Mac said to a request just made, while none for everything waits; Sources keeps the older answers.
  const answered = store.pendingFor({ all: true }) ? undefined : latestAnswered(store.done, now, JUST_NOW_MS);

  const loaded = latest ? `Loaded ${relative(latest, now)}` : 'Nothing loaded yet';
  const toSources = link({ name: 'sources' }, loaded);
  toSources.setAttribute('aria-label', `${loaded}, see Sources`);

  // One line on how fresh the records are, with Refresh; a second only for what is not as usual.
  const freshness = h(
    'div',
    { class: 'status-strip' },
    h('p', { class: 'status-line' }, toSources, failed ? h('span', { class: 'small error-text' }, ` · ${failed} failed`) : null),
    h('div', { class: 'status-action' }, refreshControl(ctx, { all: true }, 'everything', { named: true })),
    answered ? h('p', { class: 'status-more small muted' }, requestAnswer(answered, { sources: views, people }, now)) : null,
    mac.attention || store.status.kind === 'missing' ? h('p', { class: ['status-more', 'small', mac.attention ? 'attention' : 'muted'] }, mac.text) : null,
  );

  // Quiet until something needs you.
  if (!people.length) return h('div', { class: 'stack' }, h('h1', { class: 'sr-only' }, 'Own Your Health'), card({ title: 'People' }, empty('No people in this records folder yet. Add them on the Mac with medrec people add.')), card({}, freshness));
  return h('div', { class: 'stack home' }, h('h1', { class: 'sr-only' }, 'Own Your Health'), ...nextHome(ctx, signInWords(views)), card({ class: 'home-lines' }, moneyLine(ctx), freshness));
}
