// One test over time, drawn as SVG from the points given: a line chart with
// the reference range shaded behind it, and a small sparkline for a list
// row. The table beside the chart, and the row's text, carry every value.

import { isOutOfRange, rangeFor, resultFlag, type FlagLevel, type Range } from '../model/flags';
import type { ResultPoint } from '../model/records';
import { h, s } from './dom';
import { dateText } from './format';

/** The size of a chart's text (`.chart-label`), in CSS pixels. */
export const LABEL_PX = 12;

/**
 * A label's width, a little over what any of the app's fonts draws, so space
 * kept for it is never short: 0.62em a character, more when bold.
 */
export function textWidth(text: string, bold = false): number {
  return Math.ceil(text.length * LABEL_PX * (bold ? 0.66 : 0.62));
}

/**
 * A chart drawn at its box's width in CSS pixels, so its text keeps its size
 * at any width and nothing is scaled past the edge; drawn again when the box
 * changes width. `draw` gets the width; until the box is laid out, `initial`.
 */
export function fitted(draw: (width: number) => SVGSVGElement, initial: number): HTMLElement {
  let drawn = initial;
  const box = h('div', { class: 'chart-fit' }, draw(initial));
  if (typeof ResizeObserver === 'undefined') return box;
  new ResizeObserver((entries) => {
    const w = Math.floor(entries[0]?.contentRect.width ?? 0);
    if (w > 0 && w !== drawn) {
      drawn = w;
      // A link in the chart that held focus has it again once redrawn, so a keyboard keeps its place.
      const focused = document.activeElement;
      const at = focused && box.contains(focused) ? focused.getAttribute('href') : null;
      box.replaceChildren(draw(w));
      if (at !== null) [...box.querySelectorAll<SVGAElement | HTMLAnchorElement>('a')].find((a) => a.getAttribute('href') === at)?.focus();
    }
  }).observe(box);
  return box;
}

interface Box {
  w: number;
  h: number;
  pad: { top: number; right: number; bottom: number; left: number };
}

const CHART: Box = { w: 640, h: 220, pad: { top: 16, right: 16, bottom: 28, left: 48 } };

/** The full chart's box at a width: its left side as wide as its longest tick. */
function chartBox(width: number, ticks: number[]): Box {
  const left = Math.max(28, ...ticks.map((t) => textWidth(fmt(t)) + 10));
  return { w: width, h: width < 480 ? 200 : 220, pad: { ...CHART.pad, left } };
}
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

/** Null when fewer than two dated numeric points. Drawn at its box's width. */
export function resultChart(points: ResultPoint[], unit: string | undefined, name: string): HTMLElement | null {
  const pts = plottable(points);
  if (pts.length < 2) return null;
  return fitted((width) => resultSvg(pts, unit, name, width), CHART.w);
}

