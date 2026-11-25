// Money: the claim shares no paper accounts for yet, the bills a
// receipt paid, Worth a call's split and order, a bill's privacy, and the
// lines the plan left out.
import { describe, expect, it } from 'vitest';
import type { BillCall, BillState } from '../src/model/bills';
import type { MedDocument, PersonIndex } from '../src/model/types';
import { householdEvents } from '../src/next/calendar';
import { billPrivate, byDue, callsSummary, deskPayments, explainedLines, openBills, overAsked, paidBills, paidText, partText, paymentText, unbilledShares, worthACall, type OpenBill } from '../src/next/money';
import { demo, personNamed } from './demo-data';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const person = (name: string) => personNamed(household, name);
const index = (name: string) => indexes.get(person(name).id)!;
const events = (name: string) => householdEvents(household, (id) => indexes.get(id), TODAY).filter((x) => x.person.id === person(name).id);
const shares = (name: string, idx = index(name)) => unbilledShares(idx, events(name)).map((u) => [u.event.event.start, u.provider, u.cents]);

describe('shares not billed yet', () => {
  it('list each provider’s share with no bill or receipt from them, and none for a fill', () => {
    expect(shares('Robin Example')).toEqual([['2026-11-18', 'Example Health', 2500]]);
    expect(shares('Sam Example')).toEqual([
      ['2026-10-27', 'Example Counseling', 3000],
      ['2026-10-12', 'Example Lab', 7030],
      ['2026-08-26', 'Example Orthopedic Surgeons', 11250],
      ['2026-05-20', 'Example Health', 5640],
    ]);
  });

  it('carry the privacy of their visit', () => {
    expect(unbilledShares(index('Sam Example'), events('Sam Example')).map((u) => u.private)).toEqual(['mental_health', undefined, undefined, undefined]);
  });

  it('take a billing company’s bill as the visit’s, and a receipt on or after the visit as paid', () => {
    // Sam's Jul 9 lab tests are billed by a billing company, so the lab's share is accounted for.
    expect(shares('Sam Example').some(([start]) => start === '2026-07-09')).toBe(false);
    const idx = index('Robin Example');
    const receipt = idx.documents.find((d) => d.doc_type === 'receipt')!;
    const paid: PersonIndex = { ...idx, documents: [...idx.documents, { ...receipt, id: 'd_receiptafterthevisitx', date: '2026-11-18' }] };
    expect(shares('Robin Example', paid)).toEqual([]);
  });
});

describe('paid bills', () => {
  it('are those with a receipt from their provider filed after them', () => {
    expect(paidBills(index('Robin Example'), events('Robin Example')).map((p) => [p.bill.provider, p.cents, p.bill.payments[0]?.receipt?.date, p.event?.event.start])).toEqual([['Example Health', 5118, '2025-04-20', '2025-03-10']]);
    expect(paidBills(index('Sam Example'), events('Sam Example'))).toEqual([]);
  });
});

describe('worth a call', () => {
  it('splits bills that ask more, or that no claim backs, from those that ask less', () => {
    const sam = openBills(index('Sam Example'), events('Sam Example'), TODAY);
    const billing = sam.find((b) => b.verdict === 'differs')!;
    const less: OpenBill = { ...billing, cents: 3000, asked: 3000 };
    const unbacked: OpenBill = { ...billing, verdict: 'no_claim', claimSays: undefined, claimSaysVisit: false, cents: 9900, asked: 9900 };
    const sum = callsSummary([...sam, less, unbacked], (b) => b);
    expect(sum.asksMore).toEqual([billing, unbacked]);
    expect(sum.asksLess).toEqual([less]);
    // $120.00 asked against $50.70; the unbacked bill's $99.00 is not counted.
    expect([sum.overCents, sum.unbacked, sum.providers]).toEqual([6930, 1, 1]);
  });

  it('counts as over only what is left, once part of the bill is paid', () => {
    const billing = openBills(index('Sam Example'), events('Sam Example'), TODAY).find((b) => b.verdict === 'differs')!;
    expect([billing, { ...billing, cents: 7000 }, { ...billing, cents: 2000 }].map(overAsked)).toEqual([6930, 6930, 2000]);
    expect(callsSummary([{ ...billing, cents: 2000 }], (b) => b).overCents).toBe(2000);
  });

  it('orders open bills overdue first, then by due date', () => {
    const robin = openBills(index('Robin Example'), events('Robin Example'), TODAY);
    expect([...robin].reverse().sort(byDue).map((b) => b.bill.due)).toEqual(['2026-11-19', '2026-11-27']);
  });

  it('takes a bill’s privacy from its visit when medrec did not judge the two together', () => {
    const idx = index('Sam Example');
    const doc = idx.documents.find((d) => d.doc_type === 'bill')!;
    const visit = events('Sam Example').find((x) => x.private && x.event.kind === 'office')!;
    expect([billPrivate(idx, doc), billPrivate(idx, doc, visit), billPrivate(idx, { ...doc, id: 'd_inanovisitofmedrecsx' }, visit)]).toEqual([undefined, undefined, 'mental_health']);
  });
});

