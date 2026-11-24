import { expect, test, type Page } from '@playwright/test';

// Home under ?next: what needs you, where everyone stands and what happened
// recently, with private items kept off it and shown on the person's own page.

const SAM = 'p_wwezzed7kml67hnp6s7n';

async function open(page: Page, path = '') {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo&next${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('home leads with what needs you, in order, and keeps private items off it', async ({ page }) => {
  await open(page);
  const needs = card(page, /^Needs you$/);
  await expect(needs.locator('.card-head')).toContainText('8 things');
  await expect(needs.locator('.need-kind')).toHaveText(['Worth a call', 'No payment on file', 'No payment on file', 'Bill to pay', 'Vaccine due', 'Refill', 'Coming up', 'Coming up']);
  await expect(needs.locator('.need-title')).toHaveText([
    'Lab tests, Jul 9, 2026',
    'Emergency room, Sep 12–13, 2026',
    'Office visit, Oct 1, 2026',
    'Lab tests, Oct 3, 2026',
    'Flu, 2026–27 season',
    'Vitamin D3 2,000 unit capsule',
    'Hepatitis B, dose 2',
    '2-month vaccines',
  ]);
  await expect(needs.locator('.row').first()).toContainText('Example Billing asks $120.00; the visit’s claims say you owe $50.70');

  // The schedule's version and the court's stay are named; the private refill is counted, not named.
  await expect(needs).toContainText('CDC child schedule of Jul 2, 2025, restored after a court stayed the January 2026 changes on Mar 16, 2026.');
  await expect(needs).toContainText('1 private item is kept off Home. Each shows on its person’s own overview.');
  await expect(page.locator('main')).not.toContainText('Sertraline');
  await expect(page.locator('main')).not.toContainText('Counseling');

  // Where everyone stands: one block per person.
  const stands = card(page, 'Where everyone stands');
  await expect(stands.locator('.stand-name')).toHaveText(['Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example']);
  const sam = stands.locator('.stand', { hasText: 'Sam Example' });
  await expect(sam).toContainText('46 years old · last visit Oct 12, 2026 at Example Lab');
  await expect(sam.locator('.kv-row')).toHaveText(['To pay$370.00 in 2 bills, 1 worth a call', 'NextVitamin D3 2,000 unit capsule runs out about Nov 28, 2026']);
  await expect(stands.locator('.stand', { hasText: 'Jamie Example' })).toContainText('2 weeks old');

  // A bill worth a call opens its visit.
  await needs.locator('.row').first().locator('a.row-main').click();
  await expect(page.locator('.event h1')).toHaveText('Lab tests');
});

test('a person’s overview lists their own needs, private ones marked', async ({ page }) => {
  await open(page, `#/p/${SAM}`);
  const needs = card(page, /^Needs you$/);
  await expect(needs.locator('.need-title')).toHaveText(['Lab tests, Jul 9, 2026', 'Emergency room, Sep 12–13, 2026', 'Sertraline 50 mg tablet', 'Vitamin D3 2,000 unit capsule']);
  const refill = needs.locator('.row', { hasText: 'Sertraline' });
  await expect(refill.locator('.row-meta')).toHaveText('Runs out about Nov 27, 2026 · 30 days filled Oct 28, 2026 at Example Pharmacy');
  await expect(refill.locator('.chip').first()).toHaveText('Private');
  await expect(needs).not.toContainText('kept off Home');

  // From Home, Jamie's overview lists the doses coming up.
  await page.goto('./?demo&next#/');
  await card(page, 'Where everyone stands').getByRole('link', { name: 'Jamie Example' }).click();
  await expect(card(page, /^Needs you$/).locator('.need-title')).toHaveText(['Hepatitis B, dose 2', '2-month vaccines']);
});

test('home fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await expect(card(page, /^Needs you$/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('without ?next home has no Needs you', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo#/');
  await expect(card(page, /^Needs you$/)).toHaveCount(0);
  await expect(card(page, 'Where everyone stands')).toHaveCount(0);
  await page.goto(`./?demo#/p/${SAM}`);
  await expect(card(page, /^Needs you$/)).toHaveCount(0);
});
