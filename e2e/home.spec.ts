import { expect, test, type Page } from '@playwright/test';

// Home: what needs you, where everyone stands and what happened recently,
// with private items kept off it and shown on the person's own pages.

const SAM = 'p_wwezzed7kml67hnp6s7n';

async function open(page: Page, path = '') {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('home leads with what needs you, in order, and keeps private items off it', async ({ page }) => {
  await open(page);
  const needs = card(page, /^Needs you$/);
  await expect(needs.locator('.card-head')).toContainText('8 things');
  await expect(needs.locator('.need-kind')).toHaveText(['Worth a call', 'No payment on file', 'No payment on file', 'Bill to pay', 'Vaccine due', 'Refill', 'Coming up', 'Coming up']);
  await expect(needs.locator('.need-title')).toHaveText([
    'Lab tests, Jul 9, 2026',
    'Hospital visit, Aug 26, 2026',
    'Office visit, Oct 1, 2026',
    'Lab tests, Oct 3, 2026',
    'Flu, 2026–27 season',
    'Loratadine 10 mg tablet',
    '4-month vaccines',
    'Hepatitis B, dose 3',
  ]);
  await expect(needs.locator('.row').first()).toContainText('Example Billing asks $120.00; the visit’s claims say you owe $50.70');

  // The schedule's version and the court's stay are named; the private refill is counted, not named.
  await expect(needs).toContainText('CDC child schedule of Jul 2, 2025, restored after a court stayed the January 2026 changes on Mar 16, 2026.');
  await expect(needs).toContainText('1 private item is kept off Home. Each shows on its person’s own Health or Money.');
  await expect(page.locator('main')).not.toContainText('Nicotine');
  await expect(page.locator('main')).not.toContainText('Counseling');

  // Where everyone stands: one block per person.
  const stands = card(page, 'Where everyone stands');
  await expect(stands.locator('.stand-name')).toHaveText(['Robin', 'Sam', 'Alex', 'Jamie']);
  const sam = stands.locator('.stand', { hasText: 'Sam' });
  await expect(sam).toContainText('46 years old · last visit Oct 12, 2026 at Example Lab');
  await expect(sam.locator('.kv-row')).toHaveText(['To pay$295.00 in 2 bills, 1 worth a call', 'NextLoratadine 10 mg tablet runs out about Nov 24, 2026']);
  await expect(stands.locator('.stand', { hasText: 'Jamie' })).toContainText('3 months old');

  // A bill worth a call opens Worth a call; a bill to pay opens its visit.
  await needs.locator('.row').first().locator('a.row-main').click();
  await expect(page).toHaveURL(/#\/money\/calls\?bill=d_/);
  await expect(page.locator('.call.bill-picked')).toBeFocused();
  await expect(page.locator('.call.bill-picked .card-head h2')).toHaveText('Example Billing');
  await page.goBack();
  await needs.locator('.row').nth(1).locator('a.row-main').click();
  await expect(page.locator('.event h1')).toHaveText('Hospital visit');
});

test('a person’s own pages list their needs, private ones marked: refills on Health, bills on Money', async ({ page }) => {
  await open(page, `#/health?who=${SAM}`);
  const due = card(page, /^Due$/);
  await expect(due.locator('.need-title')).toHaveText(['Loratadine 10 mg tablet', 'Nicotine 14 mg/24 hour patch']);
  const refill = due.locator('.row', { hasText: 'Nicotine' });
  await expect(refill.locator('.row-meta')).toHaveText('Runs out about Nov 28, 2026 · 28 days filled Oct 31, 2026 at Example Pharmacy');
  await expect(refill.locator('.chip').first()).toHaveText('Private');
  await expect(page.locator('main')).not.toContainText('kept off Home');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Money' }).click();
  await page.getByRole('group', { name: 'Whose money' }).getByRole('link', { name: 'Sam' }).click();
  await expect(page).toHaveURL(new RegExp(`#/money\\?who=${SAM}$`));
  await expect(page.locator('main')).toContainText('1 bill ready to pay');
  await expect(page.locator('main')).toContainText('1 bill worth a call');

  // From Home, Jamie's Health lists the doses coming up.
  await open(page, '#/');
  await card(page, 'Where everyone stands').getByRole('link', { name: 'Jamie' }).click();
  await expect(card(page, /^Due$/).locator('.need-title')).toHaveText(['4-month vaccines', 'Hepatitis B, dose 3']);
});

test('home fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await expect(card(page, /^Needs you$/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
