import { createHash } from 'node:crypto';
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

/**
 * The folder with those of Pat's records `keep` keeps, and views.json's MD5 of
 * their index made to match: a variant of what medrec wrote, built here.
 */
function patWith(keep: (r: { date?: string; code?: { code?: string } }) => boolean): Record<string, string> {
  const files = resultsFiles();
  const index = JSON.parse(files['Pat Example/index.json']!) as { records: { date?: string; code?: { code?: string } }[] };
  const text = JSON.stringify({ ...index, records: index.records.filter(keep) });
  const views = JSON.parse(files['views/views.json']!) as { people: Record<string, { index: string }> };
  views.people[PAT]!.index = createHash('md5').update(text).digest('hex');
  return { ...files, 'Pat Example/index.json': text, 'views/views.json': JSON.stringify(views) };
}
const pressureUpTo = (day: string) => patWith((r) => r.code?.code !== '85354-9' || (r.date ?? '') < day);

/** The folder with one of Pat's records changed, and views.json's MD5 of the index made to match. */
function patChanged(id: string, change: (fields: Record<string, unknown>) => void): Record<string, string> {
  const files = resultsFiles();
  const index = JSON.parse(files['Pat Example/index.json']!) as { records: { id: string; fields: Record<string, unknown> }[] };
  change(index.records.find((r) => r.id === id)!.fields);
  const text = JSON.stringify(index);
  const views = JSON.parse(files['views/views.json']!) as { people: Record<string, { index: string }> };
  views.people[PAT]!.index = createHash('md5').update(text).digest('hex');
  return { ...files, 'Pat Example/index.json': text, 'views/views.json': JSON.stringify(views) };
}

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
  await expect(over.locator('p', { hasText: 'another unit' })).toHaveText(['The chart is in mmHg; 1 result in another unit is not in it.']);
  await expect(over).toContainText('The shaded band is the lab’s range at each result.');
  await expect(over.locator('tr.current .table-range')).toHaveText('Range: top number 90–120 mmHg');
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
  await expect(main(page).locator('tbody tr').last()).toHaveText(/^Apr 1, 2024128\/76 mmHg HighRange: top number 90–120 mmHg$/);
});

test('a reading whose part is in another unit shows it as given', async ({ page }) => {
  await go(page, `#/p/${PAT}/r/${KPA}`);
  await expect(card(page, 'Its parts').locator('tbody tr')).toHaveText([/^Blood pressure, top number16 kPa$/, /^Blood pressure, bottom number80 mmHg$/]);
  await expect(card(page, 'Over time').locator('p', { hasText: 'another unit' })).toHaveText(['The chart is in mmHg; 1 result in another unit is not in it.']);
});

test('a test sent in two units is drawn in the newest one’s, and says how many it leaves out', async ({ page }) => {
  await go(page, `#/p/${PAT}/results`);
  await main(page).locator('.row', { hasText: 'Example glucose' }).click();
  await expect(main(page).locator('.card-head h1')).toHaveText('Example glucose');
  await expect(main(page).locator('svg.chart')).toHaveAttribute('aria-label', /^Example glucose in mg\/dL, 2 results from Feb 1, 2024 to Jun 1, 2024/);
  await expect(main(page).locator('p', { hasText: 'another unit' })).toHaveText(['The chart is in mg/dL; 1 result in another unit is not in it.']);
  await expect(main(page).locator('tbody tr')).toHaveCount(3);
});

test('a test whose newest result has no parts draws each part its results give', async ({ page }) => {
  await lay(page, pressureUpTo('2024-04-10'));
  await go(page, `#/p/${PAT}/results/${encodeURIComponent(fixture<{ records: { id: string; code?: { system?: string; code?: string } }[] }>('results/views/Pat Example/index.json').records.find((r) => r.id === PRESSURE)!.code!.system + '|85354-9')}`);
  await expect(main(page).locator('.card-head h1')).toHaveText('Blood pressure');
  await expect(main(page).locator('h3')).toHaveText(['Blood pressure, top number (mmHg)', 'Blood pressure, bottom number (mmHg)']);
  await expect(main(page).locator('svg.chart')).toHaveCount(2);
});

