import { describe, expect, it } from 'vitest';
import { headline, importsFor, isOverdue, macState, requestWait, sourceViews } from '../src/model/sources';
import { buildRequest } from '../src/model/requests';
import type { RefreshStatus } from '../src/model/types';
import { demo, sourceOf } from './demo-data';

const NOW = new Date('2026-11-22T20:00:00Z');

describe('source views over the sample', () => {
  const { household, indexes, status } = demo();
  const views = sourceViews({ household, indexes, status, pending: [], done: [] });
  const view = (person: string, cli: string) => views.find((v) => v.source.id === sourceOf(household, person, cli).id)!;

  it('give each source its health', () => {
    expect(view('Robin Example', 'uhc').health).toBe('needs_person');
    expect(view('Sam Example', 'labcorp').health).toBe('failed');
    expect(view('Sam Example', 'peryourhealth').health).toBe('paused');
    expect(view('Sam Example', 'mychart').health).toBe('expiring');
    expect(view('Robin Example', 'mychart').health).toBe('ok');
    expect(view('Alex Example', 'athena').health).toBe('ok');
  });

  it('fall back to the ImportRun for a source the Mac does not refresh', () => {
    const v = view('Robin Example', 'oneblood');
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
    const v = sourceViews({ household, indexes, status: later, pending: [], done: [] }).find((x) => x.source.id === s.id)!;
    expect(v.lastLoad!.at > '2020-01-01T00:00:00Z').toBe(true);
  });

  it('show an everything request only on sources the Mac refreshes', () => {
    const req = buildRequest({ scope: { all: true }, now: NOW, by: {}, appVersion: '0' });
    const vs = sourceViews({ household, indexes, status, pending: [req], done: [] });
    // The blood centre and the newborn's practice are not set up for refresh.
    const notRefreshed = [sourceOf(household, 'Robin Example', 'oneblood').id, sourceOf(household, 'Jamie Example', 'athena').id];
    for (const v of vs) expect(v.pending.length).toBe(notRefreshed.includes(v.source.id) ? 0 : 1);
  });
});

describe('headline', () => {
  const { household, indexes } = demo();
  it('reads plainly when nothing is wrong', () => {
    // Without status.json, health comes from the ImportRuns alone.
    const vs = sourceViews({ household, indexes, pending: [], done: [] });
    expect(headline(vs)).toEqual({ text: '7 sources loaded, 1 not yet', attention: false });
    expect(headline(vs.filter((v) => v.health === 'ok'))).toEqual({ text: 'All 7 sources loaded', attention: false });
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
      return sourceViews({ household, indexes, status: s, pending: [req], done: [] });
    };

    it('is being loaded when a running import names it', () => {
      expect(requestWait(req, running([req.id]), mac, NOW).kind).toBe('loading');
    });

    it('waits on a busy Mac, not a late one, while another import runs', () => {
      expect(requestWait(req, running([]), mac, NOW)).toMatchObject({ kind: 'busy' });
    });

    it('is late after a pass and a minute when nothing runs', () => {
      const idle = sourceViews({ household, indexes, status, pending: [req], done: [] }).map((v) => (v.lastAttempt?.outcome === 'running' ? { ...v, lastAttempt: undefined } : v));
      expect(requestWait(req, idle, mac, NOW).kind).toBe('late');
      expect(requestWait(req, idle, mac, new Date('2026-11-22T19:55:00Z')).kind).toBe('waiting');
    });

    it('trusts no running import from a Mac that is offline', () => {
      expect(requestWait(req, running([req.id]), { kind: 'offline', passEverySecs: 300 }, NOW).kind).toBe('waiting');
    });
  });
});
