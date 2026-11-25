import { describe, expect, it } from 'vitest';
import { parseBills } from '../src/model/bills';
import { billList, claimsWithBills, openList, standsFor } from '../src/model/billing';
import { fromCents, toCents } from '../src/model/records';
import type { MedDocument, MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const index = (name: string) => indexes.get(personNamed(household, name).id)!;
const usd = (amount: string) => ({ amount, currency: 'USD' });

let n = 0;
function bill(org: string, date: string, amount: string, extra: Partial<MedDocument> = {}): MedDocument {
  n += 1;
  const base = index('Robin Example').documents[0]!;
  return { ...base, id: `d_bill${n}`, doc_type: 'bill', organization: org, date, title: `Statement from ${org}`, statement: { statement_date: date, amount_due: usd(amount), due_date: undefined }, same_statement_as: undefined, ...extra };
}
function claim(provider: string, date: string, share: string): MedRecord {
  n += 1;
  return {
    id: `r_claim${n}`,
    kind: 'claim',
    key: `claim|x|${date}`,
    date,
    display: 'Claim',
    status: 'active',
    fields: { provider, billable_period: { start: date }, total: [{ category: 'Member liability', amount: usd(share) }] },
    documents: [],
    provenance: [],
  };
}
const only = (records: MedRecord[], documents: MedDocument[]) => ({ ...index('Robin Example'), bills: undefined, records, documents }) as PersonIndex;

/** The same, with medrec's list of these bills. */
const listed = (documents: MedDocument[], bills: Record<string, object>) => ({
  ...only([], documents),
  bills: parseBills({ schema: 'medrec-bills/v1', person: 'p_x', bills: Object.fromEntries(Object.entries(bills).map(([id, b]) => [id, { currency: 'USD', paid: [], settled: false, ...b }])), worth_a_call: [] }, 'p_x'),
});

describe('money in cents', () => {
  it('reads and writes decimal strings without floats', () => {
    expect([toCents(usd('53.68')), toCents(usd('0.1')), toCents(usd('-12')), toCents(usd('1,000.00')), toCents(undefined)]).toEqual([5368, 10, -1200, undefined, undefined]);
    expect(fromCents(7296)).toEqual(usd('72.96'));
    expect(fromCents(-5)).toEqual(usd('-0.05'));
  });
});

const openOf = (idx: PersonIndex) => openList(idx).map((b) => [b.provider, b.left?.amount, b.due]);
const receiptOf = (org: string, date: string, extra: Partial<MedDocument> = {}) => ({ ...bill(org, date, '0.00'), doc_type: 'receipt', statement: undefined, ...extra });
const paidReceipt = (org: string, on: string, amount: string) => receiptOf(org, on, { statement: { amount_paid: usd(amount), paid_on: on } });

describe('what is open', () => {
  it('is what medrec says is left of each bill no later statement replaces, soonest due first', () => {
    expect(openOf(index('Robin Example'))).toEqual([
      ['Example Health', '53.68', '2026-11-19'],
      ['Example Lab', '19.28', '2026-11-27'],
    ]);
  });

  it('is, without medrec’s list, what the receipts’ amounts leave of the newest statement of each provider and account', () => {
    const bare: PersonIndex = { ...index('Robin Example'), bills: undefined };
    expect(openOf(bare)).toEqual(openOf(index('Robin Example')));
    const papers = [bill('Example Health', '2026-10-20', '53.68'), paidReceipt('Example Health', '2026-11-01', '53.68'), bill('Example Lab', '2026-10-28', '19.28'), bill('Example Lab', '2026-09-28', '40.00')];
    expect(openOf(only([], papers))).toEqual([['Example Lab', '19.28', undefined]]);
    const list = billList(only([], papers));
    expect(list.map((b) => [b.provider, b.date, b.settled, b.replacedBy !== undefined])).toEqual([
      ['Example Lab', '2026-10-28', false, false],
      ['Example Health', '2026-10-20', true, false],
      ['Example Lab', '2026-09-28', false, true],
    ]);
    expect(standsFor(list[2]!, list)).toBe(list[0]);
  });

  it('is, without medrec’s list, not settled by receipts that come to less', () => {
    const due = bill('Example Health', '2026-10-20', '53.68');
    const [first, second] = [paidReceipt('Example Health', '2026-11-01', '20.00'), paidReceipt('Example Health', '2026-11-09', '33.67')];
    const read = (...receipts: MedDocument[]) => billList(only([], [due, ...receipts])).map((b) => [b.settled, b.left?.amount, b.payments.map((p) => [p.document, p.on, p.amount?.amount, p.apart ?? false])])[0];
    expect(read(second, first)).toEqual([false, '0.01', [[first.id, '2026-11-01', '20.00', false], [second.id, '2026-11-09', '33.67', false]]]);
    expect(read(first, paidReceipt('Example Health', '2026-11-09', '40.00'))![0]).toBe(true);
    // One in another currency is listed, and not taken off.
    const euros = { ...first, statement: { ...first.statement, amount_paid: { amount: '53.68', currency: 'EUR' } } };
    expect(read(euros)).toEqual([false, '53.68', [[first.id, '2026-11-01', '53.68', true]]]);
    // A bill that asks for nothing is settled, and one that gives no amount is not.
    expect(billList(only([], [bill('Example Health', '2026-10-20', '0.00')]))[0]).toMatchObject({ settled: true, payments: [] });
    expect(billList(only([], [{ ...due, statement: undefined }, first]))[0]).toMatchObject({ settled: false, payments: [{ document: first.id }] });
  });

  it('is, without medrec’s list, paid by a receipt for the bill medrec would take it for', () => {
    const [one, two] = [bill('Example Health', '2026-10-01', '40.00'), bill('Example Health', '2026-10-20', '53.68')];
    const pays = (receipt: MedDocument, ...bills: MedDocument[]) => billList(only([], [...bills, receipt])).filter((b) => b.payments.length).map((b) => b.doc.id);
    // The only bill that asks just that; else the only one it can be for.
    expect(pays(paidReceipt('Example Health', '2026-11-01', '40.00'), one, two)).toEqual([one.id]);
    expect(pays(paidReceipt('Example Health', '2026-11-01', '25.00'), one, two)).toEqual([]);
    expect(pays(paidReceipt('Example Health', '2026-11-01', '25.00'), two)).toEqual([two.id]);
    expect(pays(paidReceipt('Example Health', '2026-11-01', '40.00'), one, { ...two, statement: one.statement })).toEqual([]);
    // Not as much in another currency.
    const euros = paidReceipt('Example Health', '2026-11-01', '40.00');
    expect(pays({ ...euros, statement: { ...euros.statement, amount_paid: { amount: '40.00', currency: 'EUR' } } }, one, two)).toEqual([]);
  });

  it('leaves out a copy medrec found to be the same statement', () => {
    const first = bill('Example Billing', '2026-08-01', '120.00');
    const copy = bill('Example Billing', '2026-08-01', '120.00', { same_statement_as: first.id });
    expect(billList(only([], [first, copy])).map((b) => b.doc.id)).toEqual([first.id]);
  });
});

const account = (d: MedDocument, number: string) => ({ ...d, statement: { ...d.statement, account: number } });

describe('bills by medrec’s list', () => {
  const [due, second] = [bill('Example Health', '2026-10-20', '53.68'), bill('Example Health', '2026-10-25', '40.00')];
  const marked = { from: 'household', id: 'o_one', on: '2026-11-18', currency: 'USD' };

  it('have what is left of them, and are settled when medrec says so', () => {
    const part = listed([due], { [due.id]: { paid: [{ ...marked, amount: '20.00' }], left: '33.68' } });
    expect(billList(part)[0]).toMatchObject({ settled: false, left: usd('33.68'), payments: [{ from: 'household', on: '2026-11-18', amount: usd('20.00') }] });
    expect(openOf(part)).toEqual([['Example Health', '33.68', undefined]]);
    // Neither replaces the other unless medrec says so, and one without a provider is still open.
    const nameless = { ...second, organization: undefined };
    expect(openOf(listed([due, second], { [due.id]: { left: '53.68' }, [second.id]: { left: '40.00' } }))).toHaveLength(2);
    expect(openOf(listed([nameless], { [second.id]: { left: '40.00' } }))).toEqual([[undefined, '40.00', undefined]]);
    expect(openOf(only([], [nameless]))).toEqual([]);
    const all = listed([due], { [due.id]: { paid: [{ ...marked, amount: '53.68' }], left: '0.00', settled: true } });
    expect([billList(all)[0]!.settled, billList(all)[0]!.left, openOf(all)]).toEqual([true, undefined, []]);
  });

  it('are the later statement’s once it replaces them, however often that happens', () => {
    const third = bill('Example Health', '2026-11-05', '61.00');
    const idx = listed([due, second, third], { [due.id]: { left: '53.68', superseded_by: second.id }, [second.id]: { left: '40.00', superseded_by: third.id }, [third.id]: { left: '61.00' } });
    const list = billList(idx);
    expect(openOf(idx)).toEqual([['Example Health', '61.00', undefined]]);
    expect(standsFor(list.find((b) => b.doc.id === due.id)!, list).doc.id).toBe(third.id);
    // One that is not here replaces nothing.
    expect(openOf(listed([due], { [due.id]: { left: '53.68', superseded_by: 'd_gone' } }))).toHaveLength(1);
    // Two that name each other still end.
    const loop = billList(listed([due, second], { [due.id]: { superseded_by: second.id }, [second.id]: { superseded_by: due.id } }));
    expect(loop.map((b) => b.replacedBy)).toEqual([due.id, second.id]);
    expect(standsFor(loop[0]!, loop).doc.organization).toBe('Example Health');
  });

  it('are not settled by a receipt whose amount did not read, which each one it can be for names', () => {
    const states = { [due.id]: { left: '53.68' }, [second.id]: { left: '40.00' } };
    const named = (documents: MedDocument[], ...receipts: MedDocument[]) => {
      const idx = listed([...documents, ...receipts], Object.fromEntries(documents.map((d) => [d.id, states[d.id]!])));
      const list = billList(idx);
      expect(list.some((b) => b.settled || b.payments.length)).toBe(false);
      expect(openOf(idx)).toHaveLength(documents.length);
      return list.filter((b) => b.unread.length).map((b) => [b.doc.id, b.unread.map((r) => r.id)]);
    };
    const receipt = receiptOf('Example Health', '2026-11-01');
    expect(named([due], receipt)).toEqual([[due.id, [receipt.id]]]);
    expect(named([due, second], receipt)).toEqual([[second.id, [receipt.id]], [due.id, [receipt.id]]]);
    const later = receiptOf('Example Health', '2026-11-09');
    expect(named([due], later, receipt)).toEqual([[due.id, [receipt.id, later.id]]]);
    // One it is too late or too early for, another provider's, none.
    expect(named([due], { ...receipt, date: '2027-02-18' })).toEqual([]);
    expect(named([due], { ...receipt, date: '2027-02-17' })).toHaveLength(1);
    expect(named([due], { ...receipt, date: '2026-10-19' })).toEqual([]);
    expect(named([due], { ...receipt, date: '2026-10-20' })).toHaveLength(1);
    expect(named([due], { ...receipt, organization: 'Example Lab' })).toEqual([]);
    expect(named([due], { ...receipt, date: undefined })).toEqual([]);
    // Its account says which, whatever its name; the day it was paid comes before the paper's.
    expect(named([account(due, 'EX-1'), account(second, 'EX-2')], account(receipt, 'EX-2')).map(([id]) => id)).toEqual([second.id]);
    expect(named([account(due, 'EX-1')], account({ ...receipt, organization: 'Example Billing' }, 'EX-1'))).toHaveLength(1);
    expect(named([due], { ...receipt, date: '2027-03-30', statement: { paid_on: '2026-11-02' } })).toHaveLength(1);
    // Nor is one without medrec's list, and a settled one names none.
    expect(billList(only([], [due, receipt]))[0]).toMatchObject({ settled: false, unread: [receipt], left: usd('53.68') });
    expect(billList(listed([due, receipt], { [due.id]: { left: '0.00', settled: true } }))[0]).toMatchObject({ settled: true, payments: [], unread: [] });
  });

  it('leave a receipt with an amount to medrec, which says which bill it pays', () => {
    const read = receiptOf('Example Health', '2026-11-01', { statement: { amount_paid: usd('53.68'), paid_on: '2026-11-01' } });
    expect(openOf(listed([due, read], { [due.id]: { left: '53.68' } }))).toHaveLength(1);
    const [paid] = billList(listed([due, read], { [due.id]: { paid: [{ from: 'receipt', document: read.id, on: '2026-11-01', amount: '53.68', currency: 'USD' }], left: '0.00', settled: true } }));
    expect(paid!.payments).toEqual([{ from: 'receipt', document: read.id, on: '2026-11-01', amount: usd('53.68'), receipt: read }]);
    // A payment marked on a bill says how much was paid, so a receipt that does not adds nothing.
    const unread = receiptOf('Example Health', '2026-11-03');
    const [both] = billList(listed([due, unread], { [due.id]: { paid: [{ ...marked, amount: '53.68' }], left: '0.00', settled: true } }));
    expect([both!.payments.map((p) => p.from), both!.unread]).toEqual([['household'], []]);
    const [part] = billList(listed([due, unread], { [due.id]: { paid: [{ ...marked, amount: '20.00' }], left: '33.68' } }));
    expect([part!.settled, part!.left, part!.payments.length, part!.unread]).toEqual([false, usd('33.68'), 1, []]);
  });

  it('go by the receipts for one medrec does not list', () => {
    const idx = listed([due, second, paidReceipt('Example Health', '2026-10-30', '40.00')], { [due.id]: { left: '53.68', paid: [{ ...marked, amount: '1.00' }] } });
    expect(billList(idx).map((b) => [b.doc.id, !!b.medrec, b.settled])).toEqual([
      [second.id, false, true],
      [due.id, true, false],
    ]);
  });
});

describe('claims beside their bills', () => {
  it('pairs each claim with the statement for its share, and says when none has come', () => {
    const { claims, otherBills } = claimsWithBills(index('Robin Example'));
    const view = claims.map((c) => [c.service, c.provider, c.yourShare?.amount, c.bill?.how, c.bill?.bill.date, c.bill?.bill.unread[0]?.date ?? null]);
    expect(view).toEqual([
      ['2026-11-18', 'Example Health', '25', undefined, undefined, null],
      ['2026-11-07', 'Example Pharmacy', '5', undefined, undefined, null],
      ['2026-10-08', 'Example Pharmacy', '5', undefined, undefined, null],
      ['2026-10-03', 'Example Lab', '19.28', 'amount', '2026-10-28', null],
      ['2026-10-01', 'Example Health', '53.68', 'amount', '2026-10-20', null],
      ['2026-09-08', 'Example Pharmacy', '5', undefined, undefined, null],
      ['2025-09-15', 'Example Health', '0', undefined, undefined, null],
      ['2025-03-10', 'Example Health', '51.18', 'amount', '2025-04-02', null],
    ]);
    expect(otherBills).toEqual([]);
    expect(claims[4]).toMatchObject({ billed: usd('412'), allowed: usd('268.4'), planPaid: usd('214.72'), parts: [{ label: 'Coinsurance', amount: usd('53.68') }] });
  });

  it('falls back to the provider’s next statement within the window, and lists bills no claim matches', () => {
    const { claims, otherBills } = claimsWithBills(
      only([claim('Example Health', '2026-01-10', '40.00')], [bill('Example Health', '2026-02-01', '95.00'), bill('Example Health', '2026-09-01', '40.00'), bill('Example Billing', '2026-02-01', '40.00')]),
    );
    expect(claims[0]!.bill).toMatchObject({ how: 'next', bill: { date: '2026-02-01', amount: usd('95.00') } });
    // The September statement is past the 120-day window; the other provider's is not its bill.
    expect(otherBills.map((b) => [b.provider, b.date])).toEqual([
      ['Example Health', '2026-09-01'],
      ['Example Billing', '2026-02-01'],
    ]);
  });

  it('never takes a statement from before the visit', () => {
    const { claims } = claimsWithBills(only([claim('Example Health', '2026-03-01', '40.00')], [bill('Example Health', '2026-02-20', '40.00')]));
    expect(claims[0]!.bill).toBeUndefined();
  });
});
