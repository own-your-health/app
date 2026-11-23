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

test('home leads with the people, and one line for the sign-in that needs a person', async ({ page }) => {
  await page.goto('./?demo');
  await expect(page.locator('.banner')).toContainText('Invented records');
  const people = page.locator('.card', { hasText: 'People' });
  await expect(people.locator('.row')).toHaveCount(4);
  await expect(people).toBeInViewport();
  // The people come first, then the one line, which carries no command or provider error.
  const notice = page.locator('.signin-notice');
  await expect(notice).toHaveText('Example Pediatrics needs a sign-in on the Mac');
  expect(await people.evaluate((el) => el.nextElementSibling?.classList.contains('signin-notice'))).toBe(true);
  await expect(page.locator('main .command')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('auth login');
  const strip = page.locator('.status-strip');
  await expect(strip).toContainText(/^Latest load \d+ hours? ago\./);
  await expect(strip).toContainText(/Last refresh request for .+ 3 hours ago: loaded/);
  // The failed load retries on its own, so home only counts it.
  await expect(strip).toContainText('1 source failed to load; the Mac tries again on its own.');
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
  // Only the people: every source is on Sources.
  await expect(page.locator('main .row')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Sources: a source needs attention' })).toBeVisible();

  // The line opens the source: a plain sentence and medrec's command, the provider's words folded away.
  await notice.getByRole('link').click();
  await expect(page).toHaveURL(/#\/s\/s_[a-z2-7]{20}$/);
  const lines = page.locator('.card .source-lines').first();
  await expect(lines).toContainText('The sign-in to Example Pediatrics has ended.');
  await expect(lines.locator('.command code')).toHaveText(/^medrec refresh sign-in s_[a-z2-7]{20}$/);
  const details = lines.locator('details.error-details');
  await expect(details.getByText(/athena auth login --profile/)).toBeHidden();
  await details.getByText('Error details').click();
  await expect(details.getByText(/athena auth login --profile/)).toBeVisible();
  await expect(details).toContainText('To sign in, run the medrec command above, not the tool’s own.');
  // medrec 0.7.0's own words lead; its remedy is the command above, so it is not said twice.
  await expect(details).toContainText('athena needs a sign-in: its export answered that the sign-in has ended');
  await expect(details).not.toContainText('on this machine');
  // The Mac's history folds each attempt's error too.
  const attempts = page.locator('.card', { hasText: 'Attempts' });
  await expect(attempts.locator('.row').first()).toBeVisible();
  await expect(attempts.getByText(/athena auth login --profile/)).toBeHidden();
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
  await expect(attention.locator('.row').first()).toContainText('The sign-in to Example Pediatrics has ended.');
  await expect(attention.locator('.row').nth(1)).toContainText(/The last try, 2 hours ago, failed\. The Mac tries again on its own\./);
  // The provider's own words are on the source's page, not in the list.
  await expect(attention).not.toContainText('503');
  await expect(attention).not.toContainText('auth login');
  const others = page.locator('.card', { hasText: 'Other sources' });
  // A sign-in nothing renews waits quietly among the others, with its command on its own page.
  const plan = others.locator('.row', { hasText: 'Example Health Plan' });
  await expect(plan.locator('.chip')).toHaveText('Waits for a sign-in');
  await expect(plan).toContainText('Loads when someone signs in on the Mac. A sign-in to Example Health Plan lasts about 30 minutes.');
  await expect(plan.locator('.command')).toHaveCount(0);
  // Where medrec has not measured how long a sign-in lasts, the row says only how the source loads.
  const blood = others.locator('.row', { hasText: 'Example Blood Center' });
  await expect(blood.locator('.chip')).toHaveText('Waits for a sign-in');
  await expect(blood).toContainText('Loads when someone signs in on the Mac.');
  await expect(blood).not.toContainText('lasts about');
  await expect(blood.locator('.command')).toHaveCount(0);
  await blood.locator('.row-main').click();
  await expect(page.locator('.card .source-lines').first().locator('.needs-person')).toContainText('To load it now, run this in a terminal on the Mac:');
  await expect(page.locator('.card .source-lines').first().locator('.command code')).toHaveText(/^medrec refresh sign-in s_[a-z2-7]{20}$/);
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  await page.goBack();
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
  await expect(visits.locator('.row').first()).toContainText('Nov 18, 2026 · Blood pressure follow-up');
  await expect(visits.locator('.row').first()).toContainText('1 document');
  await expect(visits.locator('.row').nth(1)).toContainText('Oct 1, 2026 · Annual physical');
  await expect(visits.locator('.row').nth(1)).toContainText('3 documents');

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

test('conditions, allergies and medicines read as lists naming their source', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Sam Example/ }).first().click();
  await expect(page.locator('.card', { hasText: 'Allergies' }).locator('.row')).toContainText('Peanuts');
  await expect(page.locator('.card', { hasText: 'Allergies' }).locator('.row .chip')).toHaveText('High risk');

  await openSection(page, 'Conditions');
  const active = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Active$/ }) });
  await expect(active.locator('.row')).toHaveText([/Vitamin D deficiency.*recorded Apr 2, 2026 · from Example Health/]);
  const ended = page.locator('.card', { hasText: 'Resolved or inactive' });
  await expect(ended.locator('.row')).toHaveText([/Right ankle sprain.*May 20, 2026 to Jul 1, 2026 · from Example Health/]);

  await openSection(page, 'Allergies');
  await expect(page.locator('main .card').first().locator('.row')).toHaveText([/Peanuts.*Hives, Swelling of the lips · high risk of a severe reaction · recorded Mar 1, 2001 · from Example Health/]);

  await openSection(page, 'Medicines');
  const past = page.locator('.card', { hasText: 'Past and other' });
  await expect(past.locator('.row')).toContainText('Ibuprofen 200 mg tablet');
  await expect(past.locator('.row')).toContainText('reported, not prescribed in these records');
  await expect(past.locator('.row .chip')).toHaveText('Completed');
});