function resultSvg(pts: Dated[], unit: string | undefined, name: string, width: number): SVGSVGElement {
  const box = chartBox(width, layout(pts, unit, CHART).ticks);
  const { ranges, ticks, x, y } = layout(pts, unit, box);
  const { w, h, pad } = box;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const latestRange = pts[pts.length - 1]!.range;
  const label = `${name}${unit ? ` in ${unit}` : ''}, ${pts.length} results from ${dateText(pts[0]!.date)} to ${dateText(pts[pts.length - 1]!.date)}${ranges[ranges.length - 1] && latestRange ? `, against the range ${latestRange}` : ''}`;
  return s(
    'svg',
    { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': label },
    bands(pts, ranges, x, y, box),
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

/** The mark inside the value's dot, so in or out of range never rests on colour alone. */
const GLYPH: Record<FlagLevel, (x: number, y: number) => string> = {
  normal: (x, y) => `M${x - 4} ${y} l3 3 l5 -6`,
  high: (x, y) => `M${x} ${y + 4.5} V${y - 4.5} M${x - 4} ${y - 0.5} L${x} ${y - 4.5} L${x + 4} ${y - 0.5}`,
  low: (x, y) => `M${x} ${y - 4.5} V${y + 4.5} M${x - 4} ${y + 0.5} L${x} ${y + 4.5} L${x + 4} ${y + 0.5}`,
  abnormal: (x, y) => `M${x} ${y - 5} V${y + 1} M${x} ${y + 4.5} v0.01`,
};

let hatches = 0;

/**
 * Where one value sits against the lab's range: the range as a calm band,
 * the stretches outside it hatched in the attention colour, a dot at the
 * value with a mark for how it reads (in range, above, below), and the
 * range's bounds below. The sentence beside it carries the reading; the
 * picture only shows it. A one-sided range ("<130") runs from zero, or on
 * to the end of the track.
 */
export function rangeBar(value: number, range: Range, level: FlagLevel | undefined, label: string): SVGSVGElement {
  const w = 320;
  const h = 48;
  const pad = 10;
  const { low, high } = range;
  let lo: number;
  let hi: number;
  if (low !== undefined && high !== undefined) {
    const span = high - low || Math.abs(high) || 1;
    lo = Math.min(low - span * 0.5, value);
    hi = Math.max(high + span * 0.5, value);
    if (low >= 0 && lo < 0) lo = 0;
  } else if (high !== undefined) {
    lo = Math.min(0, value);
    hi = Math.max(high * 1.6, value);
  } else {
    lo = Math.min(0, value, low ?? 0);
    hi = Math.max((low ?? 0) * 2, value) || 1;
  }
  // Room past the ends, so a marker at the edge is drawn whole.
  const margin = (hi - lo) * 0.04 || 1;
  lo -= value <= lo ? margin : 0;
  hi += value >= hi ? margin : 0;
  const x = (v: number) => Math.min(w - pad, Math.max(pad, pad + ((v - lo) / (hi - lo || 1)) * (w - pad * 2)));
  const trackY = 14;
  const round = (n: number) => Math.round(n * 10) / 10;
  // The stretches of the track, with a 2px gap where they meet.
  const from = low !== undefined ? x(low) : pad;
  const to = high !== undefined ? x(high) : w - pad;
  const seg = (a: number, b: number, cls: string, fill?: string) =>
    b - a >= 1 ? s('rect', { x: round(a), y: trackY - 5, width: round(b - a), height: 10, rx: 2, class: cls, fill }) : null;
  const id = `range-hatch-${++hatches}`;
  const outside = (a: number, b: number) => [seg(a, b, 'range-zone'), seg(a, b, 'range-zone-hatch', `url(#${id})`)];
  const bound = (v: number | undefined, anchor: string) => (v === undefined ? null : s('text', { x: round(x(v)), y: h - 4, 'text-anchor': anchor, class: 'chart-label' }, fmt(v)));
  const narrow = low !== undefined && high !== undefined && x(high) - x(low) < 36;
  const cx = round(x(value));
  const marker = level === 'normal' ? 'range-marker range-marker-in' : level ? 'range-marker range-marker-out' : 'range-marker';
  return s(
    'svg',
    { viewBox: `0 0 ${w} ${h}`, class: 'range-bar', role: 'img', 'aria-label': label },
    s('defs', null, s('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { x1: 1, y1: 0, x2: 1, y2: 6, class: 'range-hatch' }))),
    low !== undefined ? outside(pad, from - 1) : null,
    seg(from + (low !== undefined ? 1 : 0), Math.max(to - (high !== undefined ? 1 : 0), from + 2), 'range-band'),
    high !== undefined ? outside(to + 1, w - pad) : null,
    bound(low, narrow ? 'end' : 'middle'),
    bound(high, narrow ? 'start' : 'middle'),
    s('circle', { cx, cy: trackY, r: 9, class: marker }, s('title', null, label)),
    level ? s('path', { d: GLYPH[level](cx, trackY), class: 'range-glyph' }) : null,
  );
}
