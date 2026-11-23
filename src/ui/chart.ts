// One test over time, drawn as SVG from the points given: a line chart with
// the reference range shaded behind it, and a small sparkline for a list
// row. The table beside the chart, and the row's text, carry every value.

import { isOutOfRange, rangeFor, resultFlag, type Range } from '../model/flags';
import type { ResultPoint } from '../model/records';
import { s } from './dom';
import { dateText } from './format';

interface Box {
  w: number;
  h: number;
  pad: { top: number; right: number; bottom: number; left: number };
}

const CHART: Box = { w: 640, h: 220, pad: { top: 16, right: 16, bottom: 28, left: 48 } };
const SPARK: Box = { w: 96, h: 28, pad: { top: 3, right: 4, bottom: 3, left: 4 } };

type Dated = ResultPoint & { value: number; date: string };

/** Round ticks from at or below `min` to at or above `max`. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const d = Math.abs(min) || 1;
    min -= d * 0.5;
    max += d * 0.5;
  }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= step0) ?? step0;
  const out: number[] = [];
  for (let i = Math.floor(min / step); ; i += 1) {
    const t = Number((i * step).toFixed(10));
    out.push(t);
    if (t >= max) return out;
  }
}

function fmt(n: number): string {
  return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Points with a number and a date, oldest first (as the series keeps them). */
function plottable(points: ResultPoint[]): Dated[] {
  return points.filter((p): p is Dated => p.value !== undefined && !!p.date && !Number.isNaN(Date.parse(p.date.slice(0, 10))));
}

/**
 * Scales for a box, with the y axis spanning the values and every range
 * bound, so the shaded range is always in view.
 */
function layout(pts: Dated[], unit: string | undefined, box: Box) {
  const ranges = pts.map((p) => rangeFor(p.range, p.unit ?? unit));
  const xs = pts.map((p) => Date.parse(p.date.slice(0, 10)));
  const bounds = ranges.flatMap((r) => [r?.low, r?.high]).filter((v): v is number => v !== undefined);
  const ticks = niceTicks(Math.min(...pts.map((p) => p.value), ...bounds), Math.max(...pts.map((p) => p.value), ...bounds));
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]!;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const { w, h, pad } = box;
  const x = (i: number) => pad.left + (xMax === xMin ? 0.5 : (xs[i]! - xMin) / (xMax - xMin)) * (w - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (h - pad.top - pad.bottom);
  return { ranges, ticks, x, y };
}

/**
 * The range behind each point, as rectangles reaching halfway to its
 * neighbours: a lab that changed its range shows the change where it
 * happened. A one-sided range ("<130") runs to the chart's edge.
 */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function bandRects(pts: Dated[], ranges: (Range | undefined)[], x: (i: number) => number, y: (v: number) => number, box: Box): Rect[] {
  const out: Rect[] = [];
  const same = (a: Range | undefined, b: Range | undefined) => a?.low === b?.low && a?.high === b?.high;
  let i = 0;
  while (i < pts.length) {
    const r = ranges[i];
    let j = i;
    while (j + 1 < pts.length && same(ranges[j + 1], r)) j += 1;
    if (r) {
      const x0 = i === 0 ? box.pad.left : (x(i - 1) + x(i)) / 2;
      const x1 = j === pts.length - 1 ? box.w - box.pad.right : (x(j) + x(j + 1)) / 2;
      const top = r.high !== undefined ? y(r.high) : box.pad.top;
      const bottom = r.low !== undefined ? y(r.low) : box.h - box.pad.bottom;
      out.push({ x: x0, y: top, width: Math.max(0, x1 - x0), height: Math.max(0, bottom - top) });
    }
    i = j + 1;
  }
  return out;
}

function bands(pts: Dated[], ranges: (Range | undefined)[], x: (i: number) => number, y: (v: number) => number, box: Box): SVGElement[] {
  return bandRects(pts, ranges, x, y, box).map((r) => s('rect', { ...r, class: 'chart-band' }));
}

/** The shaded ranges of the full chart, in its 640 by 220 coordinates (for tests). */
export function chartBands(points: ResultPoint[], unit: string | undefined): Rect[] {
  const pts = plottable(points);
  if (pts.length < 2) return [];
  const { ranges, x, y } = layout(pts, unit, CHART);
  return bandRects(pts, ranges, x, y, CHART);
}

const dotClass = (p: ResultPoint) => (isOutOfRange(resultFlag(p)) ? 'chart-dot chart-dot-flag' : 'chart-dot');

/** Null when fewer than two dated numeric points. */
export function resultChart(points: ResultPoint[], unit: string | undefined, name: string): SVGSVGElement | null {
  const pts = plottable(points);
  if (pts.length < 2) return null;
  const { ranges, ticks, x, y } = layout(pts, unit, CHART);
  const { w, h, pad } = CHART;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const latestRange = pts[pts.length - 1]!.range;
  const label = `${name}${unit ? ` in ${unit}` : ''}, ${pts.length} results from ${dateText(pts[0]!.date)} to ${dateText(pts[pts.length - 1]!.date)}${ranges[ranges.length - 1] && latestRange ? `, against the range ${latestRange}` : ''}`;
  return s(
    'svg',
    { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': label },
    bands(pts, ranges, x, y, CHART),
    ticks.map((t) => [
      s('line', { x1: pad.left, x2: w - pad.right, y1: y(t), y2: y(t), class: 'chart-grid' }),
      s('text', { x: pad.left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'chart-label' }, fmt(t)),
    ]),
    s('text', { x: pad.left, y: h - 8, 'text-anchor': 'start', class: 'chart-label' }, dateText(pts[0]!.date)),
    s('text', { x: w - pad.right, y: h - 8, 'text-anchor': 'end', class: 'chart-label' }, dateText(pts[pts.length - 1]!.date)),
    s('path', { d, class: 'chart-line' }),
    pts.map((p, i) => s('circle', { cx: x(i), cy: y(p.value), r: 4, class: dotClass(p) }, s('title', null, `${dateText(p.date)}: ${p.text}`))),
  );
}

/** A row's small picture of the same: hidden from screen readers, since the row's text says it. Null under two points. */
export function resultSparkline(points: ResultPoint[], unit: string | undefined): SVGSVGElement | null {
  const pts = plottable(points);
  if (pts.length < 2) return null;
  const { ranges, x, y } = layout(pts, unit, SPARK);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return s(
    'svg',
    { viewBox: `0 0 ${SPARK.w} ${SPARK.h}`, class: 'spark', 'aria-hidden': 'true', focusable: 'false' },
    bands(pts, ranges, x, y, SPARK),
    s('path', { d, class: 'chart-line' }),
    pts.map((p, i) => s('circle', { cx: x(i), cy: y(p.value), r: 2.4, class: dotClass(p) })),
  );
}
