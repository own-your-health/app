// A PDF's pages, drawn by pdf.js (Mozilla, Apache-2.0). Its code is the app's
// own files, loaded only once someone asks to see a PDF. The file is read in a
// worker, which holds its bytes and nothing else. No script in a PDF runs, no
// form is sent and no link is followed: a page is a picture here, with its
// words over it to select.
//
// The worker starts from a blob of the app's own file, not from its address: a
// worker started from an address is under the headers of that address alone,
// and GitHub Pages sends none, so it could connect anywhere. One from a blob
// is under this page's Content-Security-Policy, as the page is.

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerFile from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/** Where the build puts pdf.js's fonts and character maps, and its readers of older picture formats (vite.config.ts). */
const FILES = `${import.meta.env.BASE_URL}pdfjs/${__PDFJS_VERSION__}/`;

interface ScriptUrls {
  createScriptURL(url: string): string;
}
interface TrustedTypes {
  createPolicy(name: string, rules: ScriptUrls): ScriptUrls;
}

/** The addresses this module made a worker of; the policy passes no other. */
const ours = new Set<string>();
let policy: ScriptUrls | undefined;

function scriptUrl(url: string): string {
  const types = (globalThis as { trustedTypes?: TrustedTypes }).trustedTypes;
  if (!types) return url;
  // The one policy the Content-Security-Policy names (`trusted-types`).
  policy ??= types.createPolicy('oyh-pdf-worker', {
    createScriptURL: (u) => {
      if (!ours.has(u)) throw new TypeError('Not the PDF worker.');
      return u;
    },
  });
  return policy.createScriptURL(url);
}

async function startWorker(signal: AbortSignal): Promise<{ worker: Worker; stop: () => void }> {
  const res = await fetch(workerFile, { signal });
  if (!res.ok) throw new Error('The app’s PDF reader did not load.');
  const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
  ours.add(url);
  let worker: Worker;
  try {
    worker = new Worker(scriptUrl(url), { type: 'module', name: 'pdf' });
  } finally {
    ours.delete(url);
  }
  return {
    worker,
    stop: () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

/** Why a PDF was not opened, in words for the page. */
export class PdfError extends Error {}

export interface PdfPage {
  /** Its size at 72 to the inch. */
  width: number;
  height: number;
  /** Draws it on a canvas, at so many pixels across. */
  draw(canvas: HTMLCanvasElement, pixels: number, signal: AbortSignal): Promise<void>;
  /** Puts its words over it, at their places, for a page this wide. */
  words(box: HTMLElement, width: number, signal: AbortSignal): Promise<void>;
}

export interface Pdf {
  pages: number;
  page(n: number): Promise<PdfPage>;
  close(): void;
}

/** Opens a PDF. The bytes go to the worker, and `signal` ends it. */
export async function openPdf(bytes: Uint8Array, signal: AbortSignal): Promise<Pdf> {
  const [pdfjs, { worker, stop }] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), startWorker(signal)]);
  const failed = new Promise<never>((_, reject) => {
    worker.addEventListener('error', () => reject(new PdfError('This browser could not start the app’s PDF reader.')), { once: true });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  failed.catch(() => undefined);
  const files = (dir: string) => new URL(`${FILES}${dir}/`, location.href).href;
  // Its warnings may quote the file: none is logged.
  const port = pdfjs.PDFWorker.create({ port: worker, verbosity: 0 });
  const task = pdfjs.getDocument({
    data: bytes,
    worker: port,
    cMapUrl: files('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: files('standard_fonts'),
    // Its readers of JPEG 2000 and JBIG2 pictures, as scripts: the policy runs no WebAssembly.
    wasmUrl: files('wasm'),
    useWasm: false,
    // A font in the file is drawn as shapes, never loaded as a font of the page.
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    disableWorkerRendering: true,
    verbosity: 0,
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    pdfjs.TextLayer.cleanup();
    void task.destroy().catch(() => undefined);
    port.destroy();
    stop();
  };
  if (signal.aborted) {
    close();
    throw signal.reason;
  }
  signal.addEventListener('abort', close, { once: true });
  let doc: PDFDocumentProxy;
  try {
    doc = await Promise.race([task.promise, failed]);
  } catch (e) {
    close();
    if (e instanceof PdfError || signal.aborted) throw e;
    const name = e instanceof Error ? e.name : '';
    throw new PdfError(name === 'PasswordException' ? 'This PDF needs a password.' : name === 'InvalidPDFException' ? 'This file does not read as a PDF.' : 'This PDF could not be read here.');
  }
  return {
    pages: doc.numPages,
    page: async (n) => pdfPage(pdfjs, await doc.getPage(n)),
    close,
  };
}

// Phones hold a canvas of no more than 16 million pixels or so.
const MOST_PIXELS = 12_000_000;

function pdfPage(pdfjs: typeof import('pdfjs-dist'), page: PDFPageProxy): PdfPage {
  const base = page.getViewport({ scale: 1 });
  const at = (width: number) => page.getViewport({ scale: width / base.width });
  return {
    width: base.width,
    height: base.height,
    async draw(canvas, pixels, signal) {
      const most = Math.sqrt((MOST_PIXELS * base.width) / base.height);
      const viewport = at(Math.min(pixels, most));
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const task: RenderTask = page.render({ canvas, viewport, background: '#fff' });
      signal.addEventListener('abort', () => task.cancel(), { once: true });
      await task.promise;
    },
    async words(box, width, signal) {
      const viewport = at(width);
      box.style.setProperty('--total-scale-factor', String(viewport.scale));
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: box, viewport });
      signal.addEventListener('abort', () => layer.cancel(), { once: true });
      await layer.render();
    },
  };
}