test('a medicine shows its prescriber and last fill, and an inactive allergy and a declined dose stand apart', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Medicines');
  const active = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Active$/ }) });
  await expect(active.locator('.row')).toHaveText([
    /Lisinopril 10 mg tablet.*Take 1 tablet by mouth once a day · prescribed by Dr\. Jordan Sample · since Mar 12, 2025 · last filled Nov 12, 2026 at Example Pharmacy, 90 days · from Example Health/,
  ]);
  await expect(active.locator('.chip')).toHaveCount(0);
  await expect(page.locator('.card', { hasText: 'Past and other' }).locator('.row')).toHaveText([/Cetirizine 10 mg tablet.*Take 1 tablet daily as needed · recorded Apr 2, 2023 · from Example Health.*Stopped/]);

  await openSection(page, 'Allergies');
  await expect(page.locator('.card', { hasText: 'No longer active' }).locator('.row')).toHaveText([/Latex.*Inactive/]);

  await openSection(page, 'Immunizations');
  await expect(page.locator('.card', { hasText: 'Recorded as not given' }).locator('.row')).toHaveText([/COVID-19 vaccine.*Oct 4, 2025 · from Example Health/]);
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'Doses given' }) }).locator('.row', { hasText: 'COVID-19' })).toHaveCount(0);
});

test('each vaccine is listed once, with a link to every dose', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Alex Example/ }).first().click();
  await openSection(page, 'Immunizations');
  const doses = page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'Doses given' }) });
  const pcv = doses.locator('.row', { hasText: 'Pneumococcal conjugate PCV 13' });
  await expect(pcv).toContainText('4 doses, the last Jan 7, 2019 · from Example Pediatrics');
  await expect(pcv.locator('.dose-dates a')).toHaveText(['Mar 5, 2018', 'May 7, 2018', 'Jul 9, 2018', 'Jan 7, 2019']);
  await pcv.locator('.dose-dates a').first().click();
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/r\/r_[a-z2-7]{20}$/);
  await expect(page.locator('main')).toContainText('Mar 5, 2018');
});

