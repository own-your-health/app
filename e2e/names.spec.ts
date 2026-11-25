import { expect, test, type Page } from '@playwright/test';

// A condition's and a claim diagnosis's code by its published name (medrec's
// code-names.json), first, with the source's own words kept.

const SAM = 'p_wwezzed7kml67hnp6s7n';
const ROBIN = 'p_xo4em46i7yj3hphlpajo';
const ALEX = 'p_bjpnvyvnmxv74q335tk4';

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const field = (page: Page, label: string) => page.locator('main .kv-row', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');

test('a condition leads with its code’s name, and says how it was recorded', async ({ page }) => {
  await open(page, `#/health?who=${ROBIN}`);
  const row = card(page, /^Current$/).locator('.row').first();
  await expect(row.locator('.row-title')).toHaveText('Essential (primary) hypertension');
  await expect(row.locator('.row-meta')).toContainText('recorded as “High blood pressure” · ');
  await row.locator('a.row-main').click();
  await expect(page.locator('main h1').first()).toHaveText('Essential (primary) hypertension');
  await expect(field(page, 'Recorded as')).toHaveText('High blood pressure');

  await open(page, `#/p/${ROBIN}/conditions`);
  await expect(page.locator('main .row-title')).toHaveText(['Essential (primary) hypertension', 'Other seasonal allergic rhinitis']);
  await expect(page.locator('main .row-meta').last()).toContainText('recorded as “Seasonal allergies”');
});

test('a name that says what the source says is not said twice', async ({ page }) => {
  await open(page, `#/health?who=${SAM}`);
  const row = card(page, /^Current$/).locator('.row').first();
  await expect(row.locator('.row-title')).toHaveText('Vitamin D deficiency');
  await expect(row.locator('.row-meta')).not.toContainText('recorded as');
});

test('a claim’s page names its diagnosis, and keeps the claim’s words for it', async ({ page }) => {
  await open(page, `#/costs?period=all&only=person:${ROBIN}`);
  await card(page, /^\d+ claims$/).locator('.row', { hasText: 'Lisinopril 10 mg tablet, 90 days' }).first().locator('a.row-main').click();
  await expect(field(page, 'Diagnosis')).toHaveText('Essential (primary) hypertension (I10)');
  await expect(field(page, 'In the claim’s words')).toHaveText('Hypertension NOS (I10)');
});

test('a visit names its diagnosis, with the portal’s words for it in Details', async ({ page }) => {
  await open(page, `#/calendar?view=list&who=${ALEX}`);
  await page.locator('main a', { hasText: 'Ear pain' }).first().click();
  await expect(card(page, /^What happened$/)).toContainText('Diagnosis: Otitis media, unspecified, unspecified ear');
  await page.locator('details.tech > summary', { hasText: /^Details$/ }).click();
  const recorded = page.locator('details.tech .row', { hasText: 'Ear infection' });
  await expect(recorded.locator('.row-title')).toHaveText('Ear infection');
  await expect(recorded.locator('.row-meta')).toHaveText('Condition · Otitis media, unspecified, unspecified ear');
});

test('the doctor’s sheet gives the name, how it was recorded and the code', async ({ page }) => {
  await open(page, `#/health/doctor?who=${ROBIN}`);
  await expect(page.locator('.sheet')).toContainText(/Essential \(primary\) hypertension · recorded as “High blood pressure” · ICD-10 I10 · since Mar 10, 2025/);
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
