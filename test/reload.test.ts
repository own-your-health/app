// Reading the records again in an open app: after a refresh finishes, or when
// the app comes to the front while someone's items are held back.
import { expect, it } from 'vitest';
import { Store } from '../src/data/store';
import type { DemoFolder } from '../src/folder';
import { heldPeople } from '../src/next/shared';
import { personNamed } from './demo-data';
import { demoFolderWith, demoJson, privateCase } from './helpers';

/** A folder that holds `now` until everything read of it is forgotten, then `then`, as Drive's does once medrec has written. */
function changing(now: DemoFolder, then: DemoFolder) {
  let at = now;
  return new Proxy(now, {
    get: (_, key) => {
      if (key === 'forget') return (prefix: string) => void (prefix === '' && (at = then));
      const value: unknown = Reflect.get(at, key, at);
      return typeof value === 'function' ? value.bind(at) : value;
    },
  });
}

async function opened(now: DemoFolder, then: DemoFolder): Promise<Store> {
  const store = new Store(changing(now, then));
  await store.load();
  return store;
}

const SAMPLE = () => demoFolderWith({});
const heldNames = (store: Store) => heldPeople(store).map((x) => x.person.name);
const path = (name: string) => `${personNamed(demoJson('household.json'), name).folder}/index.json`;

it('clears a hold once medrec has written what it waited for, and keeps the requests', async () => {
  const store = await opened(demoFolderWith(privateCase('unreadable')), SAMPLE());
  const before = { snapshot: store.snapshot, pending: store.pending, done: store.done };
  expect([heldNames(store), store.anyHeld()]).toEqual([['Sam Example'], true]);
  await store.requestRefresh({ all: true }, {}, 'test');
  expect(await store.reload()).toBe(true);
  expect([heldNames(store), store.anyHeld()]).toEqual([[], false]);
  expect([store.pending.length, store.done]).toEqual([1, before.done]);
  expect(store.snapshot).not.toBe(before.snapshot);
});

it('reads what is new: indexes, the visits medrec made of them, and texts', async () => {
  const name = 'Robin Example';
  const idx = demoJson<{ rev: number; records: { kind: string; display: string }[] }>(path(name));
  idx.rev += 1;
  idx.records.find((r) => r.kind === 'allergy')!.display = 'An invented allergy';
  const store = await opened(SAMPLE(), demoFolderWith({ [path(name)]: JSON.stringify(idx) }));
  const robin = personNamed(store.household, name).id;
  const old = store.index(robin)!;
  expect(old.events).toBeDefined();
  expect(await store.reload()).toBe(true);
  // medrec's views are of the index before: Robin's, and those of the children linked to Robin.
  expect(store.index(robin)!.records.some((r) => r.display === 'An invented allergy')).toBe(true);
  expect([store.index(robin)!.events, store.eventsNotes.get(robin)?.kind, heldNames(store)]).toEqual([undefined, 'behind', [name, 'Alex Example', 'Jamie Example']]);
  expect(old.records.some((r) => r.display === 'An invented allergy')).toBe(false);
});

it('says nothing is new when the folder holds the same', async () => {
  const store = await opened(SAMPLE(), SAMPLE());
  const before = store.snapshot;
  expect(await store.reload()).toBe(true);
  expect(store.snapshot).toBe(before);
});

it('holds everyone when the views can’t be read this time', async () => {
  const store = await opened(SAMPLE(), demoFolderWith({ 'views/views.json': '{' }));
  expect(await store.reload()).toBe(true);
  expect([heldNames(store).length, store.viewsError?.kind]).toEqual([4, 'unreadable']);
});

it('keeps what it has when the read fails, or leaves out someone whose records are here', async () => {
  for (const then of [{ 'household.json': null }, { [path('Sam Example')]: '{' }]) {
    const store = await opened(SAMPLE(), demoFolderWith(then));
    const before = { snapshot: store.snapshot, indexes: store.indexes, loadedAt: store.loadedAt };
    expect(await store.reload()).toBe(false);
    expect({ snapshot: store.snapshot, indexes: store.indexes, loadedAt: store.loadedAt }).toEqual(before);
    expect([heldNames(store), store.indexErrors.size]).toEqual([[], 0]);
  }
});

it('reads someone whose records it could not read before', async () => {
  const store = await opened(demoFolderWith({ [path('Sam Example')]: '{' }), SAMPLE());
  expect(store.indexErrors.size).toBe(1);
  expect(await store.reload()).toBe(true);
  expect([store.indexErrors.size, store.indexes.size]).toEqual([0, 4]);
});
