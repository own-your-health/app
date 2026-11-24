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
      ['Emergency visit, moderate severity', '99284', 'CPT', 'visit', '0450'],
      ['Laboratory', '0300', 'Revenue code', 'facility', '0300'],
      ['Chest X-ray, 2 views', '71046', 'CPT', 'imaging', undefined],
    ]);
  });

  it('is said in words, with its code', () => {
    expect(revenueText({ code: '0450', display: 'Emergency room' })).toBe('Emergency room, revenue code 0450');
    expect(revenueText({ code: '0300' })).toBe('Revenue code 0300');
  });

  it('keeps a line with no service code in every sum, so nothing is left “Not split by line”', () => {
    expect(lines.map((l) => l.service)).toEqual(['Emergency visit, moderate severity', 'Laboratory', 'Chest X-ray, 2 views']);
    expect(totals(lines).cents).toEqual({ billed: 150000, allowed: 70000, planPaid: 55000, copay: 15000, youOwe: 15000 });
  });

  it('downloads in the last column, whether it is the line’s code or beside it', () => {
    const [head, ...rows] = toCsv(lines, new Map()).trimEnd().split('\r\n');
    expect(head!.split(',').slice(-3)).toEqual(['Claim', 'Left out by the plan', 'Revenue code']);
    expect(rows.map((r) => r.split(',').slice(-3))).toEqual([
      ['r_claimrevenueaaaaaaaa', '', '0450'],
      ['r_claimrevenueaaaaaaaa', '', '0300'],
      ['r_claimrevenueaaaaaaaa', '', ''],
    ]);
  });

  it('is found by search, in its own words', () => {
    const hit = search(index, null, 'emergency room').find((h) => h.id === claim.id);
    expect(hit).toMatchObject({ where: 'field', line: 'Emergency visit, moderate severity (99284) · Emergency room, revenue code 0450 · you owe $150.00' });
  });
});
