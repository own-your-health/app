// A line the plan replaced with one of its own: a payer that recodes a
// service keeps the provider's line, not covered, beside the line it paid,
// and its totals count only its own. That line is never owed.
import { describe, expect, it } from 'vitest';
import { claimCategory, claimLines, claimTitle } from '../src/model/claims';
import { claimsOf, costLines, toCsv, totals } from '../src/model/costs';
import { parseIndex } from '../src/model/parse';
import type { MedRecord } from '../src/model/types';
import { fixture } from './helpers';

const PERSON = 'p_fixturereplacedaaaaa';
const index = parseIndex(fixture('folder/index-replaced-lines.json'), PERSON);
const record = (id: string): MedRecord => index.records.find((r) => r.id === id)!;
const named = record('r_claimreplacedaaaaaaa');
const worded = record('r_claimreplacedwordsaa');
const lines = costLines(PERSON, index);
const of = (claim: string) => lines.filter((l) => l.claim === claim);

describe('a line the plan replaced', () => {
  it('is the one line without which the lines add up to the totals, in medrec’s names or the payer’s words', () => {
    expect(claimLines(named).map((l) => [l.code, !!l.replaced])).toEqual([
      ['99285', true],
      ['99284', false],
      ['85025', false],
    ]);
    expect(claimLines(worded).map((l) => [l.code, !!l.replaced])).toEqual([
      ['99285', true],
      ['99284', false],
    ]);
  });

  it('is never named in the claim’s title or kind of care', () => {
    expect(claimTitle(named)).toBe('Emergency visit, moderate severity and blood count');
    expect(claimTitle(worded)).toBe('Emergency visit, moderate severity');
    expect(claimCategory(worded)).toBe('visit');
  });

  it('counts nothing, keeps what it carried, and leaves no line of the difference', () => {
    expect(of(named.id).map((l) => [l.service, l.split, l.cents, l.replaced])).toEqual([
      ['Emergency visit, high severity', true, {}, { billed: 312000, notCovered: 312000, youOwe: 312000 }],
      ['Emergency visit, moderate severity', true, { billed: 148000, allowed: 61240, planPaid: 46240, copay: 15000, youOwe: 15000 }, undefined],
      ['Blood count', true, { billed: 9600, allowed: 3120, planPaid: 3120, youOwe: 0 }, undefined],
    ]);
    expect(totals(of(named.id))).toEqual({ cents: { billed: 157600, allowed: 64360, planPaid: 49360, copay: 15000, youOwe: 15000 }, claims: 1, lines: 2 });
    expect(totals(of(worded.id)).cents).toEqual({ billed: 90000, allowed: 42000, planPaid: 34000, copay: 8000, youOwe: 8000 });
  });

  it('leads its claim with what the claim says you owe', () => {
    const [c] = claimsOf(of(named.id), lines);
    expect(c).toMatchObject({ claim: named.id, title: 'Emergency visit, moderate severity and blood count', date: '2026-03-14', of: 3 });
    expect(c!.cents.youOwe).toBe(15000);
    // A choice that shows only the replaced line shows no claim: nothing of it counts there.
    expect(claimsOf(of(named.id).filter((l) => l.replaced), lines)).toEqual([]);
    // One that shows the lab alone still leads with the whole claim's.
    expect(claimsOf(of(named.id).filter((l) => l.code === '85025'), lines).map((x) => [x.cents.youOwe, x.lines.length, x.of])).toEqual([[15000, 1, 3]]);
  });

  it('downloads with its amounts left empty, so a spreadsheet’s sums are the claim’s', () => {
    const row = toCsv(of(named.id).slice(0, 1), new Map()).split('\r\n')[1]!;
    expect(row).toMatch(/^2026-03-14,,Example Hospital,Example Health Plan,2026-01-01 to 2026-12-31,"?Emergency visit, high severity \(replaced by the plan, not owed\)"?,99285,CPT,Visit,,,,,,,,,r_claimreplacedaaaaaaa$/);
  });
});

describe('lines that do not add up, with no one line to blame', () => {
  it('mark nothing when either of two lines would do, and keep the difference as its own line', () => {
    const c = record('r_claimambiguousaaaaaa');
    expect(claimLines(c).some((l) => l.replaced)).toBe(false);
    expect(of(c.id).map((l) => [l.service, l.cents])).toEqual([
      ['Therapeutic exercise', { billed: 10000, youOwe: 2000 }],
      ['Therapeutic exercise', { billed: 10000, youOwe: 2000 }],
      ['Not split by line', { billed: -10000, youOwe: -2000 }],
    ]);
  });

  it('mark nothing when no one line is the difference', () => {
    const c = record('r_claimnolinefitsaaaaa');
    expect(claimLines(c).some((l) => l.replaced)).toBe(false);
    expect(of(c.id).at(-1)).toMatchObject({ service: 'Not split by line', cents: { billed: -5000, youOwe: -1000 } });
  });
});
