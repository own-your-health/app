import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { CLIENT, FakeGoogle, FOLDER_NAME } from './fake-google';
import { rewritten } from './alter';
import { lay } from './lay';
import { macWrites } from './mac';
import { line, makePdf } from './make-pdf';
import { demoJson, FIXTURES } from '../test/helpers';
import { ALEX, DREW, ROBIN, SAM } from '../test/sample';

// A paper shown in the app: read when it is asked for, drawn here, and dropped
// when it is closed or its page left. What is in a paper runs nothing and
// reaches nothing.

interface Doc {
  id: string;
  path: string;
  media_type: string;
  size: number;
  pages?: number;
  title?: string;
}
interface Index {
  documents: Doc[];
}
const INDEX: Record<string, string> = { [ROBIN]: 'Robin Example/index.json', [SAM]: 'Sam Example/index.json', [ALEX]: 'Alex Example/index.json', [DREW]: 'Drew Example/index.json' };
const docOf = (person: string, is: (d: Doc) => boolean): Doc => demoJson<Index>(INDEX[person]!).documents.find(is)!;
const PDF = docOf(ROBIN, (d) => d.pages === 3);
const PICTURE = docOf(ROBIN, (d) => d.media_type === 'image/png');
const HTML = docOf(ALEX, (d) => d.media_type === 'text/html');
const CDA = docOf(DREW, (d) => d.media_type === 'application/xml');
const RTF = docOf(SAM, (d) => d.media_type === 'application/rtf');

let problems: string[] = [];
/** Every address asked for, without the app's own start. */
let asked: string[] = [];

test.beforeEach(({ page }) => {
  problems = [];
  asked = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('dialog', (d) => {
    problems.push(`dialog ${d.message()}`);
    void d.dismiss();
  });
  page.on('request', (r) => asked.push(decodeURIComponent(r.url().replace(/^https?:\/\/localhost:\d+\/app\//, ''))));
});
test.afterEach(() => expect(problems).toEqual([]));

async function open(page: Page, person: string, d: Doc): Promise<Locator> {
  await page.goto(`./?demo#/p/${person}/r/${d.id}`);
  await page.getByRole('button', { name: /^View\b/ }).click();
  const paper = page.locator('.paper');
  await expect(paper.locator('.paper-box')).toBeVisible();
  return paper;
}

/** Puts these bytes where the sample has a paper. */
async function put(page: Page, d: Doc, body: Buffer | string): Promise<void> {
  await page.route(
    (url) => decodeURIComponent(url.pathname).endsWith(`/demo/${d.path}`),
    (route) => route.fulfill({ contentType: 'application/octet-stream', body }),
  );
}

/** The share of a canvas that is not white. */
const inked = (canvas: Locator): Promise<number> =>
  canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 200 && data[i + 3]! > 0) n += 1;
    return n / (c.width * c.height);
  });

const stored = (page: Page): Promise<unknown> =>
  page.evaluate(async () => [Object.keys(localStorage), Object.keys(sessionStorage), (await indexedDB.databases()).length, (await caches.keys()).length]);

test('a paper is read only when View is tapped', async ({ page }) => {
  await page.goto(`./?demo#/p/${ROBIN}/r/${PDF.id}`);
  const view = page.getByRole('button', { name: `View: ${PDF.title ?? 'After visit summary'}` });
  await expect(view).toHaveAttribute('aria-expanded', 'false');
  expect(asked.filter((a) => a.includes(PDF.path) || /pdf|draw-/.test(a.split('/').pop()!))).toEqual([]);
  await view.click();
  await expect(page.locator('.paper-box')).toBeVisible();
  expect(asked.filter((a) => a.endsWith(PDF.path))).toHaveLength(1);
  await expect(page.getByRole('button', { name: /^Hide: / })).toHaveAttribute('aria-expanded', 'true');
});

test('a PDF is drawn page by page, with its words to select, from the app’s own files', async ({ page }) => {
  const paper = await open(page, ROBIN, PDF);
  await expect(paper.getByRole('status')).toHaveText('3 pages');
  await expect(paper.getByRole('group', { name: 'Page 1 of 3' }).locator('.textLayer')).toContainText('After visit summary');
  const canvas = paper.locator('canvas').first();
  expect(await inked(canvas)).toBeGreaterThan(0.001);
  // Its words lie over its picture: the title's, near the page's top left.
  const [page1, title] = [await paper.locator('.paper-page').first().boundingBox(), await paper.locator('.textLayer span', { hasText: 'After visit summary' }).boundingBox()];
  expect(title!.x).toBeGreaterThan(page1!.x);
  expect(title!.y - page1!.y).toBeLessThan(page1!.height / 5);
  expect(title!.width).toBeGreaterThan(page1!.width / 6);
  await paper.locator('.textLayer span', { hasText: 'After visit summary' }).selectText();
  expect(await page.evaluate(() => getSelection()!.toString())).toContain('After visit summary');
  // The last page is drawn when it comes near.
  await paper.getByRole('group', { name: 'Page 3 of 3' }).scrollIntoViewIfNeeded();
  await expect(paper.getByRole('group', { name: 'Page 3 of 3' }).locator('.textLayer')).not.toBeEmpty();
  // Nothing from outside, and no link, frame or field in it.
  expect(asked.filter((a) => /^https?:/.test(a))).toEqual([]);
  expect(await paper.locator('a, iframe, object, embed, input, form, script, img').count()).toBe(0);
});

test('the PDF reader works in a worker that is under the page’s policy', async ({ page }) => {
  // Both would answer.
  for (const host of ['https://elsewhere.example/**', 'https://oauth2.googleapis.com/**']) await page.route(host, (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: 'there' }));
  await open(page, ROBIN, PDF);
  expect(page.workers().map((w) => new URL(w.url()).protocol)).toEqual(['blob:']);
  const says = await page.workers()[0]!.evaluate(async () => {
    const tried = async (what: () => unknown) => {
      // Apart from this script, which the test runner lets do more.
      await new Promise((r) => setTimeout(r, 0));
      try {
        await what();
        return 'done';
      } catch (e) {
        return (e as Error).name;
      }
    };
    return [
      await tried(() => fetch('https://oauth2.googleapis.com/')),
      await tried(() => fetch('https://elsewhere.example/')),
      await tried(() => fetch('https://elsewhere.example/', { mode: 'no-cors' })),
      await tried(() => new Function('return 1')()),
      await tried(() => WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))),
    ];
  });
  expect([says, asked.filter((a) => /elsewhere/.test(a))]).toEqual([['done', 'TypeError', 'TypeError', 'EvalError', 'CompileError'], []]);
  problems = problems.filter((p) => !/Content Security Policy|elsewhere\.example/.test(p));
  // A worker from an address, or from another blob, does not start: only the app's own policy makes one.
  expect(
    await page.evaluate(() => {
      const tried = (what: () => unknown) => {
        try {
          what();
          return 'done';
        } catch (e) {
          return (e as Error).name;
        }
      };
      const blob = URL.createObjectURL(new Blob(['1'], { type: 'text/javascript' }));
      return [tried(() => new Worker(blob)), tried(() => (window as unknown as { trustedTypes: { createPolicy(n: string, r: object): void } }).trustedTypes.createPolicy('oyh-pdf-worker', {})), tried(() => (window as unknown as { trustedTypes: { createPolicy(n: string, r: object): void } }).trustedTypes.createPolicy('other', {}))];
    }),
  ).toEqual(['TypeError', 'TypeError', 'TypeError']);
  problems = problems.filter((p) => !/Trusted|Content Security Policy/.test(p));
});

