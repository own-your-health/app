import { expect, test } from '@playwright/test';

// The privacy policy, as Google's review and a household open it: a page of
// its own, linked under the app and from Settings.

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

test('the welcome screen links the privacy policy, which loads in the app’s look', async ({ page }) => {
  await page.goto('./');
  await page.locator('.site-footer').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/app\/privacy\.html$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  await expect(page.locator('.app-bar .brand-name')).toHaveText('Own Your Health');
  // The app's stylesheet applied: the bar has its colour, not the default.
  expect(await page.locator('.app-bar').evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.getByRole('link', { name: 'Google API Services User Data Policy' })).toBeVisible();
});

test('Settings links the privacy policy', async ({ page }) => {
  await page.goto('./?demo#/settings');
  await expect(page.locator('.card', { hasText: 'What this app keeps and sends' }).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', './privacy.html');
});