test('bills say what is owed to each provider, and each claim sits beside its bill', async ({ page }) => {
  // Due dates are fixed in the sample, so the clock is too.
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Claims and bills');

  const owed = page.locator('.card', { hasText: 'Owed to each provider' });
  await expect(owed.locator('.glance-answer')).toHaveText('$72.96 due to 2 providers');
  await expect(owed.locator('.row-title')).toHaveText(['Example Health', 'Example Lab']);
  await expect(owed.locator('.row').first()).toContainText('statement Oct 20, 2026 · account ****0000 · due Nov 19, 2026');
  await expect(owed.locator('.row').first().locator('.chip')).toHaveText('Due date passed');
  await expect(owed.locator('.row').nth(1).locator('.chip')).toHaveCount(0);

  const plan = page.locator('.card', { hasText: 'Plan year so far' });
  await expect(plan.locator('.row').first()).toContainText('Deductible');
  await expect(plan.locator('.row').first()).toContainText('in network, individual · $1,120.40 of $1,500.00 used');
  await expect(plan.locator('progress').first()).toHaveAttribute('aria-label', 'Deductible, in network, individual: $1,120.40 of $1,500.00 used');

  const claims = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Claims$/ }) });
  const rows = claims.locator('.row');
  await expect(rows).toHaveCount(7);
  // Named for what was done, not "Professional".
  const fill = 'Lisinopril 10 mg tablet, 90 days';
  await expect(rows.locator('.row-title')).toHaveText(['Office visit', fill, 'Lipid panel and blood draw', 'Preventive visit, flu vaccine and 1 more', fill, 'Office visit', 'Office visit and blood count']);
  await expect(rows.nth(2).locator('.row-meta').first()).toHaveText('Oct 3, 2026 · Example Lab · by Example Health Plan');
  await expect(rows.nth(0)).toContainText('No bill from Example Health in these records within 120 days of the visit.');
  // A fill's share goes to the pharmacy, so no statement is looked for.
  await expect(rows.nth(1)).toContainText('Your share of a fill is paid to the pharmacy, usually when it is picked up or shipped, so no statement follows.');
  await expect(rows.nth(2)).toContainText('Billed on the statement of Oct 28, 2026: $19.28, your share.');
  await expect(rows.nth(3).locator('.totals')).toHaveText('Billed $412.00; Plan allowed $268.40; Plan paid $214.72; Your share $53.68');
  await expect(rows.nth(3)).toContainText('Your share is coinsurance $53.68.');
  await expect(rows.nth(3).getByRole('link', { name: 'Explanation of Benefits' })).toBeVisible();
  await expect(rows.nth(5)).toContainText('Nothing for you to pay on this claim.');
  await expect(rows.nth(6)).toContainText('Billed on the statement of Apr 2, 2025: $51.18, your share. A receipt was filed Apr 20, 2025.');

  // A claim's page lists its lines, each with its code, what kind of service it is, and its amounts.
  await rows.nth(2).locator('a.row-main').click();
  await expect(page.locator('main h1')).toHaveText('Lipid panel and blood draw');
  const lines = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^2 lines$/ }) });
  await expect(lines.locator('.row-title')).toHaveText(['Lipid panel', 'Blood draw']);
  await expect(lines.locator('.row-meta')).toHaveText(['80061 · Lab test · Oct 3, 2026', '36415 · Lab test · Oct 3, 2026']);
  await expect(lines.locator('.claim-amounts').first()).toHaveText('Billed $180.00 · Allowed $78.40 · Plan paid $62.72 · Deductible $0.00 · Coinsurance $15.68 · You owe $15.68');
  // A claim from before medrec linked claims: no diagnosis, no line links, and no visit that day at the lab.
  await expect(page.locator('main .kv-row dt', { hasText: /^Diagnos/ })).toHaveCount(0);
  await expect(page.locator('.claim-paid-for')).toHaveCount(0);
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Paid for$/ }) })).toHaveCount(0);
  await page.goBack();
  // Without medrec's link, the visit is the one of the same day from a matching provider.
  await rows.nth(0).locator('a.row-main').click();
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Paid for$/ }) }).locator('.row-title')).toHaveText(['Office visit']);
  await page.goBack();

  await rows.nth(3).getByRole('link', { name: 'statement of Oct 20, 2026' }).click();
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/r\/d_[a-z2-7]{20}$/);
  await expect(page.locator('main')).toContainText('Statement from Example Health');
});

/** A label's value in the page's key-value list. */
const field = (page: Page, label: string) => page.locator('main .kv-row', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
const paidFor = (page: Page) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Paid for$/ }) });

