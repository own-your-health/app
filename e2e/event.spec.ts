import { expect, test, type Page } from '@playwright/test';
import { ALEX, eventId, itemId, ROBIN, SAM } from '../test/sample';
import { rewritten } from './alter';
import { lay } from './lay';

// What happened, one page per visit, over the sample. Sam's upper endoscopy
// is three claims from three providers, a bill and a paper to take home.

/** Sam's Health, from Where everyone stands on Home. */
async function openSam(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.locator('.stand-name').getByRole('link', { name: 'Sam' }).click();
  await expect(page).toHaveURL(new RegExp(`#/health\\?who=${SAM}$`));
}

async function openEndoscopy(page: Page) {
  await openSam(page);
  const happened = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^What happened$/ }) });
  // medrec makes a pharmacy fill an event of its own, from the pharmacy's record even without a claim.
  await expect(happened.locator('.row-title')).toHaveText(['Emtricitabine-tenofovir 200-300 mg tablet · Example Pharmacy', 'Office visit · Example Sexual Health Clinic', 'Famotidine 20 mg tablet · Example Pharmacy']);
  // Sam's own page shows Sam's private visit, marked.
  await expect(happened.locator('.row', { hasText: 'Clinic visit' }).locator('.chip')).toHaveText('Private');
  // The rest are in Sam's calendar.
  await happened.getByRole('link', { name: 'All 8 in the calendar' }).click();
  const row = page.locator('.cal-row', { hasText: 'Hospital visit' });
  await expect(row.locator('.row-title')).toHaveText('Hospital visit · Example Endoscopy Center');
  await expect(row.locator('.row-meta')).toHaveText('Upper endoscopy with biopsy');
  await expect(row.locator('.row-aside')).toHaveText('$213.90');
  await row.locator('a.row-main').click();
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/e/e_[a-z2-7]{20}$`));
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('a visit’s page says what happened, what it cost and whether it is paid, before any details', async ({ page }) => {
  await openEndoscopy(page);
  const head = page.locator('.event > section.card').first();
  await expect(head.locator('h1')).toHaveText('Hospital visit');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(head).toContainText('Sep 16, 2026 · Example Endoscopy Center · Sam');
  await expect(head.locator('.event-sources')).toHaveText(/Example Care Plan\s*3 claims\s*Drive\s*2 papers/);
  await expect(head).toContainText('You owe $213.90');
  await expect(head.locator('.event-settled')).toHaveText('$90.50 billed, due Nov 4, 2026 · $123.40 not billed yet');

  await expect(card(page, /^What happened$/)).toContainText('Diagnosis: Gastro-esophageal reflux disease without esophagitis (K21.9)');
  await expect(card(page, /^What happened$/)).toContainText('no portal record of this visit is in the folder');

  // The steps add up to what Sam owes, and say why.
  const price = card(page, 'How the price came down');
  await expect(price.locator('.event-step')).toHaveText([
    /Providers charged\s*\$3,380\.00/,
    /Network discount\s*−\$2,141\.00/,
    /Example Care Plan paid\s*−\$1,025\.10/,
    /You owe\s*\$213\.90/,
  ]);
  await expect(price).toContainText('Your share is coinsurance of $113.90, toward the deductible of $100.00.');

  // The line the plan left out is explained once, never owed.
  const changed = card(page, 'What Example Care Plan changed');
  await expect(changed).toContainText('Example Digestive Health billed “Upper endoscopy, look only” at $410.00.');
  await expect(changed).toContainText('B2 -- Included in the payment for another procedure of the same day.');
  await expect(page.locator('.event')).not.toContainText('$410.00 your share');

  // One row per provider, with a plain role: the hospital first, then who asks most.
  const who = card(page, 'Who charged what');
  await expect(who.locator('.row-title')).toHaveText(['Example Endoscopy Center', 'Example Digestive Health', 'Example Lab']);
  await expect(who.locator('.row').nth(1)).toContainText('Procedure');
  await expect(who.locator('.row').nth(1).locator('.row-aside')).toHaveText('$116.20');

  // Paid or not: the center's bill matches its claim, and the others' have not come.
  const bills = card(page, 'Bills and payments');
  await expect(bills.locator('.row')).toHaveText([/Bill from Example Endoscopy Center.*\$90\.50 due by Nov 4, 2026.*Matches the claim/]);
  await expect(bills).toContainText('No bill from Example Digestive Health filed yet, for the $116.20 its claim says you owe.');

  await expect(card(page, /^Papers$/).locator('.row-title')).toHaveText(['Statement from Example Endoscopy Center.pdf', 'After your upper endoscopy.pdf']);

  // How it was put together, and the claims themselves, wait folded.
  const folded = page.locator('details.tech');
  await expect(folded.locator('summary')).toHaveText(['How this visit was put together', 'Details']);
  for (const d of await folded.all()) await expect(d).not.toHaveAttribute('open', /.*/);
  await folded.nth(1).locator('summary').click();
  await expect(folded.nth(1)).toContainText('3 claims');
  await folded.nth(1).getByRole('link', { name: /^Biopsy read under a microscope/ }).click();
  await expect(page.locator('.event-part')).toHaveText('Part of Hospital visit, Sep 16, 2026');
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
  await expect(results.first()).toHaveText(/Total cholesterol\s*176 mg\/dL/);
  await results.first().getByRole('link', { name: 'Total cholesterol' }).click();
  await expect(page.locator('main h1')).toHaveText('Total cholesterol');
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

test('a bill with a receipt whose amount could not be read says so, and a fill is paid at pickup', async ({ page }) => {
  await lay(
    page,
    rewritten({}, ({ name, index, bills }) => {
      if (name !== 'Robin Example') return;
      for (const d of index.documents as { doc_type?: string; statement?: object }[]) if (d.doc_type === 'receipt') d.statement = { paid_on: '2025-04-20' };
      for (const b of Object.values(bills.bills)) if (b.amount_due === '51.18') Object.assign(b, { paid: [], paid_total: '0.00', left: '51.18', settled: false });
      Object.assign(bills, { receipts: [] });
    }),
  );
  await openRobinVisit(page, '2025-03-10');
  await expect(page.locator('.event-settled')).toHaveText('$51.18 billed · Receipt filed Apr 20, 2025; its amount could not be read');
  await expect(card(page, 'Bills and payments').locator('.row-meta')).toHaveText('$51.18 due by May 2, 2025 · Receipt filed Apr 20, 2025; its amount could not be read · a later statement has its balance');

  await openRobinVisit(page, '2026-11-07');
  // The fill is named for the pharmacy's record of the drug, not the claim's line.
  await expect(page.locator('.event h1')).toHaveText('Atorvastatin 20 mg tablet');
  await expect(page.locator('.event-settled')).toHaveText('A pharmacy takes your share when you pick up.');
  await expect(card(page, 'Bills and payments')).toHaveCount(0);
});

test('the page fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openEndoscopy(page);
  await page.locator('details.tech').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const colors = await page.locator('.event > section.card').first().evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(document.body).backgroundColor]);
  expect(colors[0]).not.toBe('rgb(255, 255, 255)');
  expect(colors[1]).not.toBe('rgb(255, 255, 255)');
});

test('an address naming any record of a visit opens the visit, under the visit’s own address', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  // The lab's claim, one of three in Sam's endoscopy.
  await page.goto(`./?demo#/p/${SAM}/e/${itemId(SAM, 'records', (r) => r.kind === 'claim' && r.date === '2026-09-16' && r.display!.includes('microscope'))}`);
  await expect(page.locator('.event h1')).toHaveText('Hospital visit');
  // The visit's own address is medrec's event id.
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/e/${eventId(SAM, '2026-09-16')}$`));
});

test('a link from when the redesign was behind ?next opens the same page, without ?next', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo&next#/p/${SAM}/e/${eventId(SAM, '2026-09-16')}`);
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
  await page.goto(`./?demo#/p/${ALEX}/e/${itemId(ALEX, 'records', (r) => r.kind === 'encounter' && r.date === '2026-01-12')}`);
  await expect(page.locator('.event h1')).toHaveText('Office visit');
  await expect(page.locator('.event-what')).toHaveText('Well-child checkup');
  await expect(page).toHaveURL(new RegExp(`#/p/${ALEX}/e/e_[a-z2-7]{20}$`));
  const tech = page.locator('details.tech', { has: page.locator('summary', { hasText: 'How this visit was put together' }) });
  await tech.locator('summary').first().click();
  await expect(tech.locator('.event-gap')).toHaveText('No insurer claim for this visit yet.');
  await expect(tech).toContainText('medrec grouped these by its matching rules.');

  // Settings says who grouped everyone's visits.
  await page.goto('./?demo#/settings');
  await expect(page.locator('dt', { hasText: 'Visits' }).locator('+ dd')).toHaveText('Grouped by medrec');
});
