// A hospital's revenue codes on a claim's lines, as medrec 0.8.2 gives them
// (`items[].revenue`): beside a line's service code, or on a line that has
// none. Such a line is kept, so the claim's lines still add up to its totals.
import { describe, expect, it } from 'vitest';
import { claimLines, revenueText } from '../src/model/claims';
import { costLines, systemName, toCsv, totals } from '../src/model/costs';
import { parseIndex } from '../src/model/parse';
import { search } from '../src/model/search';
import type { MedRecord } from '../src/model/types';
import { fixture } from './helpers';

const PERSON = 'p_fixturerevenueaaaaaa';
const index = parseIndex(fixture('folder/index-revenue-codes.json'), PERSON);
const claim = index.records.find((r) => r.id === 'r_claimrevenueaaaaaaaa') as MedRecord;
const lines = costLines(PERSON, index);

describe('a hospital’s revenue code', () => {
  it('sits beside a line’s service code, and names and codes a line that has none', () => {
    expect(claimLines(claim).map((l) => [l.label, l.code, systemName(l.system), l.category, l.revenue?.code])).toEqual([
      ['Sleep study, overnight', '95810', 'CPT', 'medicine', '0920'],
      ['Breathing care', '0410', 'Revenue code', 'facility', '0410'],
      ['Breathing test', '94010', 'CPT', 'medicine', undefined],
    ]);
  });

  it('is said in words, with its code', () => {
    expect(revenueText({ code: '0920', display: 'Other diagnostic service' })).toBe('Other diagnostic service, revenue code 0920');
    expect(revenueText({ code: '0410' })).toBe('Revenue code 0410');
  });

  it('keeps a line with no service code in every sum, so nothing is left “Not split by line”', () => {
    expect(lines.map((l) => l.service)).toEqual(['Sleep study, overnight', 'Breathing care', 'Breathing test']);
    expect(totals(lines).cents).toEqual({ billed: 157500, allowed: 60200, planPaid: 50200, copay: 10000, youOwe: 10000 });
  });

  it('downloads in the last column, whether it is the line’s code or beside it', () => {
    const [head, ...rows] = toCsv(lines, new Map()).trimEnd().split('\r\n');
    expect(head!.split(',').slice(-3)).toEqual(['Claim', 'Left out by the plan', 'Revenue code']);
    expect(rows.map((r) => r.split(',').slice(-3))).toEqual([
      ['r_claimrevenueaaaaaaaa', '', '0920'],
      ['r_claimrevenueaaaaaaaa', '', '0410'],
      ['r_claimrevenueaaaaaaaa', '', ''],
    ]);
  });

  it('is found by search, in its own words', () => {
    const hit = search(index, null, 'other diagnostic').find((h) => h.id === claim.id);
    expect(hit).toMatchObject({ where: 'field', line: 'Sleep study, overnight (95810) · Other diagnostic service, revenue code 0920 · you owe $100.00' });
  });
});
