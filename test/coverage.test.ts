import { describe, expect, it } from 'vitest';
import { birthWords, coverageHistory, isChange } from '../src/model/coverage';
import { parseIndex } from '../src/model/parse';
import { dateText } from '../src/ui/format';
import { demo, personNamed } from './demo-data';
import { fixture } from './helpers';

const { household } = demo();
const robin = personNamed(household, 'Robin Example');
const jamie = personNamed(household, 'Jamie Example');
const history = (name: 'robin' | 'jamie', id: string) => coverageHistory(parseIndex(fixture(`folder/index-coverage-${name}.json`), id), household, id);

describe('a person’s coverage over time', () => {
  const segments = history('robin', robin.id);

  it('is each insurer and start, newest first, with one entry for a coverage two sources name', () => {
    expect(segments.map((s) => [s.insurer, s.plan, s.start, s.end, s.records.map((r) => r.id), s.organizations, s.first])).toEqual([
      // The insurer's spelling wins over the portal's.
      ['Example Health Plan', 'PPO Choice', '2026-11-08', undefined, ['r_aaaaaaaaaaaaaaaaaaaa', 'r_bbbbbbbbbbbbbbbbbbbb'], ['example-health-plan', 'example-health'], false],
      ['Example Dental', 'Dental Basic', '2025-03-01', '2025-12-31', ['r_dddddddddddddddddddd'], ['example-health'], false],
      ['ExampleHealth Plan', 'PPO Choice', '2024-01-01', '2026-11-07', ['r_cccccccccccccccccccc'], ['example-health'], true],
      ['Example Vision', undefined, undefined, undefined, ['r_ffffffffffffffffffff'], ['example-health'], false],
    ]);
  });

  it('marks a coverage that started the day someone in the household was born, as a date, not a reason', () => {
    expect(segments.map((s) => s.born?.name)).toEqual(['Jamie Example', undefined, undefined, undefined]);
    expect(birthWords(segments[0]!, dateText)).toBe('Changed on Nov 8, 2026, the day Jamie Example was born.');
    expect(segments.slice(1).map((s) => birthWords(s, dateText))).toEqual([undefined, undefined, undefined]);
  });

  it('counts each coverage after the first as a change', () => {
    expect(segments.map(isChange)).toEqual([true, true, false, false]);
  });

  it('says a newborn’s own coverage started the day they were born', () => {
    const [own] = history('jamie', jamie.id);
    expect([own!.first, own!.relationship, isChange(own!)]).toEqual([true, 'child', true]);
    expect(birthWords(own!, dateText)).toBe('Started on Nov 8, 2026, the day Jamie Example was born.');
  });
});
