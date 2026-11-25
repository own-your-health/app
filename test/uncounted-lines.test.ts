// Lines a claim's totals leave out: a payer that recodes a service keeps the
// provider's line, not covered, beside the line it paid, and one that writes
// a line off keeps that too; its totals count neither. Such a line is never
// owed. medrec 0.8.2 and later marks them (`counted: false`); for a claim an
// earlier one filed, the app finds them by the same rule.
import { describe, expect, it } from 'vitest';
import { claimCategory, claimLines, claimNotes, claimTitle } from '../src/model/claims';
import { claimsOf, costLines, toCsv, totals } from '../src/model/costs';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { asFiledBefore, recordsOf } from './rules';

const filed = recordsOf('Quinn');
const on = (date: string, index = filed): MedRecord => index.records.find((r) => r.kind === 'claim' && r.date === date)!;
const [RECODED, WORDED, WRITTEN_OFF, MARKED, EITHER, NEITHER] = ['2026-03-12', '2026-04-08', '2026-05-18', '2026-07-07', '2026-08-11', '2026-09-03'] as const;
/** The same claims as an earlier medrec filed them, one in the payer's words alone, so the app finds the lines itself. */
const index: PersonIndex = { ...filed, records: filed.records.map((r) => (r.kind === 'claim' && r.date !== MARKED ? asFiledBefore(r, { words: r.date === WORDED }) : r)) };
const lines = costLines(index.person, index);
const of = (date: string) => lines.filter((l) => l.claim === on(date).id);
const counted = (r: MedRecord) => claimLines(r).map((l) => [l.code, l.counted]);
const [recoded, worded, writtenOff, marked] = [RECODED, WORDED, WRITTEN_OFF, MARKED].map((d) => on(d, index)) as [MedRecord, MedRecord, MedRecord, MedRecord];

describe('a line the claim’s totals leave out', () => {
  it('is the one line whose removal makes billed, plan paid and you owe agree, in medrec’s names or the payer’s words', () => {
    expect(counted(recoded)).toEqual([
      ['17110', false],
      ['17111', true],
      ['88305', true],
    ]);
    expect(counted(worded)).toEqual([
      ['92552', false],
      ['92557', true],
    ]);
  });

  it('can be two written off together, though their allowed amounts disagree', () => {
    expect(counted(writtenOff)).toEqual([
      ['99203', true],
      ['99058', false],
      ['99070', false],
    ]);
    expect(totals(of(WRITTEN_OFF)).cents).toEqual({ billed: 26000, allowed: 19000, planPaid: 12000, copay: 6000, youOwe: 6000 });
  });

  it('is the line medrec marks in the same claim', () => {
    for (const r of filed.records.filter((x) => x.kind === 'claim')) expect([r.date, counted(on(r.date!, index))]).toEqual([r.date, counted(r)]);
  });

  it('is as medrec marks it, with the payer’s notes, when medrec marks one', () => {
    expect(counted(marked)).toEqual([
      ['11400', false],
      ['11401', true],
    ]);
    expect(claimLines(marked)[0]!.payerNotes).toEqual(['Q4 -- Another code on this claim stands for this one.']);
    expect(claimNotes(marked)).toEqual(['Z9 -- Part of this went to your deductible.']);
  });

  it('is never named in the claim’s title or kind of care', () => {
    expect(claimTitle(recoded)).toBe('Wart removal, 15 or more and tissue exam');
    expect(claimTitle(worded)).toBe('Hearing test, full');
    expect(claimCategory(worded)).toBe('medicine');
  });

  it('counts nothing, keeps what it carried, and leaves no line of the difference', () => {
    expect(of(RECODED).map((l) => [l.service, l.split, l.cents, l.uncounted])).toEqual([
      ['Wart removal, up to 14', true, {}, { billed: 24000, planPaid: 0, notCovered: 24000, youOwe: 24000 }],
      ['Wart removal, 15 or more', true, { billed: 31000, allowed: 15000, planPaid: 11000, deductible: 0, copay: 4000, coinsurance: 0, youOwe: 4000 }, undefined],
      ['Tissue exam', true, { billed: 9500, allowed: 3150, planPaid: 3150, deductible: 0, copay: 0, coinsurance: 0, youOwe: 0 }, undefined],
    ]);
    expect(totals(of(RECODED))).toEqual({ cents: { billed: 40500, allowed: 18150, planPaid: 14150, deductible: 0, copay: 4000, coinsurance: 0, youOwe: 4000 }, claims: 1, lines: 2 });
    expect(totals(of(WORDED)).cents).toEqual({ billed: 18000, allowed: 12000, planPaid: 9000, copay: 3000, youOwe: 3000 });
  });

  it('leaves its claim leading with what the claim says you owe', () => {
    const [c] = claimsOf(of(RECODED), lines);
    expect(c).toMatchObject({ claim: recoded.id, title: 'Wart removal, 15 or more and tissue exam', date: RECODED, of: 3 });
    expect(c!.cents.youOwe).toBe(4000);
    // A choice that shows only the left-out line shows no claim: nothing of it counts there.
    expect(claimsOf(of(RECODED).filter((l) => l.uncounted), lines)).toEqual([]);
    // One that shows the lab alone still leads with the whole claim's.
    expect(claimsOf(of(RECODED).filter((l) => l.code === '88305'), lines).map((x) => [x.cents.youOwe, x.lines.length, x.of])).toEqual([[4000, 1, 3]]);
  });

  it('downloads with its service as the payer wrote it, its amounts empty and "yes" under Left out by the plan', () => {
    const [left, paid] = toCsv(of(RECODED).slice(0, 2), new Map()).split('\r\n').slice(1);
    expect(left).toBe(`2026-03-12,,Example Skin Clinic,Example Health Plan,2026-01-01 to 2026-12-31,"Wart removal, up to 14",17110,CPT,Procedure,,,,,,,,,${recoded.id},yes,`);
    expect(paid!.endsWith(`,40.00,${recoded.id},,`)).toBe(true);
  });
});

describe('lines that do not add up, with no one set of lines to blame', () => {
  it('mark nothing when either of two lines would do, and keep the difference as its own line', () => {
    expect(claimLines(on(EITHER, index)).every((l) => l.counted)).toBe(true);
    expect(of(EITHER).map((l) => [l.service, l.cents])).toEqual([
      ['Balance practice', { billed: 9000, youOwe: 1800 }],
      ['Balance practice', { billed: 9000, youOwe: 1800 }],
      ['Not split by line', { billed: -9000, youOwe: -1800 }],
    ]);
  });

  it('mark nothing when no set of lines is the difference', () => {
    expect(claimLines(on(NEITHER, index)).every((l) => l.counted)).toBe(true);
    expect(of(NEITHER).at(-1)).toMatchObject({ service: 'Not split by line', cents: { billed: -4000, youOwe: -500 } });
  });
});
