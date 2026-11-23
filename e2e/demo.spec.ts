import { expect, test, type Page } from '@playwright/test';

// The sample folder in demo mode, through the production build and its
// Content-Security-Policy. Any console error or policy violation fails.

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

async function openSection(page: Page, name: string) {
  if (isPhone(page)) {
    const nav = page.locator('.bottom-nav');
    await expect(nav).toBeVisible();
    if (BOTTOM.includes(name)) await nav.getByText(name, { exact: true }).click();
    else {
      await nav.getByText('More', { exact: true }).click();
      await page.locator('.sheet').getByText(name, { exact: true }).click();
      await expect(page.locator('.sheet')).toHaveCount(0);
    }
  } else {
    await page.locator('.section-tabs').getByText(name, { exact: true }).click();
  }
  const slug = SLUGS[name] ?? name.toLowerCase();
  await expect(page).toHaveURL(slug === 'overview' ? /#\/p\/[^/]+$/ : new RegExp(`#/p/[^/]+/${slug}(\\?.*)?$`));
  // The tabs are in the page at every size (hidden on phones); the current
  // one changes only once the section has rendered.
  await expect(page.locator('.section-tabs .tab-current')).toHaveText(name);
}

/** The sections the phone's bottom bar shows; the rest are under More. */
const BOTTOM = ['Overview', 'Results', 'Medicines', 'Timeline'];
const SLUGS: Record<string, string> = { 'Claims and bills': 'claims' };

test('home shows what needs a person, and leaves the sources to their screen', async ({ page }) => {
  await page.goto('./?demo');
  await expect(page.locator('.banner')).toContainText('Invented records');
  const alert = page.locator('.card-attention');
  await expect(alert.locator('.glance-answer')).toHaveText('1 sign-in needs a person');
  await expect(alert.locator('.row')).toHaveCount(1);
  await expect(alert).toContainText('Example Health Plan');
  await expect(alert.locator('.command code')).toHaveText(/^medrec refresh sign-in s_[a-z2-7]{20}$/);
  const strip = page.locator('.status-strip');
  await expect(strip).toContainText(/^Latest load \d+ hours? ago\./);
  await expect(strip).toContainText(/Last refresh request for .+ 3 hours ago: loaded/);
  // The failed load retries on its own, so home only counts it.
  await expect(strip).toContainText('1 source failed to load; the Mac tries again on its own.');
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'People' }).locator('.row')).toHaveCount(4);
  // The alert's row and the people: every other source is on Sources.
  await expect(page.locator('main .row')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Sources: a source needs attention' })).toBeVisible();
});

test('the Sources screen lists every source and sign-in, and opens one', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: 'Sources and sign-ins' }).click();
  await expect(page).toHaveURL(/#\/sources$/);
  await expect(page.locator('h1.glance-answer')).toHaveText('1 sign-in needs a person');
  await expect(page.locator('.glance')).toContainText('The Mac checked in');
  const attention = page.locator('.card-attention', { hasText: 'Needs attention' });
  await expect(attention.locator('.row')).toHaveCount(2);
  await expect(attention.locator('.row').first().locator('.command code')).toHaveText(/^medrec refresh sign-in s_[a-z2-7]{20}$/);
  await expect(attention.locator('.row').nth(1)).toContainText('The lab site answered 503 three times.');
  const others = page.locator('.card', { hasText: 'Other sources' });
  const total = await others.locator('.row').count();
  expect(total).toBeGreaterThanOrEqual(3);
  await others.locator('.row-main').first().click();
  await expect(page).toHaveURL(/#\/s\/s_[a-z2-7]{20}$/);
  await expect(page.locator('.card', { hasText: 'Attempts' })).toBeVisible();
  await page.getByRole('link', { name: 'All sources' }).click();
  await expect(page).toHaveURL(/#\/sources$/);
  // The app bar reaches it from anywhere.
  await page.goto('./?demo#/settings');
  await page.getByRole('link', { name: /^Sources/ }).first().click();
  await expect(page).toHaveURL(/#\/sources$/);
});

test('a person opens on what is current: new loads, results out of range first, and the rest', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}$/);
  await expect(page.locator('.section-tabs .tab-current')).toHaveText('Overview');

  const fresh = page.locator('.card', { hasText: 'New in the latest loads' });
  await expect(fresh.locator('.load-head')).toHaveText(/^Example Health, 3 hours ago: 2 records and 1 document$/);
  await expect(fresh.locator('.row')).toHaveCount(3);

  const results = page.locator('.card', { hasText: 'Latest results' });
  await expect(results).toContainText('The newest result of 1 test is out of its range.');
  await expect(results.locator('.row').first()).toContainText('Potassium');
  await expect(results.locator('.row').first().locator('.chip')).toHaveText('High');
  await expect(results.locator('.row').first()).toContainText('5.4 mmol/L');
  await expect(results.locator('.row').first()).toContainText('range 3.5-5.1 mmol/L');
  await expect(results.locator('.row .chip')).toHaveCount(1);

  const conditions = page.locator('.card', { hasText: 'Active conditions' });
  await expect(conditions.locator('.row')).toHaveCount(1);
  await expect(conditions.locator('.row')).toContainText('High blood pressure');
  await expect(conditions.locator('.row')).toContainText('Example Health');
  await expect(conditions.getByRole('link', { name: /All conditions, 1 past or inactive/ })).toBeVisible();

  await expect(page.locator('.card', { hasText: 'Current medicines' }).locator('.row')).toHaveText([/Lisinopril 10 mg tablet/]);
  await expect(page.locator('.card', { hasText: 'Allergies' }).locator('.row')).toHaveText([/Sulfa drugs.*Rash/]);
  await expect(page.locator('.card', { hasText: 'Immunizations' }).locator('.row').first()).toContainText('Influenza');
  const visits = page.locator('.card', { hasText: 'Recent visits' });
  await expect(visits.locator('.row').first()).toContainText('Annual physical');
  await expect(visits.locator('.row').first()).toContainText('1 document');

  // A card's link opens its whole section: 6 of Robin's 10 tests are shown here.
  await results.getByRole('link', { name: 'All 10 tests' }).click();
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/results$/);
});

