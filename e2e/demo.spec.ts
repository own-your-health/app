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

const PEOPLE: Record<string, string> = {
  'Robin': 'p_xo4em46i7yj3hphlpajo',
  'Sam': 'p_wwezzed7kml67hnp6s7n',
  'Alex': 'p_bjpnvyvnmxv74q335tk4',
  'Jamie': 'p_skrlw3od3nik2hkngezu',
};

/** One of a person's full lists (results, medicines…), at the address Health's links open. */
async function openList(page: Page, person: string, list: string) {
  await page.goto(`./?demo#/p/${PEOPLE[person]}/${list}`);
  await expect(page.locator('main h1')).toHaveText(`${person}’s ${list}`);
}

/** A claim's page, from every claim of the person's on the claims screen. */
async function openClaim(page: Page, person: string, title: string) {
  await page.goto(`./?demo#/costs?period=all&only=person:${PEOPLE[person]}`);
  await claimRow(page, title).locator('a.row-main').click();
  await expect(page.locator('main h1')).toHaveText(title);
}

/** A claim's row in the claims screen's list of claims, newest first. */
const claimRow = (page: Page, title: string) =>
  page
    .locator('.card', { has: page.locator('.card-head h2', { hasText: /^\d+ claims?$/ }) })
    .locator('.row')
    .filter({ has: page.locator('.row-title').getByText(title, { exact: true }) })
    .first();

/** Opens the bar's menu. */
async function openMenu(page: Page) {
  await page.getByRole('button', { name: /^Menu/ }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
}

test('home says which sign-in needs a person, in one line that opens the source', async ({ page }) => {
  await page.goto('./?demo');
  await expect(page.locator('.banner')).toContainText('Invented records');
  // The line carries no command or provider error.
  const notice = page.locator('.signin-notice');
  await expect(notice).toHaveText('Example Pediatrics needs a sign-in on the Mac');
  await expect(page.locator('main .command')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('auth login');
  const strip = page.locator('.status-strip');
  await expect(strip).toContainText(/^Latest load \d+ hours? ago\./);
  await expect(strip).toContainText(/Last refresh request for .+ 3 hours ago: loaded/);
  // The failed load retries on its own, so home only counts it.
  await expect(strip).toContainText('1 source failed to load; the Mac tries again on its own.');
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
  // The bar's menu carries the dot.
  await expect(page.getByRole('button', { name: 'Menu: a source needs attention' })).toBeVisible();

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
  // Its provider said nothing, so the details are medrec's words alone, not passed off as the provider's.
  const own = page.locator('.card .source-lines').first().locator('details.error-details');
  await own.getByText('Error details').click();
  await expect(own).toContainText('oneblood needs a sign-in: its export answered that the sign-in has ended');
  await expect(own).not.toContainText('What the provider’s tool reported');
  await expect(own).not.toContainText('on this machine');
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  await page.goBack();
  const total = await others.locator('.row').count();
  expect(total).toBeGreaterThanOrEqual(3);
  await others.locator('.row-main').first().click();
  await expect(page).toHaveURL(/#\/s\/s_[a-z2-7]{20}$/);
  await expect(page.locator('.card', { hasText: 'Attempts' })).toBeVisible();
  await page.getByRole('link', { name: 'All sources' }).click();
  await expect(page).toHaveURL(/#\/sources$/);
  // The bar's menu reaches it from anywhere.
  await page.goto('./?demo#/settings');
  await openMenu(page);
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: /^Sources/ }).click();
  await expect(page).toHaveURL(/#\/sources$/);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
});

test('a person’s old address opens their Health, and its lists still open', async ({ page }) => {
  await page.goto(`./?demo#/p/${PEOPLE['Robin']}`);
  await expect(page).toHaveURL(new RegExp(`#/health\\?who=${PEOPLE['Robin']}$`));
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main')).toContainText('Potassium');
  // A list keeps its address, under Health's tab, and leads back to the person's Health.
  await openList(page, 'Robin', 'results');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Robin’s health' }).click();
  await expect(page).toHaveURL(new RegExp(`#/health\\?who=${PEOPLE['Robin']}$`));
});

test('a newborn’s immunizations list the schedule’s doses, those coming up first', async ({ page }) => {
  // The sample's birth date and doses are fixed, so the clock is too.
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await openList(page, 'Jamie', 'immunizations');
  const full = page.locator('.card', { hasText: 'By the schedule' });
  await expect(full.locator('.row')).toHaveCount(12);
  await expect(full.locator('.row').first()).toContainText('Hepatitis B');
  await expect(full.locator('.row').first()).toContainText('1 of 3 doses in these records · next at 1–2 months, from Dec 8, 2026');
  await expect(full.locator('.row', { hasText: 'Coming up' })).toHaveCount(6);
  await expect(full.locator('.row', { hasText: 'Not in these records' })).toHaveCount(0);
  await expect(full.locator('.row', { hasText: 'MMR' })).toContainText('0 of 2 doses in these records · next at 12–15 months, from Nov 8, 2027');
  await expect(full.locator('.row', { hasText: 'Rotavirus' })).toContainText('0 of 2 or 3 doses in these records');
  await expect(full.getByRole('link', { name: 'CDC child and adolescent immunization schedule' })).toHaveAttribute('href', 'https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent-age-compliant.html');
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'Doses given' }) }).locator('.row', { hasText: 'Hep B, adolescent or pediatric' })).toContainText('Nov 8, 2026');
});

