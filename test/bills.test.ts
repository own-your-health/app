// What medrec says of the bills (views/<person id>/bills.json): reading it, and
// when the store takes it or leaves the receipts to say what is paid. Both the
// list read here and the "paid" case are medrec's own (scripts/rule-fixtures.mjs
// and scripts/bill-fixtures.mjs).
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { parseBills } from '../src/model/bills';
import { openList } from '../src/model/billing';
import { FolderError } from '../src/model/parse';
import { demoFolderWith, demoJson, fixture, paidCase, type Overlay } from './helpers';
import { ROBIN, SAM } from './sample';

const raw = () => fixture<Record<string, unknown> & { person: string; bills: Record<string, Record<string, unknown>>; worth_a_call: unknown[] }>('rules/bills.json');
const PERSON = raw().person;
const usd = (amount: string) => ({ amount, currency: 'USD' });
const [LAB, DENTAL, THERAPY, EARLIER] = Object.keys(raw().bills) as [string, string, string, string];

describe('reading bills.json', () => {
  it('takes each bill’s payments, what is left, whether it is settled and what replaces it', () => {
    const { states } = parseBills(raw(), PERSON);
    expect([...states.keys()]).toEqual([LAB, DENTAL, THERAPY, EARLIER]);
    const id = expect.stringMatching(/^o_/) as string;
    expect(states.get(LAB)).toEqual({
      payments: [
        { from: 'receipt', document: expect.stringMatching(/^d_/) as string, on: '2026-09-20', amount: usd('40.00') },
        { from: 'household', id, on: '2026-09-28', amount: usd('10.00') },
        { from: 'household', id, on: '2026-09-29', amount: { amount: '8.00', currency: 'EUR' }, apart: true },
      ],
      left: usd('40.00'),
      settled: false,
      claim: expect.stringMatching(/^r_/) as string,
      owed: usd('64.00'),
    });
    expect(states.get(DENTAL)).toMatchObject({ settled: true, left: usd('0.00') });
    expect(states.get(EARLIER)).toEqual({ payments: [], settled: false, replacedBy: LAB });
  });

  it('takes what is worth a call, never of a settled bill, nor for a reason it does not know', () => {
    const calls = [
      { reason: 'asks_more', document: LAB, asked: usd('90.00'), owed: usd('64.00') },
      { reason: 'no_claim', document: THERAPY, asked: usd('30.00') },
      { reason: 'desk_copay', document: expect.stringMatching(/^d_/) as string, asked: usd('45.00'), owed: usd('25.00') },
    ];
    expect(parseBills(raw(), PERSON).calls).toEqual(calls);
    // A medrec before 0.9.6 also lists a settled one.
    const before = [{ reason: 'no_claim', bill: DENTAL, claim: null, event: null, asked: '120.00', owed: null, currency: 'USD' }];
    const later = [{ reason: 'a_later_reason', bill: THERAPY, asked: '30.00', owed: null, currency: 'USD' }];
    expect(parseBills({ ...raw(), worth_a_call: [...before, ...raw().worth_a_call, ...later] }, PERSON).calls).toEqual(calls);
  });

  it('says whether the household’s marks could be read', () => {
    expect(parseBills(raw(), PERSON).marksUnreadable).toBe(false);
    expect(parseBills({ ...raw(), marks_unreadable: true }, PERSON).marksUnreadable).toBe(true);
    expect(parseBills({ ...raw(), marks_unreadable: false }, PERSON).marksUnreadable).toBe(false);
  });

  it('refuses what is not this person’s list, or does not read', () => {
    const refused = (v: unknown) => {
      try {
        parseBills(v, PERSON);
      } catch (e) {
        return e instanceof FolderError ? e.kind : e;
      }
      return 'read';
    };
    expect(refused(raw())).toBe('read');
    expect(refused({ ...raw(), schema: 'medrec-bills/v2' })).toBe('newer_format');
    const bill = raw().bills[LAB]!;
    const changed = (b: Record<string, unknown>) => ({ ...raw(), bills: { [LAB]: { ...bill, ...b } } });
    const malformed = [null, [], 'x', {}, { ...raw(), schema: 'medrec-private/v1' }, { ...raw(), schema: 1 }, { ...raw(), person: 'p_other' }, { ...raw(), bills: undefined }, { ...raw(), worth_a_call: {} }, { ...raw(), bills: { [LAB]: null } }, changed({ settled: 'true' }), changed({ paid: {} }), changed({ paid: [null] }), changed({ paid: [{ from: 'elsewhere' }] })];
    expect(malformed.map(refused)).toEqual(malformed.map(() => 'malformed'));
  });

  it('leaves out an amount that is none', () => {
    const bill = { ...raw().bills[LAB]!, left: 'forty', claim_you_owe: 64 };
    const { states, calls } = parseBills({ ...raw(), bills: { [LAB]: bill }, worth_a_call: [null, { reason: 'asks_more' }, { reason: 'asks_more', bill: LAB, asked: 'ninety', owed: null }] }, PERSON);
    expect([states.get(LAB)!.left, states.get(LAB)!.owed, calls]).toEqual([undefined, undefined, [{ reason: 'asks_more', document: LAB }]]);
  });
});

