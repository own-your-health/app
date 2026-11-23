import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers';

// The page's Content-Security-Policy is the boundary that keeps records in
// the browser: scripts and styles only from the app's own files, and
// connections only to Google's OAuth and Drive endpoints.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'none'",
  "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
  'upgrade-insecure-requests',
].join('; ');

function tracked(): string[] {
  return execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/\.(png|jpe?g|gif|ico|pdf|woff2?)$/i.test(f));
}

describe('the page', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  it('carries the exact Content-Security-Policy', () => {
    const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    expect(m?.[1]).toBe(CSP);
  });

  it('has a privacy policy under the same policy, with no script at all', () => {
    const privacy = readFileSync(join(ROOT, 'privacy.html'), 'utf8');
    expect(privacy.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]).toBe(CSP);
    expect(privacy).toContain('<meta name="referrer" content="no-referrer" />');
    expect(privacy).not.toMatch(/<script\b/i);
    expect(html).toContain('<a href="./privacy.html">Privacy policy</a>');
  });

  it('names the project, not Google, in its titles and descriptions', () => {
    const privacy = readFileSync(join(ROOT, 'privacy.html'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.webmanifest'), 'utf8')) as { name: string; description: string };
    const head = (page: string) => [page.match(/<title>([^<]*)<\/title>/)?.[1], page.match(/<meta name="description" content="([^"]*)"/)?.[1]];
    for (const text of [...head(html), ...head(privacy), manifest.name, manifest.description]) {
      expect(text).toContain('Own Your Health');
      expect(text).not.toMatch(/google/i);
    }
  });

  it('sends no referrer and loads only its own script', () => {
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((x) => x[0]);
    // theme.js applies the chosen theme before the first paint (public/theme.js).
    expect(scripts).toEqual(['<script src="./theme.js">', '<script type="module" src="/src/main.ts">']);
    expect(html).not.toMatch(/https?:\/\/(?!www\.googleapis\.com|oauth2\.googleapis\.com)[^"' ]+\.(js|css)/);
  });
});

describe('the repository', () => {
  // Patterns, never real values: the checks look for the shape of personal
  // data, so the test itself names no one.
  const files = tracked();
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('has email addresses only at example domains', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g)) {
        if (!/@example\.(com|org|net)$/i.test(m[0]) && !/@[\d.]+$/.test(m[0])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad.filter((b) => !b.startsWith('package-lock.json'))).toEqual([]);
  });

  it('has no real Google OAuth client id', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/\b(\d{6,})-[a-z0-9]{10,}\.apps\.googleusercontent\.com\b/g)) {
        if (!/^(123456789012|999999999999)$/.test(m[1]!)) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no Drive file id', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x !== 'package-lock.json')) {
      for (const m of read(f).matchAll(/(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{27,43}(?![A-Za-z0-9_-])/g)) {
        if (/[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /\d.*\d/.test(m[0])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no US phone or Social Security number', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x !== 'package-lock.json')) {
      const text = read(f);
      for (const m of text.matchAll(/(?<![\d.])\(?\d{3}\)?[-. ]\d{3}-\d{4}(?![\d])/g)) if (!/555/.test(m[0])) bad.push(`${f}: phone ${m[0]}`);
      for (const m of text.matchAll(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g)) bad.push(`${f}: ssn-shaped ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('never quotes a Drive query string twice', () => {
    const bad = files.filter((f) => f.startsWith('src/') && /'\$\{q\(/.test(read(f)));
    expect(bad).toEqual([]);
  });

  it('keeps the scope test out of production builds', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/import\.meta\.env\.DEV && \(await import\('\.\/dev\/scope-test'\)\)/);
  });
});
