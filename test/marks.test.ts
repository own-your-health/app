// Mark paid: the request the store writes, what waits for the Mac, what the
// records show once they are read again, and what a marked bill is meanwhile.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDemoMac } from '../src/data/demo-mac';
import { applyMark } from '../src/data/demo-marks';
import { Store } from '../src/data/store';
import { Unanswered, type DemoFolder } from '../src/folder';
import { billList } from '../src/model/billing';
import { householdEvents } from '../src/next/calendar';
import { markRecorded } from '../src/model/requests';
import { billMarks, callsSummary, mayBePaid, openBills, toPay, unmarkedCents, worthACall } from '../src/next/money';
import type { MarkRequest, MedDocument, PaidMark, PendingMark, PersonIndex, RefreshStatus, UnpaidMark } from '../src/model/types';
import { demoFolder, demoFolderWith, demoJson } from './helpers';
import { ROBIN, SAM } from './sample';

const NOW = new Date('2026-11-22T20:00:00Z');
const TODAY = '2026-11-22';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const owing = (idx: PersonIndex, amount: string): MedDocument => idx.documents.find((d) => d.statement?.amount_due?.amount === amount)!;
const paid = (person: string, document: string, amount: string, on = '2026-11-17') => ({ paid: { person, document, on, amount } });

async function loaded(folder: DemoFolder = demoFolder(NOW)): Promise<{ folder: DemoFolder; store: Store }> {
  const store = new Store(folder);
  await store.load();
  return { folder, store };
}

/** The Mac's answer to a request, its pending file gone. */
function answer(folder: DemoFolder, m: PendingMark, outcome: string): void {
  folder.writeAsMac(`_requests/done/${m.file}`, JSON.stringify({ ...m.request, handled: { picked_up_at: '2026-11-22T20:01:00Z', finished_at: '2026-11-22T20:01:01Z', outcome, sources: [], message: outcome, by: 'medrec 0.9.6' } }));
  folder.removeAsMac(`_requests/${m.file}`);
}

/** What medrec does when it records a request: its marks, then its answer. Gives what writes the list that shows it, which comes after. */
async function file(folder: DemoFolder, m: PendingMark): Promise<() => void> {
  const { writeViews } = await applyMark(folder, m.request, NOW);
  answer(folder, m, 'ok');
  return writeViews!;
}

const minutes = (n: number) => vi.setSystemTime(new Date(Date.now() + n * 60_000));

