// Money under ?next: the claim shares no paper accounts for yet, and the
// bills a receipt paid.
import { describe, expect, it } from 'vitest';
import type { PersonIndex } from '../src/model/types';
import { householdEvents } from '../src/next/calendar';
import { paidBills, unbilledShares } from '../src/next/money';
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
      ['2026-10-12', 'Example Lab', 7030],
      ['2026-09-12', 'Example Emergency Physicians', 9640],
      ['2026-05-20', 'Example Health', 5640],
    ]);
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
