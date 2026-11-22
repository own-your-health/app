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
