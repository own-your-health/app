import { describe, expect, it } from 'vitest';
import type { ResultPoint } from '../src/model/records';
import { chartBands, drawable, niceTicks } from '../src/ui/chart';

// The full chart is 640 by 220, with 48 to the left, 16 to the right and top, and 28 below.
const LEFT = 48;
const RIGHT = 640 - 16;
const TOP = 16;
const BOTTOM = 220 - 28;

const p = (date: string, value: number, range?: string, unit = 'mm Hg'): ResultPoint => ({ id: date, date, value, text: `${value} ${unit}`, unit, ...(range ? { range } : {}) });

describe('the axis', () => {
  it('reaches past the highest and lowest value', () => {
    expect(niceTicks(233, 281)).toEqual([220, 240, 260, 280, 300]);
    expect(niceTicks(43, 57)).toEqual([40, 45, 50, 55, 60]);
    expect(niceTicks(6.5, 8.1)).toEqual([6.5, 7, 7.5, 8, 8.5]);
    expect(niceTicks(0.4, 0.5)).toEqual([0.4, 0.425, 0.45, 0.475, 0.5]);
    // One value: half its size either side.
    expect(niceTicks(12, 12)).toEqual([5, 10, 15, 20]);
  });
});

describe('the reference range behind a chart', () => {
  it('spans the chart when every result came with the same range', () => {
    const [band, ...rest] = chartBands([p('2025-02-11', 8, '11-21 mm Hg'), p('2025-08-19', 25, '11-21 mm Hg')], 'mm Hg');
    expect(rest).toEqual([]);
    expect(band).toMatchObject({ x: LEFT, width: RIGHT - LEFT });
    expect(band!.y).toBeGreaterThan(TOP);
    expect(band!.y + band!.height).toBeLessThan(BOTTOM);
  });

  it('changes halfway between two results whose ranges differ', () => {
    const bands = chartBands([p('2025-02-11', 14, '11-21 mm Hg'), p('2025-05-06', 16, '11-21 mm Hg'), p('2025-08-19', 17, '9-24 mm Hg')], 'mm Hg');
    expect(bands).toHaveLength(2);
    expect(bands[0]!.x + bands[0]!.width).toBeCloseTo(bands[1]!.x);
    // The wider range is taller.
    expect(bands[1]!.height).toBeGreaterThan(bands[0]!.height);
  });

  it('runs a one-sided range to the chart’s edge, with its bound in view', () => {
    const [below] = chartBands([p('2024-04-23', 31, '<24 mm Hg'), p('2025-08-19', 19, '<24 mm Hg')], 'mm Hg');
    expect(below!.y + below!.height).toBeCloseTo(BOTTOM);
    expect(below!.y).toBeGreaterThan(TOP);
    const [above] = chartBands([p('2024-04-23', 17, '>15 mm Hg'), p('2025-08-19', 21, '>15 mm Hg')], 'mm Hg');
    expect(above!.y).toBeCloseTo(TOP);
    expect(above!.y + above!.height).toBeLessThan(BOTTOM);
  });

  it('draws no range it cannot read in the result’s unit', () => {
    expect(chartBands([p('2025-02-11', 15, '1.5-2.8 kPa', 'mm Hg'), p('2025-05-06', 18, 'Not detected', 'mm Hg')], 'mm Hg')).toEqual([]);
    expect(chartBands([p('2025-02-11', 15, '1.5-2.8 kPa')], 'mm Hg')).toEqual([]);
  });
});

describe('what a chart draws', () => {
  const dates = (pts: ResultPoint[]) => pts.map((x) => x.date);

  it('is the results in the newest one’s unit, as one axis has one', () => {
    const kpa = p('2025-03-01', 16, undefined, 'kPa');
    const all = [p('2025-01-01', 120), kpa, p('2025-05-01', 118)];
    expect([dates(drawable(all, undefined).points), drawable(all, undefined).unit, drawable(all, undefined).other]).toEqual([['2025-01-01', '2025-05-01'], 'mm Hg', 1]);
    const newest = drawable([...all, { ...kpa, date: '2025-06-01' }], undefined);
    expect([dates(newest.points), newest.unit, newest.other]).toEqual([['2025-03-01', '2025-06-01'], 'kPa', 2]);
    expect(chartBands([p('2025-01-01', 8, '11-21 mm Hg'), { ...kpa, range: '1-3 kPa' }, p('2025-05-01', 25, '11-21 mm Hg')], undefined)).toHaveLength(1);
  });

  it('reads two spellings of one unit as one', () => {
    const d = drawable([p('2025-01-01', 120, undefined, 'mg/dL'), p('2025-03-01', 119, undefined, ' MG/DL '), p('2025-05-01', 118, undefined, 'mg/dl')], undefined);
    expect([d.points.length, d.unit, d.other]).toEqual([3, 'mg/dl', 0]);
    expect(drawable([p('2025-01-01', 4, undefined, 'uIU/mL'), p('2025-03-01', 5, undefined, 'µIU/mL')], undefined).other).toBe(0);
  });

  it('is the newest unit that has two results, where the newest result is alone in its own', () => {
    const d = drawable([p('2025-01-01', 120), p('2025-03-01', 118), p('2025-05-01', 16, undefined, 'kPa')], undefined);
    expect([dates(d.points), d.unit, d.other]).toEqual([['2025-01-01', '2025-03-01'], 'mm Hg', 1]);
    const alone = drawable([p('2025-01-01', 120), p('2025-05-01', 16, undefined, 'kPa')], undefined);
    expect([dates(alone.points), alone.unit, alone.other]).toEqual([['2025-05-01'], 'kPa', 1]);
  });

  it('takes a result with no unit as in the series’ own, and leaves out what is no dated number', () => {
    const bare = { ...p('2025-03-01', 119), unit: undefined };
    const d = drawable([p('2025-01-01', 120), bare, { ...p('2025-04-01', 1), value: undefined }, { ...p('2025-05-01', 118), date: undefined }], 'mm Hg');
    expect([dates(d.points), d.unit, d.other]).toEqual([['2025-01-01', '2025-03-01'], 'mm Hg', 0]);
    expect(drawable([], 'mm Hg')).toEqual({ points: [], unit: 'mm Hg', other: 0 });
  });
});