test('a picture is shown whole, larger and smaller, and ends with the paper', async ({ page }) => {
  const paper = await open(page, ROBIN, PICTURE);
  const img = paper.getByRole('img');
  await expect(img).toHaveAttribute('alt', /\S/);
  const src = (await img.getAttribute('src'))!;
  expect(src).toMatch(/^blob:/);
  const box = (await paper.locator('.paper-box').boundingBox())!;
  const width = (await img.boundingBox())!.width;
  expect(width).toBeLessThanOrEqual(box.width);
  await paper.getByRole('button', { name: 'Larger' }).click();
  await expect(paper.locator('.paper-zoom')).toHaveText('150%');
  expect((await img.boundingBox())!.width).toBeCloseTo(width * 1.5, 0);
  for (let i = 0; i < 9 && (await paper.getByRole('button', { name: 'Larger' }).isEnabled()); i++) await paper.getByRole('button', { name: 'Larger' }).click();
  await expect(paper.locator('.paper-zoom')).toHaveText('600%');
  // The page itself is no wider for it.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (let i = 0; i < 9 && (await paper.getByRole('button', { name: 'Smaller' }).isEnabled()); i++) await paper.getByRole('button', { name: 'Smaller' }).click();
  await expect(paper.locator('.paper-zoom')).toHaveText('100%');
  await page.getByRole('button', { name: /^Hide: / }).click();
  await expect(page.locator('.paper')).toBeHidden();
  expect(await page.evaluate((u) => fetch(u).then(() => 'there', () => 'gone'), src)).toBe('gone');
  problems = problems.filter((p) => !/blob:|ERR_FILE_NOT_FOUND|Content Security Policy/.test(p));
});

test('two fingers make a paper larger where they are, and one scrolls it', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch');
  const paper = await open(page, ROBIN, PICTURE);
  const box = paper.locator('.paper-box');
  await box.scrollIntoViewIfNeeded();
  expect(await box.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-x pan-y');
  const at = (await box.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const [x, y] = [at.x + at.width * 0.75, at.y + at.height / 2];
  const touch = (type: string, apart: number) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: type === 'touchEnd' ? [] : [{ x: x - apart / 2, y, id: 0 }, { x: x + apart / 2, y, id: 1 }] });
  const before = await page.evaluate(() => window.visualViewport!.scale);
  await touch('touchStart', 60);
  for (const apart of [80, 100, 120]) await touch('touchMove', apart);
  await touch('touchEnd', 0);
  await expect(paper.locator('.paper-zoom')).toHaveText('200%');
  // The place between them stays: three quarters across the picture.
  const img = (await paper.getByRole('img').boundingBox())!;
  expect((x - img.x) / img.width).toBeCloseTo(0.75, 1);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(before);
});

test('the wheel with Ctrl makes a paper larger, and without it scrolls', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'wheel');
  const paper = await open(page, ROBIN, PDF);
  const box = (await paper.locator('.paper-box').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.wheel(0, 120);
  await expect(paper.locator('.paper-zoom')).toHaveText('100%');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(paper.locator('.paper-zoom')).not.toHaveText('100%');
});

