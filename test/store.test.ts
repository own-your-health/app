import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDemoMac } from '../src/data/demo-mac';
import { Store } from '../src/data/store';
import { demoFolder } from './helpers';
import { sourceOf } from './demo-data';

const ANCHOR = new Date('2026-11-22T20:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ now: ANCHOR, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the store over the sample folder', () => {
  it('loads the household, every index and the refresh state', async () => {
    const store = new Store(demoFolder(ANCHOR));
    await store.load();
    expect(store.household.people).toHaveLength(4);
    expect(store.indexes.size).toBe(4);
    expect(store.indexErrors.size).toBe(0);
    expect(store.status.kind).toBe('ok');
    expect(store.requestsReady).toBe(true);
    expect(store.pending).toEqual([]);
    expect(store.done.length).toBeGreaterThan(0);
    expect(store.mac(ANCHOR).kind).toBe('online');
    expect(store.personForHuishouden('hh-demo-sam')?.name).toBe('Sam Example');
    expect((await store.attempts('2026-11')).length).toBeGreaterThan(0);
  });

  it('asks for a refresh once per scope, and cancels it', async () => {
    const store = new Store(demoFolder(ANCHOR));
    await store.load();
    const sam = store.household.people.find((p) => p.name === 'Sam Example')!;
    const all = await store.requestRefresh({ all: true }, { email: 'robin@example.com' }, '0.1.0');
    expect(all.file).toMatch(/^20261122T200000Z_x_[a-z2-7]{20}\.json$/);
    expect(await store.requestRefresh({ person: sam.id }, {}, '0.1.0')).toBe(all);
    await store.loadRefreshState();
    expect(store.pending.map((p) => p.file)).toEqual([all.file]);
    expect(store.pending[0]!.cancellable).toBe(true);
    await store.cancel(store.pending[0]!);
    await store.loadRefreshState();
    expect(store.pending).toEqual([]);
  });

  it('has the simulated Mac answer a request the way medrec does', async () => {
    const folder = demoFolder(ANCHOR);
    const store = new Store(folder);
    await store.load();
    const h = store.household;
    let changes = 0;
    const mac = startDemoMac(folder, () => changes++);
    const p = await store.requestRefresh({ all: true }, {}, '0.1.0');
    mac(p.file);
    await vi.advanceTimersByTimeAsync(3000);
    await store.loadRefreshState();
    const athena = sourceOf(h, 'Alex Example', 'athena');
    expect(store.sources().find((v) => v.source.id === athena.id)?.health).toBe('running');
    await vi.advanceTimersByTimeAsync(3000);
    await store.loadRefreshState();
    expect(changes).toBe(2);
    expect(store.pending).toEqual([]);
    const done = store.done.find((r) => r.id === p.request.id)!;
    expect(done.handled?.outcome).toBe('partial');
    const outcome = (person: string, cli: string) => done.handled?.sources?.find((s) => s.source === sourceOf(h, person, cli).id)?.outcome;
    expect(outcome('Robin Example', 'uhc')).toBe('needs_person');
    expect(outcome('Sam Example', 'peryourhealth')).toBe('skipped_paused');
    expect(outcome('Sam Example', 'labcorp')).toBe('skipped_interval');
    expect(outcome('Alex Example', 'athena')).toBe('ok');
    expect(outcome('Robin Example', 'oneblood')).toBeUndefined();
    expect(store.sources().find((v) => v.source.id === athena.id)?.lastLoad?.at).toBe('2026-11-22T20:00:06Z');
  });

  it('treats a request with a done/ file as handled, and removes its own', async () => {
    const folder = demoFolder(ANCHOR);
    const store = new Store(folder);
    await store.load();
    const p = await store.requestRefresh({ all: true }, {}, '0.1.0');
    // medrec wrote done/ but could not remove the pending file.
    folder.writeAsMac(`_requests/done/${p.file}`, JSON.stringify({ ...p.request, handled: { picked_up_at: '2026-11-22T20:01:00Z', finished_at: '2026-11-22T20:02:00Z', outcome: 'ok', message: 'ok', by: 'medrec' } }));
    await store.loadRefreshState();
    expect(store.pending).toEqual([]);
    expect(store.done.some((r) => r.id === p.request.id)).toBe(true);
    expect(await folder.readText(`_requests/${p.file}`)).toBeNull();
  });

  it('lets a cancelled request go unanswered', async () => {
    const folder = demoFolder(ANCHOR);
    const store = new Store(folder);
    await store.load();
    const mac = startDemoMac(folder, () => undefined);
    const p = await store.requestRefresh({ all: true }, {}, '0.1.0');
    mac(p.file);
    await store.cancel(p);
    await vi.advanceTimersByTimeAsync(10_000);
    await store.loadRefreshState();
    expect(store.done.some((r) => r.id === p.request.id)).toBe(false);
  });
});
