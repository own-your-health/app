import { expect, test, type Page } from '@playwright/test';
import { enteredInError, rewritten } from './alter';
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
  // The claims of a person's costs, and of everyone's, none of which is private; also where nothing else fits the choices.
  for (const who of [`&only=person:${ROBIN}`, '']) {
    await go(page, `#/costs?period=all${who}`);
    await expect(card(page, '')).toContainText([ONE]);
  }
  await go(page, `#/costs?period=all&only=person:${ROBIN}&only=month:2026-10&only=category:pharmacy`);
  await expect(main(page).locator('.card', { hasText: 'No claim lines match these choices.' })).toContainText(ONE);
  await go(page, '#/costs?period=all&only=category:vaccine');
  await expect(main(page)).toContainText('Costs');
  await expect(main(page)).not.toContainText('entered in error');
  // A test's own page, of those of that test.
  await go(page, `#/p/${ROBIN}/results`);
  await main(page).locator('.row', { hasText: 'Potassium' }).getByRole('link').click();
  await expect(main(page).getByRole('heading', { name: 'Potassium', level: 1 })).toBeVisible();
  await expect(main(page)).toContainText(ONE);
});

test('a search announces how many it leaves out, with how many it found', async ({ page }) => {
  const said = main(page).locator('[aria-live=polite]', { hasText: /match(es)?\./ });
  await go(page, `#/search?q=potassium&who=${ROBIN}`);
  await expect(said).toHaveText(/^\d+ match(es)?\. \d entered in error, not shown\.$/);
  await go(page, `#/search?q=magnesium&who=${ROBIN}`);
  await expect(said).toHaveText(/^\d+ match(es)?\.$/);
});

test('a bill with a payment marked is named, since money may be owed back, and opens as no bill', async ({ page }) => {
  await go(page, '#/money/bills');
  const link = main(page).getByRole('link', { name: 'Robin, Statement from Example Lab, Oct 28, 2026' });
  await expect(link).toHaveCount(1);
  await expect(main(page).getByRole('link', { name: /^Sam, / })).toHaveCount(0);
  await link.click();
  await expect(card(page, 'Entered in error')).toContainText('Kept and not applied: 1 payment on it.');
  // One that copies a bill that stands has none of that one's payments.
  const copy = rewritten(
    enteredInError(),
    ({ name, index, bills }) => {
      if (name !== 'Robin Example') return;
      Object.assign(index.documents.find((d) => d.id === BILL)!, { same_statement_as: DIFFERS });
      Object.assign(bills.bills[DIFFERS]!, { paid: [{ from: 'household', id: 'o_cccccccccccccccccccc', on: '2026-11-04', amount: '53.68', currency: 'USD' }], paid_total: '53.68', left: '0.00', settled: true });
    },
    '0.9.9',
  );
  await lay(page, copy);
  await page.reload();
  await expect(card(page, 'Entered in error')).toBeVisible();
  await expect(main(page)).toContainText('Same statement as');
  await expect(main(page)).not.toContainText('Left to pay');
  await go(page, `#/p/${ROBIN}/r/${DIFFERS}`);
  await expect(main(page)).toContainText('Left to pay');
});

