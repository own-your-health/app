// Checks a build (default dist/) for what installing the app needs: the page
// links the web app manifest, and every icon the manifest or the page names
// is in the build. CI runs it after `npm run build`.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const problems = [];

const manifestHref = /<link rel="manifest" href="\.\/([^"]+)"/.exec(html)?.[1];
if (!manifestHref) problems.push('index.html links no manifest');
const files = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="\.\/([^"]+)"/g)].map((m) => m[1]);
if (manifestHref && existsSync(join(dir, manifestHref))) {
  const manifest = JSON.parse(readFileSync(join(dir, manifestHref), 'utf8'));
  if (!manifest.icons?.length) problems.push(`${manifestHref} names no icons`);
  for (const icon of manifest.icons ?? []) files.push(icon.src.replace(/^\.\//, ''));
}
// The privacy policy, which the page links under every screen.
if (!/<a href="\.\/privacy\.html">/.test(html)) problems.push('index.html does not link the privacy policy');
files.push('privacy.html');
for (const f of files) if (!existsSync(join(dir, f))) problems.push(`${f} is not in ${dir}/`);

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`${dir}/: manifest, privacy policy and ${files.length - 2} icon files present`);
