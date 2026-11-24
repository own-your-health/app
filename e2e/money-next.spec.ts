import { expect, test, type Page } from '@playwright/test';

// Money under ?next, bills first: each bill beside its claim, the bills worth
// a call with the words to say, and private bills kept off the shared view.

const SAM = 'p_wwezzed7kml67hnp6s7n';

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo&next${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('bills sets each open bill beside its claim, then what is not billed yet and what is paid', async ({ page }) => {
  await open(page, '#/');
  await card(page, /^Needs you$/).getByRole('link', { name: 'Bills: each one beside its claim' }).click();
  await expect(page).toHaveURL(/#\/money$/);
  await expect(page.locator('main h1')).toHaveText('Bills');

  const hero = page.locator('.money-hero');
  await expect(hero.locator('.money-hero-number')).toHaveText('$322.96');
  await expect(hero).toContainText('3 bills, each asking what its claim says you owe. 1 more bill is worth a call first.');

  const due = card(page, 'Due now');
  await expect(due.locator('.row-title')).toHaveText(['Example General Hospital', 'Example Health', 'Example Lab']);
  await expect(due.locator('.row').first().locator('.chip')).toHaveText(['Was due Oct 28, 2026', 'Matches the claim']);
  await expect(card(page, 'Check before paying').locator('.row-meta')).toHaveText('Sam Example · Lab tests, Jul 9, 2026 · asks $120.00; the visit’s claims say you owe $50.70');
  await card(page, 'Check before paying').locator('a.row-main').click();
  await expect(page.locator('.call.bill-picked')).toBeFocused();
  await page.goBack();
  await expect(card(page, 'Not billed yet').locator('.card-head')).toContainText('$273.10');
  await expect(card(page, 'Not billed yet').locator('.row-title')).toHaveText(['Example Pediatrics', 'Example Health', 'Example Lab', 'Example Emergency Physicians', 'Example Health']);
  await expect(card(page, /^Paid$/).locator('.row-meta')).toHaveText('Robin Example · Office visit, Mar 10, 2025 · receipt Apr 20, 2025');

  // One person's bills.
  await page.getByRole('group', { name: 'Whose bills' }).getByRole('link', { name: 'Robin Example' }).click();
  await expect(page).toHaveURL(/#\/money\?who=/);
  await expect(card(page, 'Due now').locator('.row-title')).toHaveText(['Example Health', 'Example Lab']);
  await expect(card(page, 'Check before paying')).toHaveCount(0);
});

test('worth a call gives each bill the figures and the words to say', async ({ page }) => {
  await open(page, '#/money');
  await page.locator('.money-hero').getByRole('link', { name: /worth a call first/ }).click();
  await expect(page).toHaveURL(/#\/money\/calls$/);
  await expect(page.locator('.money-hero .money-hero-number')).toHaveText('$69.30');

  const call = card(page, 'Example Billing');
  await expect(call.locator('.call-claim')).toHaveText('Asks $120.00. The visit’s claims say $50.70.');
  await expect(call.locator('.kv-row')).toHaveText([
    'WhoseSam Example',
    'VisitLab tests, Jul 9, 2026',
    'StatementAug 1, 2026 · account EX-000000 · was due Aug 31, 2026',
    'The claims say$50.70 to Example Lab',
    'The bill asks$120.00',
  ]);
  await expect(call.locator('.call-script')).toContainText('“I have a statement dated Aug 1, 2026 for $120.00, account EX-000000, for the visit on Jul 9, 2026. My plan’s claims for that visit say I owe $50.70 in all, to Example Lab.');

  // What the plan changed is explained, with nothing to do.
  await expect(card(page, 'Explained, nothing to do').locator('.row-title')).toHaveText(['Example Pediatrics, Nov 20, 2026', 'Example General Hospital, Sep 12–13, 2026']);

  await call.getByRole('link', { name: 'Lab tests, Jul 9, 2026' }).click();
  await expect(page.locator('.event h1')).toHaveText('Lab tests');
  await page.locator('.card', { hasText: 'Bills and payments' }).getByRole('link', { name: 'All bills, beside their claims' }).click();
  await expect(page).toHaveURL(new RegExp(`#/money\\?who=${SAM}$`));
});

test('bills fit a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['#/money', '#/money/calls']) {
    await open(page, path);
    await expect(page.locator('.money-hero')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});

test('without ?next there are no bills pages', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo#/money');
  await expect(page.locator('main .card-head h2')).toHaveText('Page not found');
});
