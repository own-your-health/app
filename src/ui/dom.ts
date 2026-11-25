// Building the page from nodes. Every string becomes a text node, so record
// content is never parsed as HTML; attributes that could run code or carry
// inline styles are refused here as well as by the Content-Security-Policy.

export type Child = Node | string | number | null | undefined | false | Child[];

type Handler = (ev: Event) => void;

export interface Attrs {
  class?: string | (string | false | null | undefined)[];
  on?: Partial<Record<keyof HTMLElementEventMap, Handler>>;
  [attr: string]: unknown;
}

const SAFE_URL = /^(https:\/\/|#|\.\/|\/(?!\/)|\?|mailto:|tel:\+?\d{7,15}$)/i;

export function safeHref(url: string): string {
  return SAFE_URL.test(url) ? url : '#';
}

/**
 * A srcset whose every image is an address safeHref keeps, with no comma in
 * it, and one density or width; null for any other, so only src is set.
 */
export function safeSrcset(srcset: string): string | null {
  const candidates = srcset.split(',').map((c) => c.trim());
  const ok = candidates.every((c) => {
    const m = /^(\S+)\s+(\d+(?:\.\d+)?x|\d+w)$/.exec(c);
    return m !== null && safeHref(m[1]!) === m[1];
  });
  return ok ? candidates.join(', ') : null;
}

function setAttrs(el: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') {
      for (const [ev, fn] of Object.entries(v as Record<string, Handler>)) el.addEventListener(ev, fn);
      continue;
    }
    if (k.startsWith('on') || k === 'style' || k === 'srcdoc') throw new Error(`Attribute ${k} is not allowed.`);
    if (k === 'class') {
      const cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      if (cls) el.setAttribute('class', cls);
      continue;
    }
    if (k === 'href' || k === 'src' || k === 'action') {
      el.setAttribute(k, safeHref(String(v)));
      continue;
    }
    if (k === 'srcset') {
      const srcset = safeSrcset(String(v));
      if (srcset) el.setAttribute(k, srcset);
      continue;
    }
    el.setAttribute(k, v === true ? '' : String(v));
  }
}

// ParentNode.append inserts each string as a Text node, never as markup.
function append(el: ParentNode, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(typeof c === 'number' ? String(c) : c);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Icons: 24×24 strokes, drawn in the current text colour.
const ICONS: Record<string, string[]> = {
  refresh: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4.3-4.3'],
  back: ['M15 18l-6-6 6-6'],
  next: ['M9 18l6-6-6-6'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  chart: ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'],
  pill: ['M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7z', 'M8.5 8.5l7 7'],
  file: ['M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z', 'M14 3v5h5'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  home: ['M3 11l9-8 9 8', 'M5 10v10h5v-6h4v6h5V10'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 3v4', 'M16 3v4'],
  money: ['M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6.5 12h.01', 'M17.5 12h.01'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6 4 4 0 0 1 7 2.6c0 5.6-7 10-7 10z'],
  sources: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
};

export function icon(name: keyof typeof ICONS | string, size = 20): SVGSVGElement {
  return s(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' },
    (ICONS[name] ?? []).map((d) => s('path', { d })),
  );
}
