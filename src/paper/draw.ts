// Draws a paper's bytes in its place, by what they are (kind.ts).

import { h, type Child } from '../ui/dom';
import { count } from '../ui/format';
import { paperType, type PaperType } from './kind';
import { cdaPaper, decodeText, hasParts, htmlPaper } from './markup';
import { partNodes, type Draw } from './parts';
import type { Pdf, PdfPage } from './pdf';
import { rtfText } from './rtf';
import { zoomable } from './zoom';

/** What was read is not shown, and why, in words for the page. */
class NotShown extends Error {}

const NOT_SHOWN = 'Open it in Drive to see it.';

/** Where a paper is drawn. */
export interface Place {
  bar: HTMLElement;
  status: HTMLElement;
  progress: HTMLElement;
  title: string;
  signal: AbortSignal;
}

/** Draws a paper by what it is; why not, in words for the page, when it does not show here. */
export async function drawPaper(place: Place, media: string | undefined, read: Uint8Array<ArrayBuffer>): Promise<string | undefined> {
  try {
    await draw(place, media, read);
    return undefined;
  } catch (e) {
    if (e instanceof NotShown) return e.message;
    throw e;
  }
}

async function draw(place: Place, media: string | undefined, read: Uint8Array<ArrayBuffer>): Promise<void> {
  const type = paperType(media, read);
  switch (type.kind) {
    case 'pdf':
      return drawPdf(place, read);
    case 'image':
      return drawImage(place, type, read);
    case 'html': {
      const paper = htmlPaper(decodeText(read));
      if (!hasParts(paper.parts)) throw new NotShown(`No text was found in this file. ${NOT_SHOWN}`);
      return drawText(place, partNodes(paper.parts, picture(place.signal)), 'The paper’s words and tables, in the app’s own type. Nothing in it runs, and nothing is loaded from outside.');
    }
    case 'cda': {
      const paper = cdaPaper(decodeText(read));
      // Some hold one file, and no text of their own.
      if (paper.file) return draw(place, paper.file.media, new Uint8Array(paper.file.bytes));
      if (!hasParts(paper.parts)) throw new NotShown(`No text was found in this file. ${NOT_SHOWN}`);
      return drawText(place, [paper.title ? h('h3', { class: 'paper-title' }, paper.title) : null, ...partNodes(paper.parts, picture(place.signal))], 'The document’s text, section by section, in the app’s own type.');
    }
    case 'rtf': {
      const { text, pictures } = rtfText(read);
      if (!text.trim()) throw new NotShown(`No text was found in this file. ${NOT_SHOWN}`);
      return drawText(place, [h('pre', { class: 'paper-pre' }, text)], `The text only, without its layout${pictures ? ' and pictures' : ''}. Open in Drive shows it whole.`);
    }
    case 'xml':
    case 'text':
      return drawText(place, [h('pre', { class: 'paper-pre' }, decodeText(read))], null);
    case 'other':
      throw new NotShown(`${type.name ? `A ${type.name}` : 'A file of this type'} does not show here. ${NOT_SHOWN}`);
  }
}

/** The box a paper scrolls in, with the buttons that make it larger. `changed` hears a change of its size, or the paper's. */
function boxFor(place: Place, inner: HTMLElement, changed: () => void = () => undefined): HTMLElement {
  const box = h('div', { class: 'paper-box', tabindex: 0, role: 'group', 'aria-label': place.title }, inner);
  place.bar.append(zoomable(box, inner, changed, place.signal));
  place.progress.replaceWith(box);
  const fit = () => {
    inner.style.setProperty('--box', `${Math.max(1, box.clientWidth - 16)}px`);
    changed();
  };
  fit();
  const turned = new ResizeObserver(fit);
  turned.observe(box);
  place.signal.addEventListener('abort', () => turned.disconnect(), { once: true });
  return box;
}

function drawText(place: Place, children: Child[], note: string | null): void {
  place.status.textContent = note ?? 'The file’s text.';
  boxFor(place, h('div', { class: 'paper-text' }, children));
}

/** A picture's element, whose blob URL ends with the paper. */
function picture(signal: AbortSignal): Draw {
  return (bytes, media, alt) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: media }));
    signal.addEventListener('abort', () => URL.revokeObjectURL(url), { once: true });
    const img = h('img', { class: 'paper-picture', alt });
    img.src = url;
    return img;
  };
}

async function drawImage(place: Place, type: PaperType, read: Uint8Array<ArrayBuffer>): Promise<void> {
  const img = picture(place.signal)(read, type.media!, place.title) as HTMLImageElement;
  await img.decode().catch(() => {
    throw new NotShown(`This picture could not be read here. ${NOT_SHOWN}`);
  });
  place.signal.throwIfAborted();
  const page = h('div', { class: 'paper-page' }, img);
  sized(page, img.naturalWidth, img.naturalHeight);
  place.status.textContent = 'One picture.';
  boxFor(place, h('div', { class: 'paper-pages' }, page));
}

