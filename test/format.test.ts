import { describe, expect, it } from 'vitest';
import { bytes, clock, count, dateText, duration, relative, yearOf } from '../src/ui/format';

const NOW = new Date('2026-11-22T20:00:00Z');

describe('format', () => {
  it('says how long ago, or how long until', () => {
    expect(relative('2026-11-22T19:59:30Z', NOW)).toBe('just now');
    expect(relative('2026-11-22T19:56:00Z', NOW)).toBe('4 minutes ago');
    expect(relative('2026-11-22T23:00:00Z', NOW)).toBe('in 3 hours');
    expect(relative('2026-11-21T20:00:00Z', NOW)).toBe('1 day ago');
    expect(relative('2026-05-22T20:00:00Z', NOW)).toBe('6 months ago');
    expect(relative('2020-11-22T20:00:00Z', NOW)).toBe('6 years ago');
    expect(relative(null, NOW)).toBe('never');
    expect(relative('garbage', NOW)).toBe('unknown');
  });

  it('keeps a partial date partial', () => {
    expect(dateText('2026')).toBe('2026');
    expect(dateText('2026-03')).toMatch(/2026/);
    expect(dateText('2026-03')).not.toMatch(/\b1\b/);
    expect(dateText('2026-03-05')).toMatch(/5/);
    expect(dateText(undefined)).toBe('No date');
    expect(yearOf('2026-03-05')).toBe('2026');
    expect(yearOf(undefined)).toBe('No date');
  });

  it('writes sizes and spans', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(50 * 1024 * 1024)).toBe('50 MB');
    expect(duration(300)).toBe('5 minutes');
    expect(duration(3600)).toBe('1 hour');
    expect(duration(3 * 86400)).toBe('3 days');
    expect(count(1, 'record')).toBe('1 record');
    expect(count(2, 'study', 'studies')).toBe('2 studies');
  });

  it('says when a coming moment falls, in local days', () => {
    // Local times, so the test holds in any time zone.
    const now = new Date(2026, 10, 22, 14, 0);
    const iso = (d: Date) => d.toISOString();
    expect(clock(iso(new Date(2026, 10, 22, 13, 0)), now)).toBe('now');
    expect(clock(iso(new Date(2026, 10, 22, 21, 40)), now)).toMatch(/^at \S/);
    expect(clock(iso(new Date(2026, 10, 23, 0, 30)), now)).toMatch(/^tomorrow at \S/);
    expect(clock(iso(new Date(2026, 10, 25, 9, 0)), now)).toMatch(/^on \S.*2026/);
    expect(clock(null, now)).toBe('at an unknown time');
  });
});
