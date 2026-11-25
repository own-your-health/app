import { expect, test, type Page } from '@playwright/test';
import { enteredInError } from './alter';
import { lay } from './lay';
import { eventId, itemId, ROBIN } from '../test/sample';

// What every source of it says is entered in error (medrec 0.9.9 and later) is
// in no list, visit, bill or total, and a list says how many it leaves out. One
// opened by its id says what each source says, and what the household decided.

const RESULT = itemId(ROBIN, 'records', (r) => r.kind === 'result' && r.display === 'Potassium' && r.date?.slice(0, 10) === '2026-11-18');
const HELD = itemId(ROBIN, 'records', (r) => r.kind === 'result' && r.display === 'Creatinine' && r.date?.slice(0, 10) === '2026-11-18');
const FILL = eventId(ROBIN, '2026-10-08');
const VISIT = eventId(ROBIN, '2026-11-18');
const BILL = itemId(ROBIN, 'documents', (d) => d.doc_type === 'bill' && d.organization === 'Example Lab');
const DIFFERS = itemId(ROBIN, 'documents', (d) => d.doc_type === 'bill' && d.date === '2026-10-01');
const ONE = '1 entered in error, not shown.';

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await lay(page, enteredInError());
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const main = (page: Page) => page.locator('main');
const card = (page: Page, title: string) => main(page).locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('is in no list, which says how many it leaves out', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/results`);
  await expect(main(page)).toContainText(ONE);
  await go(page, '#/papers');
  await expect(main(page)).toContainText('2 entered in error, not shown.');
  await go(page, `#/papers?who=${ROBIN}`);
  await expect(main(page)).toContainText(ONE);
  await expect(main(page).locator(`a[href*="${DIFFERS}"]`)).toHaveCount(1);
  await expect(main(page).locator(`a[href*="${BILL}"]`)).toHaveCount(0);
  await go(page, '#/calendar?view=list');
  await expect(main(page)).toContainText(ONE);
  await go(page, `#/p/${ROBIN}/e/${VISIT}`);
  await expect(main(page)).toContainText(ONE);
  await expect(main(page)).not.toContainText('Potassium');
  await expect(main(page)).toContainText('Creatinine');
  for (const [path, says] of [
    ['#/money/bills', '2 bills entered in error, 1 with a payment you marked.'],
    [`#/money/bills?who=${ROBIN}`, '1 bill entered in error, with a payment you marked.'],
  ] as const) {
    await go(page, path);
    await expect(main(page)).toContainText(says);
    // Its claim is as if nothing had asked for it.
    await expect(main(page).locator('.row', { hasText: '19.28' })).toHaveCount(1);
    await expect(main(page).locator('.row', { hasText: '19.28' })).not.toContainText('Matches the claim');
  }
  await go(page, `#/search?q=potassium&who=${ROBIN}`);
  await expect(main(page)).toContainText(/\d entered in error, not shown\./);
});

test('one opened by its id says what each source says of it, and what the household decided', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/r/${RESULT}`);
  const said = card(page, 'Entered in error');
  await expect(said).toContainText('It is in no list, visit, bill or total.');
  await expect(said.locator('li')).toHaveText([/^Example Health: entered in error/]);
  await expect(said).toContainText('Kept and not applied: 1 decision about its visit.');
  await go(page, `#/p/${ROBIN}/r/${BILL}`);
  await expect(card(page, 'Entered in error')).toContainText('Kept and not applied: 1 payment on it.');
  await expect(card(page, 'Entered in error').locator('li')).toHaveText([/: entered in error, read Nov 20, 2026$/]);
});

test('a visit of which nothing stands opens as entered in error', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/e/${FILL}`);
  await expect(main(page)).toContainText('What makes it a visit is entered in error, so it is in no list or total.');
  await expect(main(page).locator('.row', { hasText: 'Entered in error' })).toHaveCount(2);
  await go(page, `#/calendar?view=list&who=${ROBIN}`);
  await expect(main(page).locator(`a[href*="${FILL}"]`)).toHaveCount(0);
  await expect(main(page).locator(`a[href*="${VISIT}"]`)).toHaveCount(1);
});

test('one that some source stands by stays, and says that they differ', async ({ page }) => {
  await go(page, `#/p/${ROBIN}/r/${HELD}`);
  const said = card(page, 'Its sources differ');
  await expect(said).toContainText('Some say it is entered in error. It stays while any does not.');
  await expect(said.locator('li')).toHaveText([/: entered in error, read Nov 20, 2026$/, /: final, read Nov 20, 2026$/]);
  await go(page, '#/papers');
  const row = main(page).locator('.row', { has: page.locator(`a[href*="${DIFFERS}"]`) });
  await expect(row).toContainText('Sources differ');
  await go(page, '#/money/bills');
  await expect(main(page).locator('.row', { hasText: '53.68' }).first()).toContainText('Sources differ');
  await go(page, `#/p/${ROBIN}/r/${DIFFERS}`);
  await expect(card(page, 'Its sources differ').locator('li')).toHaveCount(2);
});

test('what it says fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of [`#/p/${ROBIN}/r/${RESULT}`, `#/p/${ROBIN}/r/${DIFFERS}`, `#/p/${ROBIN}/e/${FILL}`, '#/papers', '#/money/bills', '#/calendar?view=list']) {
    await go(page, path);
    await expect(main(page)).toContainText(/entered in error/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});