describe('the store', () => {
  async function load(overlay: Overlay = {}, manifest?: Parameters<typeof demoFolderWith>[1]): Promise<Store> {
    const store = new Store(demoFolderWith(overlay, manifest));
    await store.load();
    return store;
  }
  const listed = (store: Store, id = ROBIN) => [store.index(id)!.bills !== undefined, store.billsNotes.get(id)];
  const file = demoJson<{ files: string[] }>('manifest.json').files.find((f) => f.startsWith(`views/${ROBIN}/bills.`))!;
  const text = JSON.stringify(demoJson(file));
  const folder = demoJson<{ people: { id: string; folder: string }[] }>('household.json').people.find((p) => p.id === ROBIN)!.folder;

  it('attaches each person’s list when the folder holds what it was made from', async () => {
    const store = await load();
    expect(store.household.people.map((p) => listed(store, p.id))).toEqual(store.household.people.map(() => [true, undefined]));
    expect(store.mayBring()).toBe(false);
  });

  it('takes the household’s payments with it', async () => {
    const store = await load(paidCase());
    const left = (id: string) => openList(store.index(id)!).map((b) => [b.provider, b.left?.amount]);
    expect([left(ROBIN), left(SAM)]).toEqual([[['Example Health', '33.68']], [['Example Endoscopy Center', '90.50']]]);
    expect(store.index(SAM)!.bills!.calls).toEqual([]);
    expect((await load()).snapshot).not.toBe(store.snapshot);
  });

  it('leaves it out, and says why, when marks or records are newer than it', async () => {
    const behind = [false, 'medrec’s list of what is paid is older than their records.'];
    const marks = `${folder}/marks.json`;
    const store = await load({ [marks]: paidCase()[marks]! });
    expect([listed(store), listed(store, SAM)]).toEqual([behind, [true, undefined]]);
    expect([store.mayBring(), openList(store.index(ROBIN)!).map((b) => b.left?.amount)]).toEqual([true, ['53.68', '19.28']]);
    const path = `${folder}/index.json`;
    expect(listed(await load({ [path]: `${JSON.stringify(demoJson(path))} ` }))).toEqual(behind);
    expect(listed(await load({ 'household.json': `${JSON.stringify(demoJson('household.json'))} ` }))).toEqual(behind);
  });

  it('reads again for a list medrec is still writing, or the folder could not compare', async () => {
    const arriving = [false, 'medrec is still writing its list of what is paid.'];
    for (const overlay of [{ [file]: null }, { [file]: `${text} ` }]) {
      const store = await load(overlay);
      expect([listed(store), store.mayBring()]).toEqual([arriving, true]);
    }
    const unchecked = await load({}, (m) => void delete m.md5);
    expect([listed(unchecked), unchecked.mayBring()]).toEqual([[false, 'medrec’s list of what is paid could not be checked against their records.'], true]);
    expect((await load({ [file]: null })).snapshot).not.toBe((await load()).snapshot);
  });

  it('says when a list does not read, and does not read again for it', async () => {
    const was = (m: { md5?: Record<string, string> }) => void (m.md5![file] = demoJson<{ md5: Record<string, string> }>('manifest.json').md5[file]!);
    const newer = await load({ [file]: text.replace('medrec-bills/v1', 'medrec-bills/v2') }, was);
    expect([listed(newer), newer.mayBring()]).toEqual([[false, 'medrec’s list of what is paid could not be read: it is written by a newer medrec. Update the app.'], false]);
    const [bad, note] = listed(await load({ [file]: '{' }, was));
    expect([bad, String(note)]).toEqual([false, expect.stringMatching(/^medrec’s list of what is paid could not be read: /)]);
  });

  it('says so for everyone when views.json itself can’t be used, and nothing when medrec writes no list', async () => {
    const views = demoJson<{ schema: string; people: Record<string, { files: Record<string, string> }> }>('views/views.json');
    const newer = await load({ 'views/views.json': JSON.stringify({ ...views, schema: 'medrec-views/v3' }) });
    expect(listed(newer)).toEqual([false, 'medrec’s views, which say what is paid, are written by a newer medrec. Update the app.']);
    expect(newer.billsNotes.size).toBe(newer.household.people.length);
    expect(listed(await load({ 'views/views.json': '{' }))).toEqual([false, 'medrec’s views, which say what is paid, could not be read.']);
    for (const overlay of [{ 'views/views.json': null }, { 'views/views.json': JSON.stringify({ ...views, people: { ...views.people, [ROBIN]: { ...views.people[ROBIN], files: Object.fromEntries(Object.entries(views.people[ROBIN]!.files).filter(([f]) => f !== 'bills.json')) } } }) }]) {
      const store = await load(overlay);
      expect([listed(store), store.billsNotes.size]).toEqual([[false, undefined], 0]);
    }
  });

  it('takes the list and the notes of a later read', async () => {
    const store = await load(paidCase());
    const marks = `${folder}/marks.json`;
    store.folder = Object.assign(store.folder, { fresh: () => demoFolderWith({ [marks]: paidCase()[marks]! }) });
    await store.reload();
    expect([listed(store)[0], store.billsNotes.size, store.mayBring()]).toEqual([false, 1, true]);
  });
});
