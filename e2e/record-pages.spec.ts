import { expect, test, type Page } from '@playwright/test';

// Every record page leads with the plain answer; codes, sources, identifiers
// and the raw FHIR sit folded under Technical details.

const PEOPLE: Record<string, string> = { 'Robin': 'p_xo4em46i7yj3hphlpajo', 'Sam': 'p_wwezzed7kml67hnp6s7n' };

/** One of a person's full lists (results, medicines…), at the address Health's links open. */
async function openList(page: Page, name: string, list: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo#/p/${PEOPLE[name]}/${list}`);
  await expect(page.locator('main h1')).toHaveText(`${name}’s ${list}`);
}

/** Opens the row of a person's list that names this. */
async function openFromList(page: Page, name: string, list: string, rowText: string | RegExp) {
  await openList(page, name, list);
  await page.locator('main .row', { hasText: rowText }).first().locator('a.row-main').click();
}

async function expectFolded(page: Page) {
  const tech = page.locator('details.tech');
  await expect(tech).toHaveCount(1);
  await expect(tech).not.toHaveAttribute('open', /.*/);
  await expect(page.getByText('Merge key')).toBeHidden();
  await tech.locator('summary').click();
  await expect(page.getByText('Merge key')).toBeVisible();
  await expect(page.getByText('Code system')).toBeVisible();
}

/** The link leaves the app for the named site, in a new tab, with nothing about the person in it. */
async function expectLearnLink(page: Page, site: RegExp, href: RegExp) {
  const a = page.locator('.learn-more a');
  await expect(a).toHaveAttribute('href', href);
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(a).toHaveText(site);
  const url = (await a.getAttribute('href'))!;
  expect(url).not.toMatch(/[pr]_[a-z2-7]{20}|Example|Robin|Sam|Alex|Jamie/);
}

test('a result leads with its value, the lab’s range and what the test measures', async ({ page }) => {
  await openList(page, 'Robin', 'results');
  await page.getByRole('link', { name: /LDL cholesterol/ }).first().click();
  await page.locator('table a').first().click();

  const head = page.locator('section.card').first();
  await expect(head.locator('h1')).toHaveText('LDL cholesterol');
  // A final result gets no badge.
  await expect(head.locator('.card-head .chip')).toHaveCount(0);
  await expect(head.locator('p.muted').first()).toHaveText('Cholesterol (lipid panel) · Oct 1, 2026 · from Example Health');
  await expect(head.locator('.result-value')).toHaveText('104 mg/dL');
  await expect(head.locator('.verdict')).toHaveText('Within the lab’s range (under 130 mg/dL).');
  await expect(head.locator('svg.range-bar')).toHaveAttribute('aria-label', '104 mg/dL. Within the lab’s range (under 130 mg/dL).');
  await expect(head.locator('.verdict.verdict-in')).toHaveCount(1);
  await expect(head.locator('.range-marker-in')).toHaveCount(1);
  await expect(head.locator('.range-marker-out')).toHaveCount(0);
  await expect(head.locator('.about')).toContainText('LDL is the “bad” cholesterol');
  await expect(head.locator('.about')).toContainText('a question for your doctor');
  await expectLearnLink(page, /Read about LDL cholesterol on MedlinePlus/, /^https:\/\/connect\.medlineplus\.gov\/application\?mainSearchCriteria\.v\.cs=2\.16\.840\.1\.113883\.6\.1&mainSearchCriteria\.v\.c=13457-7&/);

  const history = page.locator('.card', { has: page.locator('h2', { hasText: /^Over time$/ }) });
  await expect(history.locator('svg.chart')).toBeVisible();
  await expect(history.locator('tbody tr')).toHaveCount(4);
  await expect(history.locator('tbody tr[aria-current="true"]')).toContainText('104 mg/dL');
  await expect(history.locator('tbody tr[aria-current="true"] .sr-only')).toHaveText(' (this result)');

  const draw = page.locator('.card', { has: page.locator('h2', { hasText: /^Also tested on Oct 1, 2026$/ }) });
  await expect(draw.locator('.group-head').first()).toHaveText('Cholesterol (lipid panel)');
  await expect(draw.locator('.row-title').first()).toHaveText('Total cholesterol');
  await expect(draw.locator('.group-head')).toContainText(['Cholesterol (lipid panel)', 'Metabolic panel', 'Blood sugar (A1c)']);

  const came = page.locator('.card', { has: page.locator('h2', { hasText: /^Came with$/ }) });
  await expect(came.locator('.row-title')).toHaveText(['Office visit', 'Lipid panel']);

  await expectFolded(page);
});

