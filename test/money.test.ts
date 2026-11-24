// Money: the claim shares no paper accounts for yet, the bills a
// receipt paid, Worth a call's split and order, a bill's privacy, and the
// lines the plan left out.
import { describe, expect, it } from 'vitest';
import type { PersonIndex } from '../src/model/types';
import { householdEvents } from '../src/next/calendar';
import { billPrivate, byDue, callsSummary, explainedLines, openBills, paidBills, unbilledShares, type OpenBill } from '../src/next/money';
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
    expect(paidBills(index('Robin Example'), events('Robin Example')).map((p) => [p.bill.provider, p.cents, p.bill.receipt?.date, p.event?.event.start])).toEqual([['Example Health', 5118, '2025-04-20', '2025-03-10']]);
    expect(paidBills(index('Sam Example'), events('Sam Example'))).toEqual([]);
  });
});

describe('worth a call', () => {
  it('splits bills that ask more, or that no claim backs, from those that ask less', () => {
    const sam = openBills(index('Sam Example'), events('Sam Example'), TODAY);
    const billing = sam.find((b) => b.verdict === 'differs')!;
    const less: OpenBill = { ...billing, cents: 3000 };
    const unbacked: OpenBill = { ...billing, verdict: 'no_claim', claimSays: undefined, claimSaysVisit: false, cents: 9900 };
    const sum = callsSummary([...sam, less, unbacked], (b) => b);
    expect(sum.asksMore).toEqual([billing, unbacked]);
    expect(sum.asksLess).toEqual([less]);
    // $120.00 asked against $50.70; the unbacked bill's $99.00 is not counted.
    expect([sum.overCents, sum.unbacked, sum.providers]).toEqual([6930, 1, 1]);
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

describe('what the plan changed', () => {
  it('lists the left-out lines of the last year with what the visit’s provider is owed in all', () => {
    expect(explainedLines(index('Sam Example'), events('Sam Example'), TODAY).map((x) => [x.event.event.start, x.provider, x.insurer, x.line.label, x.share])).toEqual([['2026-08-26', 'Example Surgery Center', 'Example Care Plan', 'Knee scope, both sides', 17500]]);
    expect(explainedLines(index('Sam Example'), events('Sam Example'), '2027-08-27')).toEqual([]);
  });
});
