// Sources: each provider medrec loads from, its sign-in, its last load and
// attempt, and what the Mac does next. Home has one line for what needs a
// person.

import { headline, isRecentAnswer, needsAttention, needsPerson, NEEDS_PERSON, type AnsweredRequest, type MacState, type SourceView } from '../../model/sources';
import { h, icon, type Child } from '../dom';
import { card, chip, command, empty, link, refreshControl, row, type Ctx, type Tone } from '../components';
import { clock, dateTime, duration, relative } from '../format';
import type { ErrorInfo, Handled, Person } from '../../model/types';
import type { Route } from '../router';

export const HEALTH_TEXT: Record<SourceView['health'], [string, Tone]> = {
  needs_person: ['Needs a person', 'attention'],
  failed: ['Failed', 'error'],
  expired: ['Sign-in ended', 'attention'],
  signed_out: ['Signed out', 'attention'],
  paused: ['Paused', 'muted'],
  expiring: ['Sign-in ends soon', 'attention'],
  running: ['Loading now', 'running'],
  ok: ['Loaded', 'ok'],
  never: ['Not loaded yet', 'muted'],
};

export function macLine(mac: MacState, now: Date): { text: string; attention: boolean } {
  switch (mac.kind) {
    case 'not_set_up':
      return { text: 'Refresh is not set up on the Mac yet. Loads shown come from medrec’s import history.', attention: false };
    case 'newer_format':
      return { text: 'The Mac writes its status in a newer layout than this app reads. Reload the page to update the app.', attention: true };
    case 'offline':
      return {
        text: mac.lastPassAt ? `The Mac has not checked in since ${dateTime(mac.lastPassAt)}. Refresh requests wait until it is back.` : 'The Mac has not checked in yet.',
        attention: true,
      };
    case 'online':
      return { text: `The Mac checked in ${relative(mac.lastPassAt, now)} and looks for refresh requests every ${duration(mac.passEverySecs)}.`, attention: false };
  }
}

