import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { demoJson, labelCase, type Overlay } from '../test/helpers';
import { lay } from './lay';
import { ALEX, ROBIN, SAM } from '../test/sample';

// What medrec's labels say of a provider, under the source's own words: the
// sample as medrec 0.9.7 labels it from an invented directory, with what the
// household said (scripts/label-fixtures.mjs), and as it is with none.

interface Rec {
  id: string;
  kind: string;
  date?: string;
  fields: Record<string, unknown>;
}
interface Doc {
  id: string;
  organization?: string;
  doc_type?: string;
}
const NAMES: Record<string, string> = { [ROBIN]: 'Robin', [SAM]: 'Sam', [ALEX]: 'Alex' };
const of = (who: string) => demoJson<{ records: Rec[]; documents: Doc[] }>(`${NAMES[who]} Example/index.json`);
/** The newest of someone's records that names a provider in a field. */
const rec = (who: string, kind: string, field: string, name: string): string =>
  of(who)
    .records.filter((r) => r.kind === kind && r.fields[field] === name)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!.id;
const paper = (who: string, name: string): string => of(who).documents.find((d) => d.organization === name)!.id;

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const item = (who: string, id: string) => `#/p/${who}/r/${id}`;
const provider = (who: string, id: string, field: string, all = false) => `#/p/${who}/provider/${id}/${field}${all ? '?all=1' : ''}`;
const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const row = (page: Page, title: string) => page.locator('.kv-row', { has: page.locator('dt', { hasText: title }) }).first();
const note = (page: Page) => page.locator('main .label-note');
const lines = (page: Page, within = page.locator('main')) => within.locator('.label-note p');

/** The same with every label of Sam's changed. */
function altered(change: (label: Record<string, unknown>) => Record<string, unknown>): Overlay {
  const base = labelCase();
  const views = JSON.parse(base['views/views.json']!) as { people: Record<string, { files: Record<string, string> }> };
  const files = views.people[SAM]!.files;
  const at = (md5: string) => `views/${SAM}/providers.${md5.slice(0, 12)}.json`;
  const labels = JSON.parse(base[at(files['providers.json']!)]!) as { labels: Record<string, Record<string, unknown>> };
  labels.labels = Object.fromEntries(Object.entries(labels.labels).map(([id, l]) => [id, change(l)]));
  const text = JSON.stringify(labels);
  const md5 = createHash('md5').update(text).digest('hex');
  files['providers.json'] = md5;
  return { ...base, [at(md5)]: text, 'views/views.json': JSON.stringify(views) };
}

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('a visit’s record says who each is under the source’s words, with a number to call and why', async ({ page }) => {
  await lay(page, labelCase());
  await go(page, item(SAM, rec(SAM, 'encounter', 'practitioner', 'Dr. Casey Placeholder')));
  await expect(row(page, 'With').getByRole('link', { name: 'Dr. Casey Placeholder' })).toBeVisible();
  await expect(lines(page, row(page, 'With'))).toHaveText(['Casey Placeholder, MD · orthopedic surgeon', '555-010-0123 from the provider directory, Nov 8, 2026', 'By the provider number these records give.']);
  await expect(row(page, 'With').getByRole('link', { name: '555-010-0123' })).toHaveAttribute('href', 'tel:5550100123');
  // What was said of a name with no label of its own.
  await expect(lines(page, row(page, 'Where'))).toHaveText(['The household said on Nov 22, 2026 that Example Health and Example Health Orthopedics are not one provider.']);
});

test('a medicine, a claim, a vaccine and a paper say it too, and nothing shows a provider’s number', async ({ page }) => {
  await lay(page, labelCase());
  const main = page.locator('main');
  await go(page, item(SAM, rec(SAM, 'medication', 'prescriber', 'Dr. Casey Placeholder')));
  await expect(lines(page, row(page, 'Prescribed by')).first()).toHaveText('Casey Placeholder, MD · orthopedic surgeon');
  await go(page, item(ROBIN, rec(ROBIN, 'claim', 'provider', 'Example Health')));
  await expect(lines(page)).toHaveText(['Example Health Partners · primary care clinic', '555-010-0125 from the provider directory, Nov 8, 2026', 'By the provider number these records give.', 'The household said on Nov 22, 2026 that Example Health and Example Health Main Clinic are one provider.']);
  await expect(main).not.toContainText(/\b\d{10}\b/);
  await go(page, item(SAM, paper(SAM, 'Example Billing')));
  await expect(lines(page)).toHaveText(['Example Lab', '555-010-0140 as the household said', 'The household said so on Nov 22, 2026.']);
  // A label the household said is wrong is not shown.
  await go(page, item(ROBIN, rec(ROBIN, 'claim', 'provider', 'Example Lab')));
  await expect(lines(page)).toHaveText(['The household said on Nov 22, 2026 that the label here was wrong.']);
});

