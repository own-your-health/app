import { expect, test, type Page } from '@playwright/test';

// What happened, one page per visit, over the sample. Sam's knee procedure
// is five claims from four providers, a bill and a paper to take home.

const SAM = 'p_wwezzed7kml67hnp6s7n';
const ROBIN = 'p_xo4em46i7yj3hphlpajo';

/** Sam's Health, from Where everyone stands on Home. */
async function openSam(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.locator('.stand-name').getByRole('link', { name: 'Sam' }).click();
  await expect(page).toHaveURL(new RegExp(`#/health\\?who=${SAM}$`));
}

async function openKnee(page: Page) {
  await openSam(page);
  const happened = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^What happened$/ }) });
  // medrec makes a pharmacy fill an event of its own, from the pharmacy's record even without a claim.
  await expect(happened.locator('.row-title')).toHaveText(['Nicotine 14 mg/24 hour patch · Example Pharmacy', 'Office visit · Example Counseling', 'Loratadine 10 mg tablet · Example Pharmacy']);
  // Sam's own page shows Sam's private visit, marked.
  await expect(happened.locator('.row', { hasText: 'Counseling session' }).locator('.chip')).toHaveText('Private');
  // The rest are in Sam's calendar.
  await happened.getByRole('link', { name: 'All 7 in the calendar' }).click();
  const knee = page.locator('.cal-row', { hasText: 'Hospital visit' });
  await expect(knee.locator('.row-title')).toHaveText('Hospital visit · Example Surgery Center');
  await expect(knee.locator('.row-meta')).toHaveText('Knee scope, one side and Antibiotic during surgery');
  await expect(knee.locator('.row-aside')).toHaveText('$287.50');
  await knee.locator('a.row-main').click();
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/e/e_[a-z2-7]{20}$`));
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('a visit’s page says what happened, what it cost and whether it is paid, before any details', async ({ page }) => {
  await openKnee(page);
  const head = page.locator('.event > section.card').first();
  await expect(head.locator('h1')).toHaveText('Hospital visit');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(head).toContainText('Aug 26, 2026 · Example Surgery Center · Sam');
  await expect(head.locator('.event-sources')).toHaveText(/Example Care Plan\s*5 claims\s*Drive\s*2 papers/);
  await expect(head).toContainText('You owe $287.50');
  await expect(head.locator('.event-settled')).toHaveText('$175.00 billed, due Oct 21, 2026 · $112.50 not billed yet');

  await expect(card(page, /^What happened$/)).toContainText('Diagnosis: Other tear of medial meniscus, current injury, right knee, initial encounter (S83.241A)');
  await expect(card(page, /^What happened$/)).toContainText('no portal record of this visit is in the folder');

  // The steps add up to what Sam owes, and say why.
  const price = card(page, 'How the price came down');
  await expect(price.locator('.event-step')).toHaveText([
    /Providers charged\s*\$5,818\.00/,
    /Network discount\s*−\$3,802\.30/,
    /Example Care Plan paid\s*−\$1,728\.20/,
    /You owe\s*\$287\.50/,
  ]);
  await expect(price).toContainText('Your share is a copay of $175.00, toward the deductible of $112.50.');

  // The line the plan left out is explained once, never owed.
  const changed = card(page, 'What Example Care Plan changed');
  await expect(changed).toContainText('Example Surgery Center billed “Knee scope, both sides” at $5,120.00.');
  await expect(changed).toContainText('C7 -- This service was paid under a different code than the one billed.');
  await expect(page.locator('.event')).not.toContainText('$5,120.00 your share');

  // One row per provider, with a plain role: the hospital first, then who asks most.
  const who = card(page, 'Who charged what');
  await expect(who.locator('.row-title')).toHaveText(['Example Surgery Center', 'Example Orthopedic Surgeons', 'Example Medical Supply', 'Example Imaging Partners']);
  await expect(who.locator('.row').nth(1)).toContainText('Procedure');
  await expect(who.locator('.row').nth(1).locator('.row-aside')).toHaveText('$112.50');

  // Paid or not: the surgery center's bill matches its claim, and the surgeon's has not come.
  const bills = card(page, 'Bills and payments');
  await expect(bills.locator('.row')).toHaveText([/Bill from Example Surgery Center.*\$175\.00 due by Oct 21, 2026.*Matches the claim/]);
  await expect(bills).toContainText('No bill from Example Orthopedic Surgeons filed yet, for the $112.50 its claim says you owe.');

  await expect(card(page, /^Papers$/).locator('.row-title')).toHaveText(['Statement from Example Surgery Center', 'Going home after knee surgery']);

  // How it was put together, and the claims themselves, wait folded.
  const folded = page.locator('details.tech');
  await expect(folded.locator('summary')).toHaveText(['How this visit was put together', 'Details']);
  for (const d of await folded.all()) await expect(d).not.toHaveAttribute('open', /.*/);
  await folded.nth(1).locator('summary').click();
  await expect(folded.nth(1)).toContainText('5 claims');
  await folded.nth(1).getByRole('link', { name: /^X-ray of the knee/ }).click();
  await expect(page.locator('.event-part')).toHaveText('Part of Hospital visit, Aug 26, 2026');
  await page.locator('.event-part a').click();
  await expect(page.locator('.event h1')).toHaveText('Hospital visit');
});

/** Robin's visit of a day (YYYY-MM-DD), from that day on Robin's calendar. */
async function openRobinVisit(page: Page, day: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo#/calendar?month=${day.slice(0, 7)}&day=${day}&who=${ROBIN}`);
  await page.locator('.cal-row a.row-main').first().click();
  await expect(page.locator('.event')).toBeVisible();
}