test('a PDF made larger is drawn sharp again, and its words grow with it', async ({ page }) => {
  const paper = await open(page, ROBIN, PDF);
  const canvas = paper.locator('canvas').first();
  const word = paper.locator('.textLayer span', { hasText: 'After visit summary' });
  await expect(word).toBeVisible();
  const [pixels, wide] = [await canvas.evaluate((c) => (c as HTMLCanvasElement).width), (await word.boundingBox())!.width];
  await paper.getByRole('button', { name: 'Larger' }).click();
  await expect.poll(() => paper.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).width)).toBeGreaterThan(pixels * 1.4);
  await expect.poll(async () => (await word.boundingBox())!.width).toBeGreaterThan(wide * 1.4);
});

test('HTML, a clinical document and RTF are shown as their words', async ({ page }) => {
  const html = await open(page, ALEX, HTML);
  await expect(html.locator('.paper-text')).toContainText('Give the antibiotic for all ten days.');
  await expect(html.getByRole('status')).toContainText('Nothing in it runs');
  const cda = await open(page, DREW, CDA);
  await expect(cda.locator('.paper-text').getByRole('heading', { name: 'Measurements' })).toBeVisible();
  await expect(cda.locator('.paper-text li')).toHaveText(['Well child visit, 3 years, 12/16/2025', 'Dr. Morgan Placeholder', 'Weight 14.6 kg', 'Height 95.8 cm', /^Next visit at 4 years/]);
  const rtf = await open(page, SAM, RTF);
  await expect(rtf.getByRole('status')).toHaveText('The text only, without its layout. Open in Drive shows it whole.');
  await expect(rtf.locator('pre')).toContainText('Please see for an upper endoscopy.');
  await expect(rtf.locator('..').getByText('Opens in Drive on a real folder')).toBeVisible();
  await rtf.getByRole('button', { name: 'Larger' }).click();
  expect(await rtf.locator('.paper-text').evaluate((el) => getComputedStyle(el).fontSize)).toBe('22.5px');
});

test('nothing in an HTML paper runs, loads, frames, links or sends', async ({ page }) => {
  await put(page, HTML, readFileSync(`${FIXTURES}/paper/letter.html`));
  const paper = await open(page, ALEX, HTML);
  await expect(paper.locator('.paper-text')).toContainText('Drink plenty of water & rest.');
  expect(await paper.locator('a, iframe, frame, object, embed, script, style, link, meta, base, form, input, select, textarea, svg, video, audio, [onclick], [onload], [href], .paper-text [style]').count()).toBe(0);
  const attrs = await paper.locator('.paper-text *').evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.attributes].map((a) => a.name)))].sort());
  expect(attrs).toEqual(['alt', 'class', 'colspan', 'rowspan', 'src']);
  // A picture in the file itself is not one here: its eight bytes are only a PNG's start.
  await expect(paper.locator('img')).toHaveAttribute('src', /^blob:/);
  expect(asked.filter((a) => /elsewhere|portal\.example/.test(a))).toEqual([]);
  expect(page.url()).toContain(`#/p/${ALEX}/r/${HTML.id}`);
  problems = problems.filter((p) => !/blob:/.test(p));
});

