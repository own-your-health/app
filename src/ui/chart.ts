// One test over time: a small line chart drawn as SVG, values only from the
// points given. The table beside it carries every value as text.

import type { ResultPoint } from '../model/records';
import { s } from './dom';
import { dateText } from './format';

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const d = Math.abs(min) || 1;
    min -= d * 0.5;
    max += d * 0.5;
  }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function fmt(n: number): string {
  return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Null when fewer than two dated numeric points. */
export function resultChart(points: ResultPoint[], unit: string | undefined, name: string): SVGSVGElement | null {
  const pts = points.filter((p) => p.value !== undefined && p.date && !Number.isNaN(Date.parse(p.date.slice(0, 10))));
  if (pts.length < 2) return null;
  const xs = pts.map((p) => Date.parse(p.date!.slice(0, 10)));
  const ys = pts.map((p) => p.value!);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]!;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const x = (t: number) => PAD.left + (xMax === xMin ? 0.5 : (t - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(xs[i]!).toFixed(1)},${y(p.value!).toFixed(1)}`).join(' ');
  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${name}${unit ? ` in ${unit}` : ''}, ${pts.length} results from ${dateText(pts[0]!.date)} to ${dateText(pts[pts.length - 1]!.date)}` },
    ticks.map((t) => [
      s('line', { x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t), class: 'chart-grid' }),
      s('text', { x: PAD.left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'chart-label' }, fmt(t)),
    ]),
    s('text', { x: PAD.left, y: H - 8, 'text-anchor': 'start', class: 'chart-label' }, dateText(pts[0]!.date)),
    s('text', { x: W - PAD.right, y: H - 8, 'text-anchor': 'end', class: 'chart-label' }, dateText(pts[pts.length - 1]!.date)),
    s('path', { d, class: 'chart-line' }),
    pts.map((p, i) => s('circle', { cx: x(xs[i]!), cy: y(p.value!), r: 4, class: p.interpretation && !/normal/i.test(p.interpretation) ? 'chart-dot chart-dot-flag' : 'chart-dot' }, s('title', null, `${dateText(p.date)}: ${p.text}`))),
  );
}
