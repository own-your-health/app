import { describe, expect, it } from 'vitest';
import { headline, importsFor, isOverdue, macState, needsAttention, needsPerson, QUIET_FOR_MS, requestWait, sourceViews } from '../src/model/sources';
import { buildRequest } from '../src/model/requests';
import type { RefreshStatus } from '../src/model/types';
import { demo, sourceOf } from './demo-data';

const NOW = new Date('2026-11-22T20:00:00Z');

describe('source views over the sample', () => {
  const { household, indexes, status } = demo();
  const views = sourceViews({ household, indexes, status, pending: [], done: [], now: NOW });
  const view = (person: string, cli: string) => views.find((v) => v.source.id === sourceOf(household, person, cli).id)!;

  it('give each source its health', () => {
    expect(view('Alex Example', 'athena').health).toBe('needs_person');
    expect(view('Sam Example', 'labcorp').health).toBe('failed');
    expect(view('Sam Example', 'peryourhealth').health).toBe('paused');
    expect(view('Sam Example', 'mychart').health).toBe('expiring');
    expect(view('Robin Example', 'mychart').health).toBe('ok');
    expect(view('Robin Example', 'caremark').health).toBe('ok');
    expect(view('Robin Example', 'uhc').health).toBe('awaits_sign_in');
    expect(view('Robin Example', 'oneblood').health).toBe('awaits_sign_in');
  });

  it('read a sign-in nothing renews as waiting, not as needing a person, unless it waits on the Keychain', () => {
    const blood = sourceOf(household, 'Robin Example', 'oneblood');
    const withSignIn = (signIn: object) => sourceViews({ household, indexes, status: { ...status, sources: status.sources.map((s) => (s.source === blood.id ? { ...s, sign_in: { ...s.sign_in!, ...signIn } } : s)) }, pending: [], done: [], now: NOW }).find((v) => v.source.id === blood.id)!;
    expect(withSignIn({}).health).toBe('awaits_sign_in');
    expect(needsPerson([withSignIn({})])).toEqual([]);
    expect(needsAttention([withSignIn({})])).toEqual([]);
    // Unknown, or renewing: as before.
    expect(withSignIn({ renews: undefined }).health).toBe('needs_person');
    expect(withSignIn({ renews: true }).health).toBe('needs_person');
    expect(withSignIn({ needs_person: { reason: 'keychain', command: 'medrec refresh sign-in s_x' } }).health).toBe('needs_person');
    // Signed in again: loads as any other.
    expect(withSignIn({ state: 'ok', needs_person: null }).health).toBe('ok');
  });

  it('bring a quiet source back as an alert once it has gone a week unloaded, or never loaded', () => {
    const blood = sourceOf(household, 'Robin Example', 'oneblood');
    const at = (now: Date) => sourceViews({ household, indexes, status, pending: [], done: [], now }).find((v) => v.source.id === blood.id)!;
    const loaded = Date.parse(at(NOW).lastLoad!.at);
    expect(at(new Date(loaded + QUIET_FOR_MS - 60_000)).health).toBe('awaits_sign_in');
    expect(at(new Date(loaded + QUIET_FOR_MS)).health).toBe('needs_person');
    const unloaded = { ...indexes.get(blood.person)!, imports: indexes.get(blood.person)!.imports.filter((i) => i.cli !== 'oneblood') };
    const never = sourceViews({ household, indexes: new Map([...indexes, [blood.person, unloaded]]), status, pending: [], done: [], now: NOW }).find((v) => v.source.id === blood.id)!;
    expect(never.lastLoad).toBeUndefined();
    expect(never.health).toBe('needs_person');
  });

  it('show a failed load of a quiet source as failed', () => {
    const blood = sourceOf(household, 'Robin Example', 'oneblood');
    const failedStatus = { ...status, sources: status.sources.map((s) => (s.source === blood.id ? { ...s, sign_in: { ...s.sign_in!, needs_person: null }, last_attempt: { ...s.last_attempt!, outcome: 'failed' } } : s)) };
    expect(sourceViews({ household, indexes, status: failedStatus, pending: [], done: [], now: NOW }).find((v) => v.source.id === blood.id)!.health).toBe('failed');
  });

  it('take a sign-in made since the attempt that asked for one as made', () => {
    const plan = sourceOf(household, 'Alex Example', 'athena');
    const signedIn: RefreshStatus = {
      ...status,
      sources: status.sources.map((s) => (s.source === plan.id ? { ...s, sign_in: { ...s.sign_in!, state: 'ok', needs_person: null } } : s)),
    };
    const v = sourceViews({ household, indexes, status: signedIn, pending: [], done: [], now: NOW }).find((x) => x.source.id === plan.id)!;
    expect(v.lastAttempt?.outcome).toBe('needs_person');
    expect(v.health).not.toBe('needs_person');
    // An older status.json without the field still reads the attempt.
    const older: RefreshStatus = { ...status, sources: status.sources.map((s) => (s.source === plan.id ? { ...s, sign_in: { state: 'ok' } } : s)) };
    expect(sourceViews({ household, indexes, status: older, pending: [], done: [], now: NOW }).find((x) => x.source.id === plan.id)!.health).toBe('needs_person');
  });

  it('fall back to the ImportRun for a source the Mac does not refresh', () => {
    const v = view('Jamie Example', 'athena');
    expect(v.status).toBeUndefined();
    expect(v.health).toBe('ok');
    expect(v.lastLoad?.importId).toMatch(/^i_/);
    expect(v.lastLoad?.at).toBe(importsFor(v.source, indexes.get(v.source.person)!.imports).map((i) => i.imported_at).sort().at(-1));
  });

  it('sort what needs a person first', () => {
    expect(views[0]!.health).toBe('needs_person');
    expect(views.at(-1)!.health).toBe('ok');
  });

  it('lead with the sign-in that needs a person', () => {
    expect(headline(views)).toEqual({ text: '1 sign-in needs a person', attention: true });
  });

  it('take a newer hand-run import over the last refresh', () => {
    const s = sourceOf(household, 'Robin Example', 'mychart');
    const later: RefreshStatus = structuredClone(status);
    const st = later.sources.find((x) => x.source === s.id)!;
    st.last_success!.finished_at = '2020-01-01T00:00:00Z';
    const v = sourceViews({ household, indexes, status: later, pending: [], done: [], now: NOW }).find((x) => x.source.id === s.id)!;
    expect(v.lastLoad!.at > '2020-01-01T00:00:00Z').toBe(true);
  });

  it('show an everything request only on sources the Mac refreshes', () => {
    const req = buildRequest({ scope: { all: true }, now: NOW, by: {}, appVersion: '0' });
    const vs = sourceViews({ household, indexes, status, pending: [req], done: [], now: NOW });
    // Jamie's practice is not set up for refresh.
    const notRefreshed = [sourceOf(household, 'Jamie Example', 'athena').id];
    for (const v of vs) expect(v.pending.length).toBe(notRefreshed.includes(v.source.id) ? 0 : 1);
  });
});

