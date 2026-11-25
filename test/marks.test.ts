// Mark paid: the request the store writes, what waits for the Mac, what the
// records show once they are read again, and what a marked bill is meanwhile.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDemoMac } from '../src/data/demo-mac';
import { Store } from '../src/data/store';
import type { DemoFolder } from '../src/folder';
import { billList } from '../src/model/billing';
import { householdEvents } from '../src/next/calendar';
import { billMarks, callsSummary, mayBePaid, openBills, toPay, unmarkedCents, worthACall } from '../src/next/money';
import type { MarkRequest, MedDocument, PaidMark, PendingMark, PersonIndex, UnpaidMark } from '../src/model/types';
import { demoFolder, demoFolderWith, demoJson } from './helpers';

const NOW = new Date('2026-11-22T20:00:00Z');
const TODAY = '2026-11-22';
const ROBIN = 'p_xo4em46i7yj3hphlpajo';
const SAM = 'p_wwezzed7kml67hnp6s7n';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const owing = (idx: PersonIndex, amount: string): MedDocument => idx.documents.find((d) => d.statement?.amount_due?.amount === amount)!;
const paid = (person: string, document: string, amount: string, on = '2026-11-20') => ({ paid: { person, document, on, amount } });

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
      paid: { person: ROBIN, document: doc, on: '2026-11-20', amount: '53.68' },
    });
    // The same again is the one that waits; another day is another payment.
    expect(await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0')).toBe(m);
    const other = await store.requestMark(paid(ROBIN, doc, '53.68', '2026-11-21'), {}, '0.1.0');
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
    folder.list = async (path) => {
      const entries = await list(path);
      if (path === '_requests') asked = await store.requestMark(paid(ROBIN, doc, '53.68'), {}, '0.1.0');
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
    answer(folder, m, 'ok');
    await store.loadRefreshState();
    await reading;
    expect([store.marks.map((x) => x.file), store.owed]).toEqual([[m.file], true]);
    await store.reload();
    expect([store.marks, store.owed]).toEqual([[], false]);
  });

  it('recorded is not shown as waiting by a look the records were read during', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    answer(folder, m, 'ok');
    const read = folder.readText.bind(folder);
    folder.readText = async (path) => {
      // The answer is read after the listing that shows it, and the records in between.
      if (path === `_requests/done/${m.file}`) await store.reload();
      return read(path);
    };
    await store.loadRefreshState();
    expect([store.marks, store.owed, store.answeredMarks.map((r) => r.id)]).toEqual([[], false, [m.request.id]]);
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
    answer(folder, m, 'ok');
    await store.loadRefreshState();
    expect(store.marks).toEqual([{ ...m, cancellable: false, taken: true }]);
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

  it('taken back just after the Mac read it is read for once its answer is there', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    expect(await store.cancel(m)).toBe(true);
    expect([store.marks, store.waiting]).toEqual([[], true]);
    answer(folder, m, 'ok');
    await store.loadRefreshState();
    expect([store.owed, store.waiting]).toEqual([true, false]);
  });

  it('the Mac has already taken says so when it is taken back', async () => {
    const { folder, store } = await loaded();
    const m = await store.requestMark(paid(ROBIN, owing(store.index(ROBIN)!, '53.68').id, '53.68'), {}, '0.1.0');
    answer(folder, m, 'ok');
    expect(await store.cancel(m)).toBe(false);
  });

  it('is asked of a medrec that records it, by an account that may', async () => {
    const { store } = await loaded();
    expect([store.medrec, store.mayRequest]).toEqual(['0.9.5', true]);
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
    const later = await loaded(demoFolderWith({ 'views/views.json': JSON.stringify({ ...demoJson<object>('views/views.json'), medrec: '0.9.7' }) }));
    expect(later.store.medrec).toBe('0.9.7');
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
    const doc = owing((await loaded()).store.index(SAM)!, '175.00').id;
    const { store, waited, done, bill } = await marked(paid(SAM, doc, '175.00'));
    expect([waited, done.handled?.outcome, done.paid?.document]).toEqual([[false], 'ok', doc]);
    expect(bill(SAM, doc)).toMatchObject({ settled: true, payments: [{ from: 'household', on: '2026-11-20', amount: { amount: '175.00', currency: 'USD' } }] });
    expect(bill(SAM, doc).payments[0]!.id).toMatch(/^o_[a-z2-7]{20}$/);
    expect([store.billsNotes.size, store.mayBring()]).toEqual([0, false]);
  });

  it('leaves the rest of one paid in part, and counts a second payment', async () => {
    const start = await loaded();
    const doc = owing(start.store.index(SAM)!, '175.00').id;
    const one = await marked(paid(SAM, doc, '75'), start);
    expect(one.bill(SAM, doc)).toMatchObject({ settled: false, left: { amount: '100.00', currency: 'USD' } });
    const two = await marked(paid(SAM, doc, '120.00', '2026-11-01'), one);
    expect(two.bill(SAM, doc)).toMatchObject({ settled: true, payments: [{ on: '2026-11-01' }, { on: '2026-11-20', amount: { amount: '75.00' } }] });
    const again = await marked(paid(SAM, doc, '75.00'), two);
    expect([again.bill(SAM, doc).payments.length, again.done.handled?.message]).toEqual([2, 'It was marked already.']);
  });

  it('does not take off a payment in another currency', async () => {
    const doc = owing((await loaded()).store.index(SAM)!, '175.00').id;
    const { bill } = await marked({ paid: { person: SAM, document: doc, on: '2026-11-20', amount: { amount: '175.00', currency: 'EUR' } } });
    expect(bill(SAM, doc)).toMatchObject({ settled: false, left: { amount: '175.00' }, payments: [{ apart: true }] });
  });

  it('drops a payment, and has nothing to undo twice', async () => {
    const start = await loaded();
    const doc = owing(start.store.index(SAM)!, '175.00').id;
    const one = await marked(paid(SAM, doc, '175.00'), start);
    const unpaid = { unpaid: { person: SAM, payment: one.bill(SAM, doc).payments[0]!.id! } };
    const two = await marked(unpaid, one);
    expect(two.bill(SAM, doc)).toMatchObject({ settled: false, left: { amount: '175.00' }, payments: [] });
    expect(two.done).toMatchObject({ unpaid: unpaid.unpaid, handled: { outcome: 'ok' } });
    vi.setSystemTime(new Date('2026-11-22T21:00:00Z'));
    expect((await marked(unpaid, two)).done.handled?.message).toBe('There was nothing to undo.');
  });

  it('refuses what is not one of the person’s bills, and does nothing once it is undone', async () => {
    const start = await loaded();
    const receipt = start.store.index(ROBIN)!.documents.find((d) => d.doc_type === 'receipt')!;
    for (const [person, doc] of [[ROBIN, receipt.id], [ROBIN, owing(start.store.index(SAM)!, '175.00').id], ['p_nobody', receipt.id]] as const) expect((await marked(paid(person, doc, '5.00'), start)).done.handled?.outcome).toBe('invalid');
    const mac = startDemoMac(start.folder, () => undefined);
    const m = await start.store.requestMark(paid(SAM, owing(start.store.index(SAM)!, '175.00').id, '175.00'), {}, '0.1.0');
    mac(m.file);
    await vi.advanceTimersByTimeAsync(100);
    await start.store.cancel(m);
    await vi.advanceTimersByTimeAsync(9000);
    expect(await start.folder.readText(`_requests/done/${m.file}`)).toBeNull();
  });
});