test('nothing in a PDF runs, links, asks or sends', async ({ page }) => {
  const hostile = makePdf([`${line('Invented')}`], {
    catalog: '/OpenAction << /S /JavaScript /JS (app.alert\\("ran"\\)) >> /AcroForm << /Fields [101 0 R] /NeedAppearances true >> /Names << /JavaScript << /Names [(a) << /S /JavaScript /JS (app.alert\\("ran"\\)) >>] >> >>',
    page: '/Annots [100 0 R 101 0 R 102 0 R] /AA << /O << /S /JavaScript /JS (app.alert\\("ran"\\)) >> >>',
    extra: [
      '<< /Type /Annot /Subtype /Link /Rect [72 600 300 640] /Border [0 0 1] /A << /S /URI /URI (https://elsewhere.example/) >> >>',
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (typed) /Rect [72 500 300 540] /A << /S /SubmitForm /F (https://elsewhere.example/send) >> >>',
      '<< /Type /Annot /Subtype /FileAttachment /Rect [72 400 100 430] /FS << /F (a.exe) >> >>',
    ],
  });
  await put(page, PDF, hostile);
  const paper = await open(page, ROBIN, PDF);
  await expect(paper.locator('.textLayer')).toContainText('Invented');
  expect(await paper.locator('a, input, textarea, select, button:not(.paper-controls button), iframe').count()).toBe(0);
  const spot = (await paper.locator('.paper-page').first().boundingBox())!;
  await page.mouse.click(spot.x + spot.width * 0.25, spot.y + spot.height * 0.22);
  await page.waitForTimeout(300);
  expect([page.url().split('#')[1], asked.filter((a) => /elsewhere/.test(a)), page.context().pages().length]).toEqual([`/p/${ROBIN}/r/${PDF.id}`, [], 1]);
});

test('a PDF whose pages differ, or turn, is drawn in its own shape', async ({ page }) => {
  await put(page, PDF, makePdf([line('Wide', 300)], { size: [800, 400] }));
  const wide = await open(page, ROBIN, PDF);
  await expect(wide.locator('.textLayer')).toContainText('Wide');
  const flat = (await wide.locator('.paper-page').boundingBox())!;
  expect(flat.width / flat.height).toBeCloseTo(2, 1);
  await page.unrouteAll();
  await put(page, PDF, makePdf([line('Turned', 300)], { size: [800, 400], page: '/Rotate 90' }));
  await page.goto('about:blank');
  const turned = await open(page, ROBIN, PDF);
  await expect(turned.locator('.textLayer')).toContainText('Turned');
  const tall = (await turned.locator('.paper-page').boundingBox())!;
  expect(tall.height / tall.width).toBeCloseTo(2, 1);
  const word = (await turned.locator('.textLayer span').first().boundingBox())!;
  expect(word.height).toBeGreaterThan(word.width);
  expect(word.x).toBeGreaterThanOrEqual(tall.x);
  expect(word.x + word.width).toBeLessThanOrEqual(tall.x + tall.width + 1);
});

test('a JPEG 2000 picture in a PDF is read without WebAssembly', async ({ page }) => {
  const picture = readFileSync(`${FIXTURES}/paper/icon.j2k`).toString('latin1');
  await put(
    page,
    PDF,
    makePdf(['q 200 0 0 200 0 0 cm /I Do Q'], {
      size: [200, 200],
      resources: '/XObject << /I 100 0 R >>',
      extra: [`<< /Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Length ${picture.length} >>\nstream\n${picture}\nendstream`],
    }),
  );
  const paper = await open(page, ROBIN, PDF);
  await expect.poll(() => inked(paper.locator('canvas'))).toBeGreaterThan(0.05);
  // Both picture readers are there before a page asks for one, as scripts.
  expect(asked.filter((a) => a.startsWith('pdfjs/')).map((a) => a.split('/').pop()).sort()).toEqual(['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']);
  await expect(paper.locator('.paper-note')).toBeHidden();
});

const picture = (filter: string, body: string) => `<< /Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${body.length} >>\nstream\n${body}\nendstream`;
const LACKS = 'Something in this paper could not be drawn here. Open it in Drive to see it whole.';
for (const filter of ['JPXDecode', 'DCTDecode'])
  test(`a page that lacks a picture says so, and no other page does: ${filter}`, async ({ page }) => {
    await put(page, PDF, makePdf([line('The first page'), `${line('The second page')} q 200 0 0 200 72 300 cm /I Do Q`, line('The last page')], { resources: '/XObject << /I 100 0 R >>', extra: [picture(filter, 'not a picture')] }));
    const paper = await open(page, ROBIN, PDF);
    const second = paper.getByRole('group', { name: 'Page 2 of 3' });
    await second.scrollIntoViewIfNeeded();
    // What can be drawn of it is.
    await expect(second.locator('.textLayer')).toContainText('The second page');
    await expect.poll(() => inked(second.locator('canvas'))).toBeGreaterThan(0.0003);
    await expect(paper.locator('.paper-note:visible')).toHaveText(['A picture on page 2 could not be drawn here.']);
    await expect(paper.getByRole('status')).toHaveText(`3 pages. ${LACKS}`);
    await paper.getByRole('group', { name: 'Page 3 of 3' }).scrollIntoViewIfNeeded();
    await expect(paper.getByRole('group', { name: 'Page 3 of 3' }).locator('.textLayer')).toContainText('The last page');
    await expect(paper.locator('.paper-note:visible')).toHaveCount(1);
  });

const stream = (dict: string, body: string) => `<< ${dict} /Length ${body.length} >>\nstream\n${body}\nendstream`;
const IMAGE = '/Type /XObject /Subtype /Image /Width 32 /Height 32';
const FORM = '/Type /XObject /Subtype /Form /BBox [0 0 1 1]';
/** What a page draws, as its picture unless it says how. */
const LEFT_OUT: [what: string, object: string, draws?: string][] = [
  ['a stencil', stream(`${IMAGE} /ImageMask true /BitsPerComponent 1 /Filter /JPXDecode`, 'not a picture')],
  ['a scan that is one', stream(`${IMAGE} /ImageMask true /BitsPerComponent 1 /Filter /JBIG2Decode`, 'not a picture')],
  ['a picture of no size', stream('/Type /XObject /Subtype /Image /ColorSpace /DeviceRGB /BitsPerComponent 8', 'x')],
  ['a small picture in its line', stream(FORM, 'BI /W 8 /H 8 /BPC 8 ID x EI Q')],
  ['a shading that is not there', stream(`${FORM} /Resources << /Shading << >> >>`, '/S sh')],
  ['a shading of no known kind', stream(`${FORM} /Resources << /Shading << /S << /ShadingType 99 /ColorSpace /DeviceRGB >> >> >>`, '/S sh')],
  ['a font with no parts', '<< /Type /Font /Subtype /Type0 /BaseFont /Sample /Encoding /Identity-H >>', 'BT /J 1 Tf <0041> Tj ET'],
  ['an object of no known kind', stream('/Type /XObject /Subtype /NoSuchKind', 'x')],
];
for (const [what, object, draws = '/I Do'] of LEFT_OUT)
  test(`a part of a page that is left out is said: ${what}`, async ({ page }) => {
    await put(page, PDF, makePdf([`${line('The first page')} q 200 0 0 200 72 300 cm ${draws} Q`], { resources: '/XObject << /I 100 0 R >> /Font << /F 3 0 R /J 100 0 R >>', extra: [object] }));
    const paper = await open(page, ROBIN, PDF);
    await expect(paper.locator('.textLayer')).toContainText('The first page');
    await expect(paper.getByRole('status')).toHaveText(`1 page. ${LACKS}`);
    await expect(paper.locator('.paper-note:visible')).toHaveCount(0);
  });

test('a page let go of as it is read lacks nothing', async ({ page }) => {
  await put(page, PDF, makePdf(Array.from({ length: 60 }, (_, i) => Array.from({ length: 400 }, (_x, n) => `BT /F 8 Tf ${n % 500} ${(n * 7) % 780} Td (Page ${i + 1}, ${n}) Tj ET`).join('\n'))));
  const paper = await open(page, ROBIN, PDF);
  await expect(paper.getByRole('status')).toHaveText('60 pages');
  for (const n of [60, 1, 40, 5, 30, 60]) await paper.locator('.paper-box').evaluate((el, to) => (el.scrollTop = (el.scrollHeight * to) / 60), n);
  await paper.getByRole('group', { name: 'Page 60 of 60' }).scrollIntoViewIfNeeded();
  await expect(paper.getByRole('group', { name: 'Page 60 of 60' }).locator('.textLayer')).toContainText('Page 60, 399');
  await expect(paper.getByRole('status')).toHaveText('60 pages');
});

test('a worker that does not start is said, also while pdf.js itself is loading', async ({ page }) => {
  await page.route(/\/assets\/pdf\.worker/, (route) => route.fulfill({ contentType: 'text/javascript', body: 'this is no script' }));
  for (const wait of [0, 1500]) {
    await page.route(/\/assets\/pdf-/, async (route) => {
      await new Promise((r) => setTimeout(r, wait));
      await route.continue();
    });
    await page.goto('about:blank');
    await page.goto(`./?demo#/p/${ROBIN}/r/${PDF.id}`);
    await page.getByRole('button', { name: /^View\b/ }).click();
    await expect(page.locator('.paper').getByRole('alert')).toHaveText('This browser could not start the app’s PDF reader. Open it in Drive to see it.');
    expect(page.workers()).toHaveLength(0);
  }
  problems = problems.filter((p) => !/SyntaxError|Unexpected/.test(p));
});

test('a file of the app that does not load is said, with a way to reload', async ({ page }) => {
  for (const file of [/\/assets\/draw-/, /\/assets\/pdf-/, /\/assets\/pdf\.worker/, /openjpeg_nowasm/, /jbig2_nowasm/]) {
    await page.goto('about:blank');
    let refused = 0;
    await page.route(file, (route) => {
      refused += 1;
      return refused % 2 ? route.abort() : route.fulfill({ status: 404, body: '' });
    });
    // It does not answer, and then it is gone.
    for (let n = 0; n < 2; n++) {
      await page.goto('about:blank');
      await page.goto(`./?demo#/p/${ROBIN}/r/${PDF.id}`);
      await page.getByRole('button', { name: /^View\b/ }).click();
      await expect(page.locator('.paper').getByRole('alert')).toHaveText('The part of the app that shows papers did not load. Check the connection, or reload the app: it may have a newer version.');
      expect(page.workers()).toHaveLength(0);
    }
    expect(refused).toBeGreaterThan(1);
    await page.unrouteAll();
    await page.locator('.paper').getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('button', { name: /^View\b/ })).toBeVisible();
    await page.getByRole('button', { name: /^View\b/ }).click();
    await expect(page.locator('.textLayer').first()).toContainText('After visit summary');
  }
  problems = problems.filter((p) => !/Failed to load resource|Failed to fetch dynamically imported module/.test(p));
});

