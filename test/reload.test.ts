// Reading the records again in an open app: what a read takes in or refuses,
// and when one is due (a finished refresh, or someone's items held back).
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Rereads } from '../src/data/rereads';
import { Store } from '../src/data/store';
import type { DemoFolder } from '../src/folder';
import { heldPeople } from '../src/next/shared';
import { personNamed } from './demo-data';
import { demoFolderWith, demoJson, privateCase, type Overlay } from './helpers';

/** A folder that is the next of `states` each time it is read anew, and stays the last, as Drive's does as medrec writes. */
function changing(...states: DemoFolder[]): { folder: DemoFolder; reads: () => number } {
  let reads = 0;
  const view = (state: DemoFolder): DemoFolder =>
    new Proxy(state, {
      get: (t, key) => {
        if (key === 'fresh') return () => view(states[Math.min((reads += 1), states.length - 1)]!);
        const value: unknown = Reflect.get(t, key, t);
        return typeof value === 'function' ? value.bind(t) : value;
      },
    });
  return { folder: view(states[0]!), reads: () => reads };
}

async function opened(...states: Overlay[]) {
  const { folder, reads } = changing(...states.map((o) => demoFolderWith(o)));
  const store = new Store(folder);
  await store.load();
  return { store, reads };
}

const heldNames = (store: Store) => heldPeople(store).map((x) => x.person.name);
const path = (name: string) => `${personNamed(demoJson('household.json'), name).folder}/index.json`;
const HELD = privateCase('unreadable');