describe('a payment marked', () => {
  it('is one request, waits for the Mac, and is taken back by removing it', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const m = await store.requestMark(paid(ROBIN, doc, '53.68'), { email: 'robin@example.com' }, '0.1.0');
    expect(m.file).toMatch(/^20261122T200000Z_x_[a-z2-7]{20}\.json$/);
    expect(JSON.parse((await folder.readText(`_requests/${m.file}`))!)).toEqual({
      schema: 'medrec-request/v1',
      id: m.request.id,
      requested_at: '2026-11-22T20:00:00Z',
      requested_by: { email: 'robin@example.com' },
      app: { name: 'own-your-health-app', version: '0.1.0' },
      paid: { person: ROBIN, document: doc, on: '2026-11-17', amount: '53.68' },
    });
    // The same again is the one that waits; another day is another payment.
    expect(await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0')).toBe(m);
    const other = await store.requestMark(paid(ROBIN, doc, '53.68', '2026-11-18'), {}, '0.1.0');
    expect(store.marks.map((x) => x.file).sort()).toEqual([m.file, other.file].sort());
    await store.loadRefreshState();
    expect(store.marks.map((x) => [x.file, x.cancellable]).sort()).toEqual([[m.file, true], [other.file, true]].sort());
    expect([store.waiting, store.pending]).toEqual([true, []]);
    expect(await store.cancel(m)).toBe(true);
    expect(await store.cancel(other)).toBe(true);
    expect([store.marks, await folder.readText(`_requests/${m.file}`)]).toEqual([[], null]);
    await store.loadRefreshState();
    expect(store.marks).toEqual([]);
  });

  it('asked for while the folder is being read is kept, and so is one taken back', async () => {
    const { store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const first = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    const looking = store.loadRefreshState();
    const [second] = await Promise.all([store.requestMark(paid(ROBIN, doc, '1.00'), {}, '0.1.0'), store.cancel(first)]);
    await looking;
    expect(store.marks.map((m) => m.file)).toEqual([second.file]);
  });

  it('asked for after the folder was listed is kept', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const list = folder.list.bind(folder);
    let asked: PendingMark | undefined;
    let first = true;
    folder.list = async (path) => {
      const entries = await list(path);
      if (path === '_requests' && first) {
        first = false;
        asked = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
      }
      return entries;
    };
    await store.loadRefreshState();
    expect(store.marks).toEqual([asked]);
  });

  it('marked on another device waits here too, and its answer is read for', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    const here = new Store(folder);
    await here.load();
    expect([here.marks.map((x) => x.file), here.waiting, here.owed]).toEqual([[m.file], true, false]);
    answer(folder, m, 'ok');
    await here.loadRefreshState();
    expect([here.marks.map((x) => x.taken), here.waiting, here.owed]).toEqual([[true], false, true]);
  });

  it('recorded while the records are being read is shown until they are read once more', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    const reading = store.reload();
    const writeViews = await file(folder, m);
    await store.loadRefreshState();
    await reading.catch(() => undefined);
    expect([store.marks.map((x) => x.file), store.owed]).toEqual([[m.file], true]);
    writeViews();
    await store.reload();
    expect([store.marks, store.owed]).toEqual([[], false]);
  });

  it('recorded is not shown as waiting by a look the records were read during', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    (await file(folder, m))();
    const read = folder.readText.bind(folder);
    folder.readText = async (path) => {
      // The answer is read after the listing that shows it, and the records in between.
      if (path === `_requests/done/${m.file}`) await store.reload();
      return read(path);
    };
    await store.loadRefreshState();
    expect([store.marks, store.owed, store.answeredMarks.map((r) => r.id)]).toEqual([[], false, [m.request.id]]);
  });

  it('recorded is shown as that until medrec’s list shows it, and the list before it stands', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const bill = () => billList(store.index(ROBIN)!).find((b) => b.doc.id === doc)!;
    const m = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    // medrec's marks and its answer are there; its list is of before them.
    const writeViews = await file(folder, m);
    await store.loadRefreshState();
    for (let i = 0; i < 2; i++) {
      await expect(store.reload()).rejects.toThrow('medrec’s list of what is paid is older than their records.');
      expect([store.marks.map((x) => [x.file, x.taken, x.late]), store.owed]).toEqual([[[m.file, true, undefined]], true]);
      expect([bill().medrec !== undefined, bill().settled]).toEqual([true, false]);
    }
    writeViews();
    await store.reload();
    expect([store.marks, store.owed, bill().settled]).toEqual([[], false, true]);
  });

  it('recorded that the list never shows is dropped after a quarter of an hour', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    // A folder that gives the marks and the list of before, or an undo on the Mac since.
    answer(folder, m, 'ok');
    await store.loadRefreshState();
    await store.reload();
    expect([store.marks.map((x) => x.file), store.owed]).toEqual([[m.file], true]);
    minutes(14);
    await store.reload();
    expect([store.marks.map((x) => x.file), store.owed]).toEqual([[m.file], true]);
    minutes(1);
    expect([store.marks, store.owed]).toEqual([[], false]);
  });

  it('is found in the list by its bill, or the first copy of it, its day and its amount', async () => {
    const { store } = await loaded();
    const idx = store.index(ROBIN)!;
    const doc = owing(idx, '53.68');
    const held = (p: object, documents = idx.documents): PersonIndex => ({ ...idx, documents, bills: { ...idx.bills!, states: new Map([...idx.bills!.states, [doc.id, { settled: true, payments: [{ from: 'household' as const, id: 'o_1', on: '2026-11-17', amount: { amount: '53.68', currency: 'USD' }, ...p }] }]]) } });
    const shows = (index: PersonIndex | undefined, mark: ReturnType<typeof paid> | { unpaid: UnpaidMark }) => markRecorded({ ...mark } as MarkRequest, new Map(index ? [[ROBIN, index]] : []));
    const asked = paid(ROBIN, doc.id, '53.68');
    expect(shows(held({}), asked)).toBe(true);
    expect(shows(held({ amount: { amount: '53.680', currency: 'USD' } }), asked)).toBe(true);
    for (const p of [{ from: 'receipt' }, { on: '2026-11-16' }, { amount: { amount: '53.67', currency: 'USD' } }, { amount: { amount: '53.68', currency: 'EUR' } }, { amount: undefined }]) expect(shows(held(p), asked)).toBe(false);
    expect(shows(held({}, [...idx.documents, { ...doc, id: 'd_copy', same_statement_as: doc.id }]), paid(ROBIN, 'd_copy', '53.68'))).toBe(true);
    expect(shows(held({}), paid(ROBIN, 'd_copy', '53.68'))).toBe(false);
    const undo = (payment: string) => ({ unpaid: { person: ROBIN, payment } });
    expect([shows(held({}), undo('o_1')), shows(held({}), undo('o_2'))]).toEqual([false, true]);
    // No list says nothing.
    for (const index of [undefined, { ...idx, bills: undefined }]) expect([shows(index, asked), shows(index, undo('o_2'))]).toEqual([false, false]);
  });

  it('marked on another device and answered between two looks counts, and the records are read for it', async () => {
    const { folder, store: there } = await loaded();
    const doc = owing(there.index(ROBIN)!, '53.68').id;
    const here = new Store(folder);
    await here.load();
    const m = await there.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    const writeViews = await file(folder, m);
    for (let i = 0; i < 2; i++) {
      await here.loadRefreshState();
      expect([here.marks.map((x) => [x.file, x.taken, x.cancellable, x.late]), here.owed, here.waiting]).toEqual([[[m.file, true, false, undefined]], true, false]);
      await expect(here.reload()).rejects.toThrow('older than their records');
    }
    writeViews();
    await here.reload();
    expect([here.marks, here.owed, billList(here.index(ROBIN)!).find((b) => b.doc.id === doc)!.settled]).toEqual([[], false, true]);
    // An undo asked there as well.
    const payment = billList(here.index(ROBIN)!).find((b) => b.doc.id === doc)!.payments[0]!.id!;
    await there.reload();
    const undo = await there.requestMark({ unpaid: { person: ROBIN, payment } }, {}, '0.1.0');
    const undone = await file(folder, undo);
    await here.loadRefreshState();
    expect([here.marks.map((x) => [x.file, x.taken]), here.owed]).toEqual([[[undo.file, true]], true]);
    undone();
    await here.reload();
    expect([here.marks, here.owed]).toEqual([[], false]);
  });

  it('answered before the records were read is as they have it, also when they have it no more', async () => {
    const { folder, store: there } = await loaded();
    const doc = owing(there.index(ROBIN)!, '53.68').id;
    const here = new Store(folder);
    await here.load();
    // Recorded and, by the time the records are read, undone on the Mac.
    const one = await there.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    answer(folder, one, 'ok');
    const later = new Store(folder);
    await later.load();
    await later.loadRefreshState();
    expect([later.marks, later.owed]).toEqual([[], false]);
    await here.reload();
    await here.loadRefreshState();
    expect([here.marks, here.owed]).toEqual([[], false]);
    // The next is after them.
    const two = await there.requestMark(paid(ROBIN, doc, '1.00'), {}, '0.1.0');
    answer(folder, two, 'ok');
    await here.loadRefreshState();
    expect([here.marks.map((x) => x.file), here.owed]).toEqual([[two.file], true]);
    // Answered some other way, it counts for nothing.
    const three = await there.requestMark(paid(ROBIN, doc, '2.00'), {}, '0.1.0');
    answer(folder, three, 'failed');
    const four = await there.requestMark(paid(ROBIN, doc, '3.00'), {}, '0.1.0');
    answer(folder, four, 'skipped');
    await here.loadRefreshState();
    expect(here.marks.map((x) => x.file)).toEqual([two.file]);
  });

  it('whose answer did not read is taken in at the next look', async () => {
    for (const waits of [true, false]) {
      const { folder, store: there } = await loaded();
      const here = new Store(folder);
      await here.load();
      const m = await there.requestMark(paid(ROBIN, owing(there.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
      if (waits) await here.loadRefreshState();
      answer(folder, m, 'ok');
      const read = folder.readText.bind(folder);
      let fails = true;
      folder.readText = async (path) => {
        if (fails && path === `_requests/done/${m.file}`) throw new Error('Drive did not answer.');
        return read(path);
      };
      await here.loadRefreshState();
      expect(here.marks).toEqual([]);
      fails = false;
      await here.loadRefreshState();
      expect(here.marks.map((x) => [x.file, x.taken])).toEqual([[m.file, true]]);
    }
  });

  it('is asked only while what it was asked on stands, once the folder is looked at again', async () => {
    const { folder, store: there } = await loaded();
    const doc = owing(there.index(ROBIN)!, '53.68').id;
    const here = new Store(folder);
    await here.load();
    const stands = () => here.marks.length === 0;
    const m = await there.requestMark(paid(ROBIN, doc, '41.00'), {}, '0.1.0');
    const requests = async () => (await folder.list('_requests'))!.filter((e) => !e.folder).length;
    for (let i = 0; i < 2; i++) {
      await expect(here.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0', stands)).rejects.toThrow('What is left to pay has changed since this was opened, so nothing was sent.');
      expect([here.marks.map((x) => x.file), await requests()]).toEqual([[m.file], 1]);
    }
    // What the other device asked is the same request.
    expect((await here.requestMark(paid(ROBIN, doc, '41.00'), {}, '0.1.0', stands)).file).toBe(m.file);
    expect((await here.requestMark(paid(ROBIN, doc, '12.68'), {}, '0.1.0', () => here.marks.length === 1)).file).not.toBe(m.file);
    expect(await requests()).toBe(2);
  });

  it('the same as one asked on another device meanwhile is that one', async () => {
    const { folder, store: there } = await loaded();
    const doc = owing(there.index(ROBIN)!, '53.68').id;
    const here = new Store(folder);
    await here.load();
    const m = await there.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    expect((await here.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0', () => false)).file).toBe(m.file);
    expect((await folder.list('_requests'))!.filter((e) => !e.folder)).toHaveLength(1);
  });

  it('reads what is in the folder again only when something is new there', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    let reads = 0;
    const read = folder.readText.bind(folder);
    folder.readText = async (path) => {
      reads += path === '_status/status.json' ? 1 : 0;
      return read(path);
    };
    const m = await store.requestMark(paid(ROBIN, doc, '1.00'), {}, '0.1.0');
    expect(reads).toBe(0);
    answer(folder, m, 'failed');
    await store.requestMark(paid(ROBIN, doc, '2.00'), {}, '0.1.0');
    expect([reads, store.answeredMarks.map((r) => r.id)]).toEqual([1, [m.request.id]]);
  });

  it('lists the folder anew before it is asked', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const forgot: (string | undefined)[] = [];
    folder.forget = (...[prefix]: [string?]) => void forgot.push(prefix);
    await store.requestMark(paid(ROBIN, doc, '1.00'), {}, '0.1.0');
    expect(forgot).toEqual(['_requests']);
  });

  it('Drive did not answer is looked for, and the same asked again is that one', async () => {
    for (const stored of [true, false]) {
      const { folder, store } = await loaded();
      const doc = owing(store.index(ROBIN)!, '53.68').id;
      const create = folder.createRequest.bind(folder);
      const written: string[] = [];
      let lost = true;
      folder.createRequest = async (name, body) => {
        written.push(name);
        if (stored || !lost) await create(name, body);
        if (lost) throw new Unanswered('Google Drive did not answer.');
      };
      await expect(store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0')).rejects.toThrow('Google Drive did not answer.');
      expect([store.marks, store.waiting]).toEqual([[], true]);
      if (stored) {
        await store.loadRefreshState();
        expect(store.marks.map((x) => [x.file, x.cancellable])).toEqual([[written[0], true]]);
      }
      minutes(1);
      const again = () => store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
      if (!stored) await expect(again()).rejects.toThrow('Google Drive did not answer.');
      lost = false;
      expect((await again()).file).toBe(written[0]);
      expect(new Set(written).size).toBe(1);
      expect(store.marks.map((x) => x.file)).toEqual([written[0]]);
    }
  });

  it('Drive did not answer is not another payment, nor the same one taken back since', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const create = folder.createRequest.bind(folder);
    const ask = (amount: string) => store.requestMark(paid(ROBIN, doc, amount), {}, '0.1.0');
    const lose = async (amount: string, stored: boolean): Promise<string> => {
      let name = '';
      folder.createRequest = async (n, body) => {
        name = n;
        if (stored) await create(n, body);
        throw new Unanswered('Google Drive did not answer.');
      };
      await expect(ask(amount)).rejects.toThrow('Google Drive did not answer.');
      folder.createRequest = create;
      minutes(1);
      return name;
    };
    const lost = await lose('1.00', false);
    expect((await ask('2.00')).file).not.toBe(lost);
    // Sent at last, and taken back before any look.
    const one = await ask('1.00');
    expect(one.file).toBe(lost);
    await store.cancel(one);
    minutes(1);
    expect((await ask('1.00')).file).not.toBe(lost);
    // Found by a look, and taken back.
    const found = await lose('3.00', true);
    await store.loadRefreshState();
    await store.cancel(store.marks.find((m) => m.file === found)!);
    expect((await ask('3.00')).file).not.toBe(found);
    // What Drive refused was never there: asked again, it is of its own time.
    folder.createRequest = async () => Promise.reject(new Error('It may not.'));
    await expect(ask('4.00')).rejects.toThrow('It may not.');
    folder.createRequest = create;
    minutes(1);
    expect((await ask('4.00')).request.requested_at).toBe(new Date().toISOString().replace('.000Z', 'Z'));
  });

  it('answered while the records are read for something else is shown until they show it', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    // A folder that gives the answer, and the list of before.
    answer(folder, m, 'ok');
    await store.reload();
    await store.loadRefreshState();
    expect([store.marks.map((x) => [x.file, x.taken]), store.owed]).toEqual([[[m.file, true]], true]);
  });

  it('Drive did not answer, and which is not there at two looks, waits no more', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    folder.createRequest = async () => Promise.reject(new Unanswered('Google Drive did not answer.'));
    await expect(store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0')).rejects.toThrow();
    await store.loadRefreshState();
    expect(store.waiting).toBe(true);
    await store.loadRefreshState();
    expect([store.waiting, store.marks]).toEqual([false, []]);
    // What Drive refused is not there to look for.
    folder.createRequest = async () => Promise.reject(new Error('It may not.'));
    await expect(store.requestMark(paid(ROBIN, doc, '1.00'), {}, '0.1.0')).rejects.toThrow('It may not.');
    await expect(store.requestRefresh({ all: true }, {}, '0.1.0')).rejects.toThrow('It may not.');
    expect(store.waiting).toBe(false);
  });

  it('Drive did not answer and the Mac has is another when asked again', async () => {
    for (const where of ['waiting', 'answered'] as const) {
      const { folder, store } = await loaded();
      const doc = owing(store.index(ROBIN)!, '53.68').id;
      const create = folder.createRequest.bind(folder);
      folder.createRequest = async (name, body) => {
        await create(name, body);
        throw new Unanswered('Google Drive did not answer.');
      };
      await expect(store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0')).rejects.toThrow();
      folder.createRequest = create;
      if (where === 'waiting') await store.loadRefreshState();
      const name = (await folder.list('_requests'))!.find((e) => !e.folder)!.name;
      const request = JSON.parse((await folder.readText(`_requests/${name}`))!) as MarkRequest;
      answer(folder, { file: name, request, cancellable: true }, 'failed');
      await store.loadRefreshState();
      expect(store.answeredMarks.map((r) => r.id)).toEqual([request.id]);
      minutes(1);
      // A payment asked for once more is a new request: the first has its answer.
      expect((await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0')).request.id).not.toBe(request.id);
    }
  });

  it('a refresh Drive did not answer is looked for as well', async () => {
    const { folder, store } = await loaded();
    const create = folder.createRequest.bind(folder);
    folder.createRequest = async (name, body) => {
      await create(name, body);
      throw new Unanswered('Google Drive did not answer.');
    };
    await expect(store.requestRefresh({ all: true }, {}, '0.1.0')).rejects.toThrow('Google Drive did not answer.');
    expect([store.pending, store.waiting]).toEqual([[], true]);
    await store.loadRefreshState();
    expect([store.pending.map((p) => p.request.scope), store.waiting]).toEqual([[{ all: true }], true]);
  });

  it('that did not read this time still waits', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    const read = folder.readText.bind(folder);
    folder.readText = async (path) => {
      if (path === `_requests/${m.file}`) throw new Error('Drive did not answer.');
      return read(path);
    };
    await store.loadRefreshState();
    expect(store.marks.map((x) => x.file)).toEqual([m.file]);
  });

  it('is shown as recorded until the records are read again, and then only as they have it', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    (await file(folder, m))();
    await store.loadRefreshState();
    expect(store.marks).toEqual([{ file: m.file, request: { ...m.request, handled: expect.objectContaining({ outcome: 'ok' }) }, cancellable: false, taken: true }]);
    expect([store.owed, store.answeredMarks.map((r) => r.id)]).toEqual([true, [m.request.id]]);
    // Looking again changes nothing: the records are still to be read.
    await store.loadRefreshState();
    expect(store.marks).toHaveLength(1);
    await store.reload();
    expect([store.marks, store.owed]).toEqual([[], false]);
  });

  it('the Mac could not record waits no more, and is kept with what it said', async () => {
    const { folder, store } = await loaded();
    for (const outcome of ['failed', 'invalid']) {
      const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, outcome === 'failed' ? '1.00' : '2.00'), {}, '0.1.0');
      answer(folder, m, outcome);
      await store.loadRefreshState();
      expect(store.marks).toEqual([]);
      expect(store.answeredMarks.find((r) => r.id === m.request.id)?.handled).toMatchObject({ outcome, message: outcome });
    }
  });

  it('the Mac refused, with an answer that names only the request, is kept with what it said', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const m = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    const refuse = (of: string, name: string, message: string) => folder.writeAsMac(`_requests/done/${name}`, JSON.stringify({ schema: 'medrec-request/v1', id: of, received: { bytes: 9, sha256: '0' }, handled: { outcome: 'invalid', sources: [], message, by: 'medrec 0.9.0' } }));
    refuse('x_aaaaaaaaaaaaaaaaaaaa', '20261122T190000Z_x_aaaaaaaaaaaaaaaaaaaa.json', 'It is too large.');
    refuse(m.request.id, m.file, 'It names no scope.');
    folder.removeAsMac(`_requests/${m.file}`);
    for (let i = 0; i < 2; i++) {
      await store.loadRefreshState();
      expect([store.marks, store.answeredMarks]).toEqual([[], [{ ...m.request, handled: expect.objectContaining({ outcome: 'invalid', message: 'It names no scope.' }) }]]);
    }
  });

  it('taken back just after the Mac read it is read for once its answer is there, however many looks that takes', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const m = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    expect(await store.cancel(m)).toBe(true);
    for (let i = 0; i < 4; i++) {
      await store.loadRefreshState();
      expect([store.marks, store.waiting, store.owed]).toEqual([[], true, false]);
      minutes(3);
    }
    const writeViews = await file(folder, m);
    await store.loadRefreshState();
    expect([store.marks.map((x) => [x.file, x.taken, x.late]), store.owed, store.waiting]).toEqual([[[m.file, true, true]], true, false]);
    writeViews();
    await store.reload();
    expect([store.marks, store.owed, billList(store.index(ROBIN)!).find((b) => b.doc.id === doc)!.settled]).toEqual([[], false, true]);
  });

  it('taken back is looked for while a pass that read it before may be at work, and then no more', async () => {
    const status = demoJson<RefreshStatus>('_status/status.json');
    const { folder, store } = await loaded();
    const at = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const attempts = (last: object | null) => folder.writeAsMac('_status/status.json', JSON.stringify({ ...status, sources: status.sources.map((s, i) => ({ ...s, last_attempt: i ? null : last })) }));
    const waits = async () => {
      await store.loadRefreshState();
      return store.waiting;
    };
    attempts(null);
    const taken = async () => {
      const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
      expect(await store.cancel(m)).toBe(true);
      expect([await waits(), await waits()]).toEqual([true, true]);
    };
    await taken();
    minutes(14);
    expect(await waits()).toBe(true);
    minutes(1);
    expect(await waits()).toBe(false);
    // While an import runs, and two minutes after the last of them.
    await taken();
    minutes(20);
    attempts({ outcome: 'running', started_at: at(60_000), finished_at: null, requests: [] });
    expect(await waits()).toBe(true);
    minutes(1);
    attempts({ outcome: 'ok', started_at: at(120_000), finished_at: at(119_000), requests: [] });
    expect(await waits()).toBe(true);
    attempts({ outcome: 'ok', started_at: at(180_000), finished_at: at(120_000), requests: [] });
    expect(await waits()).toBe(false);
    // With no status, its time alone.
    await taken();
    folder.removeAsMac('_status/status.json');
    expect(await waits()).toBe(true);
    minutes(15);
    expect(await waits()).toBe(false);
  });

  it('taken back on another device is looked for here as well', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    const here = new Store(folder);
    await here.load();
    await store.cancel(m);
    for (let i = 0; i < 4; i++) {
      await here.loadRefreshState();
      expect([here.marks, here.waiting]).toEqual([[], true]);
    }
    (await file(folder, m))();
    await here.loadRefreshState();
    expect([here.marks.map((x) => [x.taken, x.late]), here.owed]).toEqual([[[true, undefined]], true]);
    await here.reload();
    expect([here.marks, here.owed, here.waiting]).toEqual([[], false, false]);
  });

  it('the Mac has already answered says so when it is taken back, before or after its file goes', async () => {
    for (const when of ['before', 'after'] as const) {
      const { folder, store } = await loaded();
      const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
      const done = () => folder.writeAsMac(`_requests/done/${m.file}`, JSON.stringify({ ...m.request, handled: { outcome: 'ok', sources: [], message: 'ok', by: 'medrec 0.9.6' } }));
      const remove = folder.deleteRequest.bind(folder);
      let removed = 0;
      folder.deleteRequest = async (name) => {
        removed += 1;
        const was = await remove(name);
        if (when === 'after') done();
        return was;
      };
      // medrec left the file: it is another account's.
      if (when === 'before') done();
      expect(await store.cancel(m)).toBe(false);
      expect(removed).toBe(when === 'before' ? 0 : 1);
      // It stays in sight until the next look reads the answer.
      expect(store.marks).toEqual([{ ...m, cancellable: false }]);
      await store.loadRefreshState();
      expect([store.marks.map((x) => [x.taken, x.late]), store.owed]).toEqual([[[true, undefined]], true]);
    }
  });

  it('is taken back only after the answers are listed anew', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    // A folder that keeps its listings until they are forgotten, as Drive's does.
    const [listings, list] = [new Map<string, ReturnType<DemoFolder['list']>>(), folder.list.bind(folder)];
    folder.list = (path) => listings.get(path) ?? listings.set(path, list(path)).get(path)!;
    folder.forget = (...[prefix]: [string?]) => [...listings.keys()].forEach((k) => (k === prefix || k.startsWith(`${prefix}/`)) && listings.delete(k));
    const m = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    await store.loadRefreshState();
    folder.writeAsMac(`_requests/done/${m.file}`, JSON.stringify({ ...m.request, handled: { outcome: 'ok', sources: [], message: '', by: 'medrec 0.9.6' } }));
    expect(await store.cancel(m)).toBe(false);
  });

  it('whose file is gone with no answer was taken back elsewhere', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    folder.removeAsMac(`_requests/${m.file}`);
    expect(await store.cancel(m)).toBe(false);
    await store.loadRefreshState();
    expect([store.marks, store.waiting]).toEqual([[], true]);
  });

  it('is taken back though its answer could not be looked for after, and not when it could not be before', async () => {
    const { folder, store } = await loaded();
    const doc = owing(store.index(ROBIN)!, '53.68').id;
    const list = folder.list.bind(folder);
    let fails = 0;
    folder.list = async (path) => {
      if (path === '_requests/done' && (fails -= 1) === 0) throw new Error('Drive did not answer.');
      return list(path);
    };
    const m = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
    fails = 1;
    await expect(store.cancel(m)).rejects.toThrow('Drive did not answer.');
    expect([store.marks, await folder.readText(`_requests/${m.file}`) !== null]).toEqual([[m], true]);
    fails = 2;
    expect(await store.cancel(m)).toBe(true);
    expect([store.marks, store.waiting]).toEqual([[], true]);
  });

  it('a refresh taken back is looked for no more', async () => {
    const { store } = await loaded();
    const p = await store.requestRefresh({ all: true }, {}, '0.1.0');
    expect(await store.cancel(p)).toBe(true);
    expect([store.pending, store.waiting]).toEqual([[], false]);
  });

  it('is asked of the medrec that answers requests', async () => {
    const status = demoJson<RefreshStatus>('_status/status.json');
    const of = async (text: string | null) => (await loaded(demoFolderWith({ '_status/status.json': text }))).store.refresher;
    expect(await of(JSON.stringify({ ...status, refresher: { ...status.refresher, medrec_version: '0.9.7' } }))).toBe('0.9.7');
    expect([await of(JSON.stringify({ ...status, refresher: {} })), await of(null), await of('{')]).toEqual([undefined, undefined, undefined]);
  });

  it('is asked of a medrec that records it, by an account that may', async () => {
    const { store } = await loaded();
    expect([store.medrec, store.mayRequest]).toEqual(['0.9.7', true]);
    const folder = demoFolder(NOW);
    const viewer = async (may: boolean | undefined) => {
      folder.mayRequest = async () => may;
      await store.loadRefreshState();
      return store.mayRequest;
    };
    store.folder = folder;
    expect([await viewer(false), await viewer(undefined), await viewer(true)]).toEqual([false, true, true]);
    const none = await loaded(demoFolderWith({ 'views/views.json': null }));
    expect(none.store.medrec).toBeUndefined();
    const later = await loaded(demoFolderWith({ 'views/views.json': JSON.stringify({ ...demoJson<object>('views/views.json'), medrec: '0.9.6' }) }));
    expect(later.store.medrec).toBe('0.9.6');
    later.folder.writeAsMac('views/views.json', JSON.stringify({ ...demoJson<object>('views/views.json'), medrec: '0.9.8' }));
    await later.store.reload();
    expect(later.store.medrec).toBe('0.9.8');
  });
});

