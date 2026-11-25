import { expect, test, type Page } from '@playwright/test';
import { privateCase } from '../test/helpers';
import { partsPrivate, placesPrivate, removed, renamed, rewritten } from './alter';
import { lay } from './lay';
import { ALEX, itemId, ROBIN, SAM } from '../test/sample';

// Private items on every screen the household shares: off each with medrec's
// own list, and everything of a person's off while no current list says which
// of it is private. Their own pages keep all of it. The folder is the sample
// with what medrec wrote for each case (scripts/private-fixtures.mjs).

/** Sam's items, private or not, by words only they have. */
const SAMS = /Example Billing|Example Endoscopy Center|Example Sexual Health|Emtricitabine|Famotidine|Peanuts|Vitamin D|Sports medicine|ankle/i;

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const heldNote = (page: Page) => page.locator('main .held-note');
const WHY = 'The household’s own private marks could not be read.';

/** Every shared screen, with where its line says the items are left off. */
const SHARED: [string, string][] = [
  ['#/', 'Home'],
  ['#/calendar?month=2026-11', 'this shared view'],
  ['#/calendar?view=list', 'this shared view'],
  ['#/calendar?view=ahead', 'this shared view'],
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
    await expect(page.locator('main'), path).not.toContainText(/\d private (item|event|paper|claim)/);
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
  await expect(card(page, /^Current$/)).toContainText('Emtricitabine-tenofovir 200-300 mg tablet');
  await expect(card(page, /^Current$/)).toContainText('Peanuts');
  await go(page, `#/money/bills?who=${SAM}`);
  await expect(page.locator('main')).toContainText('Example Billing');
  await go(page, `#/papers?who=${SAM}`);
  await expect(page.locator('main .paper-place')).toHaveCount(5);
  await go(page, `#/calendar?view=list&who=${SAM}`);
  await expect(page.locator('main')).toContainText('Example Sexual Health Clinic');
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
  await expect(page.locator('.stand', { hasText: 'Robin' })).toContainText('Last visit');
  await expect(page.locator('main')).not.toContainText('Nothing needs you');
});

