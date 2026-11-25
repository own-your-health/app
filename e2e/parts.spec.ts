import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { linesPrivate, rewritten } from './alter';
import { lay } from './lay';
import { macWrites } from './mac';
import { CLIENT, FakeGoogle, FOLDER_NAME } from './fake-google';
import { eventId, itemId, ROBIN } from '../test/sample';

// Open items with a private part (medrec 0.9.9 and later): a shared screen
// shows the item without it and says how much it leaves out; its person's own
// pages show all of it and say where it stays off. That a shared screen reads
// the same whatever the part says is in private.spec.ts.

const SAID = 'Unmistakable words';
const CLAIM = itemId(ROBIN, 'records', (r) => r.kind === 'claim' && r.date === '2026-10-01');
const BILL = itemId(ROBIN, 'documents', (d) => d.doc_type === 'eob');
const CLAIM_SAYS = '1 service, 1 diagnosis and 1 payer note not shown';

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await lay(page, linesPrivate(SAID));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const main = (page: Page) => page.locator('main');

test('a shared screen says how much it leaves out of a visit, a claim and a paper', async ({ page }) => {
  await go(page, '#/calendar?view=list');
  const visit = main(page).locator('.cal-row', { hasText: '1 service not shown' }).first();
  await expect(visit).toBeVisible();
  await expect(main(page)).not.toContainText(SAID);
  await go(page, '#/');
  await expect(main(page)).toContainText('Recently');
  await expect(main(page)).not.toContainText(SAID);
  await go(page, '#/money/events');
  await expect(main(page).locator('.row', { hasText: '1 service not shown' }).first()).toBeVisible();
  await go(page, '#/costs?period=all');
  await expect(main(page).locator('.row', { hasText: CLAIM_SAYS }).first()).toBeVisible();
  await go(page, '#/search?q=billing');
  await expect(main(page).locator('.row', { hasText: '1 line not shown' }).first()).toBeVisible();
  await go(page, `#/p/${ROBIN}/provider/${CLAIM}/provider?all=1`);
  await expect(main(page).locator('.row', { hasText: CLAIM_SAYS }).first()).toBeVisible();
  await expect(main(page)).not.toContainText(SAID);
});

test('a claim in error is counted in everyone’s costs by what is left of it', async ({ page }) => {
  const wrong = rewritten(
    linesPrivate(SAID),
    ({ name, index, view }) => {
      if (name !== 'Robin Example') return;
      index.records.find((r) => r.id === CLAIM)!.status = 'entered-in-error';
      view.in_error = { claim: [CLAIM] };
    },
    '0.9.9',
  );
  await lay(page, wrong);
  const said = '1 entered in error, not shown.';
  for (const [only, there] of [['category:imaging', false], ['category:other', true], [`category:imaging&only=person:${ROBIN}`, true]] as const) {
    await go(page, `#/costs?period=all&only=${only}`);
    await expect(main(page)).toContainText('Costs');
    await (there ? expect(main(page), only).toContainText(said) : expect(main(page), only).not.toContainText('entered in error'));
  }
});

test('its person’s own pages show all of it, and say where it stays off', async ({ page }) => {
  const off = 'on Home and everyone’s Calendar, Money, Papers and search results.';
  await go(page, `#/p/${ROBIN}/r/${CLAIM}`);
  await expect(main(page)).toContainText(SAID);
  await expect(main(page)).toContainText(`${CLAIM_SAYS} ${off}`);
  await go(page, `#/p/${ROBIN}/e/${eventId(ROBIN, '2026-10-01')}`);
  await expect(main(page)).toContainText(SAID);
  await expect(main(page)).toContainText(`1 service not shown ${off}`);
  await go(page, `#/p/${ROBIN}/r/${BILL}`);
  await expect(main(page)).toContainText(`1 line not shown ${off}`);
  await go(page, `#/calendar?view=list&who=${ROBIN}`);
  await expect(main(page)).toContainText(SAID);
  await expect(main(page)).not.toContainText('not shown');
  await go(page, `#/costs?period=all&only=person:${ROBIN}`);
  await expect(main(page)).toContainText(SAID);
  await go(page, `#/p/${ROBIN}/provider/${CLAIM}/provider`);
  await expect(main(page)).not.toContainText('not shown');
  await go(page, `#/search?q=${encodeURIComponent(SAID)}&who=${ROBIN}`);
  await expect(main(page).locator('.row').first()).toContainText(SAID);
  await expect(main(page).locator('.row', { hasText: 'not shown' })).toHaveCount(0);
});

