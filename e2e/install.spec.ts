import { expect, test } from '@playwright/test';

// Chrome's own verdict on the production build: the manifest parses, its
// icons load under the Content-Security-Policy, and the app can be
// installed. The same check as DevTools' Application panel.

test('the app can be installed', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  await page.goto('./');
  await expect(page.locator('input[aria-label="Google OAuth client id or setup link"]')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);

  const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[]; data?: string };
  expect(manifest.url).toMatch(/\/app\/manifest\.webmanifest$/);
  expect(manifest.errors).toEqual([]);

  const icons = (JSON.parse(manifest.data ?? '{}') as { icons?: { src: string }[] }).icons ?? [];
  expect(icons.length).toBeGreaterThanOrEqual(3);
  for (const src of [...icons.map((i) => new URL(i.src, manifest.url).href), new URL('apple-touch-icon.png', manifest.url).href]) {
    const res = await page.request.get(src);
    expect(res.status(), src).toBe(200);
    expect(res.headers()['content-type'], src).toBe('image/png');
  }

  // Chrome fetches the icons when asked; give it the moment it needs.
  await expect
    .poll(async () => ((await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] }).installabilityErrors.map((e) => e.errorId), {
      timeout: 10_000,
    })
    .toEqual([]);
  expect(problems).toEqual([]);
});