describe('headline', () => {
  const { household, indexes } = demo();
  it('counts a source waiting for a sign-in apart from the loaded ones', () => {
    const { status } = demo();
    const vs = sourceViews({ household, indexes, status, pending: [], done: [], now: NOW }).filter((v) => v.health === 'ok' || v.health === 'awaits_sign_in');
    const ok = vs.filter((v) => v.health === 'ok').length;
    expect(headline(vs)).toEqual({ text: `${ok} sources loaded, 2 wait for a sign-in`, attention: false });
    // No "0 sources loaded" when every source waits.
    const waiting = vs.filter((v) => v.health === 'awaits_sign_in');
    expect(waiting).toHaveLength(2);
    expect(headline([waiting[0]!])).toEqual({ text: 'The source waits for a sign-in', attention: false });
    expect(headline(waiting)).toEqual({ text: 'All 2 sources wait for a sign-in', attention: false });
    expect(headline([waiting[0]!, { ...waiting[0]!, health: 'never' }])).toEqual({ text: '1 not loaded yet, 1 waits for a sign-in', attention: false });
  });

  it('reads plainly when nothing is wrong', () => {
    // Without status.json, health comes from the ImportRuns alone.
    const vs = sourceViews({ household, indexes, pending: [], done: [], now: NOW });
    expect(headline(vs)).toEqual({ text: '10 sources loaded, 1 not yet', attention: false });
    expect(headline(vs.filter((v) => v.health === 'ok'))).toEqual({ text: 'All 10 sources loaded', attention: false });
    expect(headline([])).toEqual({ text: 'No sources yet', attention: false });
  });
});

