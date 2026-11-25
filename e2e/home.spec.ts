import { expect, test, type Page } from '@playwright/test';
import { SAM } from '../test/sample';
import { busy } from './busy';
import { lay } from './lay';

// Home: what to do now, the bills and what is coming up, each a few rows with
// the rest one tap away, then where everyone stands and what happened
// recently. Private items are kept off it and shown on the person's own pages.

async function open(page: Page, path = '') {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('home leads with what to do now, then the bills and what is coming up, and keeps private items off them', async ({ page }) => {
  await open(page);
  await expect(page.locator('.home > .card > .card-head h2')).toHaveText(['Do now', 'Bills', 'Coming up', 'Where everyone stands', 'Recently']);

  const now = card(page, /^Do now$/);
  await expect(now.locator('.card-head')).toHaveText(/^Do now\s*2$/);
  await expect(now.locator('.row-title')).toHaveText(['Flu vaccine, 2026–27 season', 'Example Pediatrics needs a sign-in on the Mac']);
  await expect(now.locator('.row').first()).toContainText('Alex · not in these records');
  await expect(now.locator('.row-aside')).toHaveText(['Due']);
  await expect(now.locator('.card-all')).toHaveCount(0);

  // The most urgent two of the four, with the count and the total of all.
  const bills = card(page, /^Bills$/);
  await expect(bills.locator('.card-head')).toHaveText(/^Bills\s*4 · \$283\.46$/);
  await expect(bills.locator('.need-kind')).toHaveText(['Worth a call', 'No payment on file']);
  await expect(bills.locator('.need-title')).toHaveText(['Lab tests, Jul 9', 'Hospital visit, Sep 16']);
  await expect(bills.locator('.row-meta')).toHaveText(['Sam · the visit’s claims say you owe $50.70 · was due Aug 31', 'Sam · was due Nov 4 · matches the claim · unless it was paid elsewhere']);
  await expect(bills.locator('.row-aside')).toHaveText(['$120.00', '$90.50']);

  const coming = card(page, /^Coming up$/);
  await expect(coming.locator('.card-head')).toHaveText(/^Coming up\s*2$/);
  await expect(coming.locator('.row-title')).toHaveText(['Famotidine 20 mg tablet', '48-month vaccines']);
  await expect(coming.locator('.row-meta')).toHaveText(['Sam · runs out about then', 'Drew · 4 vaccines, from then']);
  await expect(coming.locator('.row-aside')).toHaveText(['Nov 28', 'Dec 14']);

  // The private refill is not named, and the line that says so is there whatever is private.
  await expect(page.locator('main')).toContainText('Private items show only on their person’s own pages.');
  await expect(page.locator('main')).not.toContainText('Emtricitabine');
  await expect(page.locator('main')).not.toContainText('Sexual');

  // Where everyone stands: one line per person, with the most urgent thing.
  const stands = card(page, 'Where everyone stands');
  await expect(stands.locator('.stand-name')).toHaveText(['Robin', 'Sam', 'Alex', 'Drew']);
  await expect(stands.locator('.stand-said')).toHaveText(['Last visit Nov 18', 'Last visit Oct 12', 'Last visit Nov 20', 'Last visit Oct 6']);
  await expect(stands.locator('.row-aside')).toHaveText(['2 bills', '2 bills', 'Flu due', 'Dec 14']);

  // A bill worth a call opens Worth a call; a bill to pay opens its visit; the rest are one tap away.
  await bills.locator('.row').first().locator('a.row-main').click();
  await expect(page).toHaveURL(/#\/money\/calls\?bill=d_/);
  await expect(page.locator('.call.bill-picked')).toBeFocused();
  await expect(page.locator('.call.bill-picked .card-head h2')).toHaveText('Example Billing');
  await page.goBack();
  await bills.locator('.row').nth(1).locator('a.row-main').click();
  await expect(page.locator('.event h1')).toHaveText('Hospital visit');
  await page.goBack();
  await bills.getByRole('link', { name: 'All 4 bills' }).click();
  await expect(page).toHaveURL(/#\/money\/bills$/);
  await page.goBack();
  await coming.getByRole('link', { name: 'Ahead' }).click();
  await expect(page).toHaveURL(/#\/calendar\?view=ahead$/);
});

test('Ahead lists what is due and coming up by month, for everyone or one person, whose private refill is theirs alone', async ({ page }) => {
  await open(page, '#/calendar?view=ahead');
  await expect(page.locator('main .card-head h2')).toHaveText(['Do now', 'November 2026', 'December 2026']);
  await expect(page.locator('main .row-title')).toHaveText(['Flu vaccine, 2026–27 season', 'Example Pediatrics needs a sign-in on the Mac', 'Famotidine 20 mg tablet', '48-month vaccines']);
  await expect(card(page, 'November 2026').locator('.row-meta')).toHaveText('Sam · refill: runs out about Nov 28 · 30 days filled Oct 29 at Example Pharmacy');
  await expect(card(page, 'December 2026').locator('.row-meta')).toHaveText('Drew · from Dec 14 · DTaP, Polio, MMR, Chickenpox');
  // The schedule's version and the court's stay are named.
  await expect(page.locator('main')).toContainText('CDC child schedule of Jul 2, 2025, restored after a court stayed the January 2026 changes on Mar 16, 2026.');
  await expect(page.locator('.private-line')).toHaveText('Private items are never listed here. Each shows on its person’s own Ahead.');
  await expect(page.locator('main')).not.toContainText('Emtricitabine');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('link', { name: 'Sam', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/calendar\\?view=ahead&who=${SAM}$`));
  await expect(page.locator('main .card-head h2')).toHaveText(['November 2026', 'December 2026']);
  const refill = page.locator('main .row', { hasText: 'Emtricitabine' });
  await expect(refill.locator('.row-meta')).toHaveText('Refill: runs out about Dec 4 · 30 days filled Nov 4 at Example Pharmacy');
  await expect(refill.locator('.chip').first()).toHaveText('Private');
  await expect(page.locator('.private-line')).toHaveCount(0);
});

for (const n of [0, 15, 50]) {
  test(`home is two screens at most with ${n} more things waiting`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await lay(page, busy(n));
    await open(page, '#/');
    await expect(page.locator('.home .card').first()).toBeVisible();
    if (n) {
      // Three of each at most, the bills two, and the rest one tap away.
      await expect(card(page, /^Do now$/).locator('.row')).toHaveCount(3);
      await expect(card(page, /^Bills$/).locator('.row')).toHaveCount(2);
      await expect(card(page, /^Coming up$/).locator('.row')).toHaveCount(3);
      const all = { 15: ['All 6 to do now', 'All 12 bills', 'All 4 coming up'], 50: ['All 10 to do now', 'All 30 bills', 'All 9 coming up'] }[n]!;
      await expect(page.locator('.home .card-all a')).toHaveText([...all, 'Calendar']);
    }
    // No one's line is cut short.
    expect(await page.locator('.stand-said').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent))).toEqual([]);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(2 * 844);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
  });
}

test('a list’s arrows are last, at its right edge, and its amounts line up before them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    // November's list on the calendar has a fill with no amount.
    for (const path of ['#/', '#/money', '#/money/bills', '#/money/events', '#/calendar', '#/calendar?view=list', '#/calendar?view=ahead', `#/health?who=${SAM}`]) {
      await open(page, path);
      const lists = page.locator('main .card', { has: page.locator('.row-chevron') });
      await expect(lists.first(), path).toBeVisible();
      const off = await lists.evaluateAll((cards) =>
        cards.flatMap((c) => {
          const right = (el: Element) => Math.round(el.getBoundingClientRect().right);
          const rows = [...c.querySelectorAll('.row, .cal-row')].filter((r) => r.querySelector('.row-chevron'));
          const edges = new Set(rows.map((r) => right(r.querySelector('.row-chevron')!)));
          const asides = new Set(rows.flatMap((r) => (r.querySelector('.row-aside')?.textContent ? [right(r.querySelector('.row-aside')!)] : [])));
          const within = rows.every((r) => Math.abs(right(r.querySelector('.row-chevron')!) - right(r)) <= 1);
          return edges.size > 1 || asides.size > 1 || !within ? [`${c.querySelector('h2')?.textContent}: ${[...edges]} ${[...asides]} ${within}`] : [];
        }),
      );
      expect(off, `${colorScheme} ${path}`).toEqual([]);
    }
  }
});

test('a person’s own pages list their needs, private ones marked: refills on Health, bills on Money', async ({ page }) => {
  await open(page, `#/health?who=${SAM}`);
  const due = card(page, /^Due$/);
  await expect(due.locator('.need-title')).toHaveText(['Famotidine 20 mg tablet', 'Emtricitabine-tenofovir 200-300 mg tablet']);
  const refill = due.locator('.row', { hasText: 'Emtricitabine' });
  await expect(refill.locator('.row-meta')).toHaveText('Runs out about Dec 4, 2026 · 30 days filled Nov 4, 2026 at Example Pharmacy');
  await expect(refill.locator('.chip').first()).toHaveText('Private');
  await expect(page.locator('.private-line')).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Money' }).click();
  await page.getByRole('group', { name: 'Whose money' }).getByRole('link', { name: 'Sam' }).click();
  await expect(page).toHaveURL(new RegExp(`#/money\\?who=${SAM}$`));
  await expect(page.locator('main')).toContainText('1 bill ready to pay');
  await expect(page.locator('main')).toContainText('1 bill worth a call');

  // From Home, Drew's Health lists the doses coming up.
  await open(page, '#/');
  await card(page, 'Where everyone stands').getByRole('link', { name: /^Drew/ }).click();
  await expect(card(page, /^Due$/).locator('.need-title')).toHaveText(['48-month vaccines']);
});

test('home fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await expect(card(page, /^Do now$/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
