// views.json's `reader` (medrec 0.9.11 and later): the oldest medrec contract a
// reader must follow to read the views, by the data contract's own rule.
// `MAJOR.MINOR.PATCH`, compared as numbers part by part; where it is absent,
// `medrec`, the version that wrote the views, stands in its place. A reader
// that follows an older contract, or cannot parse the value, reads nothing of
// the views and says it must be updated, and does not fall back to the files.
import { describe, expect, it } from 'vitest';
import { Rereads } from '../src/data/rereads';
import { Store } from '../src/data/store';
import { FolderError } from '../src/model/parse';
import { FOLLOWS, NEWER_READER, parseViews, versionOf } from '../src/model/views';
import { demoFolderWith, demoJson } from './helpers';

/** The sample's views.json, with `reader` and `medrec` as given; `undefined` leaves the field out. */
function views(fields: { reader?: unknown; medrec?: unknown }, schema = 'medrec-views/v2'): Record<string, unknown> {
  const v: Record<string, unknown> = { ...demoJson<Record<string, unknown>>('views/views.json'), schema };
  delete v.reader;
  delete v.medrec;
  for (const [k, x] of Object.entries(fields)) if (x !== undefined) v[k] = x;
  return v;
}

/** What parseViews makes of them: read, or refused with its kind. */
function read(v: Record<string, unknown>, follows?: string): 'read' | string {
  try {
    parseViews(v, follows);
    return 'read';
  } catch (e) {
    return e instanceof FolderError ? `${e.kind}: ${e.message}` : String(e);
  }
}

const REFUSED = `newer_reader: ${NEWER_READER}`;

describe('a medrec version', () => {
  it('is three decimal integers, and nothing else', () => {
    expect([versionOf('0.9.10'), versionOf('1.0.0'), versionOf('10.20.300')]).toEqual([[0, 9, 10], [1, 0, 0], [10, 20, 300]]);
    expect(['0.9', '0.9.10.1', '0.9.10-dev', 'v0.9.10', ' 0.9.10', '0.9.x', '', 9, null, undefined].map(versionOf)).toEqual(Array(10).fill(undefined));
  });
});

describe('views.json’s reader', () => {
  it('is what this app follows: 0.9.10', () => {
    expect(FOLLOWS).toBe('0.9.10');
  });

  it('absent, gives way to the medrec that wrote the views: 0.9.5’s and 0.9.10’s are read', () => {
    expect([read(views({ medrec: '0.9.5' })), read(views({ medrec: '0.9.10' }))]).toEqual(['read', 'read']);
  });

  it('absent, with a medrec newer than this app follows, refuses the views', () => {
    expect([read(views({ medrec: '0.9.11' })), read(views({ medrec: '0.10.0' }))]).toEqual([REFUSED, REFUSED]);
  });

  it('equal to what this app follows, is read, whatever medrec wrote the views', () => {
    expect([read(views({ reader: '0.9.10', medrec: '0.9.10' })), read(views({ reader: '0.9.10', medrec: '0.9.11' })), read(views({ reader: '0.9.10', medrec: '1.4.2' }))]).toEqual(['read', 'read', 'read']);
  });

  it('is compared as numbers, part by part, never as text: 0.9.9 is older than 0.9.10', () => {
    expect([read(views({ reader: '0.9.9' })), read(views({ reader: '0.8.12' })), read(views({ reader: '0.0.100' }))]).toEqual(['read', 'read', 'read']);
    expect([read(views({ reader: '0.9.11' })), read(views({ reader: '0.10.0' })), read(views({ reader: '1.0.0' }))]).toEqual([REFUSED, REFUSED, REFUSED]);
  });

  it('newer than this app follows, refuses the views, even where an older medrec stands beside it', () => {
    expect(read(views({ reader: '0.9.11', medrec: '0.9.5' }))).toBe(REFUSED);
  });

  it('that does not parse, refuses the views, and so does a medrec that does not where it is absent', () => {
    for (const reader of ['0.9', '0.9.10-dev', '', null, 9, ['0', '9', '10']]) expect(read(views({ reader, medrec: '0.9.10' })), String(reader)).toBe(REFUSED);
    expect([read(views({ medrec: '0.9.10-dev' })), read(views({}))]).toEqual([REFUSED, REFUSED]);
  });

  it('newer, is read by an app updated to follow it', () => {
    expect([read(views({ reader: '0.9.11' }), '0.9.11'), read(views({ reader: '0.10.0' }), '0.9.11')]).toEqual(['read', REFUSED]);
  });

  it('refuses the views before their layout is judged: a later layout with a newer reader is no layout to fall back from', () => {
    expect([read(views({ reader: '0.9.11' }, 'medrec-views/v3')), read(views({ reader: '0.9.10' }, 'medrec-views/v3'))]).toEqual([REFUSED, 'newer_format: They are written by a newer medrec. Update the app.']);
  });
});

describe('a folder whose views need a newer app', () => {
  const NEWER = { 'views/views.json': JSON.stringify(views({ reader: '0.9.11', medrec: '0.9.11' })) };

  it('is not opened: nothing of it is read by the app’s own rules', async () => {
    const store = new Store(demoFolderWith(NEWER));
    await expect(store.load()).rejects.toMatchObject({ kind: 'newer_reader', message: NEWER_READER });
  });

  it('opens where its reader is absent and an older medrec wrote it', async () => {
    const store = new Store(demoFolderWith({ 'views/views.json': JSON.stringify(views({ medrec: '0.9.5' })) }));
    await store.load();
    expect(store.household.people.length).toBeGreaterThan(0);
  });

  it('read again in an open app, is refused at once, with nothing changed, and said only as that', async () => {
    let fresh = 0;
    const folder = demoFolderWith({});
    const next = demoFolderWith(NEWER);
    const store = new Store(new Proxy(folder, { get: (t, k) => (k === 'fresh' ? () => ((fresh += 1), next) : (Reflect.get(t, k, t) as unknown)) }));
    await store.load();
    const before = store.snapshot;
    const [said, refused]: [string[], string[]] = [[], []];
    const rereads = new Rereads(store, () => 0, (t) => void said.push(t), (t) => void refused.push(t));
    store.finished += 1;
    await rereads.look();
    expect([fresh, refused, said, store.snapshot === before]).toEqual([1, [NEWER_READER], [], true]);
  });
});
