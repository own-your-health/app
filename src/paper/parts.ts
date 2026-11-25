// A paper's parts (markup.ts) as elements of the page: each string a text
// node, each element one of the few the parts name, and no attribute but how
// many columns and rows a cell takes. A picture in the paper itself is drawn
// from its own bytes; one that is elsewhere is named and never loaded.

import { h, type Child } from '../ui/dom';
import { paperType } from './kind';
import type { Part } from './markup';

/** Pictures drawn for a paper, each its blob URL, revoked when the paper is closed. */
export type Draw = (bytes: Uint8Array, media: string, alt: string) => HTMLElement;

export function partNodes(parts: readonly Part[], draw: Draw): Child[] {
  return parts.map((p): Child => {
    if (typeof p === 'string') return p;
    if ('picture' in p) {
      const { bytes, alt } = p.picture;
      const media = bytes && paperType(undefined, bytes).media;
      if (bytes && media) return draw(bytes, media, alt);
      return alt ? `[Image: ${alt}]` : '[Image]';
    }
    return h(p.tag, { colspan: p.colspan, rowspan: p.rowspan }, partNodes(p.children, draw));
  });
}
