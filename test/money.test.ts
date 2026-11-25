// Money: the claim shares no paper accounts for yet, the bills a
// receipt paid, Worth a call's split and order, a bill's privacy, and the
// lines the plan left out.
import { describe, expect, it } from 'vitest';
import type { BillCall, BillState } from '../src/model/bills';
import type { MedDocument, PersonIndex } from '../src/model/types';
import { householdEvents } from '../src/next/calendar';
import { anyBill, billPrivate, byDue, callsSummary, deskPayments, explainedLines, forShared, mayBePaid, openBills, overAsked, paidBills, paidText, partText, paymentText, toPay, unbilledShares, unreadText, worthACall, type OpenBill } from '../src/next/money';
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
      ['2026-11-03', 'Example Sexual Health Clinic', 2000],
      ['2026-10-12', 'Example Lab', 7030],
      ['2026-09-16', 'Example Digestive Health', 11620],
      ['2026-09-16', 'Example Lab', 720],
      ['2026-05-20', 'Example Health', 5640],
    ]);
  });

  it('carry the privacy of their visit', () => {
    expect(unbilledShares(index('Sam Example'), events('Sam Example')).map((u) => u.private)).toEqual(['sexual_health', undefined, undefined, undefined, undefined]);
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

const usd = (amount: string) => ({ amount, currency: 'USD' });

describe('paid bills', () => {
  const robin = index('Robin Example');
  const read = (idx: PersonIndex) => paidBills(idx, events('Robin Example')).map((p) => [p.bill.provider, p.cents, p.bill.payments[0]?.receipt?.date, p.event?.event.start]);

  it('are those a receipt’s amount covers, not one whose receipt’s amount did not read', () => {
    const paid = [['Example Health', 5118, '2025-04-20', '2025-03-10']];
    expect(read(robin)).toEqual(paid);
    const documents = robin.documents.map((d) => (d.doc_type === 'receipt' ? { ...d, statement: undefined } : d));
    expect([read({ ...robin, bills: undefined }), read({ ...robin, documents, bills: undefined })]).toEqual([paid, []]);
    // medrec's list alone says, when it is here.
    const bill = robin.documents.find((d) => d.statement?.amount_due?.amount === '51.18')!;
    const unpaid = { ...robin.bills!, states: new Map([...robin.bills!.states, [bill.id, { payments: [], settled: false, left: usd('51.18') }]]) };
    expect([read({ ...robin, documents }), read({ ...robin, bills: unpaid })]).toEqual([paid, []]);
    expect(paidBills(index('Sam Example'), events('Sam Example'))).toEqual([]);
  });
});

describe('bills that may be paid', () => {
  const name = 'Sam Example';
  const sam = index(name);
  const billing = sam.documents.find((d) => d.organization === 'Example Billing')!;
  const receipt: MedDocument = { ...billing, id: 'd_unread', doc_type: 'receipt', date: '2026-08-20', statement: undefined };
  const open = (idx: PersonIndex) => openBills(idx, events(name), TODAY).find((b) => b.bill.doc.id === billing.id)!;
  const withReceipt: PersonIndex = { ...sam, documents: [...sam.documents, receipt] };

  it('are open, and neither worth a call nor to pay', () => {
    expect([worthACall(open(sam)), mayBePaid(open(sam)), toPay(open(sam))]).toEqual([true, false, false]);
    expect([worthACall(open(withReceipt)), mayBePaid(open(withReceipt)), toPay(open(withReceipt))]).toEqual([false, true, false]);
    expect(open(withReceipt).cents).toBe(12000);
    const center = openBills(sam, events(name), TODAY).find((b) => b.bill.doc.id !== billing.id)!;
    expect([worthACall(center), mayBePaid(center), toPay(center)]).toEqual([false, false, true]);
    for (const [cents, kind] of [[12000, 'asksMore'], [3000, 'asksLess']] as const) {
      expect(callsSummary([{ ...open(sam), asked: cents }], (b) => b)[kind]).toHaveLength(1);
      expect(callsSummary([{ ...open(withReceipt), asked: cents }], (b) => b)).toMatchObject({ asksMore: [], asksLess: [], overCents: 0 });
    }
  });

  it('say when the receipt was filed', () => {
    expect([unreadText([]), unreadText([receipt]), unreadText([receipt, { ...receipt, statement: { paid_on: '2026-09-02' } }])]).toEqual([
      undefined,
      'Receipt filed Aug 20, 2026; its amount could not be read',
      '2 receipts filed, the last Sep 2, 2026; their amounts could not be read',
    ]);
  });

  it('are as if the receipt were not here on a shared screen, when it is private', () => {
    const known = { kind: 'known' as const, records: new Map<string, string>(), documents: new Map([[receipt.id, 'household']]), events: new Map<string, string>(), studies: new Map<string, string>(), unreported: new Set<string>(), ties: false };
    const marked: PersonIndex = { ...withReceipt, privacy: known };
    expect(mayBePaid(open(marked))).toBe(true);
    const [shared] = forShared(marked, [open(marked)]);
    expect([mayBePaid(shared!), worthACall(shared!)]).toEqual([false, true]);
    expect(mayBePaid(forShared(withReceipt, [open(withReceipt)])[0]!)).toBe(true);
    // A payment by it is named without its day.
    const paid = { ...open(sam), bill: { ...open(sam).bill, payments: [{ from: 'receipt' as const, document: receipt.id, receipt, on: '2026-08-20', amount: usd('20.00') }, { from: 'household' as const, on: '2026-11-20' }] } };
    expect(forShared(marked, [paid])[0]!.bill.payments).toEqual([{ from: 'receipt' }, { from: 'household', on: '2026-11-20' }]);
  });

  it('and any other are spoken of on a shared screen only when one is not private', () => {
    const isPrivate = (...ids: string[]): PersonIndex => ({ ...sam, privacy: { kind: 'known', records: new Map(), documents: new Map(ids.map((id) => [id, 'household'])), events: new Map(), studies: new Map(), unreported: new Set(), ties: false } });
    const bills = sam.documents.filter((d) => d.doc_type === 'bill').map((d) => d.id);
    expect([anyBill(isPrivate(), events(name), true), anyBill(isPrivate(bills[0]!), events(name), true), anyBill(isPrivate(...bills), events(name), true), anyBill(isPrivate(...bills), events(name), false)]).toEqual([true, true, false, true]);
    expect(anyBill({ ...sam, documents: [] }, events(name), false)).toBe(false);
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
    expect([billPrivate(idx, doc), billPrivate(idx, doc, visit), billPrivate(idx, { ...doc, id: 'd_inanovisitofmedrecsx' }, visit)]).toEqual([undefined, undefined, 'sexual_health']);
  });
});

describe('bills as medrec’s list has them', () => {
  const name = 'Sam Example';
  const sam = index(name);
  const [billing, center] = ['120.00', '90.50'].map((a) => sam.documents.find((d) => d.statement?.amount_due?.amount === a)!);
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
    expect(says(open(state(), [{ ...call('asks_more', '64.00')[0]!, document: center!.id }]))[0]).toBe('unmatched');
    // With no claim of medrec's, the visit's own claims can match it.
    const visit = events(name).map((x) => ({ ...x, money: { ...x.money, charges: x.money.charges.map((c) => ({ ...c, share: 12000 })) } }));
    expect(says(open(state(), [], visit))).toEqual(['matches', 12000, true, false]);
  });

  it('are open with what is left, and not once settled or replaced', () => {
    const part = open(state({ left: usd('70.00'), payments: [{ from: 'household', on: '2026-11-20', amount: usd('50.00') }] }), call('asks_more', '64.00'))!;
    expect([part.cents, part.asked, partText(part), overAsked(part)]).toEqual([7000, 12000, '$50.00 of $120.00 paid', 5600]);
    expect(partText(open(state(), [])!)).toBeUndefined();
    expect(open(state({ settled: true, left: usd('0.00') }), call('no_claim'))).toBeUndefined();
    expect(open(state({ replacedBy: center!.id }), call('asks_more', '64.00'))).toBeUndefined();
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
    const receipt: MedDocument = { ...billing!, id: 'd_desk', doc_type: 'receipt', organization: 'Example Digestive Health', statement: { amount_paid: usd('150.00'), paid_on: '2026-09-16' } };
    const desk = (c: Partial<BillCall>, extra: Partial<PersonIndex> = {}) =>
      deskPayments({ ...sam, documents: [...sam.documents, receipt], bills: { states: new Map(), calls: [{ reason: 'desk_copay', document: 'd_desk', asked: usd('150.00'), owed: usd('116.20'), ...c }], marksUnreadable: false }, ...extra }, events(name)).map((d) => [d.provider, d.cents, d.claimSays]);
    expect(desk({})).toEqual([['Example Digestive Health', 15000, 11620]]);
    expect([desk({ reason: 'asks_more' }), desk({ document: 'd_gone' }), desk({ asked: undefined }), desk({ owed: undefined }), desk({}, { bills: undefined })]).toEqual([[], [], [], [], []]);
  });
});

describe('what the plan changed', () => {
  it('lists the left-out lines of the last year with what the visit’s provider is owed in all', () => {
    expect(explainedLines(index('Sam Example'), events('Sam Example'), TODAY).map((x) => [x.event.event.start, x.provider, x.insurer, x.line.label, x.share])).toEqual([['2026-09-16', 'Example Digestive Health', 'Example Care Plan', 'Upper endoscopy, look only', 11620]]);
    expect(explainedLines(index('Sam Example'), events('Sam Example'), '2027-09-17')).toEqual([]);
  });
});