test('a child’s overview shows the visit, condition and medicine loaded yesterday', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Alex Example/ }).first().click();
  const fresh = page.locator('.card', { hasText: 'New in the latest loads' });
  await expect(fresh.locator('.load-head')).toHaveText(/^Example Pediatrics, (1 day|\d+ hours) ago: 3 records and 1 document$/);
  await expect(page.locator('.card', { hasText: 'Active conditions' }).locator('.row')).toContainText('Ear infection');
  await expect(page.locator('.card', { hasText: 'Current medicines' }).locator('.row')).toContainText('Amoxicillin');
  await expect(page.locator('.card', { hasText: 'Allergies' })).toContainText('No allergies recorded in these records.');
  await expect(page.locator('.card', { hasText: 'Recent visits' }).locator('.row').first()).toContainText('Sick visit');
});

test('a newborn’s overview lists the doses the schedule has coming up', async ({ page }) => {
  // The sample's birth date and doses are fixed, so the clock is too.
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Jamie Example/ }).first().click();
  const card = page.locator('.card', { hasText: 'Immunizations' });
  const schedule = card.locator('.schedule');
  await expect(schedule.locator('.row').first()).toContainText('Hepatitis B');
  await expect(schedule.locator('.row').first()).toContainText('Dose 2 of 3, at 1–2 months, from Dec 8, 2026');
  await expect(schedule.locator('.row', { hasText: 'Coming up' })).toHaveCount(6);
  await expect(schedule.locator('.row', { hasText: 'Not in these records' })).toHaveCount(0);
  await expect(schedule.getByRole('link', { name: 'CDC child and adolescent immunization schedule' })).toHaveAttribute('href', 'https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent-age-compliant.html');
  await expect(card.locator('.row', { hasText: 'Hep B, adolescent or pediatric' })).toContainText('Nov 8, 2026');

  await card.getByRole('link', { name: 'Doses and the schedule' }).click();
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/immunizations$/);
  const full = page.locator('.card', { hasText: 'By the schedule' });
  await expect(full.locator('.row')).toHaveCount(12);
  await expect(full.locator('.row', { hasText: 'MMR' })).toContainText('0 of 2 doses in these records · next at 12–15 months, from Nov 8, 2027');
  await expect(full.locator('.row', { hasText: 'Rotavirus' })).toContainText('0 of 2 or 3 doses in these records');
  await expect(page.locator('.schedule')).toHaveCount(0);
});

test('a school-age child’s schedule shows only this season’s flu dose missing', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Alex Example/ }).first().click();
  const schedule = page.locator('.card', { hasText: 'Immunizations' }).locator('.schedule');
  await expect(schedule.locator('.row')).toHaveCount(1);
  await expect(schedule.locator('.row')).toContainText('Flu (influenza)');
  await expect(schedule.locator('.row')).toContainText('2026–27 season: dose 1 of 1');
  await expect(schedule.locator('.row .chip')).toHaveText('Not in these records');
  await openSection(page, 'Immunizations');
  const full = page.locator('.card', { hasText: 'By the schedule' });
  await expect(full.locator('.row', { hasText: 'All in these records' })).toHaveCount(9);
  await expect(full.locator('.row', { hasText: 'Rotavirus' })).toContainText('2 of 2 doses in these records');
});

test('an adult has no childhood schedule', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await expect(page.locator('.schedule')).toHaveCount(0);
});