test('a result out of the lab’s range says so in words and marks it on the bar', async ({ page }) => {
  await openList(page, 'Sam', 'results');
  await page.getByRole('link', { name: /Hemoglobin/ }).first().click();
  await page.locator('table a').last().click();
  const head = page.locator('section.card').first();
  await expect(head.locator('h1')).toHaveText('Hemoglobin');
  await expect(head.locator('.verdict.verdict-out.verdict-low')).toHaveText('Below the lab’s range of 12–15.5 g/dL.');
  await expect(head.locator('.range-marker-out')).toHaveCount(1);
  // Not by colour alone: an arrow before the words and in the dot, the stretch outside the range hatched.
  expect(await head.locator('.verdict').evaluate((el) => getComputedStyle(el, '::before').content)).toContain('↓');
  await expect(head.locator('.range-glyph')).toHaveCount(1);
  await expect(head.locator('.range-zone-hatch').first()).toHaveAttribute('fill', /^url\(#range-hatch-\d+\)$/);
});

test('a number the lab sent as text reads as one: its unit, the range bar and the chart', async ({ page }) => {
  await openList(page, 'Robin', 'results');
  await page.getByRole('link', { name: /Glucose/ }).first().click();
  await page.locator('table a', { hasText: 'Mar 10, 2025' }).click();
  const head = page.locator('section.card').first();
  await expect(head.locator('h1')).toHaveText('Glucose');
  await expect(head.locator('.result-value')).toHaveText('94 mg/dL');
  await expect(head.locator('.verdict.verdict-in')).toHaveText('Within the lab’s range of 70–99 mg/dL.');
  expect(await head.locator('.verdict').evaluate((el) => getComputedStyle(el, '::before').content)).toContain('✓');
  await expect(head.locator('svg.range-bar')).toHaveAttribute('aria-label', '94 mg/dL. Within the lab’s range of 70–99 mg/dL.');
  await expect(head.locator('.range-marker-in')).toHaveCount(1);
  const history = page.locator('.card', { has: page.locator('h2', { hasText: /^Over time$/ }) });
  await expect(history.locator('svg.chart circle')).toHaveCount(3);
  await expect(history.locator('tbody tr[aria-current="true"]')).toContainText('94 mg/dL');
});

test('a medicine leads with how to take it and its last fill', async ({ page }) => {
  await openFromList(page, 'Robin', 'medicines', 'Lisinopril');
  const head = page.locator('section.card').first();
  await expect(head.locator('h1')).toHaveText('Lisinopril 10 mg tablet');
  await expect(head.locator('.result-value')).toHaveText('Take 1 tablet by mouth once a day');
  await expect(head).toContainText('Last filled');
  await expect(head).toContainText('at Example Pharmacy for 90 days');
  await expectLearnLink(page, /Read about Lisinopril 10 mg tablet on MedlinePlus/, /mainSearchCriteria\.v\.cs=2\.16\.840\.1\.113883\.6\.88&mainSearchCriteria\.v\.c=314076&informationRecipient/);
  // The source's own name for the drug stays home.
  await expect(page.locator('.learn-more p')).toHaveText('Opens the National Library of Medicine’s health site. The link carries only the code, nothing about the person.');
  await expectFolded(page);
});

test('a condition, an allergy and a vaccine lead with what they are and link to read more', async ({ page }) => {
  await openFromList(page, 'Robin', 'conditions', 'High blood pressure');
  await expect(page.locator('section.card').first().locator('p.muted').first()).toHaveText('Condition · Active · from Example Health');
  await expectLearnLink(page, /Read about High blood pressure on MedlinePlus/, /mainSearchCriteria\.v\.cs=2\.16\.840\.1\.113883\.6\.90&mainSearchCriteria\.v\.c=I10&/);
  await expectFolded(page);

  await openFromList(page, 'Robin', 'allergies', 'Sulfa drugs');
  const allergy = page.locator('section.card').first();
  await expect(allergy).toContainText('Rash');
  await expect(allergy).toContainText('Low risk of a severe reaction');
  await expectLearnLink(page, /Read about Sulfa drugs on MedlinePlus/, /mainSearchCriteria\.v\.cs=2\.16\.840\.1\.113883\.6\.96&mainSearchCriteria\.v\.c=91939003&/);

  await openFromList(page, 'Robin', 'immunizations', 'Influenza');
  const vaccine = page.locator('section.card').first();
  await expect(vaccine.locator('p.muted').first()).toContainText('Vaccine · given');
  await expectLearnLink(page, /on CDC/, /^https:\/\/www\.cdc\.gov\/vaccines\/hcp\/current-vis\/influenza-inactivated\.html$/);
  await expect(page.locator('.learn-more p')).toHaveText('Opens the CDC’s statement on this vaccine. The link names only the vaccine, nothing about the person.');
});

test('a document and a visit keep their files and sources under Technical details', async ({ page }) => {
  // The portal's visit record, from how its visit was put together.
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo#/calendar?month=2026-10&day=2026-10-01&who=${PEOPLE['Robin']}`);
  await page.locator('.cal-row a.row-main').first().click();
  await page.getByText('How this visit was put together').click();
  await page.locator('.row', { hasText: 'Portal visit' }).locator('a.row-main').click();
  await expect(page.locator('section.card').first()).toContainText('Annual physical');
  const visit = page.locator('.card', { has: page.locator('h2', { hasText: /^At this visit$/ }) });
  // Results by their plain names.
  await expect(visit).toContainText('A1c');
  await expect(visit).not.toContainText('Cholesterol, total');
  await expectFolded(page);

  await visit.getByRole('link', { name: 'Lipid panel' }).click();
  await expect(page.locator('section.card').first().locator('h1')).toHaveText('Lipid panel');
  await expect(page.getByText('SHA-256')).toBeHidden();
  await page.locator('details.tech > summary').click();
  await expect(page.getByText('SHA-256')).toBeVisible();
});
