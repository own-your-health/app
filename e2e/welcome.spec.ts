import { expect, test } from '@playwright/test';

// What a stranger given the bare link sees first: that a records folder made
// by medrec comes before the Google client, and where the guide is.

const GUIDE = 'https://github.com/own-your-health/app/blob/main/docs/getting-started.md';

test('the welcome screen says a medrec folder comes first, and links the guide', async ({ page }) => {
  await page.goto('./');
  const first = page.locator('.card', { hasText: 'First, a records folder' });
  await expect(first).toContainText('runs in a terminal on a Mac or a Linux computer');
  await expect(first.getByRole('link', { name: 'Getting started, from nothing to your records here' })).toHaveAttribute('href', GUIDE);
  await expect(first.getByRole('link', { name: 'medrec', exact: true })).toHaveAttribute('href', 'https://github.com/own-your-health/medrec-cli');
  const titles = await page.locator('main .card .card-head h2').allTextContents();
  expect(titles.indexOf('First, a records folder')).toBeLessThan(titles.indexOf('Your Google client'));
});
