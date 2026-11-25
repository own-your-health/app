import { expect, test, type Page } from '@playwright/test';
import { resultDetails } from './alter';
import { lay } from './lay';
import { eventId, itemId, ROBIN } from '../test/sample';

// What medrec 0.9.10 and later keeps of a result: a bound, the parts of one of
// several, and the results a panel lists.

const PRESSURE = `r_${'b'.repeat(20)}`;
const PANEL = `r_${'c'.repeat(20)}`;
const UNFILED = `r_${'d'.repeat(20)}`;
const at = (display: string, day: string) => itemId(ROBIN, 'records', (r) => r.kind === 'result' && r.display === display && r.date?.slice(0, 10) === day);
const POTASSIUM = at('Potassium', '2026-11-18');
const BOUND = at('Triglycerides', '2026-10-01');

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await lay(page, resultDetails());
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const main = (page: Page) => page.locator('main');
const card = (page: Page, title: string) => main(page).locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('a reading of two parts shows both, each against its range, and each over time', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/r/${PRESSURE}`);
  await expect(main(page).locator('.result-value')).toHaveText('134/78 mmHg');
  await expect(main(page).locator('.verdict')).toHaveText('Blood pressure, top number: Above the lab’s range of 90–120 mmHg.');
  await expect(card(page, 'Its parts').locator('tbody tr')).toHaveText([/^Blood pressure, top number134 mmHg Above range90-120 mmHg$/, /^Blood pressure, bottom number78 mmHg60-80 mmHg$/]);
  await expect(main(page).locator('details.tech')).toContainText('Systolic blood pressure');
  const over = card(page, 'Over time');
  await expect(over.locator('h3')).toHaveText(['Blood pressure, top number (mmHg)', 'Blood pressure, bottom number (mmHg)']);
  await expect(over.locator('svg.chart')).toHaveCount(2);
  await expect(over.locator('svg.chart').first()).toHaveAttribute('aria-label', /^Blood pressure, top number in mmHg, 2 results from Mar 10, 2025 to Nov 18, 2026/);
  await expect(over.locator('tbody tr')).toHaveCount(2);
  await expect(over).toContainText('The shaded band is the lab’s range at each result.');
  await go(page, `#/p/${ROBIN}/results`);
  const row = main(page).locator('.row', { hasText: 'Blood pressure' });
  await expect(row).toContainText('134/78 mmHg');
  await expect(row).toContainText('Above range');
  await expect(row.locator('svg.spark')).toHaveCount(0);
});

test('a value that is a bound is shown with its sign and is in no chart', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/r/${BOUND}`);
  await expect(main(page).locator('.result-value')).toHaveText(/^<\d+ mg\/dL$/);
  await expect(main(page).locator('.card').first().locator('svg.range-bar')).toHaveCount(0);
  await expect(main(page).locator('details.tech')).toContainText(/Value\s*<\d+ mg\/dL/);
});

test('a panel lists its results, and is none of them', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/r/${PANEL}`);
  await expect(main(page).locator('h1')).toHaveText('Sample salts panel');
  await expect(main(page).locator('.card').first()).toContainText('Panel · Nov 18, 2026');
  await expect(main(page).locator('.result-value, .verdict')).toHaveCount(0);
  await expect(card(page, 'Its results').locator('.row')).toHaveCount(2);
  await expect(card(page, 'Its results').locator('.row').nth(1)).toContainText('Potassium');
  await expect(main(page).locator('details.tech')).not.toContainText(POTASSIUM);
  await go(page, `#/p/${ROBIN}/results`);
  await expect(main(page)).toContainText('Potassium');
  await expect(main(page)).not.toContainText(/Sample \w+ panel/);
  // One in error is in no list of results either way, so nothing is left out of this one.
  await expect(main(page)).not.toContainText('entered in error');
});

test('a panel is named as one in its visit and in search, also where none of what it lists is filed', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/e/${eventId(ROBIN, '2026-11-18')}`);
  const row = main(page).locator('.event-results li', { hasText: 'Sample salts panel' });
  await expect(row).toContainText('Panel');
  await expect(row).toContainText('High');
  await go(page, `#/search?q=${encodeURIComponent('sample panel')}&who=${ROBIN}`);
  await expect(main(page).locator('.row')).toHaveText([/Sample metals panel.*Panel on Nov 18, 2026/, /Sample salts panel.*Panel on Nov 18, 2026/]);
  await go(page, `#/p/${ROBIN}/r/${UNFILED}`);
  await expect(main(page).locator('.card').first()).toContainText('Panel · Nov 18, 2026');
  await expect(main(page)).not.toContainText('Its results');
  await expect(main(page)).not.toContainText('No value');
});

test('what it says fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of [`#/p/${ROBIN}/r/${PRESSURE}`, `#/p/${ROBIN}/r/${PANEL}`, `#/p/${ROBIN}/r/${BOUND}`, `#/p/${ROBIN}/results`]) {
    await go(page, path);
    await expect(main(page).locator('h1, h2').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});