test('what is left out fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['#/calendar?view=list', '#/costs?period=all', '#/money/events', '#/search?q=billing', `#/p/${ROBIN}/r/${CLAIM}`]) {
    await go(page, path);
    await expect(main(page)).toContainText('not shown');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});

/** Signed in to Drive, whose folder has the private parts. */
async function signedIn(page: Page, context: BrowserContext): Promise<FakeGoogle> {
  const google = new FakeGoogle(new Date('2026-11-22T20:00:00Z'));
  for (const [path, text] of Object.entries(linesPrivate(SAID))) if (text !== null) google.writeAsMac(path, text);
  await google.install(context);
  await page.goto(`./?client=${CLIENT}`);
  await page.locator('.row', { hasText: FOLDER_NAME }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.signin-notice')).toBeVisible();
  return google;
}

test('everyone’s search goes by the text and the private lines of each read of the records, with its page open', async ({ page, context }) => {
  const google = await signedIn(page, context);
  await page.evaluate(() => (location.hash = '#/search?q=billing'));
  const results = main(page).locator('.row');
  await expect(results.first()).toBeVisible();
  const reads = () => google.reads.filter((x) => x === 'Robin Example/text.json').length;
  await page.getByRole('searchbox').fill('billing code');
  await expect(page.locator('main [aria-live]').filter({ hasText: 'match' })).toBeVisible();
  expect(reads()).toBe(1);
  // medrec wrote the texts again, with other private lines, and its list of them.
  await macWrites(page, google, linesPrivate(`Newer and longer ${SAID}`), 0);
  for (const q of ['newer and longer', 'example']) {
    await page.getByRole('searchbox').fill(q);
    await expect(page.locator('main [aria-live]').filter({ hasText: 'match' })).toHaveText(q === 'example' ? /^[1-9]\d* matches\./ : /^0 matches\./);
    await expect(main(page)).not.toContainText('is not searched here');
    await expect(main(page)).not.toContainText(SAID);
  }
  expect(reads()).toBe(2);
  await page.getByRole('searchbox').fill('newer and longer');
  await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Robin' }).click();
  await expect(results.first()).toContainText(`Newer and longer ${SAID}`);
  expect(google.strays).toEqual([]);
});

test('the text of papers that changed since medrec said what in it is private is in one person’s search, not everyone’s', async ({ page, context }) => {
  const google = await signedIn(page, context);
  const path = 'Robin Example/text.json';
  const text = JSON.parse(google.read(path)!) as { texts: Record<string, string> };
  text.texts[BILL] = `A new line\nPlaceholder words\n${text.texts[BILL]}`;
  google.writeAsMac(path, JSON.stringify(text));
  await page.evaluate(() => (location.hash = '#/search?q=placeholder'));
  await expect(main(page)).toContainText('The text of Robin’s papers is not searched here: it changed since medrec said what in it is private. medrec says it again after its next import or refresh.');
  await expect(main(page).locator('.row', { hasText: 'Placeholder words' })).toHaveCount(0);
  await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Robin' }).click();
  await expect(main(page).locator('.row', { hasText: 'Placeholder words' })).toHaveCount(1);
  await expect(main(page)).not.toContainText('is not searched here');
  expect(google.strays).toEqual([]);
});
