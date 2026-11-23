// How the app opens on a phone with a large records folder, from synthetic
// data only: the build's sample folder, with Robin's index.json grown to a
// target size from copies of its own invented records and documents (new
// ids, earlier years), and a text.json of words from a fixed list. Nothing
// here reads a real folder.
//
//   npm run build && node scripts/perf.mjs [--index-mb 3.9] [--text-mb 4.6] [--runs 3] [--cpu 4] [--network] [--uncompressed] [--type-ms 120]
//
// It serves a copy of dist/ on its own port, opens it in Chromium as a
// Pixel 7 with the CPU slowed (--cpu, 4 by default, about a mid-range
// phone), and prints the median of each timing. --network adds a 4G-like
// link (9 Mbps down, 150 ms round trip); without it the files come from
// localhost. The preview server gzips JSON; --uncompressed asks for the
// files as they are, the way a download that is not compressed arrives.

import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const INDEX_MB = opt('index-mb', 3.9);
const TEXT_MB = opt('text-mb', 4.6);
const RUNS = opt('runs', 3);
const CPU = opt('cpu', 4);
const NETWORK = args.includes('--network');
const UNCOMPRESSED = args.includes('--uncompressed');
const TYPE_MS = opt('type-ms', 120);
const PORT = 4319;
const PERSON = 'Robin Example';