test('a school-age child’s schedule shows only this season’s flu dose missing', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await openList(page, 'Alex', 'immunizations');
  const full = page.locator('.card', { hasText: 'By the schedule' });
  await expect(full.locator('.row', { hasText: 'Not in these records' })).toHaveCount(1);
  await expect(full.locator('.row', { hasText: 'Not in these records' })).toContainText('Flu (influenza)');
  await expect(full.locator('.row', { hasText: 'Not in these records' })).toContainText('2026–27 season: dose 1 of 1');
  await expect(full.locator('.row', { hasText: 'All in these records' })).toHaveCount(9);
  await expect(full.locator('.row', { hasText: 'Rotavirus' })).toContainText('2 of 2 doses in these records');
});

test('an adult has no childhood schedule', async ({ page }) => {
  await openList(page, 'Robin', 'immunizations');
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'Doses given' }) })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'By the schedule' })).toHaveCount(0);
});

test('results come by panel, the panel with an out-of-range result first', async ({ page }) => {
  await openList(page, 'Robin', 'results');
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
  await openList(page, 'Sam', 'results');
  const cbc = page.locator('main .card').first();
  await expect(cbc.locator('.card-head h2')).toHaveText('Blood count (CBC)');
  await expect(cbc.locator('.row').first()).toContainText('Hemoglobin');
  await expect(cbc.locator('.row').first().locator('.chip')).toHaveText('Low');
});

test('conditions, allergies and medicines read as lists naming their source', async ({ page }) => {
  await openList(page, 'Sam', 'conditions');
  const active = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Active$/ }) });
  await expect(active.locator('.row')).toHaveText([/Vitamin D deficiency.*recorded Apr 2, 2026 · from Example Health/]);
  const ended = page.locator('.card', { hasText: 'Resolved or inactive' });
  await expect(ended.locator('.row')).toHaveText([/Right ankle sprain.*May 20, 2026 to Jul 1, 2026 · from Example Health/]);

  await openList(page, 'Sam', 'allergies');
  await expect(page.locator('main .card').first().locator('.row')).toHaveText([/Peanuts.*Hives, Swelling of the lips · high risk of a severe reaction · recorded Mar 1, 2001 · from Example Health/]);
  await expect(page.locator('main .card').first().locator('.row .chip')).toHaveText('High risk');

  await openList(page, 'Sam', 'medicines');
  const past = page.locator('.card', { hasText: 'Past and other' });
  await expect(past.locator('.row')).toContainText('Ibuprofen 200 mg tablet');
  await expect(past.locator('.row')).toContainText('reported, not prescribed in these records');
  await expect(past.locator('.row .chip')).toHaveText('Completed');
});

