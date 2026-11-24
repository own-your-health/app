// The costs screen's pictures, as SVG: what the plans paid and your share,
// stacked, month by month and for each row of a breakdown; and for one
// code, what each provider billed beside what the plan allowed. The text
// beside each picture, and the table under the months, carry every amount.

import { formatMoney, fromCents } from '../model/records';
import { fitted, niceTicks, textWidth } from './chart';
import { s, type Child } from './dom';
import { href, type Route } from './router';

const money = (c: number) => formatMoney(fromCents(c)) ?? '';

export interface Stack {
  planPaid: number;
  share: number;
}

/** A bar's top segment ends in a 4px round at its data end; the end on the baseline stays square. */
function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function rightRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(3, h / 2, w);
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

const GAP = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

/** An axis amount in whole dollars, short: "$0", "$500", "$2.5k", "$10k", "$1.2M". */
export function axisMoney(dollars: number): string {
  const short = (n: number, unit: string) => `$${Number(n.toFixed(1)).toLocaleString('en-US')}${unit}`;
  if (Math.abs(dollars) >= 1e6) return short(dollars / 1e6, 'M');
  if (Math.abs(dollars) >= 1000) return short(dollars / 1000, 'k');
  return `$${dollars.toLocaleString('en-US')}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Which months to name, and how: every month when the names fit, else every
 * second, third, fourth, sixth or twelfth; the first named month of each year
 * carries the year ("Nov ’25"). Each name sits under its month, moved in from
 * the chart's edges if it would cross them, and never touches the next.
 */
export function monthLabels(yms: string[], left: number, band: number, width: number): { i: number; text: string; x: number }[] {
  for (const step of [1, 2, 3, 4, 6, 12]) {
    const out: { i: number; text: string; x: number; w: number }[] = [];
    let year = '';
    for (let i = 0; i < yms.length; i += step) {
      const ym = yms[i]!;
      const text = ym.slice(0, 4) === year ? monthShort(ym) : `${monthShort(ym)} ’${ym.slice(2, 4)}`;
      year = ym.slice(0, 4);
      const w = textWidth(text);
      out.push({ i, text, w, x: clamp(left + band * (i + 0.5), w / 2, width - w / 2) });
    }
    const fits = out.every((l, k) => k === 0 || out[k - 1]!.x + out[k - 1]!.w / 2 + 6 <= l.x - l.w / 2);
    if (fits || step === 12) return out.map(({ i, text, x }) => ({ i, text, x }));
  }
  return [];
}

type Month = { ym: string; label: string } & Stack;

/**
 * Plan paid and your share for each month, stacked, with the months between
 * them. Each month is a link to its lines. Drawn at its box's width, so its
 * text keeps its size and stays inside the chart. Null with nothing to draw.
 */
/** `linkText` ends each month's label, saying where its link goes. */
export function monthChart(months: Month[], linkFor: (ym: string) => Route, linkText = 'Show its lines.'): HTMLElement | null {
  if (!months.length) return null;
  return fitted((width) => monthSvg(months, linkFor, width, linkText), 360);
}

export interface MonthLayout {
  width: number;
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
  /** Each tick, in whole dollars. */
  ticks: number[];
  /** A month's column width, and its bar's. */
  band: number;
  bar: number;
  /** Where a total in cents sits, from the top. */
  y: (cents: number) => number;
  /** The months named under the chart. */
  names: { i: number; text: string; x: number }[];
  /** The largest month's total, centred at `x` above its bar; null when the plot is narrower than it. */
  value: { i: number; text: string; x: number; y: number } | null;
}

/**
 * Where everything in the month chart goes at a width in CSS pixels: the left
 * side as wide as the longest tick, the names under the months, and the
 * largest total kept inside the plot.
 */
export function monthLayout(totals: number[], yms: string[], width: number): MonthLayout {
  const W = Math.max(240, width);
  const H = W < 480 ? 200 : 220;
  const top = Math.max(0, ...totals);
  const ticks = niceTicks(0, Math.max(top, 100) / 100, 3);
  const pad = { top: 24, right: 8, bottom: 26, left: Math.max(...ticks.map((t) => textWidth(axisMoney(t)))) + 10 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const yMax = ticks[ticks.length - 1]! * 100;
  const y = (c: number) => pad.top + plotH - (c / yMax) * plotH;
  const band = plotW / totals.length;
  const tallest = totals.reduce((best, t, i) => (t > totals[best]! ? i : best), 0);
  const text = money(top);
  const vw = textWidth(text, true);
  return {
    width: W,
    height: H,
    pad,
    ticks,
    band,
    bar: Math.max(3, Math.min(28, band * 0.62)),
    y,
    names: monthLabels(yms, pad.left, band, W),
    value: top > 0 && vw <= plotW ? { i: tallest, text, x: clamp(pad.left + band * (tallest + 0.5), pad.left + vw / 2, W - pad.right - vw / 2), y: y(top) - 6 } : null,
  };
}

/** The month chart at one width, in CSS pixels. */
function monthSvg(months: Month[], linkFor: (ym: string) => Route, width: number, linkText: string): SVGSVGElement {
  const totalOf = (m: Stack) => Math.max(0, m.planPaid) + Math.max(0, m.share);
  const L = monthLayout(months.map(totalOf), months.map((m) => m.ym), width);
  const { pad, band, y } = L;
  const W = L.width;
  const H = L.height;
  const bw = L.bar;
  const plotH = H - pad.top - pad.bottom;
  const yMax = L.ticks[L.ticks.length - 1]! * 100;
  const names = new Map(L.names.map((l) => [l.i, l]));

  const columns = months.map((m, i) => {
    const x0 = pad.left + band * i;
    const bx = x0 + (band - bw) / 2;
    const plan = Math.max(0, m.planPaid);
    const share = Math.max(0, m.share);
    const segs: Child[] = [];
    const planTop = y(plan);
    const planH = pad.top + plotH - planTop;
    const shareH = (share / yMax) * plotH;
    const shareGap = plan > 0 && share > 0 ? GAP : 0;
    if (plan > 0) segs.push(s('path', { d: share > 0 ? `M${bx},${planTop} H${bx + bw} V${planTop + planH} H${bx} Z` : topRounded(bx, planTop, bw, planH), class: 'cost-plan' }));
    if (share > 0) segs.push(s('path', { d: topRounded(bx, planTop - shareH - shareGap, bw, Math.max(shareH, 1)), class: 'cost-share' }));
    const text = `${m.label}: plan paid ${money(m.planPaid)}, your share ${money(m.share)}`;
    const name = names.get(i);
    return s(
      'a',
      { href: href(linkFor(m.ym)), 'aria-label': `${text}. ${linkText}`, class: 'cost-col' },
      s('title', null, text),
      s('rect', { x: x0, y: pad.top, width: band, height: plotH, class: 'cost-hit' }),
      segs,
      name ? s('text', { x: name.x, y: H - 8, 'text-anchor': 'middle', class: 'chart-label' }, name.text) : null,
    );
  });

  // Each month's link says its amounts, so the value above the largest is only seen.
  const valueLabel = L.value ? s('text', { x: L.value.x, y: L.value.y, 'text-anchor': 'middle', class: 'chart-label chart-value', 'aria-hidden': 'true' }, L.value.text) : null;

  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'chart cost-chart', role: 'group', 'aria-label': 'Plan paid and your share by month' },
    L.ticks.map((t) => [
      s('line', { x1: pad.left, x2: W - pad.right, y1: y(t * 100), y2: y(t * 100), class: 'chart-grid' }),
      s('text', { x: pad.left - 6, y: y(t * 100) + 4, 'text-anchor': 'end', class: 'chart-label' }, axisMoney(t)),
    ]),
    columns,
    valueLabel,
  );
}

/**
 * One row's plan paid and share as a stacked bar, on the scale `max` (the
 * largest row), hidden from screen readers: the row's text says it.
 */
export function stackStrip(m: Stack, max: number): SVGSVGElement {
  const W = 240;
  const H = 10;
  const plan = Math.max(0, m.planPaid);
  const share = Math.max(0, m.share);
  const scale = max > 0 ? W / max : 0;
  const pw = plan * scale;
  const sw = share * scale;
  const gap = pw > 0 && sw > 0 ? GAP : 0;
  return s(
    'svg',
    { viewBox: `0 0 ${W + GAP} ${H}`, class: 'cost-strip', 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { x: 0, y: 0, width: W + GAP, height: H, class: 'cost-track' }),
    pw > 0 ? s('path', { d: sw > 0 ? `M0,0 H${pw} V${H} H0 Z` : rightRounded(0, 0, Math.max(pw, 1), H), class: 'cost-plan' }) : null,
    sw > 0 ? s('path', { d: rightRounded(pw + gap, 0, Math.max(sw, 1), H), class: 'cost-share' }) : null,
  );
}

/**
 * One line of a code's prices: a ring at what was billed, a dot at what the
 * plan allowed, joined, on a scale shared by every line (0 to `max`).
 */
export function priceStrip(billed: number | undefined, allowed: number | undefined, max: number, what: string): SVGSVGElement {
  const W = 240;
  const H = 18;
  const r = 5;
  const x = (c: number) => r + 1 + (max > 0 ? (Math.max(0, c) / max) * (W - 2 * r - 2) : 0);
  const cy = H / 2;
  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'cost-strip cost-price', role: 'img', 'aria-label': `${what}: billed ${billed === undefined ? 'not given' : money(billed)}, allowed ${allowed === undefined ? 'not given' : money(allowed)}` },
    s('line', { x1: x(0), x2: W - r - 1, y1: cy, y2: cy, class: 'cost-axis' }),
    billed !== undefined && allowed !== undefined ? s('line', { x1: x(allowed), x2: x(billed), y1: cy, y2: cy, class: 'cost-span' }) : null,
    billed !== undefined ? s('circle', { cx: x(billed), cy, r, class: 'cost-billed' }, s('title', null, `Billed ${money(billed)}`)) : null,
    allowed !== undefined ? s('circle', { cx: x(allowed), cy, r, class: 'cost-allowed' }, s('title', null, `Allowed ${money(allowed)}`)) : null,
  );
}

/** How much of a limit is used, as a bar on a track; full and square-ended when it is met. */
export function limitMeter(used: number, limit: number): SVGSVGElement {
  const W = 300;
  const H = 8;
  const w = limit > 0 ? Math.min(1, Math.max(0, used) / limit) * W : 0;
  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'cost-strip limit-meter', 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { x: 0, y: 0, width: W, height: H, class: 'cost-track' }),
    w > 0 ? s('path', { d: w >= W ? `M0,0 H${W} V${H} H0 Z` : rightRounded(0, 0, Math.max(w, 1), H), class: 'cost-share' }) : null,
  );
}