const MB = 1024 * 1024;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const idOf = (prefix, n) => {
  let s = '';
  for (let i = 0; i < 20; i += 1) {
    s = B32[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return `${prefix}_${s}`;
};
const earlier = (date, years) => (typeof date === 'string' && /^\d{4}/.test(date) ? `${Number(date.slice(0, 4)) - years}${date.slice(4)}` : date);

// ---- The folder ----

/** The build's copy in `dir`, with Robin's index and text grown to the target sizes. */
async function buildFolder(dir) {
  await cp('dist', dir, { recursive: true });
  const folder = join(dir, 'demo', PERSON);
  const index = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8'));
  const baseRecords = [...index.records];
  const baseDocs = [...index.documents];
  let n = 1;
  // One generation is a copy of every record and document, a year earlier per generation.
  for (let years = 1; JSON.stringify(index).length < INDEX_MB * MB; years += 1) {
    const docIds = new Map(baseDocs.map((d) => [d.id, idOf('d', 1_000_000 + n++)]));
    for (const d of baseDocs) index.documents.push({ ...d, id: docIds.get(d.id), date: earlier(d.date, years) });
    for (const r of baseRecords) {
      index.records.push({ ...r, id: idOf('r', 2_000_000 + n++), key: `${r.key}|perf${years}`, date: earlier(r.date, years), documents: r.documents.map((d) => docIds.get(d) ?? d) });
    }
  }
  const indexText = JSON.stringify(index);
  await writeFile(join(folder, 'index.json'), indexText);

  // 46 words, stepped through 17 at a time: 17 shares no factor with 46, so every word is used.
  const WORDS = 'patient follow up visit result normal range fasting sample blood urine panel review plan medicine dose daily weekly report clinic office note history exam vital sign pressure rate weight height diet exercise sleep return call question answer order test value unit reference interval comment signed reviewed'.split(' ');
  const texts = {};
  let size = 0;
  let w = 0;
  for (const d of index.documents) texts[d.id] = '';
  const ids = Object.keys(texts);
  for (let i = 0; size < TEXT_MB * MB; i = (i + 1) % ids.length) {
    const chunk = Array.from({ length: 200 }, () => WORDS[(w = (w + 17) % WORDS.length)]).join(' ') + '.\n';
    texts[ids[i]] += chunk;
    size += chunk.length;
  }
  const textText = JSON.stringify({ schema: 'medrec-text/v1', person: index.person, texts });
  await writeFile(join(folder, 'text.json'), textText);
  // Without the sample's anchor, its timestamps are read as written: no shifting, as with a real folder.
  const manifestPath = join(dir, 'demo', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete manifest.anchor;
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { index, indexText, textText };
}

// ---- Serving it ----

/** vite preview on PORT, started directly rather than through npx, so killing it stops the server. */
function serve(dir) {
  const server = spawn(join('node_modules', '.bin', 'vite'), ['preview', '--outDir', dir, '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const fail = (why) => {
      clearTimeout(t);
      server.kill();
      reject(new Error(`vite preview did not start: ${why}`));
    };
    const t = setTimeout(() => fail('no answer in 30 s'), 30_000);
    server.on('error', (e) => fail(e.message));
    server.on('exit', (code) => fail(`it exited with code ${code}`));
    // Read on after it starts, so its output never fills the pipe.
    server.stdout.on('data', (b) => {
      if (!String(b).includes(`${PORT}`)) return;
      clearTimeout(t);
      server.removeAllListeners('exit');
      resolve(server);
    });
  });
}

// ---- Timing ----

const dir = await mkdtemp(join(tmpdir(), 'oyh-perf-'));
const times = { open: [], person: [], firstSearch: [], nextSearch: [] };
let built;
let server;
let browser;
try {
  built = await buildFolder(dir);
  server = await serve(dir);
  browser = await chromium.launch();
  for (let run = 0; run < RUNS; run += 1) {
    const context = await browser.newContext({ ...devices['Pixel 7'], ...(UNCOMPRESSED ? { extraHTTPHeaders: { 'Accept-Encoding': 'identity' } } : {}) });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    if (NETWORK) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1e6) / 8, uploadThroughput: (2 * 1e6) / 8 });
    }
    const problems = [];
    page.on('pageerror', (e) => problems.push(String(e)));

    // Open: from navigation to every person's index read and counted on the home screen.
    await page.goto(`http://localhost:${PORT}/app/?demo`);
    const robin = page.locator('.row', { hasText: PERSON });
    await robin.locator('.row-meta', { hasText: /\d[\d,]* records/ }).waitFor({ timeout: 120_000 });
    times.open.push(await page.evaluate(() => performance.now()));
    const meta = await robin.locator('.row-meta').innerText();

    // A person's overview, once the folder is open.
    let t0 = await page.evaluate(() => performance.now());
    await robin.locator('a').first().click();
    await page.locator('.person-head h1', { hasText: PERSON }).waitFor();
    await page.locator('main .card').nth(1).waitFor();
    times.person.push((await page.evaluate(() => performance.now())) - t0);

    // The first search needs every person's text.json; the next one has it. Each is typed
    // a key at a time and timed from the last key, so it includes the search page's 200 ms
    // wait after typing, and ends at its first highlighted match.
    await page.goto(`http://localhost:${PORT}/app/?demo#/search`);
    const box = page.getByRole('searchbox').first();
    await box.waitFor();
    await box.pressSequentially('fasting sample', { delay: TYPE_MS });
    t0 = await page.evaluate(() => performance.now());
    await page.locator('main .row mark', { hasText: /fasting/i }).first().waitFor({ timeout: 120_000 });
    times.firstSearch.push((await page.evaluate(() => performance.now())) - t0);
    await box.fill('');
    await box.pressSequentially('reference interval', { delay: TYPE_MS });
    t0 = await page.evaluate(() => performance.now());
    await page.locator('main .row mark', { hasText: /reference/i }).first().waitFor({ timeout: 120_000 });
    times.nextSearch.push((await page.evaluate(() => performance.now())) - t0);

    if (problems.length) throw new Error(problems.join('\n'));
    if (run === 0) console.log(`${PERSON}: ${meta}`);
    await context.close();
  }
} finally {
  await browser?.close();
  server?.kill();
  await rm(dir, { recursive: true, force: true });
}
const { index, indexText, textText } = built;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x) => `${Math.round(x).toLocaleString('en-US')} ms`;
console.log(`index.json ${(indexText.length / MB).toFixed(1)} MB (${index.records.length} records, ${index.documents.length} documents); text.json ${(textText.length / MB).toFixed(1)} MB`);
console.log(`Pixel 7, CPU ${CPU}x slower${NETWORK ? ', 9 Mbps and 150 ms link' : ', files from localhost'}, files ${UNCOMPRESSED ? 'uncompressed' : 'gzipped'}, typing ${TYPE_MS} ms a key; median of ${RUNS} runs`);
console.log('| Step | Median | Runs |\n|---|---|---|');
for (const [k, label] of [
  ['open', 'Open to the home screen, every index read'],
  ['person', 'Open the person’s overview'],
  ['firstSearch', 'First search, from the last key (needs text.json)'],
  ['nextSearch', 'Next search, from the last key'],
]) {
  console.log(`| ${label} | ${ms(median(times[k]))} | ${times[k].map(ms).join(', ')} |`);
}