test('a medicine shows its prescriber and last fill, and an inactive allergy and a declined dose stand apart', async ({ page }) => {
  await openList(page, 'Robin', 'medicines');
  const active = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Active$/ }) });
  await expect(active.locator('.row')).toHaveText([
    /Lisinopril 10 mg tablet.*Take 1 tablet by mouth once a day · prescribed by Dr\. Jordan Sample · since Mar 12, 2025 · last filled Nov 12, 2026 at Example Pharmacy, 90 days · from Example Health/,
  ]);
  await expect(active.locator('.chip')).toHaveCount(0);
  await expect(page.locator('.card', { hasText: 'Past and other' }).locator('.row')).toHaveText([/Cetirizine 10 mg tablet.*Take 1 tablet daily as needed · recorded Apr 2, 2023 · from Example Health.*Stopped/]);

  await openList(page, 'Robin', 'allergies');
  await expect(page.locator('.card', { hasText: 'No longer active' }).locator('.row')).toHaveText([/Latex.*Inactive/]);

  await openList(page, 'Robin', 'immunizations');
  await expect(page.locator('.card', { hasText: 'Recorded as not given' }).locator('.row')).toHaveText([/COVID-19 vaccine.*Oct 4, 2025 · from Example Health/]);
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'Doses given' }) }).locator('.row', { hasText: 'COVID-19' })).toHaveCount(0);
});

test('each vaccine is listed once, with a link to every dose', async ({ page }) => {
  await openList(page, 'Alex', 'immunizations');
  const doses = page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'Doses given' }) });
  const pcv = doses.locator('.row', { hasText: 'Pneumococcal conjugate PCV 13' });
  await expect(pcv).toContainText('4 doses, the last Jan 7, 2019 · from Example Pediatrics');
  await expect(pcv.locator('.dose-dates a')).toHaveText(['Mar 5, 2018', 'May 7, 2018', 'Jul 9, 2018', 'Jan 7, 2019']);
  await pcv.locator('.dose-dates a').first().click();
  await expect(page).toHaveURL(/#\/p\/p_[a-z2-7]{20}\/r\/r_[a-z2-7]{20}$/);
  await expect(page.locator('main')).toContainText('Mar 5, 2018');
});

test('a claim’s page lists its lines, each with its code, kind of service and amounts', async ({ page }) => {
  await openClaim(page, 'Robin', 'Lipid panel and blood draw');
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
  await claimRow(page, 'Office visit').locator('a.row-main').click();
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Paid for$/ }) }).locator('.row-title')).toHaveText(['Blood pressure follow-up']);
});

/** A label's value in the page's key-value list. */
const field = (page: Page, label: string) => page.locator('main .kv-row', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
const paidFor = (page: Page) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Paid for$/ }) });

test('a claim medrec linked says what it paid for: the visit, the diagnosis and each line’s records', async ({ page }) => {
  await openClaim(page, 'Alex', 'Office visit and strep test');
  await expect(field(page, 'Diagnosis')).toHaveText('Otitis media, unspecified, unspecified ear (H66.90)');
  await expect(paidFor(page).locator('.row-title')).toHaveText(['Sick visit']);
  await expect(paidFor(page).locator('.row-meta').first()).toContainText('Visit · Nov 20, 2026');
  const lines = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^3 lines$/ }) });
  await expect(lines.locator('.row-meta')).toHaveText(['99215 · Visit · Nov 20, 2026', '99213 · Visit · Nov 20, 2026', '87880 · Lab test · Nov 20, 2026']);
  // The strep test's result is not in these records, so only the visit line links; the line the plan left out paid for nothing.
  await expect(lines.locator('.claim-paid-for')).toHaveText(['Paid for: Sick visit']);
  await lines.locator('.claim-paid-for').getByRole('link', { name: 'Sick visit' }).click();
  await expect(page.locator('main h1')).toHaveText('Sick visit');
});

