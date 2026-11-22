// Home: are the household's records up to date, and does any sign-in need
// a person?

import { headline, type MacState, type SourceView } from '../../model/sources';
import { h, type Child } from '../dom';
import { card, chip, command, empty, refreshControl, row, type Ctx, type Tone } from '../components';
import { count, dateTime, duration, relative } from '../format';

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
  skipped_interval: 'skipped: not due yet',
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

/**
 * The lines under a source: last load, last attempt, sign-in, next run,
 * requests. `brief` (the lists) leaves out what is fine; the source's own
 * page shows everything.
 */
export function sourceDetail(ctx: Ctx, v: SourceView, brief = false): Child[] {
  const now = ctx.now();
  const st = v.status;
  const lines: Child[] = [h('div', null, loadText(v, now))];
  const a = v.lastAttempt;
  if (a && a.outcome !== 'ok') {
    const err = a.error?.message ? `: ${a.error.message}` : a.error?.code === 'interrupted' ? ': the Mac stopped before it finished' : '';
    lines.push(h('div', { class: a.outcome === 'failed' ? 'error-text' : undefined }, `Last try ${relative(a.started_at, now)} ${OUTCOME_TEXT[a.outcome] ?? a.outcome}${err}`));
    if (a.error?.remedy) lines.push(h('div', { class: 'muted' }, a.error.remedy));
    if ((st?.failures ?? 0) > 1) lines.push(h('div', { class: 'muted' }, `${st!.failures} failures in a row; the Mac waits longer before each new try`));
  }
  const si = signInText(v);
  const fine = v.status?.sign_in?.state === 'ok' || v.status?.sign_in?.state === 'not_needed';
  if (si && !(brief && (fine || v.health === 'needs_person'))) lines.push(h('div', null, si));
  if (st?.paused) {
    lines.push(h('div', null, `Paused${st.paused.reason === 'consent' ? ': waiting on the household’s consent to the site’s terms' : ''}${st.paused.note ? `. ${st.paused.note}` : ''}`));
  } else if (st) {
    if (st.next_run_at && !brief) lines.push(h('div', { class: 'muted' }, `Next load ${relative(st.next_run_at, now)}`));
    else if (!st.auto) lines.push(h('div', { class: 'muted' }, 'Loads only when asked'));
  } else {
    lines.push(h('div', { class: 'muted' }, 'Not set up for refresh on the Mac'));
  }
  const np = st?.sign_in?.needs_person;
  if (np) {
    lines.push(
      h(
        'div',
        { class: 'needs-person' },
        h('div', { class: 'attention' }, np.reason === 'keychain' ? 'The Mac waited on a Keychain approval that nobody gave. Run this on the Mac, and approve the dialog:' : 'The sign-in needs a person. Run this in a terminal on the Mac:'),
        command(np.command, ctx),
      ),
    );
  }
  const handled = v.lastHandled?.handled;
  const recent = handled?.finished_at ? now.getTime() - Date.parse(handled.finished_at) < 86_400_000 : false;
  if (handled && !v.pending.length && v.lastHandled && (!brief || recent)) {
    const mine = handled.sources?.find((s) => s.source === v.source.id);
    const when = relative(handled.finished_at ?? v.lastHandled.requested_at, now);
    const outcome = mine ? OUTCOME_TEXT[mine.outcome] ?? mine.outcome : handled.outcome;
    const next = mine?.next_allowed_at && mine.outcome === 'skipped_interval' ? `; next allowed ${dateTime(mine.next_allowed_at)}` : '';
    lines.push(h('div', { class: 'muted' }, `Last refresh request ${when}: ${outcome}${next}`));
  }
  return lines;
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

export function homeView(ctx: Ctx): HTMLElement {
  const store = ctx.store;
  const views = store.sources();
  const now = ctx.now();
  const head = headline(views);
  const mac = macLine(store.mac(now), now);
  const latest = views.map((v) => v.lastLoad?.at).filter(Boolean).sort().pop();
  const people = store.household.people;
  const needs = views.filter((v) => v.health === 'needs_person');

  const glance = h(
    'section',
    { class: ['card glance', head.attention ? 'glance-needs' : null] },
    h('h1', { class: ['glance-answer', head.attention ? 'attention' : null] }, head.text),
    h('p', { class: 'glance-line' }, latest ? `Latest load ${relative(latest, now)}.` : 'medrec has not imported anything yet.'),
    h('p', { class: ['small', mac.attention ? 'attention' : 'muted'] }, mac.text),
    store.status.kind === 'missing' ? h('div', { class: 'glance-setup' }, h('p', { class: 'small muted' }, 'To set it up, run on the Mac:'), command('medrec refresh --install', ctx)) : null,
    h('div', { class: 'glance-action' }, refreshControl(ctx, { all: true }, 'everything', { primary: true })),
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

  const byPerson = new Map<string, SourceView[]>();
  for (const v of views) {
    const k = v.person?.name ?? 'Unknown person';
    byPerson.set(k, [...(byPerson.get(k) ?? []), v]);
  }
  const sourcesCard = card(
    { title: 'Sources' },
    views.length === 0
      ? empty('No sources yet. They appear once medrec imports from a provider.')
      : views.filter((v) => v.health !== 'needs_person').map((v) => sourceRow(ctx, v, { showPerson: people.length > 1 })),
  );

  const refused = store.refused.filter((r) => r.handled.finished_at && now.getTime() - Date.parse(r.handled.finished_at) < 7 * 86400_000);

  return h(
    'div',
    { class: 'stack' },
    glance,
    needs.length
      ? card(
          { title: 'Waiting for you on the Mac', class: 'card-attention' },
          needs.map((v) => sourceRow(ctx, v, { showPerson: people.length > 1 })),
        )
      : null,
    refused.length
      ? card(
          { title: 'Requests the Mac refused' },
          refused.map((r) => h('p', { class: 'small' }, `${dateTime(r.handled.finished_at)}: ${r.handled.message ?? 'refused'}`)),
        )
      : null,
    peopleCard,
    sourcesCard,
  );
}
