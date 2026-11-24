// The calendar: the month's weeks, the household's events in order,
// and private events kept off the shared view.
import { describe, expect, it } from 'vitest';
import { barPart, householdEvents, inMonth, listPage, markShape, monthWeeks, onDay, shiftMonth, shown } from '../src/next/calendar';
import { demo, personNamed } from './demo-data';

describe('a month', () => {
  it('shows whole weeks, Sunday first, with the days either side', () => {
    const oct = monthWeeks('2026-10');
    expect(oct.length).toBe(5);
    expect(oct[0]).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(oct.at(-1)!.at(-1)).toBe('2026-10-31');
    // A month that starts on a Sunday and needs a sixth week.
    expect(monthWeeks('2026-11')[0]![0]).toBe('2026-11-01');
    expect(monthWeeks('2026-08').length).toBe(6);
  });

  it('moves across years', () => {
    expect([shiftMonth('2026-01', -1), shiftMonth('2026-12', 1), shiftMonth('2026-10', -14)]).toEqual(['2025-12', '2027-01', '2025-08']);
  });
});

describe('the household’s events', () => {
  const { household, indexes } = demo();
  const events = householdEvents(household, (id) => indexes.get(id), '2026-11-22');
  const [robin, sam, , jamie] = household.people.map((p) => p.id);

  it('come newest first, each with its person’s lane in household order', () => {
    expect(events.map((x) => x.event.start)).toEqual([...events.map((x) => x.event.start)].sort().reverse());
    expect(new Set(events.map((x) => `${x.person.name}:${x.lane}`))).toEqual(new Set(['Robin Example:0', 'Sam Example:1', 'Alex Example:2', 'Jamie Example:3']));
    expect(events[0]!.person.id).toBe(personNamed(household, 'Alex Example').id);
  });

  it('keep a private event off the shared view, and on its person’s own', () => {
    // Sam's counseling session, and the fill of the medicine tied to it.
    const kept = events.filter((x) => x.private);
    expect(kept.map((x) => [x.person.id, x.private, x.event.title, x.event.start])).toEqual([
      [sam, 'mental_health', 'Sertraline 50 mg tablet', '2026-10-28'],
      [sam, 'mental_health', 'Office visit', '2026-10-27'],
    ]);
    const counseling = kept[1]!;

    const everyone = shown(events, undefined, false);
    expect([everyone.events.length, everyone.hidden]).toEqual([events.length - 2, 2]);
    expect(everyone.events).not.toContain(counseling);
    expect(shown(events, undefined, true)).toEqual({ events, hidden: 0 });
    expect(shown(events, sam, false).events).toContain(counseling);
    expect(shown(events, robin, false).events.every((x) => x.person.id === robin)).toBe(true);
  });

  it('mark a stay across its days, a fill as a ring and a visit as a dot', () => {
    const birth = events.find((x) => x.person.id === jamie && x.event.kind === 'stay')!;
    expect([birth.event.start, birth.event.end, markShape(birth.event)]).toEqual(['2026-11-08', '2026-11-10', 'bar']);
    expect(['2026-11-08', '2026-11-09', '2026-11-10'].map((d) => barPart(birth.event, d))).toEqual(['start', 'mid', 'end']);
    expect(onDay(events, '2026-11-09')).toEqual([birth]);
    const fill = events.find((x) => x.event.kind === 'fill')!;
    expect(markShape(fill.event)).toBe('ring');
    expect(markShape(events.find((x) => x.event.kind === 'office')!.event)).toBe('dot');
  });

  it('list a page of months at a time, then the months before', () => {
    const first = listPage(events, undefined, 3);
    expect(first).toEqual({ months: ['2026-11', '2026-10', '2026-09'], earlier: '2026-09' });
    expect(listPage(events, first.earlier, 3).months[0]).toBe('2026-08');
    const all = listPage(events, undefined, 100);
    expect(all.earlier).toBeUndefined();
    expect(all.months.at(-1)).toBe(events.at(-1)!.event.start.slice(0, 7));
  });

  it('belong to every month they touch', () => {
    const er = events.find((x) => x.event.kind === 'er')!;
    expect(inMonth(events, '2026-09')).toContain(er);
    expect(inMonth(events, '2026-10')).not.toContain(er);
    expect(inMonth([{ ...er, event: { ...er.event, start: '2026-09-30', end: '2026-10-02' } }], '2026-10')).toHaveLength(1);
  });
});
