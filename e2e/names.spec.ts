import { expect, test, type Page } from '@playwright/test';

// A condition or a claim's diagnosis in the source's words where they are
// plain, with its code's published title (medrec's code-names.json) in
// Details; by the title where the source's are billing words in capitals.

const SAM = 'p_wwezzed7kml67hnp6s7n';
const ROBIN = 'p_xo4em46i7yj3hphlpajo';
const ALEX = 'p_bjpnvyvnmxv74q335tk4';

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const field = (page: Page, label: string) => page.locator('main .kv-row', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');

/** The Details of a record's page, opened. */
async function details(page: Page) {
  await page.locator('details.tech > summary', { hasText: /^Technical details$/ }).click();
  await expect(card(page, /^The record$/)).toBeVisible();
}

test('a condition leads with the source’s words, and Details give its code’s title', async ({ page }) => {
  await open(page, `#/health?who=${ROBIN}`);
  const row = card(page, /^Current$/).locator('.row').first();
  await expect(row.locator('.row-title')).toHaveText('High blood pressure');
  await expect(row).not.toContainText('hypertension');
  await row.locator('a.row-main').click();
  await expect(page.locator('main h1').first()).toHaveText('High blood pressure');
  await expect(field(page, 'The code’s published title')).toBeHidden();
  await details(page);
  await expect(field(page, 'The code’s published title')).toHaveText('Essential (primary) hypertension');
  await expect(field(page, 'Name at the source')).toHaveText('High blood pressure');

  await open(page, `#/p/${ROBIN}/conditions`);
  await expect(page.locator('main .row-title')).toHaveText(['High blood pressure', 'Seasonal allergies']);
});

test('a title that says what the source says is not said again', async ({ page }) => {
  await open(page, `#/health?who=${SAM}`);
  await card(page, /^Current$/).locator('.row').first().locator('a.row-main').click();
  await expect(page.locator('main h1').first()).toHaveText('Vitamin D deficiency');
  await details(page);
  await expect(field(page, 'The code’s published title')).toHaveCount(0);
});

test('a claim’s diagnosis in capitals gives way to its code’s title, and Details keep it', async ({ page }) => {
  await open(page, `#/costs?period=all&only=person:${ROBIN}`);
  await card(page, /^\d+ claims$/).locator('.row', { hasText: 'Lisinopril 10 mg tablet, 90 days' }).first().locator('a.row-main').click();
  await expect(field(page, 'Diagnosis')).toHaveText('Essential (primary) hypertension (I10)');
  await expect(page.locator('main section.card').first()).not.toContainText('HYPERTENSION');
  await details(page);
  await expect(field(page, 'Diagnosis, in the claim’s words')).toHaveText('HYPERTENSION NOS (I10)');
  await expect(field(page, 'Diagnosis, by published title')).toHaveCount(0);
});

test('a visit gives its diagnosis in the portal’s words, with the title in Details', async ({ page }) => {
  await open(page, `#/calendar?view=list&who=${ALEX}`);
  await page.locator('main a', { hasText: 'Ear pain' }).first().click();
  await expect(card(page, /^What happened$/)).toContainText('Diagnosis: Ear infection');
  await page.locator('details.tech > summary', { hasText: /^Details$/ }).click();
  const recorded = page.locator('details.tech .row', { hasText: 'Ear infection' });
  await expect(recorded.locator('.row-title')).toHaveText('Ear infection');
  await expect(recorded.locator('.row-meta')).toHaveText('Condition · Otitis media, unspecified, unspecified ear');
});

test('the doctor’s sheet gives the source’s words, then the code and its title', async ({ page }) => {
  await open(page, `#/health/doctor?who=${ROBIN}`);
  await expect(page.locator('.sheet')).toContainText(/High blood pressure · ICD-10 I10, Essential \(primary\) hypertension · since Mar 10, 2025/);
});

test('names fit a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of [`#/health?who=${ROBIN}`, `#/p/${SAM}/conditions`, `#/health/doctor?who=${ALEX}`]) {
    await open(page, path);
    await expect(page.locator('main h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
