import { expect, test } from '@playwright/test';

// What a stranger given the bare link sees first: that a records folder made
// by medrec comes before the Google client, and where the guide is.

const GUIDE = 'https://github.com/own-your-health/app/blob/main/docs/getting-started.md';
const SITE = 'https://own-your-health.github.io/';
const REPO = 'https://github.com/own-your-health/app';
const CLIENT = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';

test('the welcome screen says what the app is, and links the project and its source', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Own Your Health');
  const intro = page.locator('.intro');
  await expect(intro.getByRole('heading', { level: 1 })).toHaveText('Your household’s health records, in your browser');
  await expect(intro).toContainText('Own Your Health is a free, open-source app for looking through your household’s health records');
  await expect(intro).toContainText('has no server');
  await expect(intro.getByRole('link', { name: 'About the project' })).toHaveAttribute('href', SITE);
  await expect(intro.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute('href', REPO);
  await expect(intro.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', './privacy.html');
  const footer = page.locator('.site-footer');
  await expect(footer.getByRole('link', { name: 'About Own Your Health' })).toHaveAttribute('href', SITE);
  await expect(footer.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', REPO);
});

test('the sign-in button is Google’s own, in the theme’s colours', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  await page.goto('./');
  await page.evaluate((id) => localStorage.setItem('own-your-health-app.client_id', id), CLIENT);
  const shown = async () => {
    const img = page.locator('.google-button img:visible');
    await expect(img).toHaveCount(1);
    return img.evaluate((i: HTMLImageElement) => ({ src: i.currentSrc.split('/').pop(), loaded: i.complete && i.naturalWidth > 0 }));
  };
  for (const [scheme, theme] of [
    ['light', 'light'],
    ['dark', 'dark'],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    const button = page.getByRole('button', { name: 'Sign in with Google' });
    await expect(button).toBeVisible();
    expect(await button.boundingBox()).toMatchObject({ width: 180, height: 40 });
    const img = await shown();
    expect(img.loaded).toBe(true);
    expect(img.src).toMatch(new RegExp(`^${theme}-[1-4]x\\.png$`));
  }
  // A theme chosen in Settings wins over the device's.
  await page.evaluate(() => localStorage.setItem('own-your-health-app.theme', 'light'));
  await page.reload();
  expect((await shown()).src).toMatch(/^light-/);
  expect(problems).toEqual([]);
});

test('the welcome screen says a medrec folder comes first, and links the guide', async ({ page }) => {
  await page.goto('./');
  const first = page.locator('.card', { hasText: 'First, a records folder' });
  await expect(first).toContainText('runs in a terminal on a Mac or a Linux computer');
  await expect(first.getByRole('link', { name: 'Getting started, from nothing to your records here' })).toHaveAttribute('href', GUIDE);
  await expect(first.getByRole('link', { name: 'medrec', exact: true })).toHaveAttribute('href', 'https://github.com/own-your-health/medrec-cli');
  const titles = await page.locator('main .card .card-head h2').allTextContents();
  expect(titles.indexOf('First, a records folder')).toBeLessThan(titles.indexOf('Your Google client'));
});
