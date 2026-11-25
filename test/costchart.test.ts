// The month chart's layout at every width from a phone's up: its text keeps
// its size, so the room for it is worked out, and nothing crosses an edge.
import { describe, expect, it } from 'vitest';
import { textWidth } from '../src/ui/chart';
import { axisMoney, monthLabels, monthLayout } from '../src/ui/costchart';

const WIDTHS = [240, 280, 320, 358, 390, 480, 768, 1100, 1280];

/** Consecutive months from a year-month. */
const months = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + i, 1)).toISOString().slice(0, 7));

/** Totals in cents with one large month last, as a costly month makes. */
const totals = (n: number, largest: number) => Array.from({ length: n }, (_, i) => (i === n - 1 ? largest : (i % 4) * 25_000));

describe('the axis', () => {
  it('says amounts short', () => {
    expect([0, 200, 500, 1000, 2500, 10_000, 12_500, 20_000, 500_000, 1_000_000, 1_500_000].map(axisMoney)).toEqual(['$0', '$200', '$500', '$1k', '$2.5k', '$10k', '$12.5k', '$20k', '$500k', '$1M', '$1.5M']);
  });
});

describe('the month chart’s layout', () => {
  const cases: [string, number, number][] = [
    ['a year, the largest month five figures', 11, 3_186_240],
    ['two years and a month, one month over a million', 25, 123_456_789],
    ['one month', 1, 8_420],
    ['nothing spent', 6, 0],
  ];

  it.each(cases)('keeps every label inside the chart at every width: %s', (_, n, largest) => {
    for (const width of WIDTHS) {
      const L = monthLayout(largest === 0 ? Array<number>(n).fill(0) : totals(n, largest), months('2024-11', n), width);
      // The ticks end at the plot's left edge and start inside the chart.
      for (const t of L.ticks) expect(L.pad.left - 6 - textWidth(axisMoney(t))).toBeGreaterThanOrEqual(0);
      // The months' names: inside the chart, apart, and under their months.
      expect(L.names.length).toBeGreaterThan(0);
      L.names.forEach((l, k) => {
        const w = textWidth(l.text);
        expect(l.x - w / 2).toBeGreaterThanOrEqual(0);
        expect(l.x + w / 2).toBeLessThanOrEqual(L.width);
        if (k > 0) {
          const prev = L.names[k - 1]!;
          expect(prev.x + textWidth(prev.text) / 2 + 6).toBeLessThanOrEqual(l.x - w / 2);
        }
      });
      // The largest total: inside the plot, and above the top of the chart.
      if (largest > 0) {
        const v = L.value!;
        const w = textWidth(v.text, true);
        expect(v.x - w / 2).toBeGreaterThanOrEqual(L.pad.left);
        expect(v.x + w / 2).toBeLessThanOrEqual(L.width - L.pad.right);
        expect(v.y - 12).toBeGreaterThanOrEqual(0);
      } else expect(L.value).toBeNull();
    }
  });

  it('names the year once, on the first named month of each year', () => {
    const L = monthLayout(totals(13, 50_000), months('2025-11', 13), 1280);
    expect(L.names.map((l) => l.text)).toEqual(['Nov ’25', 'Dec', 'Jan ’26', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    const narrow = monthLayout(totals(13, 50_000), months('2025-11', 13), 320).names.map((l) => l.text);
    expect(narrow.length).toBeLessThan(13);
    expect(narrow[0]).toBe('Nov ’25');
    expect(narrow.filter((t) => t.includes('’26'))).toHaveLength(1);
  });

  it('is drawn at the width it is given, a fixed height, not a fixed shape', () => {
    expect([320, 1280].map((w) => [monthLayout([100], ['2026-01'], w).width, monthLayout([100], ['2026-01'], w).height])).toEqual([
      [320, 200],
      [1280, 220],
    ]);
  });

  it('places a name under its month when there is room', () => {
    const [first] = monthLabels(['2026-01', '2026-02'], 50, 100, 260);
    expect(first).toEqual({ i: 0, text: 'Jan ’26', x: 100 });
  });
});
