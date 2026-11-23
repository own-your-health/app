import { describe, expect, it } from 'vitest';
import { billList, claimsWithBills, fromCents, owedByProvider, planBalances, toCents } from '../src/model/billing';
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
const only = (records: MedRecord[], documents: MedDocument[]) => ({ ...index('Robin Example'), records, documents }) as PersonIndex;

describe('money in cents', () => {
  it('reads and writes decimal strings without floats', () => {
    expect([toCents(usd('53.68')), toCents(usd('0.1')), toCents(usd('-12')), toCents(usd('1,000.00')), toCents(undefined)]).toEqual([5368, 10, -1200, undefined, undefined]);
    expect(fromCents(7296)).toEqual(usd('72.96'));
    expect(fromCents(-5)).toEqual(usd('-0.05'));
  });
});

describe('what is owed', () => {
  it('takes the newest statement of each provider and account, the paid one apart', () => {
    const owed = owedByProvider(index('Robin Example'));
    expect(owed.due.map((o) => [o.provider, o.bill.amount?.amount, o.bill.due])).toEqual([
      ['Example Health', '53.68', '2026-11-19'],
      ['Example Lab', '19.28', '2026-11-27'],
    ]);
    expect(owed.total).toEqual(usd('72.96'));
    expect(owed.paid).toEqual([]);
  });

  it('counts a statement with a receipt after it as paid, and leaves it out of the total', () => {
    const receipt = { ...bill('Example Health', '2026-11-01', '0.00'), doc_type: 'receipt', statement: undefined };
    const owed = owedByProvider(only([], [bill('Example Health', '2026-10-20', '53.68'), receipt, bill('Example Lab', '2026-10-28', '19.28')]));
    expect(owed.paid.map((o) => o.provider)).toEqual(['Example Health']);
    expect(owed.total).toEqual(usd('19.28'));
  });

  it('leaves out a copy medrec found to be the same statement', () => {
    const first = bill('Example Billing', '2026-08-01', '120.00');
    const copy = bill('Example Billing', '2026-08-01', '120.00', { same_statement_as: first.id });
    expect(billList(only([], [first, copy])).map((b) => b.doc.id)).toEqual([first.id]);
  });
});

describe('claims beside their bills', () => {
  it('pairs each claim with the statement for its share, and says when none has come', () => {
    const { claims, otherBills } = claimsWithBills(index('Robin Example'));
    const view = claims.map((c) => [c.service, c.provider, c.yourShare?.amount, c.bill?.how, c.bill?.bill.date, c.bill?.bill.receipt ? 'receipt' : null]);
    expect(view).toEqual([
      ['2026-11-18', 'Example Health', '25.00', undefined, undefined, null],
      ['2026-11-12', 'Example Pharmacy', '10.00', undefined, undefined, null],
      ['2026-10-03', 'Example Lab', '19.28', 'amount', '2026-10-28', null],
      ['2026-10-01', 'Example Health', '53.68', 'amount', '2026-10-20', null],
      ['2026-08-14', 'Example Pharmacy', '10.00', undefined, undefined, null],
      ['2025-09-15', 'Example Health', '0.00', undefined, undefined, null],
      ['2025-03-10', 'Example Health', '51.18', 'amount', '2025-04-02', 'receipt'],
    ]);
    expect(otherBills).toEqual([]);
    expect(claims[3]).toMatchObject({ billed: usd('412.00'), allowed: usd('268.40'), planPaid: usd('214.72'), parts: [{ label: 'Coinsurance', amount: usd('53.68') }] });
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

describe('plan balances', () => {
  it('come from the newest claim that printed them', () => {
    expect(planBalances(index('Robin Example'))).toMatchObject([
      { label: 'Deductible', scope: 'in network, individual', used: usd('1120.40'), limit: usd('1500.00'), asOf: '2026-10-01' },
      { label: 'Out-of-pocket limit', scope: 'in network, individual', used: usd('1356.10'), limit: usd('4000.00'), asOf: '2026-10-01' },
    ]);
    expect(planBalances(index('Sam Example'))).toMatchObject([
      { label: 'Deductible', used: usd('121.00'), limit: usd('750.00'), asOf: '2026-10-12' },
      { label: 'Out-of-pocket limit', used: usd('121.00'), limit: usd('3000.00'), asOf: '2026-10-12' },
    ]);
    expect(planBalances(index('Jamie Example'))).toEqual([]);
  });
});
