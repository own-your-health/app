import { expect, test, type Page } from '@playwright/test';

// The sample folder in demo mode, through the production build and its
// Content-Security-Policy. Any console error or policy violation fails.

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

async function openSection(page: Page, name: string) {
  if (isPhone(page)) {
    const nav = page.locator('.bottom-nav');
    await expect(nav).toBeVisible();
    if (BOTTOM.includes(name)) await nav.getByText(name, { exact: true }).click();
    else {
      await nav.getByText('More', { exact: true }).click();
      await page.locator('.sheet').getByText(name, { exact: true }).click();
      await expect(page.locator('.sheet')).toHaveCount(0);
    }
  } else {
    await page.locator('.section-tabs').getByText(name, { exact: true }).click();
  }
  const slug = SLUGS[name] ?? name.toLowerCase();
  await expect(page).toHaveURL(slug === 'timeline' ? /#\/p\/[^/]+$/ : new RegExp(`#/p/[^/]+/${slug}(\\?.*)?$`));
  // The tabs are in the page at every size (hidden on phones); the current
  // one changes only once the section has rendered.
  await expect(page.locator('.section-tabs .tab-current')).toHaveText(name);
}

/** The sections the phone's bottom bar shows; the rest are under More. */
const BOTTOM = ['Timeline', 'Results', 'Medicines', 'Documents'];
const SLUGS: Record<string, string> = { 'Claims and bills': 'claims' };

test('home answers what needs a person', async ({ page }) => {
  await page.goto('./?demo');
  await expect(page.locator('.banner')).toContainText('Invented records');
  await expect(page.locator('.glance-answer')).toHaveText('1 sign-in needs a person');
  const waiting = page.locator('.card-attention', { hasText: 'Waiting for you on the Mac' });
  await expect(waiting).toContainText('Example Health Plan');
  await expect(waiting.locator('.command code')).toHaveText(/^medrec refresh sign-in s_[a-z2-7]{20}$/);
  await expect(page.locator('.card', { hasText: 'People' }).locator('.row')).toHaveCount(3);
});

test('a result over time, down to its raw FHIR', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await expect(page.locator('.person-head h1')).toHaveText('Robin Example');
  await openSection(page, 'Results');
  await page.getByRole('link', { name: /LDL cholesterol/ }).click();
  await expect(page.locator('svg.chart')).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(4);
  await page.locator('table a').first().click();
  await expect(page.locator('h2, h1').filter({ hasText: 'LDL cholesterol' }).first()).toBeVisible();
  await expect(page.getByText('Where it came from')).toBeVisible();
  await page.getByText('Show raw FHIR').click();
  await expect(page.locator('pre.json').last()).toContainText('"resourceType": "Observation"');
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/r\/r_[a-z2-7]{20}$/);
});

test('search finds words inside documents', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Search');
  await page.fill('input[type=search]', 'triglycerides');
  await expect(page.locator('.snippet')).toContainText('Triglycerides 99 mg/dL');
  await expect(page).toHaveURL(/\/search\?q=triglycerides$/);
});

test('every section of every person opens', async ({ page }) => {
  // 27 sections, several through the phone's More sheet.
  test.setTimeout(120_000);
  await page.goto('./?demo');
  for (const name of ['Robin Example', 'Sam Example', 'Alex Example']) {
    await page.goto('./?demo#/');
    await page.getByRole('link', { name: new RegExp(`^${name}`) }).first().click();
    for (const section of ['Timeline', 'Results', 'Medicines', 'Conditions', 'Allergies', 'Immunizations', 'Claims and bills', 'Documents', 'Imaging']) {
      await openSection(page, section);
    }
  }
});

test('a Huishouden link lands on the person', async ({ page }) => {
  await page.goto('./?demo#/hh/hh-demo-sam');
  await expect(page.locator('.person-head h1')).toHaveText('Sam Example');
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}$/);
});

test('Refresh asks the Mac and shows its answer', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  // The sample Mac names the request in its running attempt for 3 seconds.
  await expect(page.getByText(/the Mac is loading .+ for it now/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Last refresh request just now: needed a person/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
});

test('a request can be cancelled before the Mac takes it', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
});

test('section navigation fits the screen', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  if (isPhone(page)) {
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.locator('.section-tabs')).toBeHidden();
  } else {
    await expect(page.locator('.bottom-nav')).toBeHidden();
    await expect(page.locator('.section-tabs')).toBeVisible();
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('an unknown address says so', async ({ page }) => {
  await page.goto('./?demo#/nowhere');
  await expect(page.getByText(/not found|no such page/i).first()).toBeVisible();
});

test('without a client id, the app asks for one and offers the sample', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('input[aria-label="Google OAuth client id"]')).toBeVisible();
  await expect(page.getByRole('link', { name: /sample/i }).first()).toBeVisible();
  const stored = await page.evaluate(() => Object.keys(localStorage));
  expect(stored).toEqual([]);
});
