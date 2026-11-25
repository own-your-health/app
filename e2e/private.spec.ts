import { expect, test, type Page } from '@playwright/test';
import { manifestWith, privateCase, type Overlay } from '../test/helpers';

// Private items on every screen the household shares: off each with medrec's
// own list, and everything of a person's off while no current list says which
// of it is private. Their own pages keep all of it. The folder is the sample
// with what medrec wrote for each case (scripts/private-fixtures.mjs).

const SAM = 'p_wwezzed7kml67hnp6s7n';
const ROBIN = 'p_xo4em46i7yj3hphlpajo';
/** Sam's items, private or not, by words only they have. */
const SAMS = /Example Billing|Example Surgery Center|Example Counseling|Nicotine|Loratadine|Peanuts|Vitamin D|Sports medicine|ankle/i;

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** Serves the sample with these files laid over it, as a folder holding them would. */
async function lay(page: Page, overlay: Overlay) {
  await page.route(/\/app\/demo\//, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*?\/demo\//, ''));
    if (path === 'manifest.json') return route.fulfill({ contentType: 'application/json', body: manifestWith(overlay) });
    const over = overlay[path];
    if (over === undefined) return route.continue();
    return over === null ? route.fulfill({ status: 404, body: 'not found' }) : route.fulfill({ contentType: 'application/json', body: over });
  });
}

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const heldNote = (page: Page) => page.locator('main .held-note');
const WHY = 'The household’s own private marks could not be read.';

/** Every shared screen, with where its line says the items are left off. */
const SHARED: [string, string][] = [
  ['#/', 'Home'],
  ['#/calendar?month=2026-10', 'this shared view'],
  ['#/calendar?view=list', 'this shared view'],
  ['#/money', 'the lists on this shared view'],
  ['#/money/bills', 'this shared view'],
  ['#/money/calls', 'this shared view'],
  ['#/money/events', 'this shared view'],
  ['#/costs', 'this shared view, its totals too'],
  ['#/papers', 'this shared view'],
  ['#/health', 'this shared view'],
];

test('someone whose private list can’t be used is left off every shared screen, which says so in a line', async ({ page }) => {
  await lay(page, privateCase('unreadable'));
  for (const [path, where] of SHARED) {
    await go(page, path);
    await expect(heldNote(page), path).toHaveText(`Sam’s items are left off ${where}. ${WHY} Sam’s own pages show them.`);
    await expect(page.locator('main'), path).not.toContainText(SAMS);
    // Nothing held back is counted as private, or can be turned on.
    await expect(page.locator('main'), path).not.toContainText(/private (item|event|paper|claim)/);
    await expect(page.getByRole('button', { name: 'Show them' }), path).toHaveCount(0);
  }
  // Everyone's search: none of Sam's, whatever is searched for.
  await go(page, '#/search?q=vitamin');
  await expect(heldNote(page)).toContainText('Sam’s items are left off everyone’s results.');
  await expect(page.locator('main .row')).toHaveCount(0);
  await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Sam' }).click();
  await expect(page.locator('main .row').first()).toContainText(/Vitamin D/i);
  await expect(heldNote(page)).toHaveCount(0);
});

test('a person held back keeps every one of their own pages', async ({ page }) => {
  await lay(page, privateCase('unreadable'));
  await go(page, `#/health?who=${SAM}`);
  await expect(card(page, /^Current$/)).toContainText('Nicotine 14 mg/24 hour patch');
  await expect(card(page, /^Current$/)).toContainText('Peanuts');
  await go(page, `#/money/bills?who=${SAM}`);
  await expect(page.locator('main')).toContainText('Example Billing');
  await go(page, `#/papers?who=${SAM}`);
  await expect(page.locator('main .paper-place')).toHaveCount(4);
  await go(page, `#/calendar?view=list&who=${SAM}`);
  await expect(page.locator('main')).toContainText('Example Counseling');
  for (const path of [`#/health?who=${SAM}`, `#/money/bills?who=${SAM}`, `#/papers?who=${SAM}`, `#/calendar?view=list&who=${SAM}`]) {
    await go(page, path);
    await expect(heldNote(page)).toHaveCount(0);
    // Nothing is known to be private, so nothing is marked so.
    await expect(page.locator('main .chip', { hasText: /^Private$/ })).toHaveCount(0);
  }
  await go(page, '#/settings');
  await expect(page.locator('main')).toContainText('Listed for 3 of 4 people: the rest’s items are all left off shared screens');
  await expect(page.locator('main')).toContainText(`Sam Example: ${WHY}`);
});

