import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTheme, BAR_COLOURS } from '../src/theme';
import { ROOT } from './helpers';

// The palettes: the dark one is written twice (chosen, and the device's), so
// the two must agree; and every text colour must read on its background at
// WCAG AA (4.5:1 for body text) in both palettes.

const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

const light = block(':root');
const darkChosen = block(":root[data-theme='dark']");
const darkSystem = block(':root:not([data-theme])');
const dark = new Map([...light, ...darkChosen]);

function resolve(tokens: Map<string, string>, name: string): string {
  let v = tokens.get(name);
  for (let i = 0; v?.startsWith('var(') && i < 5; i++) v = tokens.get(v.slice(4, -1).trim());
  if (v && /^#[0-9a-f]{3}$/i.test(v)) v = `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a colour: ${v}`);
  return v;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Text colour, and the backgrounds the app sets it on. */
const PAIRS: [string, string[]][] = [
  ['--ink', ['--page', '--surface', '--sunken', '--tint']],
  ['--ink-soft', ['--page', '--surface']],
  ['--muted', ['--page', '--surface', '--sunken']],
  ['--link', ['--page', '--surface', '--tint']],
  ['--primary', ['--surface']],
  ['--on-primary', ['--primary', '--primary-hover']],
  ['--on-bar', ['--bar']],
  ['--on-bar-soft', ['--bar']],
  ['--positive', ['--surface', '--positive-tint']],
  ['--attention-text', ['--surface', '--attention-tint']],
  ['--error', ['--surface', '--error-tint']],
];

describe('the palettes', () => {
  it('write the dark palette the same way twice', () => {
    expect(Object.fromEntries(darkSystem)).toEqual(Object.fromEntries(darkChosen));
  });

  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`read at WCAG AA in the ${name} palette`, () => {
      const failing: string[] = [];
      for (const [text, backgrounds] of PAIRS) {
        for (const bg of backgrounds) {
          const ratio = contrast(resolve(tokens, text), resolve(tokens, bg));
          if (ratio < 4.5) failing.push(`${text} on ${bg}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failing).toEqual([]);
    });
  }

  it('make the dark page and cards lighter than they were', () => {
    // The palette before: page #0b0f1e, cards #141a2e.
    expect(luminance(resolve(dark, '--page'))).toBeGreaterThan(luminance('#0b0f1e'));
    expect(luminance(resolve(dark, '--surface'))).toBeGreaterThan(luminance('#141a2e'));
  });
});

describe('the bar colour', () => {
  it('is the same in the palettes, the page, the early script and the theme module', () => {
    expect(resolve(light, '--bar')).toBe(BAR_COLOURS.light);
    expect(resolve(dark, '--bar')).toBe(BAR_COLOURS.dark);
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain(`<meta name="theme-color" content="${BAR_COLOURS.light}" media="(prefers-color-scheme: light)" />`);
    expect(html).toContain(`<meta name="theme-color" content="${BAR_COLOURS.dark}" media="(prefers-color-scheme: dark)" />`);
    const early = readFileSync(join(ROOT, 'public/theme.js'), 'utf8');
    expect(early).toContain("localStorage.getItem('own-your-health-app.theme')");
    expect(early).toContain(`theme === 'dark' ? '${BAR_COLOURS.dark}' : '${BAR_COLOURS.light}'`);
  });
});

describe('applying a theme', () => {
  function fakeDocument() {
    const meta = (media: string) => ({ content: '', getAttribute: (k: string) => (k === 'media' ? media : null) });
    const metas = [meta('(prefers-color-scheme: light)'), meta('(prefers-color-scheme: dark)')];
    const doc = { documentElement: { dataset: {} as Record<string, string> }, querySelectorAll: () => metas };
    return { doc: doc as unknown as Document, root: doc.documentElement, metas };
  }

  it('sets the attribute and both bar colours for a chosen theme', () => {
    const { doc, root, metas } = fakeDocument();
    applyTheme('dark', doc);
    expect(root.dataset.theme).toBe('dark');
    expect(metas.map((m) => m.content)).toEqual([BAR_COLOURS.dark, BAR_COLOURS.dark]);
  });

  it('gives the device back its own for System', () => {
    const { doc, root, metas } = fakeDocument();
    applyTheme('light', doc);
    applyTheme('system', doc);
    expect(root.dataset.theme).toBeUndefined();
    expect(metas.map((m) => m.content)).toEqual([BAR_COLOURS.light, BAR_COLOURS.dark]);
  });
});
