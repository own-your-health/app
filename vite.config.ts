import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// The dev server's hot reload needs a websocket and injects its own client,
// which the production policy refuses; only `vite` (serve) relaxes it.
function devPolicy(): Plugin {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        // The dev server injects CSS as <style> tags and talks to the page
        // over a websocket; production builds serve CSS as a file.
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws://localhost:5173")
        .replace(" require-trusted-types-for 'script'; trusted-types oyh-pdf-worker;", '');
    },
  };
}

// What pdf.js reads besides its code, when a PDF needs it: character maps, the
// fonts a PDF may leave out, and its readers of JPEG 2000 and JBIG2 pictures as
// scripts, with everyone's licences. Under pdf.js's version, so a new one never
// reads an old one's from a cache.
const pdfjsDir = new URL('./node_modules/pdfjs-dist/', import.meta.url);
const pdfjs = JSON.parse(readFileSync(new URL('package.json', pdfjsDir), 'utf8')) as { version: string };
function pdfjsFiles(): Plugin {
  const names = (dir: string, keep: (name: string) => boolean) => readdirSync(new URL(dir, pdfjsDir)).filter(keep).map((name) => `${dir}${name}`);
  const files = new Set(['LICENSE', ...names('cmaps/', () => true), ...names('standard_fonts/', () => true), ...names('wasm/', (n) => /^((openjpeg|jbig2)_nowasm_fallback\.js|LICENSE_(PDFJS_)?(OPENJPEG|JBIG2))$/.test(n))]);
  const root = `pdfjs/${pdfjs.version}/`;
  return {
    name: 'pdfjs-files',
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: root + f, source: readFileSync(new URL(f, pdfjsDir)) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const at = `/app/${root}`;
        const f = req.url?.startsWith(at) ? req.url.slice(at.length) : '';
        if (!files.has(f)) return next();
        res.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(new URL(f, pdfjsDir)));
      });
    },
  };
}

// The app is served from own-your-health.github.io/app/, and locally from
// localhost:5173/app/, so the OAuth redirect URI is the same path in both.
export default defineConfig({
  base: '/app/',
  plugins: [devPolicy(), pdfjsFiles()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __PDFJS_VERSION__: JSON.stringify(pdfjs.version) },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // No inline scripts or styles: the Content-Security-Policy allows only
    // the app's own files.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // The privacy policy is a page of its own, without the app's script.
    rollupOptions: { input: { index: 'index.html', privacy: 'privacy.html' } },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