describe('the Mac', () => {
  const { status } = demo();
  const at = (iso: string): RefreshStatus => ({ ...status, refresher: { ...status.refresher, last_pass_at: iso, pass_every_secs: 300, heartbeat_every_secs: 3600 } });

  it('is not set up without status.json', () => {
    expect(macState({ kind: 'missing' }, NOW)).toEqual({ kind: 'not_set_up' });
  });

  it('is online within a heartbeat and a pass of its last pass', () => {
    expect(macState({ kind: 'ok', status: at('2026-11-22T19:00:00Z') }, NOW).kind).toBe('online');
    expect(macState({ kind: 'ok', status: at('2026-11-22T18:54:00Z') }, NOW).kind).toBe('offline');
  });

  it('is late with a request after a pass and a minute', () => {
    const mac = macState({ kind: 'ok', status: at('2026-11-22T19:59:00Z') }, NOW);
    const req = buildRequest({ scope: { all: true }, now: new Date('2026-11-22T19:54:00Z'), by: {}, appVersion: '0' });
    expect(isOverdue(req, mac, NOW)).toBe(false);
    expect(isOverdue(req, mac, new Date('2026-11-22T20:00:01Z'))).toBe(true);
    expect(isOverdue(req, { kind: 'not_set_up' }, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });

  describe('a pending request', () => {
    const { household, indexes, status } = demo();
    const mac = macState({ kind: 'ok', status: at('2026-11-22T19:59:00Z') }, NOW);
    const req = buildRequest({ scope: { all: true }, now: new Date('2026-11-22T19:50:00Z'), by: {}, appVersion: '0' });
    const running = (requests: string[]) => {
      const s: RefreshStatus = structuredClone(status);
      const st = s.sources.find((x) => x.source === sourceOf(household, 'Robin Example', 'mychart').id)!;
      st.last_attempt = { started_at: '2026-11-22T19:55:00Z', finished_at: null, trigger: requests.length ? 'request' : 'schedule', outcome: 'running', requests } as unknown as typeof st.last_attempt;
      return sourceViews({ household, indexes, status: s, pending: [req], done: [], now: NOW });
    };

    it('is being loaded when a running import names it', () => {
      expect(requestWait(req, running([req.id]), mac, NOW).kind).toBe('loading');
    });

    it('waits on a busy Mac, not a late one, while another import runs', () => {
      expect(requestWait(req, running([]), mac, NOW)).toMatchObject({ kind: 'busy' });
    });

    it('is late after a pass and a minute when nothing runs', () => {
      const idle = sourceViews({ household, indexes, status, pending: [req], done: [], now: NOW }).map((v) => (v.lastAttempt?.outcome === 'running' ? { ...v, lastAttempt: undefined } : v));
      expect(requestWait(req, idle, mac, NOW).kind).toBe('late');
      expect(requestWait(req, idle, mac, new Date('2026-11-22T19:55:00Z')).kind).toBe('waiting');
    });

    it('trusts no running import from a Mac that is offline', () => {
      expect(requestWait(req, running([req.id]), { kind: 'offline', passEverySecs: 300 }, NOW).kind).toBe('waiting');
    });
  });
});