test('a claim medrec linked says what it paid for: the visit, the diagnosis and each line’s records', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Alex Example/ }).first().click();
  await openSection(page, 'Claims and bills');
  await page.locator('.row', { hasText: 'Office visit and strep test' }).locator('a.row-main').click();
  await expect(page.locator('main h1')).toHaveText('Office visit and strep test');
  await expect(field(page, 'Diagnosis')).toHaveText('Otitis media, unspecified, unspecified ear (H66.90)');
  await expect(paidFor(page).locator('.row-title')).toHaveText(['Sick visit']);
  await expect(paidFor(page).locator('.row-meta').first()).toContainText('Visit · Nov 20, 2026');
  const lines = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^2 lines$/ }) });
  await expect(lines.locator('.row-meta')).toHaveText(['99213 · Visit · Nov 20, 2026', '87880 · Lab test · Nov 20, 2026']);
  // The strep test's result is not in these records, so only the visit line links.
  await expect(lines.locator('.claim-paid-for')).toHaveText(['Paid for: Sick visit']);
  await lines.locator('.claim-paid-for').getByRole('link', { name: 'Sick visit' }).click();
  await expect(page.locator('main h1')).toHaveText('Sick visit');
});

test('a lab claim lists the results of its day once, a claim without the payer’s figure adds up your share, and a fill gives its discount', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Sam Example/ }).first().click();
  await openSection(page, 'Claims and bills');
  await page.locator('.row', { hasText: 'Blood count and vitamin D test' }).locator('a.row-main').click();
  await expect(page.locator('main h1')).toHaveText('Blood count and vitamin D test');
  await expect(page.locator('main .result-value').first()).toHaveText('You owe $70.30');
  await expect(field(page, 'Diagnosis')).toHaveText('Vitamin D deficiency, unspecified (E55.9)');
  // medrec links each lab line to every result and report of its day, from any source.
  await expect(paidFor(page).locator('.row-title')).toHaveText(['Vitamin D', 'Hemoglobin', 'White blood cells', 'Platelets']);
  await expect(paidFor(page).locator('.row-meta').nth(1)).toContainText('Result · Oct 12, 2026');
  // Both lines link the same results, so the card says it once.
  await expect(page.locator('.claim-paid-for')).toHaveCount(0);
  await page.goBack();
  // The payer gave the parts of the member's share but no figure for it.
  await page.locator('.row', { hasText: 'Thyroid test (TSH) and blood draw' }).locator('a.row-main').click();
  await expect(page.locator('main .result-value').first()).toHaveText('Your share $50.70');
  await expect(field(page, 'Your share comes from')).toHaveText('Deductible $50.70');

  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Claims and bills');
  await page.locator('.row', { hasText: 'Lisinopril 10 mg tablet, 90 days' }).first().locator('a.row-main').click();
  // medrec's name for it ends with the pharmacy, which the page shows apart.
  await expect(page.locator('main h1')).toHaveText('Lisinopril 10 mg tablet, 90 days');
  await expect(field(page, 'Billed')).toHaveText('$32.50');
  await expect(field(page, 'Discount')).toHaveText('$20.10');
  await expect(field(page, 'Diagnosis')).toHaveText('Essential (primary) hypertension (I10)');
  await expect(page.locator('.claim-amounts')).toHaveText(['Billed $32.50 · Discount $20.10 · Allowed $12.40 · Plan paid $2.40 · Deductible $0.00 · Copay $10.00 · Coinsurance $0.00 · You owe $10.00']);
  // medrec links visit and lab lines only.
  await expect(page.locator('.claim-paid-for')).toHaveCount(0);
});

test('a bill no claim matches is listed apart', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Sam Example/ }).first().click();
  await openSection(page, 'Claims and bills');
  await expect(page.locator('.card', { hasText: 'Owed to each provider' }).locator('.glance-answer')).toHaveText('$120.00 due to Example Billing');
  const others = page.locator('.card', { hasText: 'Other bills and receipts' });
  await expect(others.locator('.row')).toHaveText([/Statement from Example Billing.*no claim in these records matches it.*\$120\.00/]);
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
  // Where it came from is folded under Technical details, whole.
  await expect(page.getByText('Where it came from')).toBeHidden();
  await page.locator('details.tech > summary').click();
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