test('a likely one is marked so, and says which paper it is by', async ({ page }) => {
  await go(page, item(SAM, rec(SAM, 'encounter', 'practitioner', 'Dr. Casey Placeholder')));
  await expect(row(page, 'With').locator('.label-note .chip')).toHaveText('Likely');
  await expect(row(page, 'With').locator('.label-note')).toContainText('Example Health');
  await expect(row(page, 'With').locator('.label-note')).toContainText('from the same visit print');
  await row(page, 'With').locator('.label-note a').last().click();
  await expect(page.locator('.card-head-paper')).toBeVisible();
});

test('a likely one’s number is no link to call, wherever it is', async ({ page }) => {
  await lay(page, altered((l) => ({ ...l, confidence: 'likely' })));
  for (const path of [item(SAM, rec(SAM, 'encounter', 'practitioner', 'Dr. Casey Placeholder')), item(SAM, rec(SAM, 'medication', 'prescriber', 'Dr. Casey Placeholder')), item(SAM, paper(SAM, 'Example Billing')), provider(SAM, rec(SAM, 'encounter', 'practitioner', 'Dr. Casey Placeholder'), 'practitioner')]) {
    await go(page, path);
    await expect(note(page).first(), path).toContainText(/Likely.*555-010-01/);
    await expect(note(page).locator('a[href^="tel:"]'), path).toHaveCount(0);
  }
  await go(page, '#/money/calls');
  await expect(page.locator('.call').filter({ hasText: 'Example Billing' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('555-010-0140');
});

test('a number from a paper everyone’s Papers does not list is on its person’s own page alone', async ({ page }) => {
  await lay(page, altered((l) => ({ ...l, phone_from: { from: 'paper', document: 'd_aaaaaaaaaaaaaaaaaaaa' } })));
  await go(page, `#/money/calls?who=${SAM}`);
  await expect(page.locator('.call').filter({ hasText: 'Example Billing' })).toContainText('555-010-0140 from one that is not in these records');
  await go(page, '#/money/calls');
  await expect(page.locator('.call').filter({ hasText: 'Example Billing' })).toContainText('The bill’s phone number isn’t in these records; it is on the paper.');
  await expect(page.locator('main')).not.toContainText('555-010-0140');
});

test('a visit says it once in its head, and in a few words on the rows of who was there and who charged', async ({ page }) => {
  await lay(page, labelCase());
  await go(page, `#/p/${ROBIN}/e/${rec(ROBIN, 'claim', 'provider', 'Example Health')}`);
  await expect(note(page)).toHaveCount(1);
  await expect(card(page, 'What happened').locator('.label-line')).toHaveText(['Jordan Sample, MD · family doctor']);
  await expect(card(page, 'Who charged what').locator('.label-line')).toHaveText(['Example Health Partners · primary care clinic']);
});

test('a provider’s page has each label once, and the names the household said are one are on it', async ({ page }) => {
  await lay(page, labelCase());
  await go(page, provider(ROBIN, rec(ROBIN, 'claim', 'provider', 'Example Health'), 'provider'));
  const head = page.locator('.provider > .card').first();
  await expect(head).toContainText('Also printed as Example Health Main Clinic.');
  await expect(head.locator('.label-note')).toHaveCount(1);
  await expect(card(page, 'May be the same').locator('.row-title')).toHaveText(['Example Health Plan']);
  await go(page, provider(ROBIN, rec(ROBIN, 'claim', 'provider', 'Example Health'), 'provider', true));
  await expect(head.locator('.label-note')).toHaveCount(1);
  await expect(lines(page)).toHaveText([
    'Example Health Partners · primary care clinic',
    '555-010-0125 from the provider directory, Nov 8, 2026',
    'By the provider number these records give.',
    'The household said on Nov 22, 2026 that Example Health and Example Health Main Clinic are one provider.',
    'The household said on Nov 22, 2026 that Example Health and Example Health Orthopedics are not one provider.',
  ]);
});

test('a bill worth a call that gives no number has its organization’s, with whose word it is', async ({ page }) => {
  await go(page, '#/money/calls');
  const call = page.locator('.call').filter({ hasText: 'Example Billing' });
  await expect(call).toContainText('The bill’s phone number isn’t in these records; it is on the paper.');
  await expect(call.locator('.kv-row', { has: page.locator('dt', { hasText: /^Call$/ }) })).toHaveCount(0);
  await lay(page, labelCase());
  await page.reload();
  await expect(call.locator('.kv-row', { has: page.locator('dt', { hasText: /^Call$/ }) })).toContainText('555-010-0140 as the household said');
  await expect(call).toContainText('The bill’s own phone number isn’t in these records; it is on the paper.');
});

test('a private item’s label is on its person’s own pages alone', async ({ page }) => {
  await lay(page, labelCase());
  const claim = rec(SAM, 'claim', 'provider', 'Example Sexual Health Clinic');
  await go(page, item(SAM, claim));
  await expect(lines(page)).toHaveText(['Clinic', '555-010-0130 from the provider directory, Nov 8, 2026', 'By the provider number these records give.']);
  await go(page, provider(SAM, claim, 'provider'));
  await expect(note(page)).toContainText('Clinic');
  await go(page, provider(SAM, claim, 'provider', true));
  await expect(page.locator('main')).not.toContainText(/Sexual Health|555-010-0130/);
  for (const path of ['#/', '#/calendar?view=list', '#/money', '#/money/bills', '#/money/calls', '#/money/events', '#/costs', '#/papers', '#/health']) {
    await go(page, path);
    await expect(page.locator('main h1, main .card').first(), path).toBeVisible();
    await expect(page.locator('main'), path).not.toContainText(/Avery Sample|infectious disease|555-010-0124|555-010-0130/);
  }
});

test('nothing lists, finds or filters by a label', async ({ page }) => {
  await lay(page, labelCase());
  for (const words of ['orthopedic surgeon', 'family doctor', 'Example Health Partners']) {
    await go(page, `#/search?q=${encodeURIComponent(words)}`);
    await expect(page.locator('main')).toContainText(/no match|nothing/i);
    await expect(page.locator('main .row'), words).toHaveCount(0);
  }
});

test('a folder with no labels, or with ones that do not read, says nothing of them', async ({ page }) => {
  const files = demoJson<{ files: string[] }>('manifest.json').files.filter((f) => /\/providers\./.test(f));
  expect(files).toHaveLength(3);
  const overlays: Overlay[] = [Object.fromEntries(files.map((f) => [f, '{}'])), Object.fromEntries(files.map((f) => [f, null]))];
  for (const overlay of overlays) {
    await lay(page, overlay);
    await go(page, item(SAM, rec(SAM, 'encounter', 'practitioner', 'Dr. Casey Placeholder')));
    await page.reload();
    await expect(row(page, 'With')).toContainText('Dr. Casey Placeholder');
    await expect(note(page)).toHaveCount(0);
  }
  problems = problems.filter((x) => !/404/.test(x));
});

const FIT: [string, 'light' | 'dark', () => Overlay][] = [
  ['labels', 'light', () => labelCase()],
  ['labels', 'dark', () => labelCase()],
  ['labels of nothing but a number', 'light', () => altered(({ phone, phone_from: from, confidence, evidence }) => ({ phone, phone_from: from, confidence, evidence }))],
];
for (const [what, scheme, overlay] of FIT) {
  test(`${what} fit a 360 px phone, with numbers big enough to tap, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 360, height: 780 });
    await lay(page, overlay());
    const pages = [
      item(SAM, rec(SAM, 'encounter', 'practitioner', 'Dr. Casey Placeholder')),
      item(SAM, paper(SAM, 'Example Billing')),
      item(ALEX, rec(ALEX, 'encounter', 'practitioner', 'Dr. Morgan Placeholder')),
      `#/p/${ROBIN}/e/${rec(ROBIN, 'claim', 'provider', 'Example Health')}`,
      provider(ROBIN, rec(ROBIN, 'claim', 'provider', 'Example Health'), 'provider', true),
      '#/money/calls',
    ];
    for (const path of pages) {
      await go(page, path);
      await expect(page.locator('main a[href^="tel:"]').first(), path).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
      for (const number of await page.locator('main a[href^="tel:"]').all()) {
        expect((await number.boundingBox())!.height, path).toBeGreaterThanOrEqual(44);
        // What is drawn over another link takes its taps.
        const over = await number.evaluate((a) => {
          const r = a.getBoundingClientRect();
          return [...document.querySelectorAll('main a')].filter((x) => x !== a && [...x.getClientRects()].some((b) => b.left < r.right && b.right > r.left && b.top < r.bottom - 0.5 && b.bottom > r.top + 0.5)).map((x) => x.textContent);
        });
        expect(over, path).toEqual([]);
      }
    }
  });
}
