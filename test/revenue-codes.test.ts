// A hospital's revenue codes on a claim's lines, as medrec 0.8.2 gives them
// (`items[].revenue`): beside a line's service code, or on a line that has
// none. Such a line is kept, so the claim's lines still add up to its totals.
import { describe, expect, it } from 'vitest';
import { claimLines, revenueText } from '../src/model/claims';
import { costLines, systemName, toCsv, totals } from '../src/model/costs';
import { search } from '../src/model/search';
import { recordsOf } from './rules';

const index = recordsOf('Quinn');
const claim = index.records.find((r) => r.kind === 'claim' && r.date === '2026-10-06')!;
const lines = costLines(index.person, index).filter((l) => l.claim === claim.id);

describe('a hospital’s revenue code', () => {
  it('sits beside a line’s service code, and names and codes a line that has none', () => {
    expect(claimLines(claim).map((l) => [l.label, l.code, systemName(l.system), l.category, l.revenue?.code])).toEqual([
      ['Infusion, first hour', '96365', 'CPT', 'medicine', '0260'],
      ['Pharmacy supplies', '0250', 'Revenue code', 'facility', '0250'],
      ['Infusion, each added hour', '96366', 'CPT', 'medicine', undefined],
    ]);
  });

  it('is said in words, with its code', () => {
    expect(revenueText({ code: '0540', display: 'Ambulance' })).toBe('Ambulance, revenue code 0540');
    expect(revenueText({ code: '0110' })).toBe('Revenue code 0110');
  });

  it('keeps a line with no service code in every sum, so nothing is left “Not split by line”', () => {
    expect(lines.map((l) => l.service)).toEqual(['Infusion, first hour', 'Pharmacy supplies', 'Infusion, each added hour']);
    expect(totals(lines).cents).toEqual({ billed: 97000, allowed: 44000, planPaid: 37000, coinsurance: 7000, youOwe: 7000 });
  });

  it('downloads in the last column, whether it is the line’s code or beside it', () => {
    const [head, ...rows] = toCsv(lines, new Map()).trimEnd().split('\r\n');
    expect(head!.split(',').slice(-3)).toEqual(['Claim', 'Left out by the plan', 'Revenue code']);
    expect(rows.map((r) => r.split(',').slice(-3))).toEqual([
      [claim.id, '', '0260'],
      [claim.id, '', '0250'],
      [claim.id, '', ''],
    ]);
  });

  it('is found by search, in its own words', () => {
    const hit = search(index, null, 'iv therapy').find((h) => h.id === claim.id);
    expect(hit).toMatchObject({ where: 'field', line: 'Infusion, first hour (96365) · IV therapy, revenue code 0260 · you owe $60.00' });
  });
});