test('results come by panel, the panel with an out-of-range result first', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Results');
  const panels = page.locator('main .card');
  await expect(panels.locator('.card-head h2')).toHaveText(['Metabolic panel', 'Cholesterol (lipid panel)', 'Blood sugar (A1c)', 'Blood count (CBC)']);
  const metabolic = panels.first();
  await expect(metabolic.locator('.card-head .chip')).toHaveText('1 out of range');
  await expect(metabolic.locator('.row-title')).toHaveText(['Potassium', 'Glucose', 'Creatinine', 'Sodium']);
  await expect(metabolic.locator('.row').first().locator('.chip')).toHaveText('High');
  await expect(metabolic.locator('.row').first()).toContainText('5.4 mmol/L on Nov 18, 2026 · range 3.5-5.1 mmol/L · 4 results');
  // Each test with two or more results draws a sparkline, hidden from screen readers.
  await expect(metabolic.locator('svg.spark')).toHaveCount(4);
  await expect(metabolic.locator('svg.spark').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(panels.nth(3).locator('.row .chip')).toHaveCount(0);

  // A test's page shades its range and links the rest of its panel.
  await metabolic.getByRole('link', { name: /Potassium/ }).click();
  await expect(page.locator('main .card-head h1')).toHaveText('Potassium');
  await expect(page.locator('main .card-head .chip')).toHaveText('High');
  await expect(page.locator('main')).toContainText('Metabolic panel · 4 results · mmol/L · range 3.5-5.1 mmol/L');
  await expect(page.locator('svg.chart rect.chart-band')).toHaveCount(1);
  await expect(page.locator('svg.chart')).toHaveAttribute('aria-label', /against the range 3\.5-5\.1 mmol\/L$/);
  await expect(page.locator('svg.chart circle.chart-dot-flag')).toHaveCount(1);
  await expect(page.locator('table tbody tr').first().locator('td').last()).toHaveText('High');
  await expect(page.locator('.card', { hasText: 'Also in Metabolic panel' }).locator('.row-title')).toHaveText(['Glucose', 'Creatinine', 'Sodium']);
});

test('a low result read from its range is flagged in its panel', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Sam Example/ }).first().click();
  await openSection(page, 'Results');
  const cbc = page.locator('main .card').first();
  await expect(cbc.locator('.card-head h2')).toHaveText('Blood count (CBC)');
  await expect(cbc.locator('.row').first()).toContainText('Hemoglobin');
  await expect(cbc.locator('.row').first().locator('.chip')).toHaveText('Low');
});

test('a result over time, down to its raw FHIR', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await expect(page.locator('.person-head h1')).toHaveText('Robin Example');
  await openSection(page, 'Results');
  await page.getByRole('link', { name: /LDL cholesterol/ }).click();
  await expect(page.locator('svg.chart')).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(4);
  await page.locator('table a').first().click();
  await expect(page.locator('h2, h1').filter({ hasText: 'LDL cholesterol' }).first()).toBeVisible();
  await expect(page.getByText('Where it came from')).toBeVisible();
  await page.getByText('Show raw FHIR').click();
  await expect(page.locator('pre.json').last()).toContainText('"resourceType": "Observation"');
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/r\/r_[a-z2-7]{20}$/);
});

test('search finds words inside documents', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Search');
  await page.fill('input[type=search]', 'fasting');
  await expect(page.locator('.snippet')).toContainText('Lipid panel, fasting 12 hours');
  await expect(page).toHaveURL(/\/search\?q=fasting$/);
});

test('every section of every person opens', async ({ page }) => {
  // 27 sections, several through the phone's More sheet.
  test.setTimeout(120_000);
  await page.goto('./?demo');
  for (const name of ['Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example']) {
    await page.goto('./?demo#/');
    await page.getByRole('link', { name: new RegExp(`^${name}`) }).first().click();
    for (const section of ['Timeline', 'Results', 'Medicines', 'Conditions', 'Allergies', 'Immunizations', 'Claims and bills', 'Documents', 'Imaging', 'Overview']) {
      await openSection(page, section);
    }
  }
});

test('a Huishouden link lands on the person', async ({ page }) => {
  await page.goto('./?demo#/hh/hh-demo-sam');
  await expect(page.locator('.person-head h1')).toHaveText('Sam Example');
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}$/);
});

test('Refresh asks the Mac and shows its answer', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  // The sample Mac names the request in its running attempt for 3 seconds.
  await expect(page.getByText(/the Mac is loading .+ for it now/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Last refresh request just now: needed a person/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
});

test('a request can be cancelled before the Mac takes it', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
});

test('section navigation fits the screen', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  if (isPhone(page)) {
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.locator('.section-tabs')).toBeHidden();
  } else {
    await expect(page.locator('.bottom-nav')).toBeHidden();
    await expect(page.locator('.section-tabs')).toBeVisible();
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('an unknown address says so', async ({ page }) => {
  await page.goto('./?demo#/nowhere');
  await expect(page.getByText(/not found|no such page/i).first()).toBeVisible();
});

test('without a client id, the app asks for one and offers the sample', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('input[aria-label="Google OAuth client id or setup link"]')).toBeVisible();
  await expect(page.getByRole('link', { name: /sample/i }).first()).toBeVisible();
  const stored = await page.evaluate(() => Object.keys(localStorage));
  expect(stored).toEqual([]);
});
