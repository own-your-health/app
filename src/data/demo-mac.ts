// A stand-in for `medrec refresh` in demo mode: it answers a request the way
// medrec's data contract says the Mac does, on the synthetic folder in
// memory, so a visitor sees the whole Refresh flow.

import { REQUESTS_DIR, type DemoFolder } from '../folder';
import { parseRequest, parseStatus } from '../model/parse';
import { covers } from '../model/requests';
import type { RefreshRequest, SourceStatus } from '../model/types';

const PICKUP_MS = 3000;
const RUN_MS = 3000;

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function attemptId(): string {
  const a = 'abcdefghijklmnopqrstuvwxyz234567';
  return `t_${Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => a[b & 31]).join('')}`;
}


/** medrec 0.7.0 and later: a person's request loads a source at most once per 15 minutes. */
const REQUEST_GUARD_MS = 15 * 60 * 1000;

/** When the guard counts from: the latest of the source's last import and its last attempt, whatever its outcome. */
function requestGuardFrom(s: SourceStatus): number {
  const times = [s.last_success?.finished_at, s.last_attempt?.finished_at ?? s.last_attempt?.started_at].map((t) => (t ? Date.parse(t) : 0));
  return Math.max(0, ...times.filter((t) => !Number.isNaN(t)));
}

export function startDemoMac(folder: DemoFolder, onChange: () => void): (file: string) => void {
  return (file: string) => {
    setTimeout(() => void handle(folder, file, onChange), PICKUP_MS);
  };
}

async function handle(folder: DemoFolder, file: string, onChange: () => void): Promise<void> {
  const reqText = await folder.readText(`${REQUESTS_DIR}/${file}`);
  if (!reqText) return; // cancelled
  const req = parseRequest(JSON.parse(reqText) as unknown);
  const statusText = await folder.readText('_status/status.json');
  if (!req || !statusText) return;
  const read = parseStatus(JSON.parse(statusText) as unknown);
  if (read.kind !== 'ok') return;
  const status = read.status;
  const pickedUp = new Date();
  const covered = status.sources.filter((s) => covers(req.scope, { id: s.source, person: s.person }));
  const results: NonNullable<RefreshRequest['handled']>['sources'] = [];
  const toRun: SourceStatus[] = [];
  for (const s of covered) {
    const latest = requestGuardFrom(s);
    if (s.paused) results.push({ source: s.source, outcome: 'skipped_paused' });
    else if (s.sign_in?.needs_person) results.push({ source: s.source, outcome: 'needs_person' });
    else if (latest && pickedUp.getTime() - latest < REQUEST_GUARD_MS) {
      results.push({ source: s.source, outcome: 'skipped_interval', next_allowed_at: iso(new Date(latest + REQUEST_GUARD_MS)) });
    } else toRun.push(s);
  }
  for (const s of toRun) {
    s.last_attempt = { attempt: attemptId(), started_at: iso(pickedUp), finished_at: null, trigger: 'request', requests: [req.id], outcome: 'running', exit_code: null, error: null, import: null };
  }
  status.refresher.last_pass_at = iso(pickedUp);
  status.updated_at = iso(pickedUp);
  folder.writeAsMac('_status/status.json', JSON.stringify(status, null, 2));
  onChange();
  await new Promise((r) => setTimeout(r, toRun.length ? RUN_MS : 0));
  const finished = new Date();
  for (const s of toRun) {
    const a = s.last_attempt!;
    a.finished_at = iso(finished);
    a.outcome = 'ok';
    a.exit_code = 0;
    const prev = s.last_success?.counts ?? {};
    const total = (prev.records_added ?? 0) + (prev.records_updated ?? 0) + (prev.records_unchanged ?? 0) || 1;
    s.failures = 0;
    s.last_success = {
      attempt: a.attempt,
      finished_at: iso(finished),
      import: s.last_success?.import,
      counts: { records_added: 0, records_updated: 0, records_unchanged: total, records_older: 0, resources_written: 0, resources_unchanged: total, documents_added: 0, documents_duplicate: 0, documents_unchanged: 0 },
      withheld_types: s.last_success?.withheld_types ?? [],
    };
    if (s.auto && s.min_interval_secs) s.next_run_at = iso(new Date(finished.getTime() + s.min_interval_secs * 1000));
    results.push({ source: s.source, outcome: 'ok', attempt: a.attempt, next_allowed_at: iso(new Date(finished.getTime() + REQUEST_GUARD_MS)) });
  }
  status.updated_at = iso(finished);
  status.refresher.last_pass_at = iso(finished);
  folder.writeAsMac('_status/status.json', JSON.stringify(status, null, 2));
  const ok = results.filter((r) => r.outcome === 'ok').length;
  const failed = results.filter((r) => r.outcome === 'failed' || r.outcome === 'needs_person').length;
  const failedOnly = results.some((r) => r.outcome === 'failed');
  const outcome = covered.length === 0 ? 'invalid' : ok && failed ? 'partial' : ok ? 'ok' : failedOnly ? 'failed' : failed ? 'needs_person' : 'skipped';
  const done: RefreshRequest = {
    ...req,
    handled: {
      picked_up_at: iso(pickedUp),
      finished_at: iso(finished),
      outcome,
      sources: results,
      message: covered.length === 0 ? 'No source of this request is set up for refresh.' : `${ok} ${ok === 1 ? 'source' : 'sources'} imported`,
      by: 'medrec (demo)',
    },
  };
  folder.writeAsMac(`${REQUESTS_DIR}/done/${file}`, JSON.stringify(done, null, 2));
  folder.removeAsMac(`${REQUESTS_DIR}/${file}`);
  onChange();
}
