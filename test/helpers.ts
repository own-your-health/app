import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DemoFolder } from '../src/folder';

export const ROOT = join(import.meta.dirname, '..');
export const DEMO = join(ROOT, 'public', 'demo');
export const FIXTURES = join(ROOT, 'test', 'fixtures');

export function fixture<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as T;
}

export function demoJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(DEMO, path), 'utf8')) as T;
}

/** A fetch that serves public/demo/ as the page's own origin would. */
export function demoFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = decodeURIComponent(url.replace(/^\/app\/demo\//, ''));
    try {
      const body = readFileSync(join(DEMO, path), 'utf8');
      return new Response(body, { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
}

export function demoFolder(now = new Date('2026-11-22T20:00:00Z')): DemoFolder {
  return new DemoFolder('/app/demo/', demoFetch(), now);
}

/** Files laid over the sample, by their path in it; null takes one away. */
export type Overlay = Record<string, string | null>;

/** What medrec wrote for a case of scripts/private-fixtures.mjs, to lay over the sample. */
export function privateCase(name: 'marked' | 'unreadable'): Overlay {
  const dir = join(FIXTURES, 'private', name);
  return Object.fromEntries(filesUnder(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

/** The sample once the household has marked payments, as medrec wrote it (scripts/bill-fixtures.mjs). */
export function paidCase(): Overlay {
  const dir = join(FIXTURES, 'bills', 'paid');
  return Object.fromEntries(filesUnder(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

/** The sample's manifest with an overlay's files and MD5s, as a folder holding them would give them. */
export function manifestWith(overlay: Overlay): string {
  const m = demoJson<{ anchor: string; files: string[]; md5: Record<string, string> }>('manifest.json');
  for (const [f, text] of Object.entries(overlay)) {
    m.files = m.files.filter((x) => x !== f);
    delete m.md5[f];
    if (text === null) continue;
    m.files.push(f);
    m.md5[f] = createHash('md5').update(text).digest('hex');
  }
  return JSON.stringify(m);
}

/** The sample with an overlay on it; `manifest` changes its manifest (its MD5s, say) further. */
export function demoFolderWith(overlay: Overlay, manifest: (m: { files: string[]; md5?: Record<string, string> }) => void = () => {}): DemoFolder {
  const files = demoFetch();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const path = decodeURIComponent(String(input).replace(/^\/app\/demo\//, ''));
    if (path === 'manifest.json') {
      const m = JSON.parse(manifestWith(overlay)) as { files: string[]; md5?: Record<string, string> };
      manifest(m);
      return new Response(JSON.stringify(m), { status: 200 });
    }
    const over = overlay[path];
    if (over === undefined) return files(input);
    return over === null ? new Response('not found', { status: 404 }) : new Response(over, { status: 200 });
  }) as typeof fetch;
  return new DemoFolder('/app/demo/', fetchImpl, new Date(demoJson<{ anchor: string }>('manifest.json').anchor));
}

export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
