import { expect, test, type Page } from '@playwright/test';

// Health under ?next: each person's standing on everyone's view, a person's
// page in the design's order (Due, Current, Worth noticing, Recently, Quiet),
// and the sheet to hand a doctor, with private items kept off shared views
// and off the sheet until included.

const SAM = 'p_wwezzed7kml67hnp6s7n';

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo&next${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('everyone’s Health gives each person’s standing and counts what it keeps private', async ({ page }) => {
  await open(page, '#/');
  await page.getByRole('link', { name: 'Health: what each person has now and what is worth a look' }).click();
  await expect(page).toHaveURL(/#\/health$/);
  await expect(page.locator('main h1')).toHaveText('Health');
  await expect(page.getByRole('group', { name: 'Whose health' }).getByRole('link')).toHaveText(['Everyone', 'Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example']);

  const sam = card(page, /^Sam Example$/);
  await expect(sam.locator('.card-head')).toContainText('Doctors’ records and claims');
  // Sam's private medicine and its refill are one private item, kept off.
  await expect(sam.locator('dd')).toHaveText(['1 item: Vitamin D3 2,000 unit capsule refill', '1 condition, 1 medicine, 1 allergy', 'Hemoglobin']);
  await expect(page.getByText('1 private item is kept off this shared view. Each shows on its person’s own Health.')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Sertraline');

  const jamie = card(page, /^Jamie Example$/);
  await expect(jamie.locator('.card-head')).toContainText('Doctors’ records only');
  await expect(jamie.locator('dd').first()).toHaveText('Nothing now. Next: Hepatitis B, dose 2 from Dec 8, 2026');

  await sam.getByRole('link', { name: 'Sam Example’s health' }).click();
  await expect(page).toHaveURL(new RegExp(`#/health\\?who=${SAM}$`));
});

test('a person’s page runs Due, Current, Worth noticing, Recently, then Quiet', async ({ page }) => {
  await open(page, `#/health?who=${SAM}`);
  await expect(page.locator('main .card-head h2')).toHaveText(['Due', 'Current', 'Worth noticing', 'What happened']);
  await expect(page.locator('.health-standing .chip')).toHaveText(['46 years old', 'Doctors’ records and claims']);

  // On Sam's own page the private medicine shows, marked, with its refill.
  const due = card(page, /^Due$/);
  await expect(due.locator('.need-title')).toHaveText(['Sertraline 50 mg tablet', 'Vitamin D3 2,000 unit capsule']);
  await expect(due.locator('.row').first()).toContainText('Private');

  const current = card(page, /^Current$/);
  await expect(current.locator('h3')).toHaveText(['Conditions', 'Medicines', 'Allergies']);
  await expect(current.locator('.row').first()).toContainText('Vitamin D deficiency');
  await expect(current.locator('.row').first()).toContainText('last recorded Apr 2, 2026 · from Example Health');
  await expect(current.locator('.row', { hasText: 'Vitamin D3' })).toContainText('prescribed by Dr. Casey Placeholder');

  const hemoglobin = card(page, /^Worth noticing$/).locator('.row');
  await expect(hemoglobin).toHaveCount(1);
  await expect(hemoglobin).toContainText('11.8 g/dL · Oct 12, 2026 · up from the result before');
  await expect(hemoglobin).toContainText('Below the lab’s range of 12–15.5 g/dL.');
  await expect(hemoglobin.locator('.chip')).toHaveText('Low');

  // Quiet counts what is not news and links to all of it.
  const quiet = page.locator('details.health-quiet');
  await expect(quiet.locator('summary')).toHaveText('Quiet: 6 items that are not news');
  await quiet.locator('summary').click();
  await quiet.getByRole('link', { name: /1 past or unconfirmed condition/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/conditions$`));
});

test('the doctor’s sheet leaves private items off until they are included', async ({ page }) => {
  await open(page, `#/health?who=${SAM}`);
  await page.getByRole('link', { name: 'Hand to a doctor' }).click();
  await expect(page).toHaveURL(new RegExp(`#/health/doctor\\?who=${SAM}$`));
  await expect(page.locator('main h1')).toHaveText('Sam Example');
  await expect(page.locator('.sheet h2')).toHaveText(['Allergies', 'Medicines', 'Problems', 'Vaccines', 'Labs, last two years', 'Vital signs, last two years', 'Care team']);

  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Peanuts · Hives, Swelling of the lips · criticality high');
  await expect(sheet).toContainText('Vitamin D deficiency · ICD-10 E55.9 · since Apr 2, 2026');
  await expect(sheet.locator('tbody tr').first().locator('td')).toHaveText(['Hemoglobin', '11.8 g/dL (low)', '12–15.5 g/dL', 'Oct 12, 2026']);
  await expect(sheet).not.toContainText('Sertraline');
  await expect(sheet).not.toContainText('Dr. Morgan Placeholder');
  await expect(page.locator('.sheet-private')).toContainText('2 private items are left off. This is discretion, not security: the files stay readable in the shared Drive folder.');

  await page.getByRole('button', { name: 'Include 2 private items' }).click();
  await expect(page.getByRole('button', { name: 'Leave private items off' })).toBeFocused();
  await expect(sheet.locator('.sheet-section', { hasText: 'Medicines' }).locator('li')).toHaveText([/^Sertraline 50 mg tablet/, /^Vitamin D3 2,000 unit capsule/]);
  await expect(sheet).toContainText('Dr. Morgan Placeholder');

  // Leaving the sheet leaves them off again.
  await page.getByRole('link', { name: 'Health', exact: true }).click();
  await page.getByRole('link', { name: 'Hand to a doctor' }).click();
  await expect(page.getByRole('button', { name: 'Include 2 private items' })).toBeVisible();
  await expect(page.locator('.sheet')).not.toContainText('Sertraline');

  // Printed, the sheet stands alone: no app bar, no chips, no note about private items.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-bar')).toBeHidden();
  await expect(page.locator('.sheet-private')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(page.locator('.sheet')).toBeVisible();
});

test('Health asks for ?next', async ({ page }) => {
  await page.goto('./?demo#/health');
  await expect(page.getByText('Health is part of the redesign. Add ?next to the address to try it.')).toBeVisible();
});

test('Health fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['#/health', `#/health?who=${SAM}`, `#/health/doctor?who=${SAM}`]) {
    await open(page, path);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