describe('the sample’s Mac', () => {
  const marked = async (mark: { paid: PaidMark } | { unpaid: UnpaidMark }, from?: { folder: DemoFolder; store: Store }) => {
    const { folder, store } = from ?? (await loaded());
    const mac = startDemoMac(folder, () => undefined);
    const m = await store.requestMark(mark, { name: 'Sample visitor' }, '0.1.0');
    mac(m.file);
    await vi.advanceTimersByTimeAsync(7900);
    await store.loadRefreshState();
    const waited = store.marks.map((x) => x.taken ?? false);
    await vi.advanceTimersByTimeAsync(200);
    await store.loadRefreshState();
    await store.reload();
    return { folder, store, waited, done: store.answeredMarks.find((r) => r.id === m.request.id)!, bill: (person: string, id: string) => billList(store.index(person)!).find((b) => b.doc.id === id)! };
  };

  it('settles a bill paid in full, and lists its payment by an id', async () => {
    const doc = owing((await loaded()).store.index(SAM)!, '90.50').id;
    const { store, waited, done, bill } = await marked(paid(SAM, doc, '90.50'));
    expect([waited, done.handled?.outcome, done.paid?.document]).toEqual([[false], 'ok', doc]);
    expect(bill(SAM, doc)).toMatchObject({ settled: true, payments: [{ from: 'household', on: '2026-11-17', amount: { amount: '90.50', currency: 'USD' } }] });
    expect(bill(SAM, doc).payments[0]!.id).toMatch(/^o_[a-z2-7]{20}$/);
    expect([store.billsNotes.size, store.mayBring()]).toEqual([0, false]);
  });

  it('leaves the rest of one paid in part, and counts a second payment', async () => {
    const start = await loaded();
    const doc = owing(start.store.index(SAM)!, '90.50').id;
    const one = await marked(paid(SAM, doc, '55'), start);
    expect(one.bill(SAM, doc)).toMatchObject({ settled: false, left: { amount: '35.50', currency: 'USD' } });
    const two = await marked(paid(SAM, doc, '48.00', '2026-11-05'), one);
    expect(two.bill(SAM, doc)).toMatchObject({ settled: true, payments: [{ on: '2026-11-05' }, { on: '2026-11-17', amount: { amount: '55.00' } }] });
    const again = await marked(paid(SAM, doc, '55.00'), two);
    expect([again.bill(SAM, doc).payments.length, again.done.handled?.message]).toEqual([2, 'It was marked already.']);
  });

  it('does not take off a payment in another currency', async () => {
    const doc = owing((await loaded()).store.index(SAM)!, '90.50').id;
    const { bill } = await marked({ paid: { person: SAM, document: doc, on: '2026-11-17', amount: { amount: '90.50', currency: 'EUR' } } });
    expect(bill(SAM, doc)).toMatchObject({ settled: false, left: { amount: '90.50' }, payments: [{ apart: true }] });
  });

  it('drops a payment, and has nothing to undo twice', async () => {
    const start = await loaded();
    const doc = owing(start.store.index(SAM)!, '90.50').id;
    const one = await marked(paid(SAM, doc, '90.50'), start);
    const unpaid = { unpaid: { person: SAM, payment: one.bill(SAM, doc).payments[0]!.id! } };
    const two = await marked(unpaid, one);
    expect(two.bill(SAM, doc)).toMatchObject({ settled: false, left: { amount: '90.50' }, payments: [] });
    expect(two.done).toMatchObject({ unpaid: unpaid.unpaid, handled: { outcome: 'ok' } });
    vi.setSystemTime(new Date('2026-11-22T21:00:00Z'));
    expect((await marked(unpaid, two)).done.handled?.message).toBe('There was nothing to undo.');
  });

  it('refuses what is not one of the person’s bills, and does nothing once it is undone', async () => {
    const start = await loaded();
    const receipt = start.store.index(ROBIN)!.documents.find((d) => d.doc_type === 'receipt')!;
    for (const [person, doc] of [[ROBIN, receipt.id], [ROBIN, owing(start.store.index(SAM)!, '90.50').id], ['p_nobody', receipt.id]] as const) expect((await marked(paid(person, doc, '5.00'), start)).done.handled?.outcome).toBe('invalid');
    const mac = startDemoMac(start.folder, () => undefined);
    const m = await start.store.requestMark(paid(SAM, owing(start.store.index(SAM)!, '90.50').id, '90.50'), {}, '0.1.0');
    mac(m.file);
    await vi.advanceTimersByTimeAsync(100);
    await start.store.cancel(m);
    await vi.advanceTimersByTimeAsync(9000);
    expect(await start.folder.readText(`_requests/done/${m.file}`)).toBeNull();
  });
});

