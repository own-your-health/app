// The costs screen's pictures, as SVG: what the plans paid and your share,
// stacked, month by month and for each row of a breakdown; and for one
// code, what each provider billed beside what the plan allowed. The text
// beside each picture, and the table under the months, carry every amount.

import { fromCents } from '../model/billing';
import { formatMoney } from '../model/records';
import { niceTicks } from './chart';
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

/**
 * Plan paid and your share for each month, stacked, with the months between
 * them. Each month is a link to its lines. Null with nothing to draw.
 */
export function monthChart(months: ({ ym: string; label: string } & Stack)[], linkFor: (ym: string) => Route): SVGSVGElement | null {
  if (!months.length) return null;
  const W = 360;
  const H = 196;
  const pad = { top: 22, right: 6, bottom: 38, left: 46 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const totalOf = (m: Stack) => Math.max(0, m.planPaid) + Math.max(0, m.share);
  const top = Math.max(...months.map(totalOf));
  const ticks = niceTicks(0, Math.max(top, 100) / 100, 3);
  const yMax = ticks[ticks.length - 1]! * 100;
  const y = (c: number) => pad.top + plotH - (c / yMax) * plotH;
  const band = plotW / months.length;
  const bw = Math.max(3, Math.min(28, band * 0.62));
  const tallest = months.reduce((best, m, i) => (totalOf(m) > totalOf(months[best]!) ? i : best), 0);

  // Every month's name when they fit, else every second, third or sixth; the year under the first month and each January.
  const step = band >= 26 ? 1 : band >= 13 ? 2 : band >= 9 ? 3 : 6;
  const labelled = (i: number) => i % step === 0;
  const yearAt = (i: number) => i === 0 || months[i]!.ym.endsWith('-01');

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
    return s(
      'a',
      { href: href(linkFor(m.ym)), 'aria-label': `${text}. Show its lines.`, class: 'cost-col' },
      s('title', null, text),
      s('rect', { x: x0, y: pad.top, width: band, height: plotH, class: 'cost-hit' }),
      segs,
      i === tallest && top > 0 ? s('text', { x: bx + bw / 2, y: y(top) - 6, 'text-anchor': 'middle', class: 'chart-label chart-value' }, money(top)) : null,
      labelled(i) ? s('text', { x: x0 + band / 2, y: H - 20, 'text-anchor': 'middle', class: 'chart-label' }, monthShort(m.ym)) : null,
      yearAt(i) ? s('text', { x: x0 + band / 2, y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle', dx: i === 0 ? -Math.min(band / 2, 12) : 0, class: 'chart-label' }, m.ym.slice(0, 4)) : null,
    );
  });

  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'chart cost-chart', role: 'group', 'aria-label': 'Plan paid and your share by month' },
    ticks.map((t) => [
      s('line', { x1: pad.left, x2: W - pad.right, y1: y(t * 100), y2: y(t * 100), class: 'chart-grid' }),
      s('text', { x: pad.left - 6, y: y(t * 100) + 4, 'text-anchor': 'end', class: 'chart-label' }, `$${t.toLocaleString('en-US')}`),
    ]),
    columns,
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