test('the timeline lists visits with their documents, and switches to every record', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Timeline');

  const tl = page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'Timeline' }) });
  await expect(tl.getByRole('link', { name: 'Visits' })).toHaveAttribute('aria-current', 'page');
  const rows = tl.locator('.row');
  await expect(rows).toHaveCount(5);
  // The day Robin's coverage changed sits among the visits, between Nov 18 and Oct 1.
  await expect(rows.nth(1)).toContainText('Coverage changed');
  await expect(rows.nth(1)).toContainText('Nov 8, 2026 · Example Health Plan, PPO Choice');
  await expect(rows.nth(1).locator('.coverage-born')).toHaveText('Changed on Nov 8, 2026, the day Jamie Example was born.');
  const october = rows.nth(2);
  await expect(october).toContainText('Oct 1, 2026 · Annual physical · Dr. Jordan Sample · Example Health Main Clinic');
  await expect(october).toContainText('3 documents');
  await expect(october.locator('.visit-docs li')).toHaveText(['After visit summary Visit summary', 'Lipid panel Lab report', 'Statement from Example Health Bill']);
  await expect(october.locator('.visit-line')).toHaveText([/^Results: LDL cholesterol · Glucose · .+ and 5 more$/, 'Vaccine: Influenza, seasonal, injectable', 'Claim: your share $53.68 from Example Health Plan']);
  await expect(rows.nth(3).locator('.visit-line').last()).toHaveText('Claim: nothing for you to pay from Example Health Plan');
  await expect(tl).toContainText('5 documents from no visit in these records (bills, scans, letters) are under Documents.');

  await october.getByRole('link', { name: 'Lipid panel' }).click();
  await expect(page.locator('.card-head h1')).toHaveText('Lipid panel');
  await page.goBack();

  await tl.getByRole('link', { name: 'Every record' }).click();
  await expect(page).toHaveURL(/\/timeline\/all$/);
  await expect(page.locator('.chips[role=group]').getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: 'Every record' })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page.getByRole('link', { name: 'Visits' })).toHaveAttribute('aria-current', 'page');
});

test('a visit’s page shows what belongs to it, a hand-filed note among them', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Alex Example/ }).first().click();
  await openSection(page, 'Timeline');
  const sick = page.locator('.row', { hasText: 'Sick visit' });
  await expect(sick).toContainText('Nov 20, 2026 · Office visit · Ear pain');
  await sick.locator('a.row-link, a').first().click();
  await expect(page.locator('.card-head h1').first()).toHaveText('Sick visit');
  const at = page.locator('.card', { hasText: 'At this visit' });
  await expect(at.locator('.visit-docs li')).toHaveText(['School note Letter']);
  await expect(at.locator('.visit-line')).toHaveText(['Diagnosis: Ear infection', 'Medicine: Amoxicillin 400 mg/5 mL suspension', 'Claim: your share $25.00 from Example Care Plan']);
});

test('a search starts reading the documents’ text before anything is typed, and reads it once', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/text.json')) reads.push(decodeURIComponent(r.url()));
  });
  await page.goto('./?demo');
  const field = page.getByRole('searchbox', { name: 'Search everyone’s records' });
  await expect(field).toBeVisible();
  expect(reads).toEqual([]);
  await field.focus();
  await expect.poll(() => reads.length).toBe(4);
  await field.fill('lisinopril');
  await field.press('Enter');
  await expect(page.locator('main p[aria-live]')).toHaveText(/matches/);
  expect(reads).toHaveLength(4);

  // A person's own search, on a fresh load, reads only theirs, as soon as it opens.
  await page.goto('about:blank');
  await page.goto('./?demo#/p/p_xo4em46i7yj3hphlpajo/search');
  await expect.poll(() => reads.filter((u) => u.includes('/Robin Example/')).length).toBe(2);
  expect(reads).toHaveLength(5);
});

