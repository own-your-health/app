import { expect, test, type Page } from '@playwright/test';

// The redesign's tabs (?next): Home, Calendar, Money, Health and Papers, at
// the bottom of a phone's screen and above the page from 640px, with the
// current part marked. A person's own pages keep their section tabs.

const SAM = 'p_wwezzed7kml67hnp6s7n';
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo&next${path}`);
}

test('the tabs lead to each part of the app and mark the one shown', async ({ page }) => {
  await open(page, '#/');
  await expect(tabs(page).getByRole('link')).toHaveText(['Home', 'Calendar', 'Money', 'Health', 'Papers']);
  await expect(tabs(page).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  for (const [name, url] of [['Calendar', /#\/calendar$/], ['Money', /#\/money$/], ['Health', /#\/health$/], ['Papers', /#\/papers$/]] as const) {
    await tabs(page).getByRole('link', { name }).click();
    await expect(page).toHaveURL(url);
    await expect(tabs(page).locator('[aria-current="page"]')).toHaveText(name);
  }
  // A part's own pages keep its tab: Money's bills, Health's sheet for a doctor.
  await open(page, `#/health/doctor?who=${SAM}`);
  await expect(tabs(page).locator('[aria-current="page"]')).toHaveText('Health');
  // A visit belongs to no one tab.
  await open(page, `#/p/${SAM}/e/r_fbhlexithgaohaghqvwc`);
  await expect(page.locator('.event h1')).toBeVisible();
  await expect(tabs(page).locator('[aria-current="page"]')).toHaveCount(0);
});

test('a person’s own pages keep their section tabs, and the app without ?next has none', async ({ page }) => {
  await open(page, `#/p/${SAM}`);
  await expect(page.locator('.person-head h1')).toHaveText('Sam Example');
  await expect(tabs(page)).toHaveCount(0);
  await page.goto('./?demo#/');
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
});

test('on a 360px phone the tabs sit at the bottom, over nothing the page needs', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, '#/papers');
  const bar = await tabs(page).boundingBox();
  expect(bar!.y + bar!.height).toBeCloseTo(780, 0);
  expect(bar!.width).toBe(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  // Scrolled to the end, the page's last line clears the tabs.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = await page.locator('main > *').last().boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y);
  for (const link of await tabs(page).getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
});

test('from 640px the tabs are a row above the page', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await open(page, '#/money');
  const bar = (await tabs(page).boundingBox())!;
  const main = (await page.locator('main').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(main.y + 1);
  await expect(tabs(page).getByRole('link', { name: 'Money' })).toHaveAttribute('aria-current', 'page');
});

test('a printed page leaves the tabs off', async ({ page }) => {
  await open(page, '#/health');
  await page.emulateMedia({ media: 'print' });
  await expect(tabs(page)).toBeHidden();
});