/** A page no wider than itself, in its own shape, before it is drawn. */
function sized(page: HTMLElement, width: number, height: number): void {
  page.style.setProperty('--w', `${width}px`);
  page.style.setProperty('aspect-ratio', `${width} / ${height}`);
}

// A PDF's page is 72 to the inch, so one made for paper is 600 or so across: it may fill a wide screen.
const PDF_WIDTH = 900;

async function drawPdf(place: Place, read: Uint8Array): Promise<void> {
  const { openPdf, PdfError } = await import('./pdf');
  let pdf: Pdf;
  let first: PdfPage;
  try {
    pdf = await openPdf(read, place.signal);
    first = await pdf.page(1);
  } catch (e) {
    throw e instanceof PdfError ? new NotShown(`${e.message} ${NOT_SHOWN}`) : e;
  }
  place.status.textContent = count(pdf.pages, 'page');
  const slots = Array.from({ length: pdf.pages }, (_, i) => new Slot(pdf, i + 1, place, i === 0 ? first : undefined));
  for (const s of slots) s.shape(first);
  // Sharp again once the size settles.
  let soon: number | undefined;
  const box = boxFor(place, h('div', { class: 'paper-pages' }, slots.map((s) => s.el)), () => {
    window.clearTimeout(soon);
    soon = window.setTimeout(() => slots.forEach((s) => s.again()), 200);
  });
  // Drawn when near the part of the box in sight, and let go when far from it, so a long paper holds few pages.
  const near = new IntersectionObserver((seen) => seen.forEach((x) => slots.find((s) => s.el === x.target)?.near(x.isIntersecting)), { root: box, rootMargin: '100% 0px' });
  for (const s of slots) near.observe(s.el);
  place.signal.addEventListener(
    'abort',
    () => {
      near.disconnect();
      window.clearTimeout(soon);
      for (const s of slots) s.near(false);
    },
    { once: true },
  );
}

/** One page of a PDF: its place, and the page drawn there while it is near. */
class Slot {
  readonly el: HTMLElement;
  private drawing: AbortController | null = null;
  private isNear = false;
  /** How wide it is drawn, in pixels. */
  private drawn = 0;

  constructor(
    private readonly pdf: Pdf,
    private readonly n: number,
    private readonly place: Place,
    private page?: PdfPage,
  ) {
    this.el = h('div', { class: 'paper-page', role: 'group', 'aria-label': `Page ${n} of ${pdf.pages}` });
  }

  shape(page: PdfPage): void {
    sized(this.el, PDF_WIDTH, (PDF_WIDTH * page.height) / page.width);
  }

  near(is: boolean): void {
    if (is === this.isNear) return;
    this.isNear = is;
    if (is) void this.draw();
    else this.drop();
  }

  /** After a change of size: sharp again. */
  again(): void {
    if (this.isNear && this.width() !== this.drawn) void this.draw();
  }

  private width(): number {
    return Math.round(this.el.clientWidth * (window.devicePixelRatio || 1));
  }

  private drop(): void {
    this.drawing?.abort();
    this.drawing = null;
    this.drawn = 0;
    for (const c of this.el.querySelectorAll('canvas')) c.width = c.height = 0;
    this.el.replaceChildren();
  }

  private async draw(): Promise<void> {
    this.drawing?.abort();
    const mine = (this.drawing = new AbortController());
    try {
      if (!this.page) {
        this.page = await this.pdf.page(this.n);
        if (mine.signal.aborted) return;
        this.shape(this.page);
      }
      const width = this.width();
      if (!width) return;
      const canvas = h('canvas', { class: 'paper-canvas', 'aria-hidden': 'true' });
      const words = h('div', { class: 'textLayer' });
      await this.page.draw(canvas, width, mine.signal);
      if (mine.signal.aborted) return;
      // What was there stays, stretched, until this is ready.
      for (const c of this.el.querySelectorAll('canvas')) c.width = c.height = 0;
      this.el.replaceChildren(canvas, words);
      this.drawn = width;
      await this.page.words(words, this.el.clientWidth, mine.signal);
    } catch {
      // Let go while it was drawn; a page that does not draw says so.
      if (mine.signal.aborted || this.place.signal.aborted) return;
      this.el.replaceChildren(h('p', { class: 'paper-failed small' }, `Page ${this.n} could not be drawn here. ${NOT_SHOWN}`));
    }
  }
}