test('one search over everyone, from the home screen, with filters by kind and person', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('searchbox', { name: 'Search everyone’s records' }).fill('lisinopril');
  await page.getByRole('searchbox', { name: 'Search everyone’s records' }).press('Enter');
  await expect(page).toHaveURL(/#\/search\?q=lisinopril$/);
  const results = page.locator('main .row');
  await expect(results.first()).toContainText('Robin Example');
  await expect(results.first().locator('mark').first()).toHaveText(/lisinopril/i);
  const kinds = page.getByRole('group', { name: 'Filter by kind' });
  // The two fills' claims name lisinopril on their lines.
  await expect(kinds.getByRole('button', { name: 'All 6' })).toHaveAttribute('aria-pressed', 'true');
  await expect(kinds.getByRole('button', { name: 'Claims 2' })).toBeVisible();
  await expect(page.locator('main p[aria-live]')).toHaveText('6 matches.');
  // By keyboard: the chip pressed keeps focus, and the status counts what is shown.
  await kinds.getByRole('button', { name: 'Documents 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(kinds.getByRole('button', { name: 'Documents 1' })).toBeFocused();
  await expect(kinds.getByRole('button', { name: 'Documents 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main p[aria-live]')).toHaveText('1 of 6 matches.');
  await expect(results).toHaveText([/After visit summary.*Robin Example.*in the document text.*continuing lisinopril/]);
  await expect(results.locator('.snippet mark')).toHaveText(['lisinopril']);
});

test('a kind the chosen person has none of falls back to All', async ({ page }) => {
  await page.goto('./?demo#/search?q=example');
  const kinds = page.getByRole('group', { name: 'Filter by kind' });
  await kinds.getByRole('button', { name: /^Claims \d+$/ }).click();
  await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Jamie Example' }).click();
  await expect(kinds.getByRole('button', { name: /^All \d+$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(kinds.getByRole('button', { name: /^Claims/ })).toHaveCount(0);
  await expect(page.locator('main .row').first()).toContainText('Jamie Example');
});

test('a refresh answer does not wipe what is being typed on the home screen', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  const field = page.getByRole('searchbox', { name: 'Search everyone’s records' });
  await field.fill('lisi');
  // The sample Mac takes the request after 3 seconds and answers 3 later; then nothing is pending and the poll stops.
  await page.waitForTimeout(8000);
  await expect(field).toHaveValue('lisi');
  await expect(field).toBeFocused();
  await expect(page.getByText(/Last refresh request just now/)).toHaveCount(0);
  // Leaving the field empty draws the answer the page held back.
  await field.fill('');
  await field.blur();
  await expect(page.locator('.status-strip')).toContainText(/Last refresh request just now: .*1 needed a person/, { timeout: 3000 });
});

test('search finds a field, says which, and narrows to one person', async ({ page }) => {
  await page.goto('./?demo#/search');
  const box = page.getByRole('searchbox', { name: 'Search' });
  await expect(box).toBeFocused();
  await box.fill('ear pain');
  const results = page.locator('main .row');
  await expect(page.locator('main h3.search-group')).toHaveText(['Visits (1)']);
  await expect(results).toHaveText([/Sick visit.*Alex Example · Nov 20, 2026 · in reason.*Reason: Ear pain/]);
  await expect(page).toHaveURL(/#\/search\?q=ear\+pain$/);

  await box.fill('weight');
  const people = page.getByRole('group', { name: 'Filter by person' });
  await expect(people.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true');
  await people.getByRole('button', { name: 'Jamie Example' }).click();
  await expect(results.first()).toBeVisible();
  for (const meta of await results.locator('.row-meta').allTextContents()) expect(meta).toContain('Jamie Example');
});

test('the app bar opens search from anywhere', async ({ page }) => {
  await page.goto('./?demo#/sources');
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/#\/search$/);
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeFocused();
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
  // Home's one line counts each outcome, and says when a source loaded too recently may load again.
  const answer = page.locator('.status-strip');
  await expect(answer).toContainText(/Last refresh request just now: .*1 needed a person/, { timeout: 15_000 });
  await expect(answer).not.toContainText('too soon');
  await expect(answer).not.toContainText('not due yet');
  // Asked again at once, what just loaded waits 15 minutes from that load (medrec 0.7.0).
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(answer).toContainText(/too soon after (its|their) last tr(y|ies)\b.*; next load allowed (at|tomorrow at) /, { timeout: 15_000 });
  // The load finished seconds ago, so the time shown is 14 or 15 minutes from now, as this browser writes times.
  const times = await page.evaluate(() => [14, 15].map((m) => new Date(Date.now() + m * 60_000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })));
  const text = (await answer.textContent()) ?? '';
  expect(times.some((t) => text.includes(`allowed at ${t}`) || text.includes(`allowed tomorrow at ${t}`))).toBe(true);
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

test('“blood tests” finds lab results by panel, each test once, and can search the words instead', async ({ page }) => {
  await page.goto('./?demo#/search?q=blood+tests');
  await expect(page.locator('.search-concept')).toContainText('Showing lab results.');
  await expect(page.locator('main h3.search-group').first()).toHaveText(/^Results \(\d+\)$/);
  await expect(page.locator('main h3.search-group')).not.toContainText(['Claims']);
  const ldl = page.locator('main .row', { hasText: 'LDL cholesterol' });
  await expect(ldl).toHaveCount(1);
  await expect(ldl.locator('.row-meta')).toHaveText('Robin Example · 104 mg/dL on Oct 1, 2026 · 4 results');
  await expect(page.locator('main h4.group-head', { hasText: 'Cholesterol (lipid panel)' })).toHaveCount(1);
  // A test found more than once opens its history.
  await ldl.locator('a.row-main').click();
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/results\//);
  await page.goBack();

  await page.getByRole('button', { name: 'Search for the words instead' }).click();
  await expect(page.locator('.search-concept')).toContainText('Showing every match for the words.');
  // The keyboard stays on the toggle, and the address keeps the choice.
  await expect(page.getByRole('button', { name: 'Show lab results instead' })).toBeFocused();
  await expect(page).toHaveURL(/#\/search\?q=blood\+tests&words=1$/);
  await page.reload();
  await expect(page.locator('.search-concept')).toContainText('Showing every match for the words.');
  await page.getByRole('button', { name: 'Show lab results instead' }).click();
  await expect(page.locator('.search-concept')).toContainText('Showing lab results.');
  await expect(page).toHaveURL(/#\/search\?q=blood\+tests$/);

  await page.getByRole('searchbox', { name: 'Search' }).fill('lab statement');
  await expect(page.locator('.search-concept')).toHaveText('No lab results with “statement”, so this is every match for the words.');
  await expect(page.locator('main .row', { hasText: 'Statement from Example Lab' })).toHaveCount(1);
});

test('bills finds claims and statements, records before claims, and a claim names its matching line', async ({ page }) => {
  await page.goto('./?demo#/search?q=bills');
  await expect(page.locator('.search-concept')).toContainText('Showing claims and bills.');
  await expect(page.locator('main h3.search-group')).toHaveText([/^Documents/, /^Claims/]);
  await expect(page.locator('main .row', { hasText: 'Lipid panel and blood draw' }).locator('.row-meta')).toHaveText('Robin Example · Oct 3, 2026 · Example Lab · you owe $19.28');

  await page.getByRole('searchbox', { name: 'Search' }).fill('blood draw');
  const claim = page.locator('main .row', { hasText: 'Lipid panel and blood draw' });
  await expect(claim.locator('.snippet')).toHaveText('Line: Blood draw (36415) · you owe $3.60');
  await expect(page.locator('.search-concept')).toHaveCount(0);
});

test('coverage over time: each insurer and plan, newest first, the same coverage from two sources once, a change on a birthday marked', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo');
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await openSection(page, 'Claims and bills');

  const coverage = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Coverage$/ }) });
  const rows = coverage.locator('.row');
  await expect(rows.locator('.row-title')).toHaveText(['Example Health Plan, PPO Choice', 'ExampleHealth Plan, PPO Choice']);
  await expect(rows.nth(0)).toContainText('since Nov 8, 2026');
  // The insurer's record and the portal's copy, spelled without the space, are one coverage.
  await expect(rows.nth(0)).toContainText('In records from Example Health Plan and Example Health.');
  await expect(rows.nth(0).locator('.coverage-born')).toHaveText('Changed on Nov 8, 2026, the day Jamie Example was born.');
  await expect(rows.nth(1)).toContainText('Jan 1, 2024 to Nov 7, 2026');
  await expect(rows.nth(1)).toContainText('In records from Example Health.');
  await expect(rows.nth(1).locator('.coverage-born')).toHaveCount(0);
  await expect(coverage).toContainText('A birthday beside a change is a date the two share. These records don’t say why coverage changed.');

  await rows.nth(0).getByRole('link', { name: 'Example Health Plan, PPO Choice' }).click();
  await expect(page.locator('.card-head h1')).toHaveText('Example Health Plan PPO');
});

test('costs say when a coverage changed inside the period shown', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto('./?demo#/costs');
  const note = page.locator('.cost-summary .coverage-note');
  await expect(note).toHaveText('Coverage changed in this period: Robin Example, Example Health Plan from Nov 8, 2026, the day Jamie Example was born.');
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '2025' }).click();
  await expect(page.locator('.cost-summary')).toBeVisible();
  await expect(note).toHaveCount(0);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '2026' }).click();
  await note.getByRole('link', { name: 'Robin Example' }).click();
  await expect(page).toHaveURL(/\/claims$/);
  await expect(page.locator('.card-head h2', { hasText: /^Coverage$/ })).toBeVisible();
});
