import { expect, test } from '@playwright/test';

// With no service worker, an installed copy that comes back from the
// background still runs the build it opened with. Coming to the front, it
// asks the site for its page and says when that page names another build.

test('coming back to the front, the app says when the site has a newer build, and Reload loads it', async ({ page, baseURL }) => {
  await page.goto('./?demo');
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  const asked: string[] = [];
  // The site's page, as a deploy after this load would answer it.
  await page.route(`${baseURL}`, async (route) => {
    asked.push(route.request().url());
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/assets\/index-[\w-]+\.js/, 'assets/index-NEWBUILD.js') });
  });
  const front = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await front();
  const note = page.locator('.banner-update');
  await expect(note).toHaveText('A new version of the app is ready.Reload');
  await expect(note).toHaveAttribute('role', 'status');
  // Only the app's own page, without the address's query or hash.
  expect(asked).toEqual([baseURL]);
  await front();
  expect(asked).toHaveLength(1);

  await page.unroute(`${baseURL}`);
  await note.getByRole('button', { name: 'Reload' }).click();
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  await expect(note).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('?demo');
});

test('the same build says nothing', async ({ page }) => {
  await page.goto('./?demo');
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  const look = page.waitForRequest((r) => new URL(r.url()).pathname === '/app/' && r.resourceType() === 'fetch');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await (await look).response();
  await expect(page.locator('.banner-update')).toHaveCount(0);
});