describe('reading the records again', () => {
  it('clears a hold once medrec has written what it waited for, and keeps the requests', async () => {
    const { store } = await opened(HELD, {});
    const before = { snapshot: store.snapshot, done: store.done };
    expect([heldNames(store), store.anyHeld()]).toEqual([['Sam Example'], true]);
    const asked = await store.requestRefresh({ all: true }, {}, 'test');
    await store.reload();
    expect([heldNames(store), store.anyHeld()]).toEqual([[], false]);
    expect([store.pending, store.done]).toEqual([[asked], before.done]);
    expect(store.snapshot).not.toBe(before.snapshot);
  });

  it('takes in what is new: an index, and that medrec’s visits are of the one before', async () => {
    const name = 'Robin Example';
    const idx = demoJson<{ rev: number; records: { kind: string; display: string }[] }>(path(name));
    idx.rev += 1;
    idx.records.find((r) => r.kind === 'allergy')!.display = 'An invented allergy';
    const { store } = await opened({}, { [path(name)]: JSON.stringify(idx) });
    const robin = personNamed(store.household, name).id;
    const old = store.index(robin)!;
    expect(old.events).toBeDefined();
    await store.reload();
    expect(store.index(robin)!.records.some((r) => r.display === 'An invented allergy')).toBe(true);
    // Robin's views are behind, and so are those of the children linked to Robin.
    expect([store.index(robin)!.events, store.eventsNotes.get(robin)?.kind, heldNames(store), store.holdMayEnd()]).toEqual([undefined, 'behind', [name, 'Alex Example', 'Drew Example'], true]);
    expect(old.records.some((r) => r.display === 'An invented allergy')).toBe(false);
  });

  it('says nothing is new when the folder holds the same', async () => {
    const { store } = await opened({}, {});
    const before = store.snapshot;
    await store.reload();
    expect(store.snapshot).toBe(before);
  });

  it('holds everyone when the views can’t be read this time', async () => {
    const { store } = await opened({}, { 'views/views.json': '{' });
    await store.reload();
    expect([heldNames(store).length, store.viewsError?.kind, store.holdMayEnd()]).toEqual([4, 'unreadable', true]);
  });

  it('keeps what it has when the read fails, or leaves out something that is here', async () => {
    const cases: [Overlay, string][] = [
      [{ 'household.json': null }, 'This folder has no household.json. Choose the records folder medrec writes.'],
      [{ [path('Sam Example')]: '{' }, 'Sam Example’s records could not be read: Sam Example/index.json is not valid JSON.'],
      // Its file between two versions, or a listing that lacks it: on opening a folder, no index is someone with nothing imported.
      [{ [path('Sam Example')]: null }, 'Sam Example’s records could not be read: Their index is not in the folder.'],
      [{ 'views/views.json': null }, 'medrec’s views are not in the folder.'],
    ];
    for (const [then, says] of cases) {
      const { store } = await opened({}, then);
      const before = { snapshot: store.snapshot, indexes: store.indexes, loadedAt: store.loadedAt };
      await expect(store.reload()).rejects.toThrow(says);
      expect({ snapshot: store.snapshot, indexes: store.indexes, loadedAt: store.loadedAt }).toEqual(before);
      expect([heldNames(store), store.indexErrors.size]).toEqual([[], 0]);
    }
  });

  it('takes someone out when the household no longer lists them, and reads someone it could not before', async () => {
    const household = demoJson<{ people: { name: string }[] }>('household.json');
    household.people = household.people.filter((p) => p.name !== 'Drew Example');
    const { store } = await opened({}, { 'household.json': JSON.stringify(household) });
    await store.reload();
    expect([store.household.people.length, store.indexes.size]).toEqual([3, 3]);

    const { store: other } = await opened({ [path('Sam Example')]: '{' }, {});
    expect(other.indexErrors.size).toBe(1);
    await other.reload();
    expect([other.indexErrors.size, other.indexes.size]).toEqual([0, 4]);
  });

  it('is one read when two are asked for at once', async () => {
    const { store, reads } = await opened(HELD, {}, {});
    await Promise.all([store.reload(), store.reload()]);
    expect(reads()).toBe(1);
  });

  it('takes over from a read that has stalled, which then changes nothing and shares nothing', async () => {
    let release = () => {};
    const stall = new Promise<void>((r) => (release = r));
    const stalled = demoFolderWith({});
    const slow = new Proxy(stalled, { get: (t, key) => (key === 'readText' ? async (p: string) => (await stall, t.readText(p)) : (Reflect.get(t, key, t) as unknown)) });
    const { folder, reads } = changing(demoFolderWith({}), slow, demoFolderWith({}));
    const store = new Store(folder);
    await store.load();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = store.reload();
      expect(store.reload()).toBe(first);
      vi.setSystemTime(Date.now() + 121_000);
      const second = store.reload();
      expect(second).not.toBe(first);
      await second;
      const { indexes, folder: read } = store;
      expect(read).not.toBe(folder);
      release();
      await first;
      expect([store.indexes === indexes, store.folder === read, reads()]).toEqual([true, true, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the folder it had in use while it reads, and when it fails', async () => {
    const { store } = await opened({}, { 'household.json': null }, {});
    const { folder } = store;
    await expect(store.reload()).rejects.toThrow();
    expect(store.folder).toBe(folder);
    const reading = store.reload();
    expect(store.folder).toBe(folder);
    await reading;
    expect(store.folder).not.toBe(folder);
  });
});

describe('a request that finished', () => {
  const DONE = '_requests/done';
  /** A folder whose requests the test changes. */
  async function asked() {
    const folder = demoFolderWith({});
    const store = new Store(folder);
    await store.load();
    const p = await store.requestRefresh({ all: true }, {}, 'test');
    const file = `_requests/${p.file}`;
    const answer = () => {
      folder.writeAsMac(`${DONE}/${p.file}`, JSON.stringify({ ...p.request, handled: { outcome: 'ok', sources: [] } }));
      folder.removeAsMac(file);
    };
    return { folder, store, p, file, answer };
  }

  it('is owed a read of the records, until one that began after it', async () => {
    const { store, answer } = await asked();
    await store.loadRefreshState();
    expect([store.pending.length, store.owed]).toEqual([1, false]);
    const reading = store.reload();
    answer();
    await store.loadRefreshState();
    expect([store.pending.length, store.owed]).toEqual([0, true]);
    // The read under way began before it finished.
    await reading;
    expect(store.owed).toBe(true);
    await store.reload();
    expect(store.owed).toBe(false);
  });

  it('is not one that was cancelled, here or by another device', async () => {
    const here = await asked();
    await here.store.loadRefreshState();
    await here.store.cancel(here.p);
    await here.store.loadRefreshState();
    expect([here.store.pending.length, here.store.owed]).toEqual([0, false]);
    const there = await asked();
    await there.store.loadRefreshState();
    there.folder.removeAsMac(there.file);
    // Its answer may come between the two listings of one look, so it is looked for once more.
    await there.store.loadRefreshState();
    expect([there.store.pending.length, there.store.waiting, there.store.owed]).toEqual([0, true, false]);
    await there.store.loadRefreshState();
    expect([there.store.waiting, there.store.owed]).toEqual([false, false]);
  });

  it('is seen at the next look when its answer came between the two listings of one', async () => {
    const { folder, store, file, answer } = await asked();
    await store.loadRefreshState();
    folder.removeAsMac(file);
    await store.loadRefreshState();
    answer();
    await store.loadRefreshState();
    expect([store.waiting, store.owed]).toEqual([false, true]);
  });

  it('is still waiting while its file is listed but does not read', async () => {
    const { folder, store, file, answer } = await asked();
    await store.loadRefreshState();
    const whole = (await folder.readText(file))!;
    folder.writeAsMac(file, '{');
    await store.loadRefreshState();
    expect([store.pending.length, store.owed]).toEqual([1, false]);
    folder.writeAsMac(file, whole);
    answer();
    await store.loadRefreshState();
    expect([store.pending.length, store.owed]).toEqual([0, true]);
  });

  it('keeps one asked for, and drops one cancelled, while the requests are read', async () => {
    const { store, p } = await asked();
    const reading = store.loadRefreshState();
    await store.cancel(p);
    const next = await store.requestRefresh({ person: store.household.people[0]!.id }, {}, 'test');
    await reading;
    expect(store.pending.map((x) => x.file)).toEqual([next.file]);
  });
});

describe('when a read is due', () => {
  /** Rereads over a store whose clock and folder the test moves. */
  async function watching(...states: Overlay[]) {
    const { store, reads } = await opened(...states);
    let at = 0;
    const [said, refused]: [string[], string[]] = [[], []];
    const rereads = new Rereads(store, () => at, (t) => void said.push(t), (t) => void refused.push(t));
    /** The times of the reads a timer starts in this many seconds, looking every second. */
    const timer = async (seconds: number) => {
      const times: number[] = [];
      for (let s = 0; s < seconds; s += 1) {
        const n = reads();
        if (rereads.due()) await rereads.look();
        if (reads() > n) times.push(at / 1000);
        at += 1000;
      }
      return times;
    };
    return { store, rereads, reads, said, refused, timer, finish: () => void (store.finished += 1) };
  }
  const FAILS: Overlay = { 'household.json': null };
  const BEHIND: Overlay = { [path('Sam Example')]: JSON.stringify({ ...demoJson<object>(path('Sam Example')), rev: 99 }) };

  it('is never, with no one held back and no request finished', async () => {
    const { rereads, reads, timer } = await watching({}, {});
    await rereads.look();
    await rereads.look(true);
    expect([await timer(3600), reads()]).toEqual([[], 0]);
  });

  it('is once for a finished request', async () => {
    const { rereads, reads, timer, finish } = await watching({}, {});
    finish();
    await rereads.look();
    expect([await timer(3600), reads()]).toEqual([[], 1]);
  });

  it('is again after one fails, by the timer alone, with twice the wait each time, and is said at the third', async () => {
    const { rereads, said, timer, finish, store } = await watching({}, FAILS);
    finish();
    await rereads.look();
    expect([await timer(89), said]).toEqual([[30], []]);
    expect(await timer(3600)).toEqual([90, 210, 450, 930]);
    expect(said).toEqual(['The records could not be read again, so these are from before. This folder has no household.json. Choose the records folder medrec writes.']);
    expect([store.owed, heldNames(store)]).toEqual([true, []]);
  });

  it('starts over when the app comes to the front or another request finishes, and ends once one is read', async () => {
    const { rereads, timer, finish, store } = await watching({}, FAILS, FAILS, FAILS, {});
    finish();
    await rereads.look();
    expect(await timer(40)).toEqual([30]);
    finish();
    await rereads.look();
    expect(store.owed).toBe(true);
    await rereads.look(true);
    expect([store.owed, await timer(3600)]).toEqual([false, []]);
  });

  it('is said at once when the folder is in a newer layout, and only once', async () => {
    const household = { ...demoJson<object>('household.json'), format: 99 };
    const { rereads, said, timer, finish } = await watching({}, { 'household.json': JSON.stringify(household) });
    finish();
    await rereads.look();
    await timer(3600);
    expect(said.length).toBe(1);
    expect(said[0]).toMatch(/newer than this app reads .* Update the app\.$/);
  });

  it('is while a hold may end by itself, the app left in front', async () => {
    // medrec's index is there before its views, which follow.
    const { timer, store } = await watching(BEHIND, BEHIND, BEHIND, {});
    expect(heldNames(store)).toContain('Sam Example');
    expect([await timer(3600), heldNames(store)]).toEqual([[0, 30, 90], []]);
  });

  it('is only at the front for a hold that waits on the household or on medrec’s version', async () => {
    const { timer, rereads, store, reads } = await watching(HELD, HELD, {});
    expect(await timer(3600)).toEqual([]);
    await rereads.look(true);
    expect([heldNames(store), reads()]).toEqual([['Sam Example'], 1]);
    await rereads.look(true);
    expect([heldNames(store), reads()]).toEqual([[], 2]);
  });

  describe('for the names of someone’s codes', () => {
    const robin = personNamed(demoJson('household.json'), 'Robin Example').id;
    const file = demoJson<{ files: string[] }>('manifest.json').files.find((f) => f.startsWith(`views/${robin}/code-names.`))!;
    const named = (store: Store) => store.index(robin)!.codeNames !== undefined;

    it('is until they are there, no one held back', async () => {
      const { timer, store } = await watching({ [file]: null }, { [file]: '{}' }, {});
      expect([named(store), heldNames(store)]).toEqual([false, []]);
      expect([await timer(3600), named(store)]).toEqual([[0, 30], true]);
    });

    it('is again after a read that left them out, and ends after six', async () => {
      const { rereads, timer, finish, store, said } = await watching({}, { [file]: null });
      finish();
      await rereads.look();
      expect([store.owed, named(store)]).toEqual([false, false]);
      expect(await timer(3600)).toEqual([30, 90, 210, 450, 930]);
      expect(said).toEqual([]);
    });

    it('is after Drive fails to give them', async () => {
      const { folder } = changing(demoFolderWith({}), demoFolderWith({}));
      let fails = true;
      const store = new Store(
        new Proxy(folder, {
          get: (t, key) => {
            const value: unknown = Reflect.get(t, key, t);
            if (key === 'readText') return (p: string) => (p === file && fails ? Promise.reject(new Error('Drive: Backend Error')) : folder.readText(p));
            return value;
          },
        }),
      );
      await store.load();
      expect([named(store), store.mayBring(), store.holdMayEnd()]).toEqual([false, true, false]);
      fails = false;
      await store.reload();
      expect([named(store), store.mayBring()]).toEqual([true, false]);
    });

    it('is not when the file is in a newer layout', async () => {
      const text = JSON.stringify({ ...demoJson<object>(file), schema: 'medrec-code-names/v2' });
      const md5 = createHash('md5').update(text).digest('hex');
      const views = demoJson<{ people: Record<string, { files: Record<string, string> }> }>('views/views.json');
      views.people[robin]!.files['code-names.json'] = md5;
      const newer = { [file]: null, [`views/${robin}/code-names.${md5.slice(0, 12)}.json`]: text, 'views/views.json': JSON.stringify(views) };
      const { timer, store } = await watching(newer, newer);
      expect([named(store), await timer(3600)]).toEqual([false, []]);
    });
  });

  it('is again after a read that itself left someone held back', async () => {
    const { rereads, timer, finish, store } = await watching({}, { 'views/views.json': '{' }, {});
    finish();
    await rereads.look();
    expect([store.owed, heldNames(store).length]).toEqual([false, 4]);
    expect([await timer(3600), heldNames(store)]).toEqual([[30], []]);
  });
});