test('a page whose font or character map does not load is not shown without it, nor any later one', async ({ page }) => {
  const cases: [RegExp, Buffer][] = [
    [/standard_fonts/, makePdf([line('One'), line('Two')])],
    [
      /cmaps/,
      makePdf(['BT /J 24 Tf 72 700 Td <3042> Tj ET', 'BT /J 24 Tf 72 700 Td <3044> Tj ET'], {
        resources: '/Font << /J 100 0 R >>',
        extra: ['<< /Type /Font /Subtype /Type0 /BaseFont /Sample /Encoding /UniJIS-UCS2-H /DescendantFonts [101 0 R] >>', '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Sample /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> >>'],
      }),
    ],
  ];
  for (const [file, pdf] of cases) {
    await page.unrouteAll();
    await page.goto('about:blank');
    await put(page, PDF, pdf);
    await page.route(file, (route) => route.abort());
    const paper = await open(page, ROBIN, PDF);
    for (const n of [1, 2]) {
      const one = paper.getByRole('group', { name: `Page ${n} of 2` });
      await one.scrollIntoViewIfNeeded();
      await expect(one).toHaveText(`Page ${n} could not be drawn here: a file of the app did not load. Reload the app, or open the paper in Drive.`);
      await expect(one.locator('canvas')).toHaveCount(0);
    }
  }
  problems = problems.filter((p) => !/Failed to load resource/.test(p));
});