test('the doctor’s sheet of someone held back holds nothing until it is all included', async ({ page }) => {
  await lay(page, privateCase('unreadable'));
  await go(page, `#/health/doctor?who=${SAM}`);
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText(`Sam’s items are left off this sheet until you include them, private ones too. ${WHY}`);
  await page.getByRole('button', { name: 'Include them all' }).click();
  await expect(page.locator('.sheet')).toContainText('Peanuts');
  await expect(page.locator('.sheet')).toContainText('Emtricitabine-tenofovir 200-300 mg tablet');
  await expect(page.getByRole('status')).toHaveText('All Sam’s items are included, private ones too.');
  await page.getByRole('button', { name: 'Leave them off' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
});

test('a folder whose medrec wrote no views leaves everyone off, in one line', async ({ page }) => {
  await lay(page, { 'views/views.json': null });
  for (const [path, where] of SHARED) {
    await go(page, path);
    await expect(heldNote(page), path).toHaveText(`Robin’s, Sam’s, Alex’s and Drew’s items are left off ${where}. medrec has not written which items are private. medrec 0.9.1 and later does, with its views. Their own pages show them.`);
  }
  await go(page, '#/');
  await expect(page.locator('main')).not.toContainText('Nothing needs you');
  await expect(card(page, /^Recently$/)).toContainText('Nothing to show here.');
  await go(page, '#/money');
  await expect(card(page, /^Bills$/)).toContainText('No open bills listed here.');
  await go(page, '#/money/bills');
  await expect(page.locator('.money-hero')).toContainText('No bill listed here matches its claim.');
  await go(page, '#/money/calls');
  await expect(page.locator('main')).toContainText('No bill listed here asks for more than the claims say you owe.');
  await go(page, '#/costs');
  await expect(page.locator('main')).toContainText('No claims listed here yet.');
  await go(page, '#/calendar?view=list');
  await expect(page.locator('main')).toContainText('Nothing to show here.');
  await go(page, '#/calendar?month=2026-11');
  await expect(page.locator('main')).toContainText('Nothing to show in November 2026.');
  await go(page, '#/settings');
  await expect(page.locator('main')).toContainText('Not listed: everyone’s items are left off shared screens');
});

test('what the household marked private stays off, and what it marked not private shows', async ({ page }) => {
  await lay(page, privateCase('marked'));
  // Sam's endoscopy, marked private, with its claims and its bill.
  for (const path of ['#/', '#/calendar?month=2026-09', '#/money/bills', '#/costs']) {
    await go(page, path);
    await expect(page.locator('main'), path).not.toContainText('Example Endoscopy Center');
    await expect(heldNote(page), path).toHaveCount(0);
  }
  await go(page, '#/calendar?month=2026-09');
  await expect(page.locator('.cal-private')).toContainText('1 private event (marked private) is kept off this shared view.');
  // Its one paper marked not private shows, without the visit.
  await go(page, '#/papers');
  const afterward = page.locator('.row', { hasText: 'After your upper endoscopy' });
  await expect(afterward.locator('.paper-place')).toHaveText('With no visit. No visit listed here is on or near Sep 16, 2026.');
  await expect(page.locator('main')).not.toContainText('Statement from Example Endoscopy Center');
  await expect(page.locator('main')).not.toContainText('Statement from Example Lab');
  await expect(page.locator('.private-line')).toHaveText('Private papers are never listed here. Each shows on its person’s own Papers. This is discretion, not security: everyone the Drive folder is shared with can read every file in it.');
  // On Sam's own Papers it names its visit.
  await go(page, `#/papers?who=${SAM}`);
  await expect(page.locator('.row', { hasText: 'After your upper endoscopy' }).locator('.paper-place')).toContainText('With Hospital visit at Example Endoscopy Center');
  // The clinic visit, marked not private, is on the shared calendar; its claim, still private, is on no shared Money list.
  await go(page, '#/calendar?month=2026-11');
  await expect(page.locator('.cal-private')).toContainText('1 private event (sexual health) is kept off this shared view.');
  await go(page, '#/money/events');
  await expect(page.locator('main')).not.toContainText('Example Sexual Health');
  // Robin's only allergy is private: the sheet must not say there are none.
  await go(page, `#/health/doctor?who=${ROBIN}`);
  const allergies = page.locator('.sheet-section', { has: page.getByRole('heading', { name: 'Allergies' }) });
  await expect(allergies).toContainText('None listed here.');
  await expect(allergies).not.toContainText('No known allergies');
  await page.getByRole('button', { name: 'Include 1 private item' }).click();
  await expect(allergies).toContainText('Sulfa drugs');
});

/** What a screen holds, card by card, once it has all its records; `without` drops one part. */
async function holds(page: Page, path: string, without?: string): Promise<string[]> {
  // The screen before this one is marked, to see it go.
  await page.evaluate(() => document.querySelector('main')?.firstElementChild?.setAttribute('data-was', ''));
  await go(page, path);
  const main = page.locator('main');
  await expect(main.locator('[data-was]')).toHaveCount(0);
  await main.locator(path.startsWith('#/search') ? '.row' : '.card, .stack').first().waitFor();
  let last = '';
  const settled = async () => {
    const now = await main.innerHTML();
    const same = now === last && !/Loading|Reading|loading/.test(now);
    last = now;
    return same;
  };
  await expect.poll(settled, { message: path, intervals: [80] }).toBe(true);
  const parts = await main.evaluate((el, skip) => {
    for (const c of skip ? el.querySelectorAll(skip) : []) c.remove();
    return el.innerHTML;
  }, without);
  return parts.split(/(?=<section)/);
}

/** The pages everyone's lists are on, whose words say nothing of how many private items there are. */
const LISTS: [string, string?][] = [['#/', '.money-line'], ['#/calendar?view=ahead'], ['#/money/bills'], ['#/money/calls'], ['#/money/events'], ['#/money/events?sort=discount'], ['#/papers'], ['#/costs'], ['#/search?q=example']];

const PARTS: typeof LISTS = [...LISTS, ['#/calendar?view=list', '.cal-private']];
/** Everyone's pages of providers the sample's open items name. */
const PROVIDERS = [
  ['provider', ROBIN, itemId(ROBIN, 'records', (r) => r.kind === 'claim' && r.date === '2026-11-18')],
  ['provider', SAM, itemId(SAM, 'records', (r) => r.kind === 'claim' && r.date === '2026-07-09')],
  ['location', ALEX, itemId(ALEX, 'records', (r) => r.kind === 'encounter' && r.date === '2026-01-12')],
].map(([field, who, id]) => `#/p/${who}/provider/${id}/${field}?all=1`);

// A bill is still beside the private claim medrec matched, where the folder without it has none.
const BILLS = ['#/', '#/money/bills', '#/money/calls'];

for (const [name, base, lists] of [
  ['the sample’s', {}, LISTS],
  ['the household’s marks', privateCase('marked'), LISTS],
  ['parts of visits that are not', partsPrivate(), PARTS],
  ['the portal visits of visits that are not', partsPrivate('encounter'), PARTS],
  ['the claims and portal visits of visits that are not', partsPrivate('claim', 'encounter'), PARTS.filter(([path]) => !BILLS.includes(path))],
  ['what only a private paper says of where visits are', placesPrivate(), PARTS],
] as const) {
  test(`every shared screen reads the same whatever its private items are called and on which day: ${name}`, async ({ page, browser }) => {
    const other = await browser.newPage();
    await other.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
    await lay(page, base);
    await lay(other, renamed(base));
    for (const path of [...SHARED.map(([p]) => p), ...LISTS.map(([p]) => p), '#/calendar?month=2026-09', '#/calendar?month=2026-07', '#/money?period=plan-1', ...PROVIDERS]) {
      const [was, is] = await Promise.all([holds(page, path), holds(other, path)]);
      expect(was.join('').length, path).toBeGreaterThan(path.includes('/provider/') ? 100 : 400);
      expect(is, path).toEqual(was);
    }
    // The other names are in that folder: Sam's own pages say them.
    await go(other, `#/calendar?view=list&who=${SAM}`);
    await expect(other.locator('main')).toContainText('Something else entirely');
    await other.close();
  });

  test(`everyone’s lists read the same without the private items there: ${name}`, async ({ page, browser }) => {
    const other = await browser.newPage();
    await other.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
    await lay(page, base);
    await lay(other, removed(base));
    for (const [path, totals] of lists) {
      const [was, is] = await Promise.all([holds(page, path, totals), holds(other, path, totals)]);
      expect(is, path).toEqual(was);
    }
    await go(other, `#/calendar?view=list&who=${SAM}`);
    await expect(other.locator('main')).toContainText('Famotidine');
    await expect(other.locator('main')).not.toContainText('Emtricitabine');
    await other.close();
  });
}

test('a bill says nothing of a private claim, or of a visit by one, on the screens the household shares', async ({ page }) => {
  const bill = (of: string | RegExp) => card(page, of).locator('.row', { hasText: '$120.00' });
  await go(page, '#/');
  await expect(bill(/^Bills$/).locator('.need-title')).toHaveText('Lab tests, Jul 9');
  await expect(bill(/^Bills$/).locator('.row-meta')).toContainText('the visit’s claims say you owe $50.70');
  await lay(page, partsPrivate('claim', 'encounter'));
  await page.reload();
  await expect(bill(/^Bills$/).locator('.need-title')).toHaveText('Tests, Jul 9');
  await expect(bill(/^Bills$/).locator('.row-meta')).toHaveText('Sam · was due Aug 31 · unless it was paid elsewhere');
  await go(page, '#/money/bills');
  await expect(bill('Due now').locator('.row-meta').first()).toContainText('Sam · Tests, Jul 9, 2026');
  await expect(card(page, 'Check before paying')).toHaveCount(0);
  for (const path of ['#/money/bills', '#/money/calls', '#/']) {
    await go(page, path);
    await expect(page.locator('main')).not.toContainText(/\$50\.70|\$69\.30|no claim in these records|Matches the claim/i);
  }
  // Their own pages have it.
  await go(page, `#/money/calls?who=${SAM}`);
  await expect(page.locator('main')).toContainText('$50.70');
  await go(page, `#/money/bills?who=${SAM}`);
  await expect(bill('Check before paying').locator('.row-meta').first()).toContainText('Lab tests, Jul 9, 2026');
});

/** The folder with Sam's one private claim from a plan no other claim names, on this day, and with every claim of Alex's private. */
const ownPlan = (day: string) =>
  rewritten({}, ({ name, index, list }) => {
    const ids = index.records.filter((r) => r.kind === 'claim').map((r) => r.id);
    if (name === 'Alex Example') for (const id of ids) list.records[id] = { area: 'household', from: 'marks' };
    for (const r of index.records) if (name === 'Sam Example' && r.kind === 'claim' && r.id in list.records) Object.assign(r, { date: day, fields: { ...r.fields, insurer: 'Example Meadow Plan', when: day, billable_period: { start: day, end: day }, benefit_period: undefined, items: (r.fields.items as object[]).map((i) => ({ ...i, serviced: day })) } });
  });

test('a plan only a private claim names is in no words, limits or dates of everyone’s Money', async ({ page }) => {
  await lay(page, ownPlan('2026-11-19'));
  await go(page, '#/money');
  const hero = page.locator('.money-hero');
  await expect(hero).toContainText('from 13 claims for care between Jul 9, 2026 and Nov 18, 2026.');
  await expect(hero).toContainText('Example Pharmacy Benefits');
  await expect(page.locator('main')).not.toContainText('Example Meadow Plan');
  const deductible = card(page, /^Deductible$/);
  await expect(deductible.locator('.row-title')).toHaveText(['Robin', 'Sam', 'Alex', 'Drew']);
  // Alex's claims are all private, so nothing here says there is one.
  for (const i of [2, 3]) await expect(deductible.locator('.row').nth(i)).toContainText('No claims listed here for this plan year yet.');
  await go(page, '#/costs');
  await expect(page.locator('main')).not.toContainText('Example Meadow Plan');
  await expect(page.getByRole('group', { name: 'Whose costs' }).getByRole('link')).toHaveText(['Everyone', 'Robin', 'Sam']);
  // On Alex's own address Alex is there to choose.
  const alex = await page.evaluate(async () => ((await (await fetch('./demo/household.json')).json()) as { people: { id: string; name: string }[] }).people.find((p) => p.name === 'Alex Example')!.id);
  await go(page, `#/costs?only=person%3A${alex}`);
  await expect(page.getByRole('group', { name: 'Whose costs' }).getByRole('link')).toHaveText(['Everyone', 'Robin', 'Sam', 'Alex']);
  await expect(page.locator('main .private-line')).toHaveCount(0);

  // In a year whose other claims are all one plan's, it stays one plan's. Sam's own Money names the other.
  await page.goto('about:blank');
  await page.unrouteAll();
  await lay(page, ownPlan('2025-11-13'));
  await go(page, '#/money?period=2025');
  await expect(hero).toContainText('The plan’s figures, from 4 claims for care between Mar 10, 2025 and Sep 15, 2025.');
  await go(page, `#/costs?only=person%3A${SAM}&period=2025`);
  await expect(page.locator('main')).toContainText('Example Meadow Plan');
});

test('a deductible that is met says with which claim on its person’s Money, and no day on everyone’s', async ({ page }) => {
  await lay(
    page,
    rewritten({}, ({ name, index }) => {
      if (name !== 'Sam Example') return;
      for (const r of index.records) r.fields = JSON.parse(JSON.stringify(r.fields).replaceAll('"750"', '"221.00"'));
    }),
  );
  const sam = card(page, /^Deductible$/).locator('.row', { hasText: '$221.00 of $221.00' });
  await go(page, '#/money');
  await expect(sam.locator('.chip')).toHaveText('Met');
  await expect(sam).toContainText('As of their plan’s newest claim.');
  await go(page, `#/money?who=${SAM}`);
  await expect(sam.locator('.chip')).toHaveText('Met with the claim for Oct 12, 2026');
  await expect(sam).toContainText('As of the claim for Nov 3, 2026.');
});

test('everyone’s search never finds a private item, or says whose it is', async ({ page }) => {
  await go(page, '#/search?q=emtricitabine');
  await expect(page.locator('main .row')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('Private items are left off everyone’s results. So is 1 imaging study with no report in these records: nothing says whether it is private. Choose a person to search theirs.');
  await expect(page.locator('main [aria-live]').filter({ hasText: 'match' })).toHaveText(/^0 matches\./);
  // Everyone's chip is there for any words, so a chip says nothing about who has a match.
  const whose = page.getByRole('group', { name: 'Filter by person' });
  await expect(whose.getByRole('button')).toHaveText(['Everyone', 'Robin', 'Sam', 'Alex', 'Drew']);
  await whose.getByRole('button', { name: 'Robin' }).click();
  await expect(page.locator('main')).toContainText('Nothing matches every word.');
  await whose.getByRole('button', { name: 'Sam' }).click();
  await expect(page.locator('main .row')).toHaveCount(2);
  await expect(page).toHaveURL(new RegExp(`who=${SAM}`));
});

test('a private provider’s address shows nothing of it on everyone’s costs, and its claim on Sam’s', async ({ page }) => {
  await go(page, `#/costs?only=person%3A${SAM}`);
  const went = card(page, 'Where it went');
  await went.locator('.row', { hasText: 'Example Sexual Health Clinic' }).locator('a').first().click();
  await expect(page.locator('main')).toContainText('Provider: Example Sexual Health Clinic');
  // The same choice with the person taken off it.
  await page.getByRole('group', { name: 'Whose costs' }).getByRole('link', { name: 'Everyone' }).click();
  await expect(page.locator('main')).not.toContainText(/sexual/i);
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