test('Home says who is left off, and no screen says that nothing is there', async ({ page }) => {
  await lay(page, privateCase('unreadable'));
  // Sam's bill that asks too much is held back, so Bills can't say that none does.
  await go(page, '#/money/bills');
  await expect(page.locator('.money-hero')).toContainText('2 bills, each asking what its claim says you owe.');
  await expect(page.locator('.money-hero')).not.toContainText('None asks for more');
  await go(page, '#/money/calls');
  await expect(page.locator('main')).toContainText('No bill listed here asks for more than the claims say you owe.');
  await go(page, '#/');
  const sam = page.locator('.stand', { hasText: 'Sam' });
  await expect(sam).toContainText('Left off Home');
  await expect(sam).not.toContainText(/Nothing due|visit/);
  await expect(page.locator('.stand', { hasText: 'Robin' })).toContainText('last visit');
  await expect(page.locator('main')).not.toContainText('Nothing needs you');
});

test('the doctor’s sheet of someone held back holds nothing until it is all included', async ({ page }) => {
  await lay(page, privateCase('unreadable'));
  await go(page, `#/health/doctor?who=${SAM}`);
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText(`Sam’s items are left off this sheet until you include them, private ones too. ${WHY}`);
  await page.getByRole('button', { name: 'Include them all' }).click();
  await expect(page.locator('.sheet')).toContainText('Peanuts');
  await expect(page.locator('.sheet')).toContainText('Nicotine 14 mg/24 hour patch');
  await expect(page.getByRole('status')).toHaveText('All Sam’s items are included, private ones too.');
  await page.getByRole('button', { name: 'Leave them off' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
});

test('a folder whose medrec wrote no views leaves everyone off, in one line', async ({ page }) => {
  await lay(page, { 'views/views.json': null });
  for (const [path, where] of SHARED) {
    await go(page, path);
    await expect(heldNote(page), path).toHaveText(`Robin’s, Sam’s, Alex’s and Jamie’s items are left off ${where}. medrec has not written which items are private. medrec 0.9.1 and later does, with its views. Their own pages show them.`);
  }
  await go(page, '#/');
  await expect(page.locator('main')).not.toContainText('Nothing needs you');
  await expect(card(page, /^Recently$/)).toContainText('Nothing to show here.');
  await go(page, '#/money');
  await expect(card(page, /^Bills$/)).toContainText('No open bills listed here.');
  await go(page, '#/calendar?view=list');
  await expect(page.locator('main')).toContainText('Nothing to show here.');
  await go(page, '#/calendar?month=2026-10');
  await expect(page.locator('main')).toContainText('Nothing to show in October 2026.');
  await go(page, '#/settings');
  await expect(page.locator('main')).toContainText('Not listed: everyone’s items are left off shared screens');
});

test('what the household marked private stays off, and what it marked not private shows', async ({ page }) => {
  await lay(page, privateCase('marked'));
  // Sam's knee procedure, marked private, with its claims and its bill.
  for (const path of ['#/', '#/calendar?month=2026-08', '#/money/bills', '#/costs']) {
    await go(page, path);
    await expect(page.locator('main'), path).not.toContainText('Example Surgery Center');
    await expect(heldNote(page), path).toHaveCount(0);
  }
  await go(page, '#/calendar?month=2026-08');
  await expect(page.locator('.cal-private')).toContainText('1 private event (marked private) is kept off this shared view.');
  // Its one paper marked not private shows, without the visit.
  await go(page, '#/papers');
  const goingHome = page.locator('.row', { hasText: 'Going home after knee surgery' });
  await expect(goingHome.locator('.paper-place')).toHaveText('With a visit kept off this shared view.');
  await expect(page.locator('main')).not.toContainText('Statement from Example Surgery Center');
  await expect(page.locator('main')).not.toContainText('Statement from Example Lab');
  await expect(page.locator('.papers-private')).toContainText('2 private papers are kept off this shared view.');
  // On Sam's own Papers it names its visit.
  await go(page, `#/papers?who=${SAM}`);
  await expect(page.locator('.row', { hasText: 'Going home after knee surgery' }).locator('.paper-place')).toContainText('With Hospital visit at Example Surgery Center');
  // The counseling visit, marked not private, is on the shared calendar; its claim, still private, is on no shared Money list.
  await go(page, '#/calendar?month=2026-10');
  await expect(page.locator('.cal-private')).toContainText('1 private event (substance use) is kept off this shared view.');
  await go(page, '#/money/events');
  await expect(page.locator('main')).not.toContainText('Example Counseling');
  // Robin's only allergy is private: the sheet must not say there are none.
  await go(page, `#/health/doctor?who=${ROBIN}`);
  const allergies = page.locator('.sheet-section', { has: page.getByRole('heading', { name: 'Allergies' }) });
  await expect(allergies).toContainText('None listed here.');
  await expect(allergies).not.toContainText('No known allergies');
  await page.getByRole('button', { name: 'Include 1 private item' }).click();
  await expect(allergies).toContainText('Sulfa drugs');
});

test('everyone’s search never finds a private item, or says whose it is', async ({ page }) => {
  await go(page, '#/search?q=nicotine');
  await expect(page.locator('main .row')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('Private items are left off everyone’s results. So is 1 imaging study with no report in these records: nothing says whether it is private. Choose a person to search theirs.');
  await expect(page.locator('main [aria-live]').filter({ hasText: 'match' })).toHaveText(/^0 matches\./);
  // Everyone's chip is there for any words, so a chip says nothing about who has a match.
  const whose = page.getByRole('group', { name: 'Filter by person' });
  await expect(whose.getByRole('button')).toHaveText(['Everyone', 'Robin', 'Sam', 'Alex', 'Jamie']);
  await whose.getByRole('button', { name: 'Robin' }).click();
  await expect(page.locator('main')).toContainText('Nothing matches every word.');
  await whose.getByRole('button', { name: 'Sam' }).click();
  await expect(page.locator('main .row')).toHaveCount(2);
  await expect(page).toHaveURL(/who=p_wwezzed7kml67hnp6s7n/);
});

test('a private provider’s address shows nothing of it on everyone’s costs, and its claim on Sam’s', async ({ page }) => {
  await go(page, `#/costs?only=person%3A${SAM}`);
  const went = card(page, 'Where it went');
  await went.locator('.row', { hasText: 'Example Counseling' }).locator('a').first().click();
  await expect(page.locator('main')).toContainText('Provider: Example Counseling');
  // The same choice with the person taken off it.
  await page.getByRole('group', { name: 'Whose costs' }).getByRole('link', { name: 'Everyone' }).click();
  await expect(page.locator('main')).not.toContainText(/counseling/i);
  await expect(page.locator('main')).toContainText('Provider: one not listed here');
  await expect(page.locator('main')).toContainText('No claim lines match these choices.');
});

test('the line of someone held back fits a phone in dark', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await lay(page, privateCase('unreadable'));
  for (const [path] of SHARED) {
    await go(page, path);
    await expect(heldNote(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
  }
});
