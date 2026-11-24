import { describe, expect, it } from 'vitest';
import { parseRoute } from '../src/ui/router';
import { tabOf } from '../src/ui/tabs';

const P = 'p_aaaaaaaaaaaaaaaaaaaa';
const R = 'r_aaaaaaaaaaaaaaaaaaaa';

describe('the tab a page belongs to', () => {
  it('is its part’s, for the part’s own pages too', () => {
    expect(tabOf(parseRoute('#/'))).toBe('home');
    expect(tabOf(parseRoute('#/calendar?view=list'))).toBe('calendar');
    expect(tabOf(parseRoute(`#/money/bills?who=${P}`))).toBe('money');
    expect(tabOf(parseRoute('#/costs?period=2025'))).toBe('money');
    expect(tabOf(parseRoute(`#/health/doctor?who=${P}`))).toBe('health');
    expect(tabOf(parseRoute(`#/p/${P}/results`))).toBe('health');
    expect(tabOf(parseRoute(`#/p/${P}/immunizations`))).toBe('health');
    expect(tabOf(parseRoute(`#/papers?who=${P}`))).toBe('papers');
  });

  it('is none for a visit, a record, search and settings', () => {
    for (const hash of [`#/p/${P}/e/${R}`, `#/p/${P}/r/${R}`, '#/search?q=flu', '#/settings', '#/sources']) expect(tabOf(parseRoute(hash))).toBeUndefined();
  });
});
