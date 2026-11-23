// Each source's state, from household.json, _status/status.json, the
// people's ImportRuns and the refresh requests.

import { covers } from './requests';
import type {
  Attempt,
  Household,
  ImportCounts,
  ImportRun,
  Person,
  PersonIndex,
  RefreshRequest,
  RefreshStatus,
  Source,
  SourceStatus,
} from './types';

export type Health =
  | 'needs_person'
  | 'failed'
  | 'expired'
  | 'signed_out'
  | 'paused'
  | 'expiring'
  | 'running'
  | 'ok'
  | 'never';

/** Worst first: the order the sources list and the headline use. */
export const HEALTH_ORDER: Health[] = [
  'needs_person',
  'failed',
  'expired',
  'signed_out',
  'paused',
  'expiring',
  'running',
  'ok',
  'never',
];

/** What a person at the Mac should look at: the head of HEALTH_ORDER, through `signed_out`. */
export const ATTENTION: Health[] = HEALTH_ORDER.slice(0, HEALTH_ORDER.indexOf('signed_out') + 1);

/** The sign-ins only a person can make: home's alert. A failed load retries on its own. */
export const NEEDS_PERSON: Health[] = ['needs_person', 'expired', 'signed_out'];

/** The sources that need attention, most pressing first. */
export function needsAttention(views: SourceView[]): SourceView[] {
  return views.filter((v) => ATTENTION.includes(v.health)).sort((a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health));
}

/** The sources whose sign-in only a person can make, most pressing first. */
export function needsPerson(views: SourceView[]): SourceView[] {
  return needsAttention(views).filter((v) => NEEDS_PERSON.includes(v.health));
}

/** How long the Mac's answer to a refresh request stays on show. */
export const ANSWER_SHOWN_MS = 86_400_000;

/** A request the Mac has answered. */
export type AnsweredRequest = RefreshRequest & { handled: NonNullable<RefreshRequest['handled']> & { finished_at: string } };

export function isAnswered(r: RefreshRequest): r is AnsweredRequest {
  return typeof r.handled?.finished_at === 'string';
}

/** Answered within ANSWER_SHOWN_MS before `now` (a finish time ahead of the clock is not). */
export function isRecentAnswer(r: RefreshRequest, now: Date): r is AnsweredRequest {
  if (!isAnswered(r)) return false;
  const age = now.getTime() - Date.parse(r.handled.finished_at);
  return age >= 0 && age < ANSWER_SHOWN_MS;
}

/** The newest recent answer: the one home shows. */
export function latestAnswered(done: RefreshRequest[], now: Date): AnsweredRequest | undefined {
  return done.filter((r): r is AnsweredRequest => isRecentAnswer(r, now)).sort((a, b) => b.handled.finished_at.localeCompare(a.handled.finished_at))[0];
}

/** Counts medrec did not give are unknown, never zero. */
export interface LastLoad {
  at: string;
  added?: number;
  updated?: number;
  unchanged?: number;
  counts: ImportCounts;
  importId?: string;
  withheldTypes: string[];
}

export interface SourceView {
  source: Source;
  person?: Person;
  name: string;
  /** Present when the source is set up for refresh on the Mac. */
  status?: SourceStatus;
  lastLoad?: LastLoad;
  lastAttempt?: Attempt;
  health: Health;
  pending: RefreshRequest[];
  lastHandled?: RefreshRequest;
}

export type MacState =
  | { kind: 'not_set_up' }
  | { kind: 'newer_format' }
  | { kind: 'offline'; lastPassAt?: string; passEverySecs: number }
  | { kind: 'online'; lastPassAt: string; nextPassAt?: string; passEverySecs: number };

export function sourceName(s: Source): string {
  return s.organization_name || s.organization || s.cli || s.kind;
}

/** The ImportRuns that came from this source. */
export function importsFor(source: Source, imports: ImportRun[]): ImportRun[] {
  return imports.filter(
    (i) =>
      i.cli === source.cli &&
      i.organization === source.organization &&
      (!source.patient_id || !i.patient_id || i.patient_id === source.patient_id),
  );
}

function latest<T>(xs: T[], at: (x: T) => string | undefined): T | undefined {
  let best: T | undefined;
  let bestAt = '';
  for (const x of xs) {
    const t = at(x);
    if (t && t > bestAt) {
      best = x;
      bestAt = t;
    }
  }
  return best;
}

function fromImport(run: ImportRun): LastLoad {
  return {
    at: run.imported_at,
    added: run.records_added,
    updated: run.records_updated,
    unchanged: run.records_unchanged,
    counts: {
      records_added: run.records_added,
      records_updated: run.records_updated,
      records_unchanged: run.records_unchanged,
      records_older: run.records_older,
      resources_written: run.resources_written,
      resources_unchanged: run.resources_unchanged,
      documents_added: run.documents_added,
    },
    importId: run.id,
    withheldTypes: [],
  };
}

function health(status: SourceStatus | undefined, lastLoad: LastLoad | undefined): Health {
  if (!status) return lastLoad ? 'ok' : 'never';
  const signIn = status.sign_in?.state;
  // medrec clears needs_person once someone signs in; the attempt that asked keeps its outcome until the next.
  const asked = status.last_attempt?.outcome === 'needs_person' && status.sign_in?.needs_person === undefined;
  if (status.sign_in?.needs_person || asked) return 'needs_person';
  if (status.last_attempt?.outcome === 'running') return 'running';
  if (status.paused) return 'paused';
  if (status.last_attempt?.outcome === 'failed') return 'failed';
  if (signIn === 'expired') return 'expired';
  if (signIn === 'signed_out') return 'signed_out';
  if (signIn === 'expiring') return 'expiring';
  return lastLoad ? 'ok' : 'never';
}