test('a visit the portal recorded leads with the portal’s own words and results, one line each', async ({ page }) => {
  await openRobinVisit(page, '2026-10-01');
  await expect(page.locator('.event h1')).toHaveText('Office visit');
  await expect(page.locator('.event-what')).toHaveText('Annual physical');
  await expect(page.locator('.event-settled')).toHaveText('$53.68 billed, due Nov 19, 2026');
  await expect(card(page, /^What happened$/)).toContainText('Annual physical');
  await expect(card(page, /^What happened$/)).toContainText('From the provider’s own records.');
  const results = card(page, /^Results$/).locator('li');
  await expect(results).toHaveCount(9);
  await expect(results.first()).toHaveText(/LDL cholesterol\s*104 mg\/dL/);
  await results.first().getByRole('link', { name: 'LDL cholesterol' }).click();
  await expect(page.locator('main h1')).toHaveText('LDL cholesterol');
});

test('a visit its portal names by a billing descriptor leads with its kind, says its reason, and keeps the descriptor for Details', async ({ page }) => {
  await openRobinVisit(page, '2025-03-10');
  await expect(page.locator('.event h1')).toHaveText('Office visit');
  await expect(page.locator('.event-what')).toHaveText('Annual physical');
  const happened = card(page, /^What happened$/);
  await expect(happened.locator('.row-title')).toHaveText(['Annual physical']);
  await expect(happened.locator('.row-meta')).toHaveText('with Dr. Jordan Sample · Example Health Main Clinic');
  // Nowhere but Details.
  await expect(page.locator('.event > :not(details.tech)', { hasText: 'YEARLY EXAM RETURNING ADULT' })).toHaveCount(0);
  const details = page.locator('details.tech', { has: page.locator('summary', { hasText: 'Details' }) });
  await details.locator('summary').click();
  await expect(details.locator('.event-descriptors li')).toHaveText(['YEARLY EXAM RETURNING ADULT']);
});

test('a bill with a receipt after it is paid, and a fill is paid at pickup', async ({ page }) => {
  await openRobinVisit(page, '2025-03-10');
  await expect(page.locator('.event-settled')).toHaveText('Paid');
  await expect(card(page, 'Bills and payments').locator('.row-meta')).toHaveText('$51.18 due by May 2, 2025 · paid, receipt Apr 20, 2025');

  await openRobinVisit(page, '2026-11-12');
  // The fill is named for the pharmacy's record of the drug, not the claim's line.
  await expect(page.locator('.event h1')).toHaveText('Lisinopril 10 mg tablet');
  await expect(page.locator('.event-settled')).toHaveText('A pharmacy takes your share when you pick up.');
  await expect(card(page, 'Bills and payments')).toHaveCount(0);
});

test('the page fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openKnee(page);
  await page.locator('details.tech').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const colors = await page.locator('.event > section.card').first().evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(document.body).backgroundColor]);
  expect(colors[0]).not.toBe('rgb(255, 255, 255)');
  expect(colors[1]).not.toBe('rgb(255, 255, 255)');
});

test('an address naming any record of a visit opens the visit, under the visit’s own address', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  // The imaging group's claim, one of five in Sam's knee procedure.
  await page.goto(`./?demo#/p/${SAM}/e/r_fbhlexithgaohaghqvwc`);
  await expect(page.locator('.event h1')).toHaveText('Hospital visit');
  // The visit's own address is medrec's event id.
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/e/e_ouknsy76ppd33msuv5du$`));
});

test('a link from when the redesign was behind ?next opens the same page, without ?next', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo&next#/p/${SAM}/e/r_se4qctpgoqorqqvlkebf`);
  await expect(page.locator('.event h1')).toHaveText('Hospital visit');
  expect(new URL(page.url()).search).toBe('?demo');
  await page.goto(`./?next&demo#/health`);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).search).toBe('?demo');
  // An address no visit has says so.
  await page.goto(`./?demo#/p/${SAM}/e/r_aaaaaaaaaaaaaaaaaaaa`);
  await expect(page.locator('main')).toContainText('This visit is not in these records.');
});

test('a visit says what medrec still expects for it, and that medrec grouped it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  // Alex's well-child visit: the portal's record, and no claim from the plan yet.
  await page.goto('./?demo#/p/p_bjpnvyvnmxv74q335tk4/e/r_jlaqcmc74llvhvsjt635');
  await expect(page.locator('.event h1')).toHaveText('Office visit');
  await expect(page.locator('.event-what')).toHaveText('Well child visit, 8 years');
  await expect(page).toHaveURL(/#\/p\/p_bjpnvyvnmxv74q335tk4\/e\/e_[a-z2-7]{20}$/);
  const tech = page.locator('details.tech', { has: page.locator('summary', { hasText: 'How this visit was put together' }) });
  await tech.locator('summary').first().click();
  await expect(tech.locator('.event-gap')).toHaveText('No insurer claim for this visit yet.');
  await expect(tech).toContainText('medrec grouped these by its matching rules.');

  // Settings says who grouped everyone's visits.
  await page.goto('./?demo#/settings');
  await expect(page.locator('dt', { hasText: 'Visits' }).locator('+ dd')).toHaveText('Grouped by medrec');
});
