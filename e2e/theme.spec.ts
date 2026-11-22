import { expect, test, type Page } from '@playwright/test';

// The theme chosen in Settings: it applies at once, before the first paint
// on the next open (public/theme.js, without the app's script), and System
// gives the device back its own.

const LIGHT_PAGE = 'rgb(243, 245, 249)';
const DARK_PAGE = 'rgb(22, 28, 48)';

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

const pageColour = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const barColours = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content));

test('Light on a dark phone applies at once and on the next open, before the app runs', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./?demo#/settings');
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
  expect(await pageColour(page)).toBe(DARK_PAGE);

  await page.getByRole('radio', { name: 'Light' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await pageColour(page)).toBe(LIGHT_PAGE);
  expect(await barColours(page)).toEqual(['#121848', '#121848']);

  // The next open, with the app's own script blocked: theme.js alone sets it.
  await page.route(/\/assets\/index-[^/]+\.js$/, (r) => r.abort());
  problems = [];
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await pageColour(page)).toBe(LIGHT_PAGE);
  expect(await barColours(page)).toEqual(['#121848', '#121848']);
  problems = problems.filter((p) => !p.includes('net::ERR_FAILED'));
});

test('the focused theme option shows a ring that differs from its fill', async ({ page }) => {
  await page.goto('./?demo#/settings');
  await page.getByRole('radio', { name: 'System' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
  const span = page.locator('.choice', { hasText: 'Light' }).locator('span');
  const [ring, fill] = await span.evaluate((e) => [getComputedStyle(e).outlineColor, getComputedStyle(e).backgroundColor]);
  expect(await span.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
  expect(ring).not.toBe(fill);
});

test('Dark on a light phone, and System gives the device its own back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./?demo#/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  expect(await pageColour(page)).toBe(DARK_PAGE);
  expect(await barColours(page)).toEqual(['#1d2452', '#1d2452']);

  await page.getByRole('radio', { name: 'System' }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  expect(await pageColour(page)).toBe(LIGHT_PAGE);
  expect(await barColours(page)).toEqual(['#121848', '#1d2452']);
  expect(await page.evaluate(() => localStorage.getItem('own-your-health-app.theme'))).toBeNull();
});