test('a lab claim lists the results of its day once, a claim without the payer’s figure adds up your share, and a fill gives its discount', async ({ page }) => {
  await openClaim(page, 'Sam', 'Blood count and vitamin D test');
  await expect(page.locator('main .result-value').first()).toHaveText('You owe $70.30');
  await expect(field(page, 'Diagnosis')).toHaveText('Vitamin D deficiency, unspecified (E55.9)');
  // medrec links each lab line to every result and report of its day, from any source.
  await expect(paidFor(page).locator('.row-title')).toHaveText(['Vitamin D', 'Hemoglobin', 'White blood cells', 'Platelets']);
  await expect(paidFor(page).locator('.row-meta').nth(1)).toContainText('Result · Oct 12, 2026');
  // Both lines link the same results, so the card says it once.
  await expect(page.locator('.claim-paid-for')).toHaveCount(0);
  await page.goBack();
  // The payer gave the parts of the member's share but no figure for it.
  await claimRow(page, 'Thyroid test (TSH) and blood draw').locator('a.row-main').click();
  await expect(page.locator('main .result-value').first()).toHaveText('Your share $50.70');
  await expect(field(page, 'Your share comes from')).toHaveText('Deductible $50.70');

  // medrec's name for it ends with the pharmacy, which the page shows apart.
  await openClaim(page, 'Robin', 'Lisinopril 10 mg tablet, 90 days');
  await expect(field(page, 'Billed')).toHaveText('$32.50');
  await expect(field(page, 'Discount')).toHaveText('$20.10');
  await expect(field(page, 'Diagnosis')).toHaveText('Essential (primary) hypertension (I10)');
  await expect(page.locator('.claim-amounts')).toHaveText(['Billed $32.50 · Discount $20.10 · Allowed $12.40 · Plan paid $2.40 · Deductible $0.00 · Copay $10.00 · Coinsurance $0.00 · You owe $10.00']);
  // medrec links visit and lab lines only.
  await expect(page.locator('.claim-paid-for')).toHaveCount(0);
});

