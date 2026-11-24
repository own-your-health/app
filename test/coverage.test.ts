import { describe, expect, it } from 'vitest';
import { birthWords, bornClause, coverageChangesIn, coverageHistory, isChange } from '../src/model/coverage';
import { householdLines, inPeriod } from '../src/model/costs';
import { parseIndex } from '../src/model/parse';
import { dateText } from '../src/ui/format';
import { demo, personNamed } from './demo-data';
import { fixture } from './helpers';

const { household, indexes } = demo();
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
    expect(birthWords(segments[0]!, dateText)).toBe('Changed on Nov 8, 2026, the day Jamie was born.');
    expect(segments.slice(1).map((s) => birthWords(s, dateText))).toEqual([undefined, undefined, undefined]);
  });

  it('counts each coverage after the first as a change', () => {
    expect(segments.map(isChange)).toEqual([true, true, false, false]);
  });

  it('gives the birthday clause on its own, for a sentence of another shape', () => {
    expect(segments.map(bornClause)).toEqual(['the day Jamie was born', undefined, undefined, undefined]);
  });

  it('says a newborn’s own coverage started the day they were born', () => {
    const [own] = history('jamie', jamie.id);
    expect([own!.first, own!.relationship, isChange(own!)]).toEqual([true, 'child', true]);
    expect(birthWords(own!, dateText)).toBe('Started on Nov 8, 2026, the day Jamie was born.');
  });
});

describe('coverage changes inside a cost period', () => {
  const lines = householdLines(household.people.map((p) => ({ id: p.id, index: indexes.get(p.id) })));
  const TODAY = '2026-11-22';
  const changes = (period: string) =>
    coverageChangesIn(
      lines.filter((l) => inPeriod(l, period, TODAY)),
      period,
      (pid) => indexes.get(pid),
      household,
    ).map(({ person, change }) => [household.people.find((p) => p.id === person)?.name, change.insurer, change.start]);

  it('names each change in the plan years, calendar year or years shown, judged by that person’s own lines', () => {
    expect(changes('plan')).toEqual([['Robin Example', 'Example Health Plan', '2026-11-08']]);
    expect(changes('2026')).toEqual([['Robin Example', 'Example Health Plan', '2026-11-08']]);
    expect(changes('all')).toEqual([['Robin Example', 'Example Health Plan', '2026-11-08']]);
    // Robin's last plan year was 2025, before the change.
    expect(changes('plan-1')).toEqual([]);
    expect(changes('2025')).toEqual([]);
  });

  it('names no one without lines in the period, and skips a person whose index is not loaded', () => {
    const sam = lines.filter((l) => l.person === personNamed(household, 'Sam Example').id && inPeriod(l, 'plan', TODAY));
    expect(coverageChangesIn(sam, 'plan', (pid) => indexes.get(pid), household)).toEqual([]);
    expect(coverageChangesIn(lines.filter((l) => inPeriod(l, 'plan', TODAY)), 'plan', () => undefined, household)).toEqual([]);
  });
});
