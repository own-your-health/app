// The PNG icons the web app manifest and iOS need, drawn from public/icon.svg:
// 192 and 512 as the icon is, a 512 maskable one and the 180 apple-touch-icon
// with the tile's colour to the edges. Run `npm run icons` after changing the
// icon, and commit the PNGs.

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const PUBLIC = new URL('../public/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', PUBLIC), 'utf8');
const tile = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1];
if (!tile) throw new Error('icon.svg has no tile <rect> with a fill colour.');
const glyph = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect[^>]*\/>/, '');

// The glyph spans x 6.5–25.5 and y 9–24 of 32, so its centre is (16, 16.5)
// and its farthest corner 12.1 units from it.
const fullBleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${tile}"/><g transform="translate(16 16.5) scale(${scale}) translate(-16 -16.5)">${glyph}</g></svg>`;

const ICONS = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  // A launcher crops a maskable icon to any shape inside the circle of 40%
  // radius (12.8 units): at 0.8 the glyph's corners reach 9.7.
  ['icon-maskable-512.png', 512, fullBleed(0.8)],
  // iOS rounds the corners itself and turns transparency black.
  ['apple-touch-icon.png', 180, fullBleed(0.9)],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, source] of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    const src = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
    await page.setContent(`<!doctype html><body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.locator('img').evaluate((img) => img.decode());
    writeFileSync(new URL(name, PUBLIC), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    console.log(`public/${name} ${size}×${size}`);
  }
} finally {
  await browser.close();
}