export function loadText(v: SourceView, now: Date): string {
  const l = v.lastLoad;
  if (!l) return 'Not loaded yet';
  const parts: string[] = [];
  if (l.added !== undefined) parts.push(`${l.added} new`);
  if (l.updated !== undefined) parts.push(`${l.updated} changed`);
  if (l.unchanged !== undefined) parts.push(`${l.unchanged} unchanged`);
  return `Loaded ${relative(l.at, now)}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

const OUTCOME_TEXT: Record<string, string> = {
  ok: 'loaded',
  failed: 'failed',
  needs_person: 'needed a person',
  skipped_interval: 'not loaded, too soon after its last try',
  skipped_paused: 'skipped: paused',
  running: 'running',
};

export function signInText(v: SourceView): string | undefined {
  const si = v.status?.sign_in;
  if (!si) return undefined;
  const until = si.expires_at ? ` until ${dateTime(si.expires_at)}` : '';
  switch (si.state) {
    case 'ok':
      return `Signed in${until}`;
    case 'expiring':
      return `Sign-in ends ${si.expires_at ? relative(si.expires_at) : 'soon'}`;
    case 'expired':
      return 'Sign-in ended';
    case 'signed_out':
      return 'Signed out';
    case 'not_needed':
      return 'No sign-in needed';
    default:
      return 'Sign-in not checked yet';
  }
}

/** The earliest a source the Mac skipped may load again: "; next load allowed at 9:40 PM". */
function nextAllowed(sources: Handled['sources'], now: Date): string {
  // By the moment, not the text: an offset other than Z sorts wrong as a string.
  const next = (sources ?? [])
    .filter((x) => x.outcome === 'skipped_interval' && x.next_allowed_at && !Number.isNaN(Date.parse(x.next_allowed_at)))
    .map((x) => x.next_allowed_at!)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return next ? `; next load allowed ${clock(next, now)}` : '';
}

/**
 * What the provider's own tool said, folded away. Its words were written for
 * someone running that tool by hand, so they can name commands other than
 * the one medrec asks for.
 */
export function errorDetails(e: ErrorInfo, opts: { commandAbove?: boolean } = {}): HTMLElement | null {
  if (!e.message && !e.remedy) return null;
  return h(
    'details',
    { class: 'error-details' },
    h('summary', null, 'Error details'),
    opts.commandAbove ? h('p', { class: 'muted' }, 'What the provider’s tool reported. To sign in, run the medrec command above, not the tool’s own.') : null,
    e.message ? h('p', null, e.message) : null,
    e.remedy ? h('p', null, e.remedy) : null,
    e.code ? h('p', { class: 'muted' }, `Code: ${e.code}`) : null,
  );
}

/**
 * The lines under a source: last load, last attempt, sign-in, next run,
 * requests. `brief` (the lists) leaves out what is fine and the provider's
 * own error text; the source's own page shows everything.
 */
export function sourceDetail(ctx: Ctx, v: SourceView, brief = false): Child[] {
  const now = ctx.now();
  const st = v.status;
  const lines: Child[] = [h('div', null, loadText(v, now))];
  const a = v.lastAttempt;
  const np = st?.sign_in?.needs_person;
  const ended = NEEDS_PERSON.includes(v.health);
  if (ended) {
    lines.push(h('div', { class: 'attention' }, np?.reason === 'keychain' ? 'The Mac waited on a Keychain approval that nobody gave.' : `The sign-in to ${v.name} has ended.`));
    if (np) {
      lines.push(
        h(
          'div',
          { class: 'needs-person' },
          h('div', null, np.reason === 'keychain' ? 'Run this on the Mac, and approve the dialog:' : 'To sign in again, run this in a terminal on the Mac:'),
          command(np.command, ctx),
        ),
      );
    }
  } else if (a && a.outcome !== 'ok') {
    const failed = a.outcome === 'failed';
    const retries = !!st?.auto && !st.paused;
    const text = failed
      ? `The last try, ${relative(a.started_at, now)}, failed${a.error?.code === 'interrupted' ? ': the Mac stopped before it finished' : ''}.${retries ? ' The Mac tries again on its own.' : ''}`
      : `Last try ${relative(a.started_at, now)}: ${OUTCOME_TEXT[a.outcome] ?? a.outcome}`;
    lines.push(h('div', { class: failed ? 'error-text' : undefined }, text));
    if ((st?.failures ?? 0) > 1) lines.push(h('div', { class: 'muted' }, `${st!.failures} failures in a row; the Mac waits longer before each new try`));
  }
  if (!brief && a?.error && a.outcome !== 'ok') lines.push(errorDetails(a.error, { commandAbove: ended && !!np }));
  const si = signInText(v);
  const fine = v.status?.sign_in?.state === 'ok' || v.status?.sign_in?.state === 'not_needed';
  if (si && !ended && !(brief && fine)) lines.push(h('div', null, si));
  if (st?.paused) {
    lines.push(h('div', null, `Paused${st.paused.reason === 'consent' ? ': waiting on the household’s consent to the site’s terms' : ''}${st.paused.note ? `. ${st.paused.note}` : ''}`));
  } else if (st) {
    if (st.next_run_at && !brief) lines.push(h('div', { class: 'muted' }, `Next load ${relative(st.next_run_at, now)}`));
    else if (!st.auto) lines.push(h('div', { class: 'muted' }, 'Loads only when asked'));
  } else {
    lines.push(h('div', { class: 'muted' }, 'Not set up for refresh on the Mac'));
  }
  const handled = v.lastHandled?.handled;
  const recent = v.lastHandled ? isRecentAnswer(v.lastHandled, now) : false;
  if (handled && !v.pending.length && v.lastHandled && (!brief || recent)) {
    const mine = handled.sources?.find((x) => x.source === v.source.id);
    const when = relative(handled.finished_at ?? v.lastHandled.requested_at, now);
    const outcome = mine ? OUTCOME_TEXT[mine.outcome] ?? mine.outcome : handled.outcome;
    lines.push(h('div', { class: 'muted' }, `Last refresh request ${when}: ${outcome}${mine ? nextAllowed([mine], now) : ''}`));
  }
  return lines;
}

/** What a source that needs a person waits for, in a few words. */
function waitsFor(v: SourceView): string {
  return v.status?.sign_in?.needs_person?.reason === 'keychain' ? 'a Keychain approval' : 'a sign-in';
}

/**
 * The one line for the sign-ins only a person can make ("Example Health
 * Plan needs a sign-in on the Mac"), and where it leads: the source, or
 * Sources for several. Undefined when none does.
 */
export function signInWords(views: SourceView[]): { text: string; route: Route } | undefined {
  const needs = needsPerson(views);
  if (needs.length === 0) return undefined;
  const label = (v: SourceView) => (v.person && needs.some((x) => x !== v && x.name === v.name) ? `${v.name} (${v.person.name})` : v.name);
  const what = needs.every((v) => waitsFor(v) === 'a sign-in') ? 'a sign-in' : needs.length === 1 ? waitsFor(needs[0]!) : 'a person';
  const text =
    needs.length === 1
      ? `${label(needs[0]!)} needs ${what} on the Mac`
      : needs.length === 2
        ? `${label(needs[0]!)} and ${label(needs[1]!)} need ${what} on the Mac`
        : `${needs.length} sources need ${what} on the Mac`;
  return { text, route: needs.length === 1 ? { name: 'source', source: needs[0]!.source.id } : { name: 'sources' } };
}

/** signInWords as a link, for home and a person's overview. */
export function signInNotice(views: SourceView[]): HTMLElement | null {
  const words = signInWords(views);
  return words ? h('p', { class: 'signin-notice' }, link(words.route, h('span', null, words.text), icon('next', 18))) : null;
}

/** The shorter words for `n` sources with an outcome, counted among others ("2 too soon after their last tries"). */
function counted(outcome: string, n: number): string {
  if (outcome === 'skipped_interval') return n === 1 ? 'too soon after its last try' : 'too soon after their last tries';
  if (outcome === 'skipped_paused') return 'paused';
  return OUTCOME_TEXT[outcome] ?? outcome.replace(/_/g, ' ');
}

/** The words for every source of a request having had the same outcome. */
function only([outcome, n]: [string, number]): string {
  if (outcome === 'skipped_interval' && n > 1) return 'none loaded, too soon after their last tries';
  return OUTCOME_TEXT[outcome] ?? outcome;
}

/**
 * The Mac's answer to a refresh request, in one line: "loaded" when every
 * source had the same outcome, otherwise a count of each.
 */
export function requestAnswer(r: AnsweredRequest, names: { sources: SourceView[]; people: Person[] }, now: Date): string {
  const handled = r.handled;
  const scope = r.scope;
  const what =
    'source' in scope
      ? ` for ${names.sources.find((v) => v.source.id === scope.source)?.name ?? 'a source'}`
      : 'person' in scope
        ? ` for ${names.people.find((p) => p.id === scope.person)?.name ?? 'a person'}`
        : '';
  const counts = new Map<string, number>();
  for (const s of handled.sources ?? []) counts.set(s.outcome, (counts.get(s.outcome) ?? 0) + 1);
  const answer =
    counts.size === 1
      ? only([...counts][0]!)
      : counts.size > 1
        ? [...counts].map(([o, n]) => `${n} ${counted(o, n)}`).join(', ')
        : handled.message ?? handled.outcome;
  return `Last refresh request${what} ${relative(handled.finished_at, now)}: ${answer}${nextAllowed(handled.sources, now)}`;
}

/** A request would answer at once for a paused source or one that needs a person. */
export function canRefresh(v: SourceView): boolean {
  return !!v.status && !v.status.paused && v.health !== 'needs_person';
}

export function sourceRow(ctx: Ctx, v: SourceView, opts: { showPerson: boolean }): HTMLElement {
  const [label, tone] = HEALTH_TEXT[v.health];
  return row({
    route: { name: 'source', source: v.source.id },
    title: h('span', null, v.name),
    meta: [opts.showPerson && v.person ? `${v.person.name} · ` : '', v.source.cli ?? v.source.kind],
    aside: chip(label, tone),
    extra: h(
      'div',
      { class: 'row-extra' },
      h('div', { class: 'source-lines' }, sourceDetail(ctx, v, true)),
      canRefresh(v) ? h('div', { class: 'row-actions' }, refreshControl(ctx, { source: v.source.id }, v.name)) : null,
    ),
  });
}

/** The Sources screen: every source and sign-in, the Mac, and Refresh. */
export function sourcesView(ctx: Ctx): HTMLElement {
  const store = ctx.store;
  const views = store.sources();
  const now = ctx.now();
  const head = headline(views);
  const mac = macLine(store.mac(now), now);
  const latest = views.map((v) => v.lastLoad?.at).filter(Boolean).sort().pop();
  const showPerson = store.household.people.length > 1;
  const attention = needsAttention(views);
  const rest = views.filter((v) => !attention.includes(v));

  const glance = h(
    'section',
    { class: ['card glance', head.attention ? 'glance-needs' : null] },
    h('h1', { class: ['glance-answer', head.attention ? 'attention' : null] }, head.text),
    h('p', { class: 'glance-line' }, latest ? `Latest load ${relative(latest, now)}.` : 'medrec has not imported anything yet.'),
    h('p', { class: ['small', mac.attention ? 'attention' : 'muted'] }, mac.text),
    store.status.kind === 'missing' ? h('div', { class: 'glance-setup' }, h('p', { class: 'small muted' }, 'To set it up, run on the Mac:'), command('medrec refresh --install', ctx)) : null,
    h('div', { class: 'glance-action' }, refreshControl(ctx, { all: true }, 'everything', { primary: true })),
  );

  const refused = store.refused.filter((r) => r.handled.finished_at && now.getTime() - Date.parse(r.handled.finished_at) < 7 * 86400_000);

  return h(
    'div',
    { class: 'stack' },
    glance,
    attention.length ? card({ title: 'Needs attention', class: 'card-attention' }, attention.map((v) => sourceRow(ctx, v, { showPerson }))) : null,
    refused.length
      ? card(
          { title: 'Requests the Mac refused' },
          refused.map((r) => h('p', { class: 'small' }, `${dateTime(r.handled.finished_at)}: ${r.handled.message ?? 'refused'}`)),
        )
      : null,
    card(
      { title: attention.length ? 'Other sources' : 'Sources' },
      views.length === 0
        ? empty('No sources yet. They appear once medrec imports from a provider.')
        : rest.length === 0
          ? empty('Every source is listed above.')
          : rest.map((v) => sourceRow(ctx, v, { showPerson })),
    ),
  );
}
