import { expect, test, type Page } from '@playwright/test';

// The redesign, behind ?next: what happened, one page per visit, over the
// sample. Sam's night in the emergency room is five claims from four
// providers, a bill and a discharge paper.

const SAM = 'p_wwezzed7kml67hnp6s7n';

async function openSam(page: Page, next = true) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(next ? './?demo&next' : './?demo');
  await page.getByRole('link', { name: /^Sam Example/ }).first().click();
  await expect(page.locator('.person-head h1')).toHaveText('Sam Example');
}

async function openEmergency(page: Page) {
  await openSam(page);
  const happened = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^What happened$/ }) });
  await expect(happened.locator('.row-title')).toHaveText(['Counseling session', 'Lab tests', 'Emergency room · overnight', 'Lab tests', 'Sports medicine visit']);
  // Sam's own page shows Sam's private visit, marked.
  await expect(happened.locator('.row', { hasText: 'Counseling session' }).locator('.chip')).toHaveText('Private');
  const er = happened.locator('.row', { hasText: 'Emergency room · overnight' });
  await expect(er.locator('.row-meta')).toHaveText('Sep 12–13, 2026 · Example General Hospital');
  await expect(er.locator('.row-aside')).toHaveText('$346.40');
  await er.locator('a.row-main').click();
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/e/r_[a-z2-7]{20}$`));
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('a visit’s page says what happened, what it cost and whether it is paid, before any details', async ({ page }) => {
  await openEmergency(page);
  const head = page.locator('.event > section.card').first();
  await expect(head.locator('h1')).toHaveText('Emergency room · overnight');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(head).toContainText('Sep 12–13, 2026 · Example General Hospital · Sam Example');
  await expect(head.locator('.event-sources')).toHaveText(/Example Care Plan\s*5 claims\s*Drive\s*2 papers/);
  await expect(head).toContainText('You owe $346.40');
  await expect(head.locator('.event-settled')).toHaveText('$250.00 billed, due Oct 28, 2026 · $96.40 not billed yet');

  await expect(card(page, /^What happened$/)).toContainText('Diagnosis: Chest pain, unspecified (R07.9)');
  await expect(card(page, /^What happened$/)).toContainText('no portal record of this visit is in the folder');

  // The steps add up to what Sam owes, and say why.
  const price = card(page, 'How the price came down');
  await expect(price.locator('.event-step')).toHaveText([
    /Providers charged\s*\$4,779\.00/,
    /Network discount\s*−\$3,395\.80/,
    /Example Care Plan paid\s*−\$1,036\.80/,
    /You owe\s*\$346\.40/,
  ]);
  await expect(price).toContainText('Your share is a copay of $250.00, toward the deductible of $96.40.');

  // The line the plan left out is explained once, never owed.
  const changed = card(page, 'What Example Care Plan changed');
  await expect(changed).toContainText('Example General Hospital billed “Emergency visit, high severity” at $4,200.00.');
  await expect(changed).toContainText('C7 -- This service was paid under a different code than the one billed.');
  await expect(page.locator('.event')).not.toContainText('$4,200.00 your share');

  // One row per provider, with a plain role: the hospital first, then who asks most.
  const who = card(page, 'Who charged what');
  await expect(who.locator('.row-title')).toHaveText(['Example General Hospital', 'Example Emergency Physicians', 'Example Lab', 'Example Radiology Associates']);
  await expect(who.locator('.row').nth(1)).toContainText('Emergency doctor');
  await expect(who.locator('.row').nth(1).locator('.row-aside')).toHaveText('$96.40');

  // Paid or not: the hospital's bill matches its claim, and the doctor's has not come.
  const bills = card(page, 'Bills and payments');
  await expect(bills.locator('.row')).toHaveText([/Bill from Example General Hospital.*\$250\.00 due by Oct 28, 2026.*Matches the claim/]);
  await expect(bills).toContainText('No bill from Example Emergency Physicians filed yet, for the $96.40 its claim says you owe.');

  await expect(card(page, /^Papers$/).locator('.row-title')).toHaveText(['Emergency department discharge instructions', 'Statement from Example General Hospital']);

  // How it was put together, and the claims themselves, wait folded.
  const folded = page.locator('details.tech');
  await expect(folded.locator('summary')).toHaveText(['How this visit was put together', 'Details']);
  for (const d of await folded.all()) await expect(d).not.toHaveAttribute('open', /.*/);
  await folded.nth(1).locator('summary').click();
  await expect(folded.nth(1)).toContainText('5 claims');
  await folded.nth(1).getByRole('link', { name: /^Chest X-ray, 2 views/ }).click();
  await expect(page.locator('.event-part')).toHaveText('Part of Emergency room · overnight, Sep 12–13, 2026');
  await page.locator('.event-part a').click();
  await expect(page.locator('.event h1')).toHaveText('Emergency room · overnight');
});

async function openRobinVisit(page: Page, when: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo&next');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await card(page, /^What happened$/).locator('.row', { hasText: when }).first().locator('a.row-main').click();
  await expect(page.locator('.event')).toBeVisible();
}

test('a visit the portal recorded leads with the portal’s own words and results, one line each', async ({ page }) => {
  await openRobinVisit(page, 'Oct 1, 2026');
  await expect(page.locator('.event h1')).toHaveText('Office visit');
  await expect(page.locator('.event-settled')).toHaveText('$53.68 billed, due Nov 19, 2026');
  await expect(card(page, /^What happened$/)).toContainText('Annual physical');
  await expect(card(page, /^What happened$/)).toContainText('From the provider’s own records.');
  const results = card(page, /^Results$/).locator('li');
  await expect(results).toHaveCount(9);
  await expect(results.first()).toHaveText(/LDL cholesterol\s*104 mg\/dL/);
  await results.first().getByRole('link', { name: 'LDL cholesterol' }).click();
  await expect(page.locator('main h1')).toHaveText('LDL cholesterol');
});

test('a bill with a receipt after it is paid, and a fill is paid at pickup', async ({ page }) => {
  await openRobinVisit(page, 'Mar 10, 2025');
  await expect(page.locator('.event-settled')).toHaveText('Paid');
  await expect(card(page, 'Bills and payments').locator('.row-meta')).toHaveText('$51.18 due by May 2, 2025 · paid, receipt Apr 20, 2025');

  await openRobinVisit(page, 'Nov 12, 2026');
  await expect(page.locator('.event h1')).toHaveText('Lisinopril 10 mg tablet, 90 days');
  await expect(page.locator('.event-settled')).toHaveText('A pharmacy takes your share when you pick up.');
  await expect(card(page, 'Bills and payments')).toHaveCount(0);
});

test('the page fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openEmergency(page);
  await page.locator('details.tech').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const colors = await page.locator('.event > section.card').first().evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(document.body).backgroundColor]);
  expect(colors[0]).not.toBe('rgb(255, 255, 255)');
  expect(colors[1]).not.toBe('rgb(255, 255, 255)');
});

test('an address naming any record of a visit opens the visit, under the visit’s own address', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  // The radiologist's claim, one of five in Sam's emergency room visit.
  await page.goto(`./?demo&next#/p/${SAM}/e/r_fbhlexithgaohaghqvwc`);
  await expect(page.locator('.event h1')).toHaveText('Emergency room · overnight');
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/e/r_se4qctpgoqorqqvlkebf$`));
});

test('without ?next the app is as it was, and a visit’s address says how to see it', async ({ page }) => {
  await openSam(page, false);
  await expect(page.locator('.card-head h2', { hasText: /^What happened$/ })).toHaveCount(0);
  await page.goto(`./?demo#/p/${SAM}/e/r_aaaaaaaaaaaaaaaaaaaa`);
  await expect(page.locator('main .card-head h2')).toHaveText('Page not found');
  await expect(page.locator('main')).toContainText('Visit pages are part of the redesign. Add ?next to the address to try it.');
});