test('the doctor’s sheet gives the range of the part that flags a result', async ({ page }) => {
  // It lists the last two years' results.
  await page.clock.setFixedTime(new Date('2024-07-01T12:00:00Z'));
  await lay(page, pressureUpTo('2024-04-02'));
  await go(page, `#/health/doctor?who=${PAT}`);
  await expect(main(page).locator('.sheet-table tr', { hasText: '128/76' })).toHaveText([/^Blood pressure128\/76 mmHg \(high\)top number: 90–120 mmHgApr 1, 2024$/]);
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

/** Of each row in a table over time, how many lines its date and its value (without its flag and range) take. */
const rowLines = (page: Page) =>
  main(page)
    .locator('tbody tr:has(td.table-date)')
    .evaluateAll((rows) => {
      const lines = (node: Node) => {
        const r = document.createRange();
        r.selectNodeContents(node);
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
      };
      return rows.map((tr): [number, number] => [lines(tr.querySelector('td.table-date a') ?? tr.querySelector('td.table-date')!.firstChild!), lines(tr.querySelector('td:nth-child(2)')!.firstChild!)]);
    });

/** Of each range under a value, how many lines its numbers and unit take. */
const rangeLines = (page: Page) => main(page).locator('td .table-range-value').evaluateAll((spans) => spans.map((x) => new Set([...x.getClientRects()].map((r) => Math.round(r.top))).size));

test('a blood pressure reads in one form in every row, its date on one line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, `#/p/${PAT}/results`);
  await main(page).locator('.row', { hasText: '118/74 mmHg' }).click();
  await expect(main(page).locator('.card-head h1')).toHaveText('Blood pressure');
  // Newest first; whatever words its source wrote, each is top/bottom, and a part beyond them after it. One has no value.
  // Two columns: the flag and the range are under the value.
  await expect(main(page).locator('thead th')).toHaveText(['Date', 'Value']);
  await expect(main(page).locator('tbody tr td:nth-child(2)')).toHaveText(['118/74 mmHg', '>260/80 mmHg', '—', '122 and 124/78 mmHg', '122/78 mmHg, mean 93', '122 mmHg, top number only', '16 kPa/80 mmHg', '110/70 mmHg', '128/76 mmHg HighRange: top number 90–120 mmHg']);
  // Each date on one line, and each value on one at 390 px and at most two at 320 px.
  expect(await rowLines(page)).toEqual(Array(9).fill([1, 1]));
  await page.setViewportSize({ width: 320, height: 780 });
  expect((await rowLines(page)).map(([date, value]) => date === 1 && value <= 2)).toEqual(Array(9).fill(true));
  // A range breaks before its numbers, never after the dash.
  expect(await rangeLines(page)).toEqual([1]);
  // And the table stays inside its card.
  const spill = () => main(page).locator('table').evaluate((t) => {
    const card = t.closest('.card')!;
    return Math.round(t.getBoundingClientRect().right - (card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight)));
  });
  expect(await spill()).toBeLessThanOrEqual(0);
  // The reading's own page, and its others over time, at 390 px and at 320 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, `#/p/${PAT}/r/${WORDS}`);
  await expect(main(page).locator('.result-value')).toHaveText('120/80 mmHg');
  await go(page, `#/p/${PAT}/r/${PRESSURE}`);
  await expect(card(page, 'Over time').locator('thead th')).toHaveText(['Date', 'Value']);
  await expect(card(page, 'Over time').locator('tbody td:nth-child(2)')).toHaveText([/^118\/74 mmHg$/, /^>260\/80 mmHg$/, /^—$/, /^122 and 124\/78 mmHg$/, /^122\/78 mmHg, mean 93$/, /^128\/76 mmHg HighRange: top number 90–120 mmHg$/]);
  expect(await rowLines(page)).toEqual(Array(6).fill([1, 1]));
  await page.setViewportSize({ width: 320, height: 780 });
  expect((await rowLines(page)).map(([date, value]) => date === 1 && value <= 2)).toEqual(Array(6).fill(true));
  expect(await rangeLines(page)).toEqual([1]);
});

test('a long range a source wrote in words wraps on a phone, its numbers each kept whole', async ({ page }) => {
  const LONG = 'Normal: under 120 mmHg; Elevated: 120–129 mmHg; High: 130 or more, or a bottom number of 80 or more';
  await lay(page, patChanged(at('Blood pressure panel', '2024-04-17'), (f) => Object.assign(f, { reference_range: LONG })));
  await page.setViewportSize({ width: 320, height: 780 });
  await go(page, `#/p/${PAT}/results`);
  await main(page).locator('.row', { hasText: '118/74 mmHg' }).click();
  await expect(main(page).locator('tbody tr').first().locator('.table-range')).toHaveText(`Range: ${LONG}`);
  const range = main(page).locator('tbody tr').first().locator('.table-range');
  expect(await range.evaluate((x) => x.getBoundingClientRect().height / parseFloat(getComputedStyle(x).lineHeight))).toBeGreaterThan(2.5);
  expect(await main(page).locator('table').evaluate((t) => Math.round(t.getBoundingClientRect().right - t.closest('.card')!.getBoundingClientRect().right))).toBeLessThan(0);
  expect(await rangeLines(page)).toEqual(Array(5).fill(1));
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
