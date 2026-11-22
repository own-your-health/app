import { readFileSync } from 'node:fs';
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
        .replace(" require-trusted-types-for 'script'; trusted-types 'none';", '');
    },
  };
}

// The app is served from own-your-health.github.io/app/, and locally from
// localhost:5173/app/, so the OAuth redirect URI is the same path in both.
export default defineConfig({
  base: '/app/',
  plugins: [devPolicy()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