test('the buttons that make a paper larger and smaller keep their focus at the ends, and say how large it is', async ({ page }) => {
  const paper = await open(page, ROBIN, PICTURE);
  const [smaller, larger, says] = [paper.getByRole('button', { name: 'Smaller' }), paper.getByRole('button', { name: 'Larger' }), paper.locator('.paper-zoom')];
  await expect(says).toHaveAttribute('aria-live', 'polite');
  await expect(smaller).toHaveAttribute('aria-disabled', 'true');
  await larger.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('Enter');
  await expect(says).toHaveText('600%');
  await expect(larger).toBeFocused();
  await expect(larger).toHaveAttribute('aria-disabled', 'true');
  await expect(smaller).toHaveAttribute('aria-disabled', 'false');
  await smaller.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('Enter');
  await expect(says).toHaveText('100%');
  await expect(smaller).toBeFocused();
});

test('a long PDF holds only the pages near the part in sight', async ({ page }) => {
  // Each time pdf.js has its worker read a page to draw it.
  await page.addInitScript(() => {
    const read: number[] = [];
    Object.assign(window, { readPages: read });
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, m: { action?: string; data?: { pageIndex: number } }, ...rest: unknown[]) {
      if (m?.action === 'GetOperatorList') read.push(m.data!.pageIndex);
      return Reflect.apply(post, this, [m, ...rest]) as void;
    } as typeof post;
  });
  const reads = (n: number) => page.evaluate((i) => (window as unknown as { readPages: number[] }).readPages.filter((x) => x === i).length, n - 1);
  await put(page, PDF, makePdf(Array.from({ length: 40 }, (_, i) => line(`Page ${i + 1}`))));
  const paper = await open(page, ROBIN, PDF);
  await expect(paper.getByRole('status')).toHaveText('40 pages');
  await expect(paper.getByRole('group', { name: 'Page 1 of 40' }).locator('canvas')).toBeVisible();
  expect(await paper.locator('canvas').count()).toBeLessThan(8);
  await paper.getByRole('group', { name: 'Page 30 of 40' }).scrollIntoViewIfNeeded();
  await expect(paper.getByRole('group', { name: 'Page 30 of 40' }).locator('.textLayer')).toContainText('Page 30');
  await expect(paper.getByRole('group', { name: 'Page 1 of 40' }).locator('canvas')).toHaveCount(0);
  expect(await paper.locator('canvas').count()).toBeLessThan(8);
  // One let go is read and drawn again: nothing of it was held.
  expect(await reads(1)).toBe(1);
  await paper.getByRole('group', { name: 'Page 1 of 40' }).scrollIntoViewIfNeeded();
  await expect(paper.getByRole('group', { name: 'Page 1 of 40' }).locator('.textLayer')).toHaveText('Page 1');
  await expect.poll(() => inked(paper.getByRole('group', { name: 'Page 1 of 40' }).locator('canvas'))).toBeGreaterThan(0.0003);
  expect(await reads(1)).toBe(2);
});

test('what does not show here says why, beside Open in Drive', async ({ page }) => {
  const why = async (body: Buffer | string, d = PDF, person = ROBIN): Promise<string> => {
    await page.unrouteAll();
    await put(page, d, body);
    await page.goto('about:blank');
    await page.goto(`./?demo#/p/${person}/r/${d.id}`);
    await page.getByRole('button', { name: /^View\b/ }).click();
    const alert = page.locator('.paper').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(page.locator('.row-actions', { has: page.getByRole('button', { name: /^Hide/ }) })).toContainText('Drive');
    return alert.innerText();
  };
  expect(await why(makePdf([line('Locked')], { trailer: `/ID [<00> <00>] /Encrypt << /Filter /Standard /V 1 /R 2 /P -4 /O <${'41'.repeat(32)}> /U <${'42'.repeat(32)}> >>` }))).toBe('This PDF needs a password. Open it in Drive to see it.');
  expect(await why('%PDF-1.4\nnothing that is one')).toBe('This file does not read as a PDF. Open it in Drive to see it.');
  expect(await why(Buffer.from('II*\0', 'latin1'))).toBe('A TIFF picture does not show here. Open it in Drive to see it.');
  expect(await why('words of no known kind')).toBe('A file of this type does not show here. Open it in Drive to see it.');
  expect(await why(Buffer.from('\x89PNG\r\n\x1a\n and no more', 'latin1'), PICTURE)).toBe('This picture could not be read here. Open it in Drive to see it.');
  expect(await why('<html><script>1</script></html>', HTML, ALEX)).toBe('No text was found in this file. Open it in Drive to see it.');
  expect(await why('<ClinicalDocument/>', CDA, DREW)).toBe('No text was found in this file. Open it in Drive to see it.');
  expect(await why('{\\rtf1 }', RTF, SAM)).toBe('No text was found in this file. Open it in Drive to see it.');
  problems = problems.filter((p) => !/blob:/.test(p));
});

test('a clinical document that only holds a PDF is that PDF', async ({ page }) => {
  await put(page, CDA, `<ClinicalDocument><component><nonXMLBody><text mediaType="application/pdf" representation="B64">${makePdf([line('Held')]).toString('base64')}</text></nonXMLBody></component></ClinicalDocument>`);
  const paper = await open(page, DREW, CDA);
  await expect(paper.locator('.textLayer')).toContainText('Held');
});

