import { describe, expect, it } from 'vitest';
import { birthWords, bornClause, coverageChangesIn, coverageHistory, isChange } from '../src/model/coverage';
import { householdLines, inPeriod } from '../src/model/costs';
import type { MedRecord } from '../src/model/types';
import { dateText } from '../src/ui/format';
import { demo, personNamed } from './demo-data';
import { recordsOf, ruled, RULES } from './rules';

const { household, indexes } = demo();
/** Someone's coverages in the rules' household, where Wren was born the day one started: the sample has no such day. */
const history = (first: string) => coverageHistory(recordsOf(first), RULES, ruled(first));

describe('a person’s coverage over time', () => {
  const segments = history('Kit');

  it('is each insurer and start, newest first, with one entry for a coverage two sources name', () => {
    expect(segments.map((s) => [s.insurer, s.plan, s.start, s.end, s.records.length, s.sources, s.first])).toEqual([
      // The insurer's spelling wins over the portal's.
      ['Example Health Plan', 'Saver 1500', '2015-09-01', undefined, 2, ['Example Health Plan', 'Example Health'], false],
      ['Example Vision', 'Vision Plus', '2011-02-01', '2013-01-31', 1, ['Example Health'], false],
      ['EXAMPLE HEALTH PLAN, INC.', 'Saver 1500', '2009-07-01', '2015-08-31', 1, ['Example Health'], true],
      ['Example Dental', undefined, undefined, undefined, 1, ['Example Health'], false],
    ]);
    // One entered in error is none.
    const ids = segments.flatMap((s) => s.records.map((r) => r.id));
    expect(recordsOf('Kit').records.filter((r) => !ids.includes(r.id)).map((r) => r.status)).toEqual(['entered-in-error']);
  });

  it('knows the insurer’s own record by its sign-in, where another source shares its id', () => {
    const [only] = history('Dale');
    expect([only!.insurer, only!.sources]).toEqual(['Example Care Plan', ['Example Care Plan', 'Example Health']]);
  });

  it('is named by its payer, else by what the record is called', () => {
    const dale = recordsOf('Dale');
    const insurer = (payer?: string) =>
      coverageHistory({ ...dale, records: dale.records.filter((r) => r.kind === 'coverage').map((r) => ({ ...r, display: 'Silver card', fields: { ...r.fields, payer } as MedRecord['fields'] })) }, RULES, ruled('Dale')).map((s) => s.insurer);
    expect(insurer('Example Care Plan')).toEqual(['Example Care Plan']);
    expect(insurer()).toEqual(['Silver card']);
  });

  it('marks a coverage that started the day someone in the household was born, as a date, not a reason', () => {
    expect(segments.map((s) => s.born?.name)).toEqual(['Wren Example', undefined, undefined, undefined]);
    expect(birthWords(segments[0]!, dateText)).toBe('Changed on Sep 1, 2015, the day Wren was born.');
    expect(segments.slice(1).map((s) => birthWords(s, dateText))).toEqual([undefined, undefined, undefined]);
  });

  it('counts each coverage after the first as a change', () => {
    expect(segments.map(isChange)).toEqual([true, true, false, false]);
  });

  it('gives the birthday clause on its own, for a sentence of another shape', () => {
    expect(segments.map(bornClause)).toEqual(['the day Wren was born', undefined, undefined, undefined]);
  });

  it('says a child’s own first coverage started the day they were born', () => {
    const [own] = history('Wren');
    expect([own!.first, own!.relationship, isChange(own!)]).toEqual([true, 'child', true]);
    expect(birthWords(own!, dateText)).toBe('Started on Sep 1, 2015, the day Wren was born.');
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
    expect(changes('plan')).toEqual([['Robin Example', 'Example Health Plan', '2026-01-01']]);
    expect(changes('2026')).toEqual([['Robin Example', 'Example Health Plan', '2026-01-01']]);
    expect(changes('all')).toEqual([['Robin Example', 'Example Health Plan', '2026-01-01']]);
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