test('a result over time, down to its raw FHIR', async ({ page }) => {
  await openList(page, 'Robin', 'results');
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

test('search finds words inside documents, and a person’s old search address opens it on that person', async ({ page }) => {
  const robin = PEOPLE['Robin'];
  await page.goto(`./?demo#/p/${robin}/search?q=fasting`);
  await expect(page).toHaveURL(new RegExp(`#/search\\?q=fasting&who=${robin}$`));
  await expect(page.locator('.snippet')).toContainText('Lipid panel, fasting 12 hours');
  const whose = page.getByRole('group', { name: 'Filter by person' });
  await expect(whose.getByRole('button', { name: 'Robin' })).toHaveAttribute('aria-pressed', 'true');

  // Robin's search for what only Sam has says so, and Everyone shows it.
  await page.goto(`./?demo#/search?q=peanuts&who=${robin}`);
  await expect(page.locator('main')).toContainText(/No matches for Robin; \d+ match(es)? for everyone\./);
  await whose.getByRole('button', { name: 'Everyone' }).click();
  await expect(page).toHaveURL(/#\/search\?q=peanuts$/);
  await expect(page.locator('main .row').first()).toContainText('Peanuts');
});

test('a visit’s page shows what belongs to it, a hand-filed note among them', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  // The portal's visit record, from how its event was put together.
  await page.goto(`./?demo#/calendar?view=list&who=${PEOPLE['Alex']}`);
  await page.locator('main a', { hasText: 'Ear pain' }).first().click();
  await expect(page.locator('main h1').first()).toHaveText('Office visit');
  await expect(page.locator('.event-what')).toHaveText('Ear pain');
  await page.getByText('How this visit was put together').click();
  await page.locator('.row', { hasText: 'Portal visit' }).locator('a.row-main').click();
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
});

test('one search over everyone, from the home screen, with filters by kind and person', async ({ page }) => {
  await page.goto('./?demo');
  await page.getByRole('searchbox', { name: 'Search everyone’s records' }).fill('lisinopril');
  await page.getByRole('searchbox', { name: 'Search everyone’s records' }).press('Enter');
  await expect(page).toHaveURL(/#\/search\?q=lisinopril$/);
  const results = page.locator('main .row');
  await expect(results.first()).toContainText('Robin');
  await expect(results.first().locator('mark').first()).toHaveText(/lisinopril/i);
  const kinds = page.getByRole('group', { name: 'Filter by kind' });
  // The August fill's claim names lisinopril on its line; November's says only "Prescription drug".
  await expect(kinds.getByRole('button', { name: 'All 5' })).toHaveAttribute('aria-pressed', 'true');
  await expect(kinds.getByRole('button', { name: 'Claims 1' })).toBeVisible();
  await expect(page.locator('main p[aria-live]')).toHaveText('5 matches.');
  // By keyboard: the chip pressed keeps focus, and the status counts what is shown.
  await kinds.getByRole('button', { name: 'Documents 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(kinds.getByRole('button', { name: 'Documents 1' })).toBeFocused();
  await expect(kinds.getByRole('button', { name: 'Documents 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main p[aria-live]')).toHaveText('1 of 5 matches.');
  await expect(results).toHaveText([/After visit summary.*Robin.*in the document text.*continuing lisinopril/]);
  await expect(results.locator('.snippet mark')).toHaveText(['lisinopril']);
});

test('a kind the chosen person has none of falls back to All', async ({ page }) => {
  await page.goto('./?demo#/search?q=example');
  const kinds = page.getByRole('group', { name: 'Filter by kind' });
  await kinds.getByRole('button', { name: /^Claims \d+$/ }).click();
  await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Jamie' }).click();
  await expect(kinds.getByRole('button', { name: /^All \d+$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(kinds.getByRole('button', { name: /^Claims/ })).toHaveCount(0);
  await expect(page.locator('main .row').first()).toContainText('Jamie');
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
  await expect(results).toHaveText([/Sick visit.*Alex · Nov 20, 2026 · in reason.*Reason: Ear pain/]);
  await expect(page).toHaveURL(/#\/search\?q=ear\+pain$/);

  await box.fill('weight');
  const people = page.getByRole('group', { name: 'Filter by person' });
  await expect(people.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true');
  await people.getByRole('button', { name: 'Jamie' }).click();
  await expect(results.first()).toBeVisible();
  for (const meta of await results.locator('.row-meta').allTextContents()) expect(meta).toContain('Jamie');
});

test('the app bar opens search from anywhere', async ({ page }) => {
  await page.goto('./?demo#/sources');
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/#\/search$/);
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeFocused();
});

test('every list of every person opens, and every old section address lands on its new page', async ({ page }) => {
  test.setTimeout(120_000);
  for (const [name, id] of Object.entries(PEOPLE)) {
    for (const list of ['results', 'medicines', 'conditions', 'allergies', 'immunizations', 'imaging']) await openList(page, name, list);
    for (const [old, now] of [
      ['', `#/health?who=${id}`],
      ['/timeline', `#/calendar?view=list&who=${id}`],
      ['/timeline/all', `#/calendar?view=list&who=${id}`],
      ['/claims', `#/money?who=${id}`],
      ['/documents', `#/papers?who=${id}`],
    ]) {
      await page.goto(`./?demo#/p/${id}${old}`);
      await expect(page).toHaveURL((u) => u.hash === now);
      await expect(page.locator('main h1, main h2').first()).toBeVisible();
    }
  }
});

test('a Huishouden link lands on the person’s Health', async ({ page }) => {
  await page.goto('./?demo#/hh/hh-demo-sam');
  await expect(page).toHaveURL(new RegExp(`#/health\\?who=${PEOPLE['Sam']}$`));
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main')).toContainText('Sam');
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

test('the five tabs fit the screen: a bar at the bottom of a phone, a row above the page from 640px', async ({ page }) => {
  await page.goto('./?demo');
  const tabs = page.getByRole('navigation', { name: 'Main' });
  await expect(tabs.getByRole('link')).toHaveText(['Home', 'Calendar', 'Money', 'Health', 'Papers']);
  await expect(tabs.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  const bar = (await tabs.boundingBox())!;
  const view = page.viewportSize()!;
  if (view.width < 640) expect(bar.y + bar.height).toBeCloseTo(view.height, 0);
  else expect(bar.y + bar.height).toBeLessThanOrEqual((await page.locator('main').boundingBox())!.y + 1);
  for (const link of await tabs.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(view.width);
  for (const [name, url] of [['Calendar', /#\/calendar$/], ['Money', /#\/money$/], ['Health', /#\/health$/], ['Papers', /#\/papers$/], ['Home', /#\/$/]] as const) {
    await tabs.getByRole('link', { name }).click();
    await expect(page).toHaveURL(url);
    await expect(tabs.locator('[aria-current="page"]')).toHaveText(name);
  }
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
  await expect(ldl.locator('.row-meta')).toHaveText('Robin · 104 mg/dL on Oct 1, 2026 · 4 results');
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
  await expect(page.locator('main .row', { hasText: 'Lipid panel and blood draw' }).locator('.row-meta')).toHaveText('Robin · Oct 3, 2026 · Example Lab · you owe $19.28');

  await page.getByRole('searchbox', { name: 'Search' }).fill('blood draw');
  const claim = page.locator('main .row', { hasText: 'Lipid panel and blood draw' });
  await expect(claim.locator('.snippet')).toHaveText('Line: Blood draw (36415) · you owe $3.60');
  await expect(page.locator('.search-concept')).toHaveCount(0);
});

test('coverage over time: each insurer and plan, newest first, the same coverage from two sources once, a change on a birthday marked', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  // On the person's Money, where their old claims address leads.
  await page.goto(`./?demo#/p/${PEOPLE['Robin']}/claims`);
  await expect(page).toHaveURL(new RegExp(`#/money\\?who=${PEOPLE['Robin']}$`));

  const coverage = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Coverage$/ }) });
  const rows = coverage.locator('.row');
  await expect(rows.locator('.row-title')).toHaveText(['Example Health Plan, PPO Choice', 'ExampleHealth Plan, PPO Choice']);
  await expect(rows.nth(0)).toContainText('since Nov 8, 2026');
  // The insurer's record and the portal's copy, spelled without the space, are one coverage.
  await expect(rows.nth(0)).toContainText('In records from Example Health Plan and Example Health.');
  await expect(rows.nth(0).locator('.coverage-born')).toHaveText('Changed on Nov 8, 2026, the day Jamie was born.');
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
  await expect(note).toHaveText('Coverage changed in this period: Robin, Example Health Plan from Nov 8, 2026, the day Jamie was born.');
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '2025' }).click();
  await expect(page.locator('.cost-summary')).toBeVisible();
  await expect(note).toHaveCount(0);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '2026' }).click();
  await note.getByRole('link', { name: 'Robin' }).click();
  await expect(page).toHaveURL(new RegExp(`#/money\\?who=${PEOPLE['Robin']}$`));
  await expect(page.locator('.card-head h2', { hasText: /^Coverage$/ })).toBeVisible();
});