export function sourceViews(opts: {
  household: Household;
  indexes: Map<string, PersonIndex>;
  status?: RefreshStatus;
  pending: RefreshRequest[];
  done: RefreshRequest[];
}): SourceView[] {
  const { household, indexes, status } = opts;
  const byId = new Map(status?.sources.map((s) => [s.source, s]) ?? []);
  const views = household.sources.map((source): SourceView => {
    const person = household.people.find((p) => p.id === source.person);
    const st = byId.get(source.id);
    const runs = importsFor(source, indexes.get(source.person)?.imports ?? []);
    const run = latest(runs, (r) => r.imported_at);
    let lastLoad: LastLoad | undefined;
    if (st?.last_success) {
      const c = st.last_success.counts ?? {};
      lastLoad = {
        at: st.last_success.finished_at,
        added: c.records_added,
        updated: c.records_updated,
        unchanged: c.records_unchanged,
        counts: c,
        importId: st.last_success.import,
        withheldTypes: st.last_success.withheld_types ?? [],
      };
      // An import run by hand after the last refresh is newer.
      if (run && run.imported_at > lastLoad.at) lastLoad = fromImport(run);
    } else if (run) {
      lastLoad = fromImport(run);
    }
    // `all` and `person` cover only the sources set up for refresh, as
    // medrec reads them; one not set up hears only of a request naming it.
    const ref = { id: source.id, person: source.person };
    const pending = st ? opts.pending.filter((r) => covers(r.scope, ref)) : opts.pending.filter((r) => 'source' in r.scope && r.scope.source === source.id);
    const handled = opts.done.filter((r) => r.handled?.sources?.some((s) => s.source === source.id) || (st && 'source' in r.scope && r.scope.source === source.id));
    return {
      source,
      person,
      name: sourceName(source),
      status: st,
      lastLoad,
      lastAttempt: st?.last_attempt ?? undefined,
      health: health(st, lastLoad),
      pending,
      lastHandled: latest(handled, (r) => r.handled?.finished_at ?? r.requested_at),
    };
  });
  return views.sort(
    (a, b) =>
      HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health) ||
      (a.person?.name ?? '').localeCompare(b.person?.name ?? '') ||
      a.name.localeCompare(b.name),
  );
}

export function macState(read: { kind: 'missing' } | { kind: 'newer_format' } | { kind: 'ok'; status: RefreshStatus }, now: Date): MacState {
  if (read.kind === 'missing') return { kind: 'not_set_up' };
  if (read.kind === 'newer_format') return { kind: 'newer_format' };
  const r = read.status.refresher;
  const last = r.last_pass_at;
  const limitMs = (r.heartbeat_every_secs + r.pass_every_secs) * 1000;
  if (!last || now.getTime() - Date.parse(last) > limitMs) {
    return { kind: 'offline', lastPassAt: last, passEverySecs: r.pass_every_secs };
  }
  return { kind: 'online', lastPassAt: last, nextPassAt: r.next_pass_at, passEverySecs: r.pass_every_secs };
}

/** A pending request the Mac should have taken by now, while it is online. */
export function isOverdue(req: RefreshRequest, mac: MacState, now: Date): boolean {
  if (mac.kind !== 'online') return false;
  return now.getTime() - Date.parse(req.requested_at) > (mac.passEverySecs + 60) * 1000;
}

export type RequestWait =
  | { kind: 'loading'; source: string }
  | { kind: 'busy'; source: string }
  | { kind: 'late' }
  | { kind: 'waiting' };

/**
 * Where a pending request stands. A pass reads `_requests/` when it starts,
 * so a request written during a long pass waits for the next one: that is
 * the Mac being busy, not late. `last_attempt.requests` names the requests
 * an import is running for.
 */
export function requestWait(req: RefreshRequest, views: SourceView[], mac: MacState, now: Date): RequestWait {
  if (mac.kind === 'online') {
    const running = views.filter((v) => v.lastAttempt?.outcome === 'running');
    const mine = running.find((v) => v.lastAttempt?.requests?.includes(req.id));
    if (mine) return { kind: 'loading', source: mine.name };
    if (running[0]) return { kind: 'busy', source: running[0].name };
  }
  return isOverdue(req, mac, now) ? { kind: 'late' } : { kind: 'waiting' };
}

export interface Headline {
  text: string;
  attention: boolean;
}

export function headline(views: SourceView[]): Headline {
  const count = (h: Health) => views.filter((v) => v.health === h).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (views.length === 0) return { text: 'No sources yet', attention: false };
  const people = count('needs_person');
  if (people) return { text: `${plural(people, 'sign-in needs', 'sign-ins need')} a person`, attention: true };
  const failed = count('failed');
  if (failed) return { text: `${plural(failed, 'source', 'sources')} failed to load`, attention: true };
  const ended = count('expired') + count('signed_out');
  if (ended) return { text: `${plural(ended, 'sign-in has', 'sign-ins have')} ended`, attention: true };
  const never = count('never');
  if (never === views.length) return { text: 'Nothing loaded yet', attention: false };
  if (never) return { text: `${plural(views.length - never, 'source', 'sources')} loaded, ${never} not yet`, attention: false };
  return { text: views.length === 1 ? 'The source is loaded' : `All ${views.length} sources loaded`, attention: false };
}