test('without medrec’s views, what each source says is kept in the index, and the lists count by it', async ({ page }) => {
  await lay(page, { ...enteredInError(), 'views/views.json': '{' });
  for (const [path, says] of [
    [`#/p/${ROBIN}/results`, ONE],
    [`#/p/${ROBIN}/medicines`, ONE],
    [`#/papers?who=${ROBIN}`, ONE],
    [`#/money/bills?who=${ROBIN}`, '1 bill entered in error, not shown.'],
  ] as const) {
    await go(page, path);
    await expect(main(page), path).toContainText(says);
  }
  // Nothing says which are private, so everyone's count none.
  for (const path of ['#/papers', '#/money/bills', '#/costs?period=all', '#/calendar?view=list']) {
    await go(page, path);
    await expect(main(page).locator('h1'), path).toBeVisible();
    await expect(main(page), path).not.toContainText('entered in error');
  }
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

test('what it says fits a narrow phone, with a long word in each name', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const word = 'Sample_statement_with_no_space_anywhere_in_its_own_file_name';
  const named = rewritten(
    enteredInError(),
    ({ name, index }) => {
      if (name !== 'Robin Example') return;
      for (const r of index.records) Object.assign(r, { display: `${word} ${String(r.display)}` });
      for (const d of index.documents) Object.assign(d, { title: `${word} ${String(d.title ?? '')}`, organization: `${word} ${String(d.organization ?? '')}` });
    },
    '0.9.9',
  );
  await lay(page, named);
  for (const path of [`#/p/${ROBIN}/r/${RESULT}`, `#/p/${ROBIN}/r/${HELD}`, `#/p/${ROBIN}/r/${BILL}`, `#/p/${ROBIN}/r/${DIFFERS}`, `#/p/${ROBIN}/e/${FILL}`, `#/p/${ROBIN}/e/${VISIT}`, '#/papers', '#/money/bills', '#/calendar?view=list']) {
    await go(page, path);
    await page.reload();
    await expect(main(page)).toContainText(/entered in error/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});

test('a private visit of which nothing stands says that it is private', async ({ page }) => {
  await lay(page, rewritten(enteredInError(), ({ name, list }) => void (name === 'Robin Example' && Object.assign(list.events, { [FILL]: { area: 'mental_health', from: 'members' } })), '0.9.9'));
  await go(page, `#/p/${ROBIN}/e/${FILL}`);
  await expect(main(page)).toContainText('Private Mental health. Everyone’s Calendar does not count it.');
  await go(page, '#/calendar?view=list');
  await expect(main(page).locator('h1')).toBeVisible();
  await expect(main(page)).not.toContainText('entered in error');
  await go(page, '#/costs?period=all');
  await expect(main(page).locator('h1')).toBeVisible();
  await expect(main(page)).not.toContainText('entered in error');
  await go(page, `#/calendar?view=list&who=${ROBIN}`);
  await expect(main(page)).toContainText(ONE);
});

test('a row with several things beside it keeps its name’s width on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  // Private and paid, and its sources differ on it; and a private visit with an amount.
  const all = rewritten(
    enteredInError(),
    ({ name, bills, list }) => {
      if (name !== 'Robin Example') return;
      list.documents[DIFFERS] = { area: 'household', from: 'household' };
      list.events[VISIT] = { area: 'household', from: 'household' };
      Object.assign(bills.bills[DIFFERS]!, { paid: [{ from: 'household', id: 'o_cccccccccccccccccccc', on: '2026-11-04', amount: '53.68', currency: 'USD' }], paid_total: '53.68', left: '0.00', settled: true });
    },
    '0.9.9',
  );
  await lay(page, all);
  for (const [path, beside] of [
    [`#/papers?who=${ROBIN}`, ['Sources differ', 'Private']],
    [`#/money/bills?who=${ROBIN}`, ['Sources differ', 'Private', '$53.68']],
    [`#/calendar?view=list&who=${ROBIN}`, ['Private', /^\$/]],
  ] as const) {
    await go(page, path);
    const row = main(page).locator(path.startsWith('#/calendar') ? `.row:has(a[href*="${VISIT}"])` : '.row:has(.row-aside:has-text("Sources differ"))');
    await expect(row.locator('.row-aside > *'), path).toHaveText([...beside]);
    expect((await row.locator('.row-body').boundingBox())!.width, path).toBeGreaterThan(80);
    // One under the other.
    const tops = await row.locator('.row-aside > *').evaluateAll((xs) => xs.map((x) => x.getBoundingClientRect()).map((b) => [b.top, b.bottom]));
    expect(tops.slice(1).every((b, i) => b[0]! > tops[i]![1]!), path).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});
