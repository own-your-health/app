import { expect, test, type Page } from '@playwright/test';

// Money: the year (its four figures, bills to act on, each
// person's deductible and out-of-pocket limit, the months, the biggest
// costs), each bill beside its claim, the bills worth a call with the words
// to say, where the money went, and private items kept off the shared view.

const SAM = 'p_wwezzed7kml67hnp6s7n';

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('bills sets each open bill beside its claim, then what is not billed yet and what is paid', async ({ page }) => {
  await open(page, '#/');
  await card(page, /^Needs you$/).getByRole('link', { name: 'Bills: each one beside its claim' }).click();
  await expect(page).toHaveURL(/#\/money\/bills$/);
  await expect(page.locator('main h1')).toHaveText('Bills');

  const hero = page.locator('.money-hero');
  await expect(hero.locator('.money-hero-number')).toHaveText('$247.96');
  await expect(hero).toContainText('3 bills, each asking what its claim says you owe. 1 more bill is worth a call first.');

  const due = card(page, 'Due now');
  await expect(due.locator('.row-title')).toHaveText(['Example Surgery Center', 'Example Health', 'Example Lab']);
  await expect(due.locator('.row').first().locator('.chip')).toHaveText(['Was due Oct 21, 2026', 'Matches the claim']);
  await expect(card(page, 'Check before paying').locator('.row-meta')).toHaveText('Sam · Lab tests, Jul 9, 2026 · asks $120.00; the visit’s claims say you owe $50.70');
  await card(page, 'Check before paying').locator('a.row-main').click();
  await expect(page.locator('.call.bill-picked')).toBeFocused();
  await page.goBack();
  await expect(card(page, 'Not billed yet').locator('.card-head')).toContainText('$289.20');
  await expect(card(page, 'Not billed yet').locator('.row-title')).toHaveText(['Example Pediatrics', 'Example Health', 'Example Lab', 'Example Orthopedic Surgeons', 'Example Health']);
  await expect(card(page, /^Paid$/).locator('.row-meta')).toHaveText('Robin · Office visit, Mar 10, 2025 · receipt Apr 20, 2025');
  // Sam's private counseling copay is not billed yet: off the shared view, counted.
  await expect(page.getByText('1 private item is kept off this shared view. Each shows on its person’s own Bills.')).toBeVisible();

  // One person's bills.
  await page.getByRole('group', { name: 'Whose money' }).getByRole('link', { name: 'Robin' }).click();
  await expect(page).toHaveURL(/#\/money\/bills\?who=/);
  await expect(card(page, 'Due now').locator('.row-title')).toHaveText(['Example Health', 'Example Lab']);
  await expect(card(page, 'Check before paying')).toHaveCount(0);
});

test('worth a call gives each bill the figures and the words to say', async ({ page }) => {
  await open(page, '#/money/bills');
  await page.locator('.money-hero').getByRole('link', { name: /worth a call first/ }).click();
  await expect(page).toHaveURL(/#\/money\/calls$/);
  await expect(page.locator('.money-hero .money-hero-number')).toHaveText('$69.30');

  const call = card(page, 'Example Billing');
  await expect(call.locator('.call-claim')).toHaveText('Asks $120.00. The visit’s claims say $50.70.');
  await expect(call.locator('.kv-row')).toHaveText([
    'WhoseSam',
    'VisitLab tests, Jul 9, 2026',
    'StatementAug 1, 2026 · account EX-000000 · was due Aug 31, 2026',
    'The claims say$50.70 to Example Lab',
    'The bill asks$120.00',
  ]);
  await expect(call.locator('.call-script')).toContainText('“I have a statement dated Aug 1, 2026 for $120.00, account EX-000000, for the visit on Jul 9, 2026. My plan’s claims for that visit say I owe $50.70 in all, to Example Lab.');

  // What the plan changed is explained, with nothing to do.
  await expect(card(page, 'Explained, nothing to do').locator('.row-title')).toHaveText(['Example Pediatrics, Nov 20, 2026', 'Example Surgery Center, Aug 26, 2026']);

  await call.getByRole('link', { name: 'Lab tests, Jul 9, 2026' }).click();
  await expect(page.locator('.event h1')).toHaveText('Lab tests');
  await page.locator('.card', { hasText: 'Bills and payments' }).getByRole('link', { name: 'All bills, beside their claims' }).click();
  await expect(page).toHaveURL(new RegExp(`#/money/bills\\?who=${SAM}$`));
  // On Sam's own Bills the private copay is listed, marked.
  const counseling = card(page, 'Not billed yet').locator('.row', { hasText: 'Example Counseling' });
  await expect(counseling.locator('.chip')).toHaveText('Private');
  await page.locator('main').getByRole('link', { name: 'Money', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/money\\?who=${SAM}$`));
});

test('the year: what care cost, the bills to act on, deductibles, the months and the biggest costs', async ({ page }) => {
  await open(page, '#/');
  const glance = card(page, /^Money$/);
  await expect(glance.locator('.glance-answer')).toHaveText('$581.46 your share this plan year');
  await glance.getByRole('link', { name: 'The year, the bills and the biggest costs' }).click();
  await expect(page).toHaveURL(/#\/money$/);
  await expect(page.locator('main h1')).toHaveText('Money');

  const hero = page.locator('.money-hero');
  await expect(hero.locator('.money-hero-label')).toHaveText('The household’s share of this plan year’s care');
  await expect(hero.locator('.money-hero-number')).toHaveText('$581.46');
  await expect(hero).toContainText('The plans’ figures, from 14 claims for care between Jul 9, 2026 and Nov 20, 2026.');
  await expect(hero.locator('.kv-row')).toHaveText(['Providers charged$7,456.00', 'The network took off$4,587.90', 'The plans paid$2,286.64', 'Your share$581.46']);
  await expect(hero.locator('.chip')).toHaveText('62% off what providers charged');
  await expect(hero).toContainText('Example Health Plan and Example Pharmacy Benefits run by calendar year here');

  const bills = card(page, /^Bills$/);
  await expect(bills.locator('.row-title')).toHaveText(['3 bills ready to pay', '1 bill worth a call', 'Not billed yet']);
  await expect(bills.locator('.row-aside')).toHaveText(['$247.96', '$69.30', '$289.20']);
  await bills.getByRole('link', { name: /1 bill worth a call/ }).click();
  await expect(page).toHaveURL(/#\/money\/calls$/);
  await page.goBack();

  const deductible = card(page, /^Deductible$/);
  await expect(deductible.locator('.row-title')).toHaveText(['Robin', 'Sam', 'Alex', 'Jamie']);
  await expect(deductible.locator('.row-aside')).toHaveText(['$1,120.40 of $1,500.00', '$233.50 of $750.00', '$0.00 of $750.00']);
  await expect(deductible.locator('.row').first()).toContainText('$379.60 to go. As of the claim for Oct 1, 2026. None of it comes from claims in these records.');
  await expect(deductible.locator('.row').last()).toContainText('No claims in this plan year yet.');
  // Sam's plan printed its balances last on the private counseling's claim: the shared view neither dates nor links it.
  await expect(deductible.locator('.row').nth(1)).toContainText('$516.50 to go. As of their plan’s newest claim.');
  await expect(deductible.locator('.row').nth(1).getByRole('link')).toHaveCount(0);
  await expect(card(page, /^Out-of-pocket limit$/).locator('.row-aside')).toHaveText(['$1,356.10 of $4,000.00', '$438.50 of $3,000.00', '$25.00 of $3,000.00']);

  // Totals count the private counseling; the biggest costs leave it off, counted.
  const biggest = card(page, /^Biggest costs$/);
  await expect(biggest.locator('.row-title')).toHaveText(['Hospital visit · Example Surgery Center', 'Office visit · Example Health Main Clinic', 'Office visit · Example Pediatrics', 'Office visit · Example Health Main Clinic', 'Lab tests · Example Lab']);
  await expect(biggest.locator('.row-aside').first()).toHaveText('$2,015.70');
  await expect(page.getByText('Totals and months count everyone’s care without naming any. 1 private item is kept off the lists on this shared view.')).toBeVisible();

  // A month of the chart opens it in the calendar.
  await page.locator('.cost-col[aria-label^="Aug 2026"]').click();
  await expect(page).toHaveURL(/#\/calendar\?month=2026-08$/);
  await page.goBack();

  await biggest.locator('a.row-main').first().click();
  await expect(page.locator('.event h1')).toContainText('Hospital visit');
  await page.goBack();

  // Last plan year: its own figures, and its own deductibles.
  await page.getByRole('group', { name: 'Which year' }).getByRole('link', { name: 'Last plan year' }).click();
  await expect(page).toHaveURL(/#\/money\?period=plan-1$/);
  await expect(hero.locator('.money-hero-label')).toHaveText('The household’s share of last plan year’s care');
  // A calendar year has no deductibles of its own.
  await page.getByRole('group', { name: 'Which year' }).getByRole('link', { name: '2025' }).click();
  await expect(card(page, /^Deductible$/)).toHaveCount(0);
  await expect(page.getByText('Deductibles and out-of-pocket limits run by plan year.')).toBeVisible();

  // On Sam's own year, the claim is dated and linked.
  await open(page, `#/money?who=${SAM}`);
  await expect(card(page, /^Deductible$/).getByRole('link', { name: 'the claim for Oct 27, 2026' })).toBeVisible();
});

test('where the money went lists every visit by price or by your share, fills as one line', async ({ page }) => {
  await open(page, '#/money');
  await page.getByRole('link', { name: 'Where the money went: all 9, by price, by your share or by what the network took off' }).click();
  await expect(page).toHaveURL(/#\/money\/events$/);
  await expect(page.locator('main h1')).toHaveText('Where the money went');
  const list = page.locator('.money-events');
  await expect(list.locator('.row-title')).toHaveText(['Hospital visit · Example Surgery Center', 'Office visit · Example Health Main Clinic', 'Office visit · Example Pediatrics', 'Office visit · Example Health Main Clinic', 'Lab tests · Example Lab', 'Lab tests · Example Lab', 'Lab tests · Example Lab', '2 prescription fills']);
  await expect(list.locator('.row').last().locator('.row-meta')).toHaveText('Example Pharmacy · paid at the counter');

  await page.getByRole('group', { name: 'Order by' }).getByRole('link', { name: 'Your share' }).click();
  await expect(page).toHaveURL(/#\/money\/events\?sort=share$/);
  await expect(list.locator('.row-aside').first()).toHaveText('$287.50');

  // Sam's own list has the private counseling, marked, and keeps the order.
  await page.getByRole('group', { name: 'Whose money' }).getByRole('link', { name: 'Sam' }).click();
  await expect(page).toHaveURL(new RegExp(`#/money/events\\?who=${SAM}&sort=share$`));
  const counseling = list.locator('.row', { hasText: 'Counseling session' });
  await expect(counseling.locator('.chip')).toHaveText('Private');
  await expect(counseling.locator('.row-aside')).toHaveText('$30.00');
});

test('the year shows where the network took off most, and the list orders every visit by it', async ({ page }) => {
  await open(page, '#/money');
  const cuts = card(page, /^Where the network took off most$/);
  await expect(cuts.locator('.row-title')).toHaveText(['Hospital visit · Example Surgery Center', 'Lab tests · Example Lab', 'Office visit · Example Health Main Clinic']);
  await expect(cuts.locator('.cost-off')).toHaveText(['$3,802.30 off $5,818.00 charged, 65%', '$177.70 off $248.00 charged, 72%', '$143.60 off $412.00 charged, 35%']);
  await expect(cuts.getByText('a provider in the plan’s network does not bill you the rest')).toBeVisible();

  await cuts.getByRole('link', { name: 'Every visit, by what the network took off' }).click();
  await expect(page).toHaveURL(/#\/money\/events\?sort=discount$/);
  await expect(page.getByRole('group', { name: 'Order by' }).getByRole('link', { name: 'Network discount' })).toHaveAttribute('aria-current', 'page');
  const list = page.locator('.money-events');
  await expect(list.locator('.row-aside')).toHaveText(['$3,802.30', '$177.70', '$143.60', '$123.60', '$93.70', '$69.30', '$67.50', /^\$/]);
  await expect(list.locator('.row').last().locator('.row-title')).toHaveText('2 prescription fills');
  await expect(list.locator('.row').last().locator('.cost-off')).toHaveText(/ off \$[\d.,]+ charged, \d+%$|^Nothing off the /);
});

test('Money fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['#/money', '#/money/bills', '#/money/calls', '#/money/events', '#/money/events?sort=discount']) {
    await open(page, path);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