describe('a bill whose payment waits for the Mac', () => {
  const request = (p: { person: string; document: string; on: string; amount: string }): MarkRequest => ({ schema: 'medrec-request/v1', id: 'x_aaaaaaaaaaaaaaaaaaaa', requested_at: '2026-11-22T20:00:00Z', requested_by: {}, app: { name: 'own-your-health-app', version: '0.1.0' }, paid: p });
  const mark = (person: string, document: string, amount: string): PendingMark => ({ file: 'a.json', request: request({ person, document, on: '2026-11-17', amount }), cancellable: true });

  it('is neither to pay, worth a call, nor one that may be paid when that covers what is left', async () => {
    const { store } = await loaded();
    const idx = store.index(SAM)!;
    const events = householdEvents(store.household, (id) => store.index(id), TODAY).filter((x) => x.person.id === SAM);
    const [billing, center] = [owing(idx, '120.00'), owing(idx, '90.50')];
    const receipt: MedDocument = { ...billing, id: 'd_unread', doc_type: 'receipt', date: '2026-08-26', statement: undefined };
    const open = (amount: string | null, from: PersonIndex = idx, doc = billing) => openBills(from, events, TODAY, amount === null ? [] : [mark(SAM, doc.id, amount)]).find((b) => b.bill.doc.id === doc.id)!;
    const kinds = (b: ReturnType<typeof open>) => [b.marked, worthACall(b), mayBePaid(b), toPay(b)];
    expect(kinds(open(null))).toEqual([false, true, false, false]);
    expect(kinds(open('119.99'))).toEqual([false, true, false, false]);
    expect([kinds(open('120.00')), kinds(open('136.00'))]).toEqual([[true, false, false, false], [true, false, false, false]]);
    expect(kinds(open('90.50', idx, center))).toEqual([true, false, false, false]);
    expect(kinds(open('90.49', idx, center))).toEqual([false, false, false, true]);
    const unread = { ...idx, documents: [...idx.documents, receipt] };
    expect([kinds(open(null, unread)), kinds(open('120.00', unread))]).toEqual([[false, false, true, false], [true, false, false, false]]);
    expect(open('120.00').marks).toHaveLength(1);
    expect(callsSummary([open('120.00')], (b) => b).asksMore).toEqual([]);
  });

  it('keeps what it asks and what is left, as medrec has them, and says what no payment is marked for', async () => {
    const { store } = await loaded();
    const idx = store.index(SAM)!;
    const bill = billList(idx).find((b) => b.doc.id === owing(idx, '90.50').id)!;
    const marks = [mark(SAM, bill.doc.id, '48.00')];
    expect([unmarkedCents(bill, []), unmarkedCents(bill, marks), unmarkedCents(bill, [...marks, ...marks])]).toEqual([9050, 4250, 0]);
    const [open] = openBills(idx, [], TODAY, marks).filter((b) => b.bill.doc.id === bill.doc.id);
    expect([open!.cents, open!.asked]).toEqual([9050, 9050]);
  });

  it('takes a payment marked on a copy of its statement, and none of another person’s', async () => {
    const { store } = await loaded();
    const idx = store.index(SAM)!;
    const bill = billList(idx).find((b) => b.doc.id === owing(idx, '90.50').id)!;
    const copied = { ...idx, documents: [...idx.documents, { ...bill.doc, id: 'd_copy', same_statement_as: bill.doc.id }] };
    expect(billMarks(copied, bill, [mark(SAM, 'd_copy', '1.00')])).toHaveLength(1);
    expect(billMarks(idx, bill, [mark(SAM, 'd_copy', '1.00'), mark(ROBIN, bill.doc.id, '1.00')])).toEqual([]);
  });
});