describe('a bill whose payment waits for the Mac', () => {
  const request = (p: { person: string; document: string; on: string; amount: string }): MarkRequest => ({ schema: 'medrec-request/v1', id: 'x_aaaaaaaaaaaaaaaaaaaa', requested_at: '2026-11-22T20:00:00Z', requested_by: {}, app: { name: 'own-your-health-app', version: '0.1.0' }, paid: p });
  const mark = (person: string, document: string, amount: string): PendingMark => ({ file: 'a.json', request: request({ person, document, on: '2026-11-20', amount }), cancellable: true });

  it('is neither to pay, worth a call, nor one that may be paid when that covers what is left', async () => {
    const { store } = await loaded();
    const idx = store.index(SAM)!;
    const events = householdEvents(store.household, (id) => store.index(id), TODAY).filter((x) => x.person.id === SAM);
    const [billing, surgery] = [owing(idx, '120.00'), owing(idx, '175.00')];
    const receipt: MedDocument = { ...billing, id: 'd_unread', doc_type: 'receipt', date: '2026-08-20', statement: undefined };
    const open = (amount: string | null, from: PersonIndex = idx, doc = billing) => openBills(from, events, TODAY, amount === null ? [] : [mark(SAM, doc.id, amount)]).find((b) => b.bill.doc.id === doc.id)!;
    const kinds = (b: ReturnType<typeof open>) => [b.marked, worthACall(b), mayBePaid(b), toPay(b)];
    expect(kinds(open(null))).toEqual([false, true, false, false]);
    expect(kinds(open('119.99'))).toEqual([false, true, false, false]);
    expect([kinds(open('120.00')), kinds(open('130.00'))]).toEqual([[true, false, false, false], [true, false, false, false]]);
    expect(kinds(open('175.00', idx, surgery))).toEqual([true, false, false, false]);
    expect(kinds(open('174.00', idx, surgery))).toEqual([false, false, false, true]);
    const unread = { ...idx, documents: [...idx.documents, receipt] };
    expect([kinds(open(null, unread)), kinds(open('120.00', unread))]).toEqual([[false, false, true, false], [true, false, false, false]]);
    expect(open('120.00').marks).toHaveLength(1);
    expect(callsSummary([open('120.00')], (b) => b).asksMore).toEqual([]);
  });

  it('keeps what it asks and what is left, as medrec has them, and says what no payment is marked for', async () => {
    const { store } = await loaded();
    const idx = store.index(SAM)!;
    const bill = billList(idx).find((b) => b.doc.id === owing(idx, '175.00').id)!;
    const marks = [mark(SAM, bill.doc.id, '100.00')];
    expect([unmarkedCents(bill, []), unmarkedCents(bill, marks), unmarkedCents(bill, [...marks, ...marks])]).toEqual([17500, 7500, 0]);
    const [open] = openBills(idx, [], TODAY, marks).filter((b) => b.bill.doc.id === bill.doc.id);
    expect([open!.cents, open!.asked]).toEqual([17500, 17500]);
  });

  it('takes a payment marked on a copy of its statement, and none of another person’s', async () => {
    const { store } = await loaded();
    const idx = store.index(SAM)!;
    const bill = billList(idx).find((b) => b.doc.id === owing(idx, '175.00').id)!;
    const copied = { ...idx, documents: [...idx.documents, { ...bill.doc, id: 'd_copy', same_statement_as: bill.doc.id }] };
    expect(billMarks(copied, bill, [mark(SAM, 'd_copy', '1.00')])).toHaveLength(1);
    expect(billMarks(idx, bill, [mark(SAM, 'd_copy', '1.00'), mark(ROBIN, bill.doc.id, '1.00')])).toEqual([]);
  });
});
