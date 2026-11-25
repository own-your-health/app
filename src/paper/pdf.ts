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
//
// pdf.js draws what it can of a page and says nothing of the rest. So a file of
// the app's that a page needs and does not get is a failure here, not a page
// with something missing, and that it left a part of one out is said.

import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerFile from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { AppFileError, appFile } from './files';
import { LEFT_OUT } from './leftOut';

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

/** One of the app's own files. */
async function fetched(url: string, signal: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new AppFileError(`A file of the app answered ${res.status}.`);
  return res;
}

const filesAt = (dir: string): string => new URL(`${FILES}${dir}/`, location.href).href;

// Its readers of JPEG 2000, and of JBIG2 and fax pictures, as scripts: the
// policy runs no WebAssembly. pdf.js loads one when a page needs it, and where
// it does not load leaves the picture out. Loaded as the worker starts, they
// are there when a page asks.
const READERS = ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js'];
const READERS_SAID = 'oyh-readers';

// What pdf.js warns of as it leaves a part of a page out and goes on. A warning
// may quote the file: it is looked at in the worker, and only that one came is
// said to this page, not of which page it was.
const LEFT_OUT_SAID = 'oyh-left-out';

interface Started {
  worker: Worker;
  /** Its picture readers are there. */
  ready: Promise<void>;
  /** It did not start, or broke off. */
  failed: Promise<never>;
  stop: () => void;
}

async function startWorker(signal: AbortSignal, leftOut: () => void): Promise<Started> {
  const code = await appFile(fetched(workerFile, signal).then((res) => res.text()));
  const loads = READERS.map((f) => `import(${JSON.stringify(filesAt('wasm') + f)})`).join(',');
  const say = (ok: boolean) => `() => self.postMessage({ ${JSON.stringify(READERS_SAID)}: ${ok} })`;
  const hear = `console.warn = (w) => { if (${JSON.stringify(LEFT_OUT)}.some((x) => String(w).includes(x))) self.postMessage({ ${JSON.stringify(LEFT_OUT_SAID)}: true }); };`;
  const url = URL.createObjectURL(new Blob([`${hear}\nPromise.all([${loads}]).then(${say(true)}, ${say(false)});\n`, code], { type: 'text/javascript' }));
  ours.add(url);
  let worker: Worker;
  try {
    worker = new Worker(scriptUrl(url), { type: 'module', name: 'pdf' });
  } finally {
    ours.delete(url);
  }
  const ready = new Promise<void>((resolve, reject) => {
    worker.addEventListener('message', ({ data }: MessageEvent<Record<string, unknown> | undefined>) => {
      if (data?.[READERS_SAID] === true) resolve();
      else if (data?.[READERS_SAID] === false) reject(new AppFileError('A picture reader did not load.'));
      else if (data?.[LEFT_OUT_SAID]) leftOut();
    });
  });
  const failed = new Promise<never>((_, reject) => worker.addEventListener('error', () => reject(new PdfError('This browser could not start the app’s PDF reader.')), { once: true }));
  for (const p of [ready, failed]) p.catch(() => undefined);
  return {
    worker,
    ready,
    failed,
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
  /** Draws it on a canvas, at so many pixels across, and says whether each picture of its own was drawn. */
  draw(canvas: HTMLCanvasElement, pixels: number, signal: AbortSignal): Promise<boolean>;
  /** Puts its words over it, at their places, for a page this wide. */
  words(box: HTMLElement, width: number, signal: AbortSignal): Promise<void>;
  /** Lets go of what was read to draw it. */
  release(): void;
}

export interface Pdf {
  pages: number;
  page(n: number): Promise<PdfPage>;
  close(): void;
}

/** Opens a PDF. The bytes go to the worker, and `signal` ends it. `leftOut` hears that a part of a page was not drawn. */
export async function openPdf(bytes: Uint8Array, signal: AbortSignal, leftOut: () => void): Promise<Pdf> {
  const starting = startWorker(signal, leftOut);
  // Heard below, once pdf.js is here.
  starting.catch(() => undefined);
  const pdfjs = await appFile(import('pdfjs-dist/legacy/build/pdf.mjs')).catch((e: unknown) => {
    void starting.then((w) => w.stop()).catch(() => undefined);
    throw e;
  });
  const { worker, ready, failed, stop } = await starting;
  const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  aborted.catch(() => undefined);
  // Its warnings may quote the file: the worker's are heard there (LEFT_OUT), and none is logged.
  const port = pdfjs.PDFWorker.create({ port: worker, verbosity: pdfjs.VerbosityLevel.WARNINGS });
  const needs: Needs = { missing: undefined };
  /** Its fonts and character maps, from the app's own files. Where one does not load, pdf.js goes on without it, and does not ask again. */
  class Files {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      try {
        const res = await appFile(fetched(filesAt(kind === 'cMapUrl' ? 'cmaps' : 'standard_fonts') + filename, signal));
        return new Uint8Array(await appFile(res.arrayBuffer()));
      } catch (e) {
        if (!signal.aborted) needs.missing ??= e;
        throw e;
      }
    }
  }
  let task: PDFDocumentLoadingTask | undefined;
  const read = async (): Promise<PDFDocumentProxy> => {
    await ready;
    signal.throwIfAborted();
    task = pdfjs.getDocument({
      data: bytes,
      worker: port,
      cMapUrl: filesAt('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: filesAt('standard_fonts'),
      wasmUrl: filesAt('wasm'),
      useWasm: false,
      useWorkerFetch: false,
      BinaryDataFactory: Files,
      // A font in the file is drawn as shapes, never loaded as a font of the page.
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      disableWorkerRendering: true,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    return task.promise;
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    pdfjs.TextLayer.cleanup();
    void task?.destroy().catch(() => undefined);
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
    doc = await Promise.race([read(), failed, aborted]);
  } catch (e) {
    close();
    if (e instanceof PdfError || e instanceof AppFileError || signal.aborted) throw e;
    const name = e instanceof Error ? e.name : '';
    throw new PdfError(name === 'PasswordException' ? 'This PDF needs a password.' : name === 'InvalidPDFException' ? 'This file does not read as a PDF.' : 'This PDF could not be read here.');
  }
  return {
    pages: doc.numPages,
    page: async (n) => pdfPage(pdfjs, needs, await doc.getPage(n)),
    close,
  };
}

/** What a file's pages need of the app's own files: why one did not load. */
interface Needs {
  missing: unknown;
}

// Some 290 to the inch of a letter page. Phones hold a few canvases of this size, and not of twice it.
const MOST_PIXELS = 8_000_000;

/** Whether a picture was read and is not there: what pdf.js holds in place of one that it could not decode. */
const lacksPicture = (held: PDFPageProxy['objs']): boolean => [...held].some((x) => Array.isArray(x) && x[1] === null);

function pdfPage(pdfjs: typeof import('pdfjs-dist'), needs: Needs, page: PDFPageProxy): PdfPage {
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
      if (needs.missing) throw needs.missing;
      return !lacksPicture(page.objs);
    },
    async words(box, width, signal) {
      const viewport = at(width);
      box.style.setProperty('--total-scale-factor', String(viewport.scale));
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: box, viewport });
      signal.addEventListener('abort', () => layer.cancel(), { once: true });
      await layer.render();
    },
    release() {
      page.cleanup();
    },
  };
}
