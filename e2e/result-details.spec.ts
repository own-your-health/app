import { expect, test, type Page } from '@playwright/test';
import { lay } from './lay';
import { fixture, resultsFiles } from '../test/helpers';

// What medrec 0.9.10 keeps of a result, as it writes its own fixture of them
// and of a visit's results and headings (scripts/result-fixtures.mjs): a bound,
// the parts of one of several, and the results a panel lists.

const PAT = fixture<{ people: { id: string }[] }>('results/views/household.json').people[0]!.id;
const RECORDS = fixture<{ records: { id: string; kind: string; display?: string; date?: string }[] }>('results/views/Pat Example/index.json').records;
const at = (display: string, day: string, kind = 'result') => RECORDS.find((r) => r.kind === kind && r.display === display && r.date?.startsWith(day))!.id;
const PRESSURE = at('Blood pressure panel', '2024-04-01');
const KPA = at('Blood pressure panel', '2024-04-04');
const WORDS = at('Blood pressure', '2024-04-03');
const BOUND = at('Example antibody', '2024-04-10');
const HEADING = at('Example heading', '2024-04-21');
const REPORT = at('Example panel', '2024-04-30', 'report');
const SALTS = at('Example salts panel', '2024-05-14');
const METALS = at('Example metals panel', '2024-05-14');
const OFFICE = at('Office visit', '2024-05-14', 'encounter');
const PRESSURE_PANEL = at('Blood pressure panel', '2024-06-10');
const VISIT = 'e_fus5gd54pzaapafx7tso';

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await lay(page, resultsFiles());
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const main = (page: Page) => page.locator('main');
const card = (page: Page, title: string) => main(page).locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('a reading of two parts shows both, each against its range, and each over time', async ({ page }) => {
  await go(page, `#/p/${PAT}/r/${PRESSURE}`);
  await expect(main(page).locator('.result-value')).toHaveText('128/76 mmHg');
  await expect(main(page).locator('.verdict')).toHaveText('Blood pressure, top number: Above the lab’s range of 90–120 mmHg.');
  await expect(card(page, 'Its parts').locator('tbody tr')).toHaveText([/^Blood pressure, top number128 mmHg High90–120 mmHg$/, /^Blood pressure, bottom number76 mmHg$/]);
  await expect(main(page).locator('details.tech')).toContainText('Systolic blood pressure');
  const over = card(page, 'Over time');
  await expect(over.locator('h3')).toHaveText(['Blood pressure, top number (mmHg)', 'Blood pressure, bottom number (mmHg)']);
  await expect(over.locator('svg.chart')).toHaveCount(2);
  // The top number in kPa is left out of its line, and the line says so; the one that gives the same part twice is in neither.
  await expect(over.locator('svg.chart').first()).toHaveAttribute('aria-label', /^Blood pressure, top number in mmHg, 5 results from Apr 1, 2024 to Apr 17, 2024/);
  await expect(over.locator('svg.chart').nth(1)).toHaveAttribute('aria-label', /^Blood pressure, bottom number in mmHg, 7 results from Apr 1, 2024 to Apr 17, 2024/);
  await expect(over.locator('p', { hasText: 'another unit' })).toHaveText(['1 result in another unit is not in the chart.']);
  await expect(over).toContainText('The shaded band is the lab’s range at each result.');
  await expect(over.locator('tr.current')).toContainText('top number: 90–120 mmHg');
  await go(page, `#/p/${PAT}/results`);
  // The newest of its test, beside the one that names no code, which is a test of its own.
  const row = main(page).locator('.row', { hasText: '118/74 mmHg' });
  await expect(row).toContainText('Blood pressure');
  await expect(row.locator('svg.spark')).toHaveCount(0);
  await expect(main(page).locator('.row-title', { hasText: /^Blood pressure$/ })).toHaveCount(2);
  // Its own page draws each part, and says which part's range a flag is by.
  await row.click();
  await expect(main(page).locator('.card-head h1')).toHaveText('Blood pressure');
  await expect(main(page).locator('h3')).toHaveText(['Blood pressure, top number (mmHg)', 'Blood pressure, bottom number (mmHg)']);
  await expect(main(page).locator('svg.chart')).toHaveCount(2);
  await expect(main(page).locator('tbody tr').last()).toHaveText(/^Apr 1, 2024128\/76 mmHgtop number: 90–120 mmHgHigh$/);
});

test('a reading whose part is in another unit shows it as given', async ({ page }) => {
  await go(page, `#/p/${PAT}/r/${KPA}`);
  await expect(card(page, 'Its parts').locator('tbody tr')).toHaveText([/^Blood pressure, top number16 kPa$/, /^Blood pressure, bottom number80 mmHg$/]);
  await expect(card(page, 'Over time').locator('p', { hasText: 'another unit' })).toHaveText(['1 result in another unit is not in the chart.']);
});

