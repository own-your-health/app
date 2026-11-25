// Larger and smaller, for a paper in its box: by the buttons, by two fingers,
// and by the wheel with Ctrl held, which a trackpad's pinch sends too. The
// place under the fingers stays there.

import { button } from '../ui/components';
import { h } from '../ui/dom';

const LEAST = 1;
const MOST = 6;
const STEP = 1.5;

/** A place in the box, from its top left. */
interface Place {
  x: number;
  y: number;
}

/**
 * How large a paper is drawn: `--zoom` on `inner`, 1 for the box's width. The
 * buttons and how large it is; `changed` hears each change.
 */
export function zoomable(box: HTMLElement, inner: HTMLElement, changed: () => void, signal: AbortSignal): HTMLElement {
  let value = 1;
  const says = h('span', { class: 'paper-zoom', 'aria-live': 'polite' }, '100%');
  const middle = (): Place => ({ x: box.clientWidth / 2, y: box.clientHeight / 2 });
  const set = (to: number, at: Place) => {
    const next = Math.min(MOST, Math.max(LEAST, to));
    if (next === value) return;
    const ratio = next / value;
    const [left, top] = [(box.scrollLeft + at.x) * ratio - at.x, (box.scrollTop + at.y) * ratio - at.y];
    value = next;
    inner.style.setProperty('--zoom', String(next));
    box.scrollLeft = left;
    box.scrollTop = top;
    says.textContent = `${Math.round(next * 100)}%`;
    ends();
    changed();
  };
  const smaller = button('−', () => set(value / STEP, middle()), { small: true });
  smaller.setAttribute('aria-label', 'Smaller');
  const larger = button('+', () => set(value * STEP, middle()), { small: true });
  larger.setAttribute('aria-label', 'Larger');
  // Said, not disabled: the button that reached the end keeps its focus.
  const ends = () => {
    smaller.setAttribute('aria-disabled', String(value === LEAST));
    larger.setAttribute('aria-disabled', String(value === MOST));
  };
  ends();

  // Two fingers: the box scrolls with one (touch-action in styles.css), and grows with two.
  let from: { apart: number; zoom: number } | undefined;
  const two = (e: TouchEvent): { apart: number; at: Place } | undefined => {
    const [a, b] = [e.touches[0], e.touches[1]];
    if (e.touches.length !== 2 || !a || !b) return undefined;
    const rect = box.getBoundingClientRect();
    return { apart: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), at: { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top } };
  };
  box.addEventListener(
    'touchstart',
    (e) => {
      const t = two(e);
      from = t && t.apart > 0 ? { apart: t.apart, zoom: value } : undefined;
    },
    { signal, passive: true },
  );
  box.addEventListener(
    'touchmove',
    (e) => {
      const t = two(e);
      if (!t || !from) return;
      e.preventDefault();
      set((from.zoom * t.apart) / from.apart, t.at);
    },
    { signal, passive: false },
  );
  for (const end of ['touchend', 'touchcancel'] as const) box.addEventListener(end, () => (from = undefined), { signal, passive: true });
  box.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      set(value * Math.exp(-e.deltaY / 200), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    { signal, passive: false },
  );
  return h('div', { class: 'paper-controls' }, smaller, says, larger);
}
