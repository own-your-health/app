import { describe, expect, it } from 'vitest';
import type { ResultPoint } from '../src/model/records';
import { chartBands, niceTicks } from '../src/ui/chart';

// The full chart is 640 by 220, with 48 to the left, 16 to the right and top, and 28 below.
const LEFT = 48;
const RIGHT = 640 - 16;
const TOP = 16;
const BOTTOM = 220 - 28;

const p = (date: string, value: number, range?: string, unit = 'mg/dL'): ResultPoint => ({ id: date, date, value, text: `${value} ${unit}`, unit, ...(range ? { range } : {}) });

describe('the axis', () => {
  it('reaches past the highest and lowest value', () => {
    expect(niceTicks(117, 168)).toEqual([100, 120, 140, 160, 180]);
    expect(niceTicks(104, 162)).toEqual([100, 120, 140, 160, 180]);
    expect(niceTicks(3.5, 5.4)).toEqual([3.5, 4, 4.5, 5, 5.5]);
    expect(niceTicks(0.8, 0.9)).toEqual([0.8, 0.825, 0.85, 0.875, 0.9]);
    // One value: half its size either side.
    expect(niceTicks(5, 5)).toEqual([2, 4, 6, 8]);
  });
});

describe('the reference range behind a chart', () => {
  it('spans the chart when every result came with the same range', () => {
    const [band, ...rest] = chartBands([p('2026-01-01', 62, '70-99 mg/dL'), p('2026-06-01', 105, '70-99 mg/dL')], 'mg/dL');
    expect(rest).toEqual([]);
    expect(band).toMatchObject({ x: LEFT, width: RIGHT - LEFT });
    expect(band!.y).toBeGreaterThan(TOP);
    expect(band!.y + band!.height).toBeLessThan(BOTTOM);
  });

  it('changes halfway between two results whose ranges differ', () => {
    const bands = chartBands([p('2026-01-01', 90, '70-99 mg/dL'), p('2026-03-01', 92, '70-99 mg/dL'), p('2026-05-01', 95, '65-110 mg/dL')], 'mg/dL');
    expect(bands).toHaveLength(2);
    expect(bands[0]!.x + bands[0]!.width).toBeCloseTo(bands[1]!.x);
    // The wider range is taller.
    expect(bands[1]!.height).toBeGreaterThan(bands[0]!.height);
  });

  it('runs a one-sided range to the chart’s edge, with its bound in view', () => {
    const [below] = chartBands([p('2025-03-10', 162, '<130 mg/dL'), p('2026-10-01', 104, '<130 mg/dL')], 'mg/dL');
    expect(below!.y + below!.height).toBeCloseTo(BOTTOM);
    expect(below!.y).toBeGreaterThan(TOP);
    const [above] = chartBands([p('2025-03-10', 44, '>39 mg/dL'), p('2026-10-01', 51, '>39 mg/dL')], 'mg/dL');
    expect(above!.y).toBeCloseTo(TOP);
    expect(above!.y + above!.height).toBeLessThan(BOTTOM);
  });

  it('draws no range it cannot read in the result’s unit', () => {
    expect(chartBands([p('2026-01-01', 5, '3.5-5.1 mmol/L', 'mg/dL'), p('2026-02-01', 6, 'Negative', 'mg/dL')], 'mg/dL')).toEqual([]);
    expect(chartBands([p('2026-01-01', 5, '3.5-5.1 mmol/L')], 'mg/dL')).toEqual([]);
  });
});