test('above 10 MB the size is said first, and above 60 MB there is only Drive', async ({ page }) => {
  const sized = (size: number) => ({ [INDEX[ROBIN]!]: JSON.stringify({ ...demoJson<Index>(INDEX[ROBIN]!), documents: demoJson<Index>(INDEX[ROBIN]!).documents.map((d) => (d.id === PDF.id ? { ...d, size } : d)) }) });
  await lay(page, sized(12_400_000));
  await page.goto(`./?demo#/p/${ROBIN}/r/${PDF.id}`);
  await expect(page.getByRole('button', { name: /^View \(12 MB\): / })).toHaveText('View (12 MB)');
  await page.unrouteAll();
  await lay(page, sized(70_000_000));
  await page.goto('about:blank');
  await page.goto(`./?demo#/p/${ROBIN}/r/${PDF.id}`);
  await expect(page.getByText('Opens in Drive on a real folder').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^View\b/ })).toHaveCount(0);
});

test('a paper is dropped when its page is left or it is hidden, and nothing of it is kept', async ({ page }) => {
  await open(page, ROBIN, PDF);
  await expect(page.locator('.textLayer').first()).not.toBeEmpty();
  const before = await stored(page);
  expect(page.workers()).toHaveLength(1);
  await page.evaluate(() => (location.hash = '#/papers'));
  await expect(page.locator('h1')).toHaveText('Papers');
  await expect.poll(() => page.workers().length).toBe(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  await open(page, ROBIN, PDF);
  await page.getByRole('button', { name: /^Hide: / }).click();
  await expect.poll(() => page.workers().length).toBe(0);
  await expect(page.locator('.paper')).toBeEmpty();
  // Closed while it is read: nothing comes of it.
  await page.route((url) => decodeURIComponent(url.pathname).endsWith(PDF.path), async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue().catch(() => undefined);
  });
  await page.getByRole('button', { name: /^View\b/ }).click();
  await expect(page.locator('.paper').getByRole('status')).toHaveText('Reading the paper…');
  await page.getByRole('button', { name: /^Hide: / }).click();
  await page.waitForTimeout(1000);
  await expect(page.locator('.paper')).toBeEmpty();
  expect(page.workers()).toHaveLength(0);
  expect(await stored(page)).toEqual(before);
});

test('each paper of a visit has its own View', async ({ page }) => {
  const index = demoJson<Index & { records: { id: string; kind: string }[] }>(INDEX[ROBIN]!);
  await page.goto(`./?demo#/p/${ROBIN}/r/${PDF.id}`);
  await page.locator('.event-part a').click();
  const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Papers', exact: true }) });
  const views = card.getByRole('button', { name: /^View: / });
  await expect(views.first()).toBeVisible();
  const n = await views.count();
  expect(n).toBeGreaterThan(1);
  expect(new Set(await views.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).size).toBe(n);
  await views.first().click();
  await expect(card.locator('.paper-box')).toHaveCount(1);
  await views.first().click();
  await expect(card.locator('.paper-box')).toHaveCount(2);
  expect(index.documents.length).toBeGreaterThan(n);
});

/** medrec's X2: two of Robin's papers, in Drew's visit, some private. */
let visit = '';
const filed = (...isPrivate: Doc[]) =>
  rewritten({}, (f) => {
    if (f.name === 'Drew Example') {
      const event = f.events.events[0]!;
      visit = event.id;
      for (const d of [PICTURE, PDF]) event.members!.push({ ...event.members!.find((m) => m.document)!, document: d.id, person: ROBIN, kind: 'document', rule: 'X2' } as { document: string });
    }
    if (f.name === 'Robin Example') for (const d of isPrivate) f.list.documents[d.id] = 'household';
  });

test('a visit shows another person’s paper filed under them, and not one that is private', async ({ page }) => {
  for (const isPrivate of [false, true]) {
    await page.unrouteAll();
    await lay(page, isPrivate ? filed(PICTURE) : filed());
    await page.goto('about:blank');
    await page.goto(`./?demo#/p/${DREW}/e/${visit}`);
    const papers = page.locator('.row', { hasText: 'filed under Robin' });
    const paper = papers.filter({ hasNotText: 'After visit summary' });
    await expect(papers.getByRole('button', { name: /^View: / })).toHaveCount(isPrivate ? 1 : 2);
    await expect(paper).toHaveCount(isPrivate ? 0 : 1);
    // Nowhere on it: not its title, and no link to it.
    await expect(page.locator(`main a[href*="${PICTURE.id}"]`)).toHaveCount(isPrivate ? 0 : 2);
  }
  // Its own person's pages have it, with that visit.
  await page.goto(`./?demo#/papers?who=${ROBIN}`);
  await expect(page.locator('.row', { has: page.locator(`a[href*="${PICTURE.id}"]`) })).toContainText('(Drew’s visit)');
  await page.goto('about:blank');
  await open(page, ROBIN, PICTURE);
});

test('a paper is not shown with another person’s private visit', async ({ page }) => {
  for (const isPrivate of [false, true]) {
    await page.unrouteAll();
    const files = filed();
    await lay(page, isPrivate ? rewritten(files, (f) => f.name === 'Drew Example' && (f.list.events[visit] = 'household')) : files);
    await page.goto('about:blank');
    await page.goto(`./?demo#/papers?who=${ROBIN}`);
    const paper = page.locator('.row', { has: page.locator(`a[href*="${PICTURE.id}"]`) });
    await expect(paper.locator('.paper-place')).toContainText(isPrivate ? 'With no visit.' : '(Drew’s visit)');
    await expect(page.locator(`main a[href*="${visit}"]`)).toHaveCount(isPrivate ? 0 : 1);
  }
});