test('a test sent in two units is drawn in the newest one’s, and says how many it leaves out', async ({ page }) => {
  await go(page, `#/p/${PAT}/results`);
  await main(page).locator('.row', { hasText: 'Example glucose' }).click();
  await expect(main(page).locator('.card-head h1')).toHaveText('Example glucose');
  await expect(main(page).locator('svg.chart')).toHaveAttribute('aria-label', /^Example glucose in mg\/dL, 2 results from Feb 1, 2024 to Jun 1, 2024/);
  await expect(main(page).locator('p', { hasText: 'another unit' })).toHaveText(['1 result in another unit is not in the chart.']);
  await expect(main(page).locator('tbody tr')).toHaveCount(3);
});

test('a test with no two results in one unit has no chart, and says why', async ({ page }) => {
  await go(page, `#/p/${PAT}/results`);
  await main(page).locator('.row', { hasText: 'Example lactate' }).click();
  await expect(main(page).locator('svg.chart')).toHaveCount(0);
  await expect(main(page).locator('p', { hasText: 'more than one unit' })).toHaveText(['Its results are in more than one unit, so there is no chart.']);
  await expect(main(page)).not.toContainText('shaded band');
});

test('a value that is a bound is shown with its sign and is in no chart', async ({ page }) => {
  await go(page, `#/p/${PAT}/r/${BOUND}`);
  await expect(main(page).locator('.result-value')).toHaveText('<0.5 IU/mL');
  await expect(main(page).locator('.card').first().locator('svg.range-bar')).toHaveCount(0);
  await expect(main(page).locator('details.tech')).toContainText(/Value\s*<0\.5 IU\/mL/);
  // It is under the heading that lists it, as in the list of results.
  await expect(main(page).locator('.card').first()).toContainText('Example heading · Apr 10, 2024');
});

test('a panel lists its results, and is none of them', async ({ page }) => {
  await go(page, `#/p/${PAT}/r/${HEADING}`);
  await expect(main(page).locator('h1')).toHaveText('Example heading');
  await expect(main(page).locator('.card').first()).toContainText('Panel · Apr 21, 2024');
  await expect(main(page).locator('.result-value, .verdict')).toHaveCount(0);
  await expect(card(page, 'Its results').locator('.row')).toHaveText([/Example antibody.*<0\.5 IU\/mL/, /Example cell count/]);
  await expect(main(page).locator('details.tech')).not.toContainText(BOUND);
  // One that shares its code with a test has none of that test's history.
  await go(page, `#/p/${PAT}/r/${PRESSURE_PANEL}`);
  await expect(card(page, 'Its results').locator('.row')).toHaveText([/Blood pressure, top number.*130 mmHg/, /Blood pressure, bottom number.*85 mmHg/]);
  await expect(card(page, 'Over time')).toHaveCount(0);
  await go(page, `#/p/${PAT}/r/${REPORT}`);
  await expect(card(page, 'Its results').locator('.row')).toHaveText([/Example score/]);
  await go(page, `#/p/${PAT}/results`);
  // It names the group of what it lists, and is no test of its own.
  await expect(main(page)).toContainText('Example antibody');
  await expect(main(page).locator('.row', { hasText: /Example (heading|\w+ panel)/ })).toHaveCount(0);
  await expect(main(page)).toContainText('Example heading');
  await expect(main(page)).not.toContainText('entered in error');
});

test('a panel is named as one in its visit and in search, also where none of what it lists is filed', async ({ page }) => {
  await go(page, `#/p/${PAT}/e/${VISIT}`);
  await expect(main(page).locator('.event-results li', { hasText: 'Example salts panel' })).toContainText('Panel');
  await expect(main(page).locator('.event-results li', { hasText: 'Potassium' })).toContainText('High');
  await expect(main(page)).not.toContainText('Example withdrawn panel');
  await go(page, `#/p/${PAT}/provider/${OFFICE}/location`);
  await expect(main(page).locator('.row', { hasText: 'Example salts panel' })).toContainText('Panel');
  await go(page, `#/search?q=${encodeURIComponent('example panel')}&who=${PAT}`);
  await expect(main(page).locator('.row', { hasText: /Example \w+ panel/ })).toHaveText([/Example metals panel.*Panel on May 14, 2024/, /Example salts panel.*Panel on May 14, 2024/]);
  await go(page, `#/p/${PAT}/r/${METALS}`);
  await expect(main(page).locator('.card').first()).toContainText('Panel · May 14, 2024');
  await expect(main(page)).not.toContainText('Its results');
  await expect(main(page)).not.toContainText('No value');
  await go(page, `#/p/${PAT}/r/${SALTS}`);
  await expect(card(page, 'Its results').locator('.row')).toHaveText([/Sodium/, /Potassium.*High/]);
});

test('what it says fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  for (const path of [`#/p/${PAT}/r/${PRESSURE}`, `#/p/${PAT}/r/${WORDS}`, `#/p/${PAT}/r/${HEADING}`, `#/p/${PAT}/r/${BOUND}`, `#/p/${PAT}/results`, `#/p/${PAT}/e/${VISIT}`]) {
    await go(page, path);
    await expect(main(page).locator('h1, h2').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
  // A test's own page, with a part's range by name in its table.
  for (const value of ['118/74 mmHg', 'Example lactate']) {
    await go(page, `#/p/${PAT}/results`);
    await main(page).locator('.row', { hasText: value }).click();
    await expect(main(page).locator('.card-head h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), value).toBe(0);
  }
});