describe('bills as medrec’s list has them', () => {
  const name = 'Sam Example';
  const sam = index(name);
  const [billing, surgery] = ['120.00', '175.00'].map((a) => sam.documents.find((d) => d.statement?.amount_due?.amount === a)!);
  const usd = (amount: string) => ({ amount, currency: 'USD' });
  const state = (extra: Partial<BillState> = {}): BillState => ({ payments: [], settled: false, left: usd('120.00'), ...extra });
  /** Sam's bills with one state for the billing company's, and these calls. */
  const open = (s: BillState, calls: BillCall[], evs = events(name)) => {
    const idx: PersonIndex = { ...sam, bills: { states: new Map([...sam.bills!.states, [billing!.id, s]]), calls, marksUnreadable: false } };
    return openBills(idx, evs, TODAY).find((b) => b.bill.doc.id === billing!.id);
  };
  const call = (reason: BillCall['reason'], owed?: string): BillCall[] => [{ reason, document: billing!.id, asked: usd('120.00'), ...(owed ? { owed: usd(owed) } : {}) }];
  const says = (b: OpenBill | undefined) => [b?.verdict, b?.claimSays, b?.claimSaysVisit, !!b && worthACall(b)];

  it('are worth a call for the reason it gives, and for no other', () => {
    expect(says(open(state(), call('asks_more', '64.00')))).toEqual(['differs', 6400, true, true]);
    expect(says(open(state(), call('asks_less', '130.00')))).toEqual(['differs', 13000, true, true]);
    expect(says(open(state(), call('no_claim')))).toEqual(['no_claim', undefined, false, true]);
    // With no call for it, it is not, whatever its visit's claims say.
    expect(says(open(state(), []))).toEqual(['unmatched', undefined, false, false]);
    expect(says(open(state({ owed: usd('64.00') }), []))).toEqual(['unmatched', undefined, false, false]);
    expect(says(open(state({ owed: usd('120.00') }), []))).toEqual(['matches', 12000, true, false]);
    // A bill in no visit has no visit's claims to speak of.
    expect(says(open(state(), call('asks_more', '64.00'), []))).toEqual(['differs', 6400, false, true]);
    // Another's call is not its own.
    expect(says(open(state(), [{ ...call('asks_more', '64.00')[0]!, document: surgery!.id }]))[0]).toBe('unmatched');
    // With no claim of medrec's, the visit's own claims can match it.
    const visit = events(name).map((x) => ({ ...x, money: { ...x.money, charges: x.money.charges.map((c) => ({ ...c, share: 12000 })) } }));
    expect(says(open(state(), [], visit))).toEqual(['matches', 12000, true, false]);
  });

  it('are open with what is left, and not once settled or replaced', () => {
    const part = open(state({ left: usd('70.00'), payments: [{ from: 'household', on: '2026-11-20', amount: usd('50.00') }] }), call('asks_more', '64.00'))!;
    expect([part.cents, part.asked, partText(part), overAsked(part)]).toEqual([7000, 12000, '$50.00 of $120.00 paid', 5600]);
    expect(partText(open(state(), [])!)).toBeUndefined();
    expect(open(state({ settled: true, left: usd('0.00') }), call('no_claim'))).toBeUndefined();
    expect(open(state({ replacedBy: surgery!.id }), call('asks_more', '64.00'))).toBeUndefined();
  });

  it('are paid once settled by a payment, not while part is left, nor when they asked for nothing', () => {
    const paid = (s: BillState) => paidBills({ ...sam, bills: { states: new Map([[billing!.id, s]]), calls: [], marksUnreadable: false } }, events(name)).map((p) => p.cents);
    const mark = { from: 'household' as const, on: '2026-11-20', amount: usd('120.00') };
    expect([paid(state({ settled: true, payments: [mark] })), paid(state({ left: usd('70.00'), payments: [{ ...mark, amount: usd('50.00') }] })), paid(state({ settled: true }))]).toEqual([[12000], [], []]);
  });

  it('say how each payment was made', () => {
    const household = { from: 'household' as const, on: '2026-11-20', amount: usd('120.00') };
    const receipt = { from: 'receipt' as const, on: '2025-04-20' };
    expect([paymentText(household), paymentText(household, true), paymentText({ from: 'household' })]).toEqual(['Marked paid, Nov 20, 2026', '$120.00 marked paid, Nov 20, 2026', 'Marked paid']);
    expect([paymentText(receipt), paymentText(receipt, true), paymentText({ ...receipt, amount: usd('51.18') }, true)]).toEqual(['receipt Apr 20, 2025', 'receipt Apr 20, 2025, amount not read', '$51.18, receipt Apr 20, 2025']);
    expect(paymentText({ ...household, amount: { amount: '8.00', currency: 'EUR' }, apart: true })).toBe('EUR 8.00 marked paid, Nov 20, 2026, in another currency');
    expect([paidText({ payments: [household] }), paidText({ payments: [receipt] }), paidText({ payments: [{ ...receipt, amount: usd('20.00') }, household] }), paidText({ payments: [] })]).toEqual([
      'Marked paid, Nov 20, 2026',
      'paid, receipt Apr 20, 2025',
      'paid, $20.00, receipt Apr 20, 2025, $120.00 marked paid, Nov 20, 2026',
      'nothing to pay',
    ]);
  });

  it('list a payment at a visit above what its claims say', () => {
    const receipt: MedDocument = { ...billing!, id: 'd_desk', doc_type: 'receipt', organization: 'Example Orthopedic Surgeons', statement: { amount_paid: usd('150.00'), paid_on: '2026-08-26' } };
    const desk = (c: Partial<BillCall>, extra: Partial<PersonIndex> = {}) =>
      deskPayments({ ...sam, documents: [...sam.documents, receipt], bills: { states: new Map(), calls: [{ reason: 'desk_copay', document: 'd_desk', asked: usd('150.00'), owed: usd('112.50'), ...c }], marksUnreadable: false }, ...extra }, events(name)).map((d) => [d.provider, d.cents, d.claimSays]);
    expect(desk({})).toEqual([['Example Orthopedic Surgeons', 15000, 11250]]);
    expect([desk({ reason: 'asks_more' }), desk({ document: 'd_gone' }), desk({ asked: undefined }), desk({ owed: undefined }), desk({}, { bills: undefined })]).toEqual([[], [], [], [], []]);
  });
});

describe('what the plan changed', () => {
  it('lists the left-out lines of the last year with what the visit’s provider is owed in all', () => {
    expect(explainedLines(index('Sam Example'), events('Sam Example'), TODAY).map((x) => [x.event.event.start, x.provider, x.insurer, x.line.label, x.share])).toEqual([['2026-08-26', 'Example Surgery Center', 'Example Care Plan', 'Knee scope, both sides', 17500]]);
    expect(explainedLines(index('Sam Example'), events('Sam Example'), '2027-08-27')).toEqual([]);
  });
});