test('360 px, light and dark: the paper fits, and its buttons are large enough to tap', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 360, height: 780 });
    for (const [person, d] of [[ROBIN, PDF], [ROBIN, PICTURE], [ALEX, HTML], [SAM, RTF]] as const) {
      const paper = await open(page, person, d);
      expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter((el) => !el.closest('.paper-box') && el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).map((el) => el.className))).toEqual([]);
      const box = paper.locator('.paper-box');
      expect(await box.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      for (const name of ['Larger', 'Smaller']) expect((await paper.getByRole('button', { name }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
      await box.focus();
      await expect(box).toBeFocused();
      await page.goto('about:blank');
    }
  }
});

test.describe('signed in', () => {
  let google: FakeGoogle;
  test.beforeEach(async ({ page, context }) => {
    google = new FakeGoogle();
    await google.install(context);
    await page.goto(`./?client=${CLIENT}`);
    await page.locator('.row', { hasText: FOLDER_NAME }).getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('.signin-notice')).toBeVisible();
  });

  test('a paper is read from Drive, once, when it is asked for', async ({ page }) => {
    await page.evaluate((to) => (location.hash = to), `#/p/${ROBIN}/r/${PDF.id}`);
    await expect(page.getByRole('link', { name: 'Open in Drive' })).toHaveAttribute('href', /^https:/);
    expect(google.reads).not.toContain(PDF.path);
    await page.getByRole('button', { name: /^View\b/ }).click();
    await expect(page.locator('.textLayer').first()).toContainText('After visit summary');
    expect(google.reads.filter((r) => r === PDF.path)).toHaveLength(1);
    expect(google.changes).toEqual([]);
    expect(google.strays).toEqual([]);
  });

  test('what Drive does not give is said, and asked for again', async ({ page }) => {
    google.failing = PDF.path;
    await page.evaluate((to) => (location.hash = to), `#/p/${ROBIN}/r/${PDF.id}`);
    await page.getByRole('button', { name: /^View\b/ }).click();
    await expect(page.locator('.paper').getByRole('alert')).toHaveText('Drive did not give the file. Try again, or open it in Drive.');
    google.failing = null;
    await page.getByRole('button', { name: /^Hide: / }).click();
    await page.getByRole('button', { name: /^View\b/ }).click();
    await expect(page.locator('.textLayer').first()).toContainText('After visit summary');
    problems = problems.filter((p) => !/503/.test(p));
  });

  test('a paper stays open while the folder is read again, and the page is drawn once it is closed', async ({ page }) => {
    await page.evaluate((to) => (location.hash = to), `#/p/${ROBIN}/r/${PDF.id}`);
    await page.getByRole('button', { name: /^View\b/ }).click();
    await expect(page.locator('.textLayer').first()).toContainText('After visit summary');
    await page.locator('.card').first().evaluate((el) => el.setAttribute('data-drawn', 'before'));
    const status = JSON.parse(google.read('_status/status.json')!) as { updated_at: string };
    google.writeAsMac('_status/status.json', JSON.stringify({ ...status, updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }, null, 2));
    const reads = google.reads.filter((r) => r === '_status/status.json').length;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => google.reads.filter((r) => r === '_status/status.json').length).toBeGreaterThan(reads);
    await page.waitForTimeout(300);
    await expect(page.locator('.textLayer').first()).toContainText('After visit summary');
    await expect(page.locator('.card[data-drawn]')).toHaveCount(1);
    await page.getByRole('button', { name: /^Hide: / }).click();
    await expect(page.locator('.card[data-drawn]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^View\b/ })).toBeVisible();
  });

  const NO_LONGER = 'That paper is not shown on this page now.';
  test('a paper of someone else’s marked private while its page is open is not shown there, and one that is open closes', async ({ page }) => {
    for (const [path, text] of Object.entries(filed())) google.writeAsMac(path, text!);
    await page.reload();
    await expect(page.locator('.signin-notice')).toBeVisible();
    await page.evaluate((to) => (location.hash = to), `#/p/${DREW}/e/${visit}`);
    const rows = page.locator('.row', { hasText: 'filed under Robin' });
    const view = rows.getByRole('button', { name: /^View\b/ });
    await expect(view).toHaveCount(2);
    // One is open, and the other becomes private: the page stays as it was drawn, and the other's View opens nothing.
    const pdf = rows.filter({ hasText: 'After visit summary' });
    await pdf.getByRole('button', { name: /^View\b/ }).click();
    await expect(pdf.locator('.textLayer').first()).toContainText('After visit summary');
    await macWrites(page, google, filed(PICTURE), 1);
    await expect(view).toHaveCount(1);
    const read = google.reads.filter((r) => r === PICTURE.path).length;
    await view.click();
    await expect(page.getByText(NO_LONGER)).toBeVisible();
    await expect(view).toHaveCount(0);
    await expect(pdf.locator('.textLayer').first()).toContainText('After visit summary');
    expect(google.reads.filter((r) => r === PICTURE.path)).toHaveLength(read);
    // The one that is open becomes private: it closes, and the page is drawn without it.
    await macWrites(page, google, filed(PICTURE, PDF), 2);
    await expect(page.locator('canvas, .paper-box')).toHaveCount(0);
    await expect(rows).toHaveCount(0);
    expect(page.workers()).toHaveLength(0);
  });
});
