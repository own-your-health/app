// Lines a claim's totals leave out: a payer that recodes a service keeps the
// provider's line, not covered, beside the line it paid, and one that writes
// a line off keeps that too; its totals count neither. Such a line is never
// owed. medrec 0.8.2 marks them (`counted: false`); for a claim it has not
// marked, the app finds them by the same rule.
import { describe, expect, it } from 'vitest';
import { claimCategory, claimLines, claimNotes, claimTitle } from '../src/model/claims';
import { claimsOf, costLines, toCsv, totals } from '../src/model/costs';
import { parseIndex } from '../src/model/parse';
import type { MedRecord } from '../src/model/types';
import { fixture } from './helpers';

const PERSON = 'p_fixtureuncountedaaaa';
const index = parseIndex(fixture('folder/index-uncounted-lines.json'), PERSON);
const record = (id: string): MedRecord => index.records.find((r) => r.id === id)!;
const named = record('r_claimreplacedaaaaaaa');
const worded = record('r_claimreplacedwordsaa');
const writtenOff = record('r_claimwrittenoffaaaaa');
const marked = record('r_claimmarkedaaaaaaaaa');
const lines = costLines(PERSON, index);
const of = (claim: string) => lines.filter((l) => l.claim === claim);
const counted = (r: MedRecord) => claimLines(r).map((l) => [l.code, l.counted]);

describe('a line the claim’s totals leave out', () => {
  it('is the one line whose removal makes billed, plan paid and you owe agree, in medrec’s names or the payer’s words', () => {
    expect(counted(named)).toEqual([
      ['73723', false],
      ['73721', true],
      ['82565', true],
    ]);
    expect(counted(worded)).toEqual([
      ['94070', false],
      ['94060', true],
    ]);
  });

  it('can be two written off together, though their allowed amounts disagree', () => {
    expect(counted(writtenOff)).toEqual([
      ['99214', true],
      ['99072', false],
      ['99050', false],
    ]);
    expect(totals(of(writtenOff.id)).cents).toEqual({ billed: 30000, allowed: 20000, planPaid: 9000, youOwe: 3000 });
  });

  it('is as medrec marks it, with the payer’s notes, when medrec marks one', () => {
    expect(counted(marked)).toEqual([
      ['11043', false],
      ['11042', true],
    ]);
    expect(claimLines(marked)[0]!.payerNotes).toEqual(['C7 -- This service was paid under a different code than the one billed.']);
    expect(claimNotes(marked)).toEqual(['N1 -- The deductible for this plan year has been met.']);
  });

  it('is never named in the claim’s title or kind of care', () => {
    expect(claimTitle(named)).toBe('MRI of the knee, no dye and kidney test');
    expect(claimTitle(worded)).toBe('Breathing test, before and after medicine');
    expect(claimCategory(worded)).toBe('medicine');
  });

  it('counts nothing, keeps what it carried, and leaves no line of the difference', () => {
    expect(of(named.id).map((l) => [l.service, l.split, l.cents, l.uncounted])).toEqual([
      ['MRI of the knee, with and without dye', true, {}, { billed: 264000, notCovered: 264000, youOwe: 264000 }],
      ['MRI of the knee, no dye', true, { billed: 118000, allowed: 48600, planPaid: 36100, copay: 12500, youOwe: 12500 }, undefined],
      ['Kidney test', true, { billed: 6400, allowed: 1840, planPaid: 1840, youOwe: 0 }, undefined],
    ]);
    expect(totals(of(named.id))).toEqual({ cents: { billed: 124400, allowed: 50440, planPaid: 37940, copay: 12500, youOwe: 12500 }, claims: 1, lines: 2 });
    expect(totals(of(worded.id)).cents).toEqual({ billed: 72000, allowed: 31000, planPaid: 25000, copay: 6000, youOwe: 6000 });
  });

  it('leaves its claim leading with what the claim says you owe', () => {
    const [c] = claimsOf(of(named.id), lines);
    expect(c).toMatchObject({ claim: named.id, title: 'MRI of the knee, no dye and kidney test', date: '2026-02-19', of: 3 });
    expect(c!.cents.youOwe).toBe(12500);
    // A choice that shows only the left-out line shows no claim: nothing of it counts there.
    expect(claimsOf(of(named.id).filter((l) => l.uncounted), lines)).toEqual([]);
    // One that shows the lab alone still leads with the whole claim's.
    expect(claimsOf(of(named.id).filter((l) => l.code === '82565'), lines).map((x) => [x.cents.youOwe, x.lines.length, x.of])).toEqual([[12500, 1, 3]]);
  });

  it('downloads with its service as the payer wrote it, its amounts empty and "yes" under Left out by the plan', () => {
    const [left, paid] = toCsv(of(named.id).slice(0, 2), new Map()).split('\r\n').slice(1);
    expect(left).toBe('2026-02-19,,Example Imaging Center,Example Health Plan,2026-01-01 to 2026-12-31,"MRI of the knee, with and without dye",73723,CPT,Imaging,,,,,,,,,r_claimreplacedaaaaaaa,yes,');
    expect(paid).toMatch(/,125\.00,r_claimreplacedaaaaaaa,,$/);
  });
});

describe('lines that do not add up, with no one set of lines to blame', () => {
  it('mark nothing when either of two lines would do, and keep the difference as its own line', () => {
    const c = record('r_claimambiguousaaaaaa');
    expect(claimLines(c).every((l) => l.counted)).toBe(true);
    expect(of(c.id).map((l) => [l.service, l.cents])).toEqual([
      ['Guided stretching', { billed: 10000, youOwe: 2000 }],
      ['Guided stretching', { billed: 10000, youOwe: 2000 }],
      ['Not split by line', { billed: -10000, youOwe: -2000 }],
    ]);
  });

  it('mark nothing when no set of lines is the difference', () => {
    const c = record('r_claimnolinefitsaaaaa');
    expect(claimLines(c).every((l) => l.counted)).toBe(true);
    expect(of(c.id).at(-1)).toMatchObject({ service: 'Not split by line', cents: { billed: -5000, youOwe: -1000 } });
  });
});
