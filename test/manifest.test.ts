import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers';

// What makes the app installable: index.html links the web app manifest,
// and every icon either names is a PNG of the size it claims. The files in
// public/ are copied into the build as they are; e2e/install.spec.ts asks
// Chrome itself, against the build.

const PUBLIC = join(ROOT, 'public');
const SITE = 'https://own-your-health.github.io/app/';

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
}

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as Manifest;

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(b.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function head(rel: string): string | undefined {
  return new RegExp(`<link rel="${rel}" href="\\./([^"]+)"`).exec(html)?.[1];
}

describe('the web app manifest', () => {
  it('is linked from the page', () => {
    expect(head('manifest')).toBe('manifest.webmanifest');
  });

  it('opens the app itself, standalone, never with a client or the sample', () => {
    expect(manifest.name).toBe('Own Your Health');
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    const base = new URL('manifest.webmanifest', SITE);
    const start = new URL(manifest.start_url, base);
    for (const u of [start, new URL(manifest.scope, base), new URL(manifest.id, start)]) {
      expect(u.href).toBe(SITE);
    }
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('has PNG icons of 192 and 512, and a maskable 512', () => {
    const has = (size: string, purpose: string) => manifest.icons.some((i) => i.sizes === size && (i.purpose ?? 'any').split(' ').includes(purpose));
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  it('names only icons that exist, at the size it says', () => {
    for (const icon of manifest.icons) {
      const file = join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(icon.type).toBe('image/png');
      const [w, h] = pngSize(file);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });
});

describe('the Home Screen on iPhone', () => {
  it('has a 180×180 apple-touch-icon, a title, and runs as an app', () => {
    const touch = head('apple-touch-icon');
    expect(touch).toBeDefined();
    expect(pngSize(join(PUBLIC, touch!))).toEqual([180, 180]);
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Own Health" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
  });

  it('names only files that exist', () => {
    for (const m of html.matchAll(/<link rel="[^"]+" href="\.\/([^"]+)"/g)) {
      expect(existsSync(join(PUBLIC, m[1]!)), m[1]).toBe(true);
    }
  });
});
