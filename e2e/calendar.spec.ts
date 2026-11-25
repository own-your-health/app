import { expect, test, type Page } from '@playwright/test';
import { ROBIN, SAM } from '../test/sample';
import { rewritten } from './alter';
import { lay } from './lay';

// The calendar: the household's events a month at a time with a lane
// per person, or as one list, and private events kept off the shared view.

async function open(page: Page, path = '') {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo${path}`);
}

const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });

test('home leads to the calendar, which opens on this month with a lane per person', async ({ page }) => {
  await open(page);
  const recent = card(page, /^Recently$/);
  await expect(recent.locator('.row-title')).toHaveText(['Office visit', 'Office visit']);
  await expect(recent.locator('.row-meta')).toHaveText(['Alex · Example Pediatrics', 'Robin · Example Health Main Clinic']);
  await recent.getByRole('link', { name: /^Calendar$/ }).click();
  await expect(page).toHaveURL(/#\/calendar$/);
  await expect(page.locator('main h1')).toHaveText('Calendar');

  const month = page.locator('.cal-month');
  await expect(month.locator('h2')).toHaveText('November 2026');
  await expect(month.locator('.cal-today .cal-date')).toHaveText('22');
  await expect(month.locator('.cal-legend .cal-key')).toHaveText(['Visit or tests', 'Pharmacy or vaccine', 'Emergency room or hospital stay', 'Robin', 'Alex']);

  const list = card(page, 'What happened in November 2026');
  await expect(list).toContainText('2 visits, 2 pharmacy trips on 4 days · your share $60.00.');
  await expect(list.locator('.row-title')).toHaveText(['Office visit · Example Pediatrics', 'Office visit · Example Health Main Clinic', 'Lisinopril 10 mg tablet · Example Pharmacy', 'Atorvastatin 20 mg tablet · Example Pharmacy']);

  // A day opens its own list, and goes back to the month.
  await month.getByRole('link', { name: /^Thursday, November 12:/ }).click();
  await expect(page).toHaveURL(/#\/calendar\?month=2026-11&day=2026-11-12$/);
  await expect(month.getByRole('link', { name: /^Thursday, November 12:/ })).toHaveAttribute('aria-current', 'date');
  const day = card(page, 'Thursday, November 12');
  await expect(day.locator('.row-title')).toHaveText(['Lisinopril 10 mg tablet · Example Pharmacy']);
  await day.getByRole('link', { name: 'All of November 2026' }).click();
  await expect(card(page, 'What happened in November 2026')).toBeVisible();

  // Each row opens the visit's page.
  await card(page, 'What happened in November 2026').locator('.row', { hasText: 'Ear pain' }).locator('a.row-main').click();
  await expect(page.locator('.event h1')).toHaveText('Office visit');
  await expect(page.locator('.event-what')).toHaveText('Ear pain');
});

/** The sample with Sam's day at the endoscopy center a stay of three nights. */
const STAY = rewritten({}, ({ name, events }) => {
  if (name === 'Sam Example') Object.assign(events.events.find((e) => e.start === '2026-09-16')!, { kind: 'inpatient', end: '2026-09-19' });
});

test('a hospital stay is one bar across its days, in its person’s lane', async ({ page }) => {
  await lay(page, STAY);
  await open(page, '#/calendar?month=2026-09');
  await expect(page.locator('.cal-month .cal-lane.lane-1 .mark-bar')).toHaveCount(4);
  const list = card(page, 'What happened in September 2026');
  await expect(list.locator('.row-title').nth(1)).toHaveText('Hospital stay · 3 nights · Example Endoscopy Center');
  await list.locator('.row', { hasText: 'Hospital stay' }).locator('a.row-main').click();
  await expect(page.locator('.event h1')).toHaveText('Hospital stay · 3 nights');
});

test('a private event stays off the Everyone calendar until shown, and on its person’s own', async ({ page }) => {
  await open(page, '#/calendar');
  await page.getByRole('link', { name: 'Previous month: October 2026' }).click();
  await expect(page).toHaveURL(/#\/calendar\?month=2026-10$/);
  await expect(page.locator('.cal-private')).toHaveCount(0);
  await page.getByRole('link', { name: 'Next month: November 2026' }).click();
  const list = card(page, 'What happened in November 2026');
  await expect(list.locator('.row-title')).toHaveText(['Office visit · Example Pediatrics', 'Office visit · Example Health Main Clinic', 'Lisinopril 10 mg tablet · Example Pharmacy', 'Atorvastatin 20 mg tablet · Example Pharmacy']);
  const notice = page.locator('.cal-private');
  await expect(notice).toContainText('2 private events (sexual health) are kept off this shared view.');
  await expect(notice).toContainText('This is discretion, not security');

  // The button keeps the keyboard, and a screen reader hears what changed.
  await notice.getByRole('button', { name: 'Show them' }).click();
  await expect(list.locator('.row', { hasText: 'Clinic visit' }).locator('.chip')).toHaveText('Private');
  await expect(page.getByRole('button', { name: 'Hide them again' })).toBeFocused();
  await expect(page.locator('.calendar').getByRole('status')).toHaveText('2 private events now shown.');
  await page.keyboard.press('Enter');
  await expect(list.locator('.row', { hasText: 'Clinic visit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show them' })).toBeFocused();
  await expect(page.locator('.calendar').getByRole('status')).toHaveText('2 private events hidden again.');

  // Shown, then the calendar is left: back on it, they are hidden again.
  await page.getByRole('button', { name: 'Show them' }).click();
  await page.goto('./?demo#/');
  await page.goto('./?demo#/calendar?month=2026-11');
  await expect(page.locator('.cal-private')).toContainText('2 private events (sexual health) are kept off this shared view.');

  // Sam's own calendar shows it, marked, with no notice.
  await page.getByRole('group', { name: 'Whose calendar' }).getByRole('link', { name: 'Sam' }).click();
  await expect(page).toHaveURL(new RegExp(`#/calendar\\?month=2026-11&who=${SAM}$`));
  await expect(page.locator('.cal-private')).toHaveCount(0);
  const own = card(page, 'What happened in November 2026');
  await expect(own.locator('.row-title')).toHaveText(['Emtricitabine-tenofovir 200-300 mg tablet · Example Pharmacy', 'Office visit · Example Sexual Health Clinic']);
  await own.locator('.row', { hasText: 'Clinic visit' }).locator('a.row-main').click();
  await expect(page.locator('.event-private')).toContainText('Sexual health. Kept off Home and everyone’s Calendar, Money, Papers and search results.');

  // Home's shared list leaves it off.
  await page.goto('./?demo#/');
  await expect(card(page, /^Recently$/)).not.toContainText('Clinic visit');
});

test('the list has every event by month, and a person’s Health opens theirs', async ({ page }) => {
  await open(page, `#/health?who=${SAM}`);
  await card(page, /^What happened$/).getByRole('link', { name: 'All 8 in the calendar' }).click();
  await expect(page).toHaveURL(new RegExp(`#/calendar\\?view=list&who=${SAM}$`));
  await expect(page.getByRole('group', { name: 'View' }).getByRole('link', { name: 'List' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.calendar .card-head h2')).toHaveText(['November 2026', 'October 2026', 'September 2026', 'July 2026', 'May 2026']);
  await expect(card(page, 'September 2026')).toContainText('1 visit, 1 pharmacy trip · your share $213.90.');

  await page.getByRole('group', { name: 'Whose calendar' }).getByRole('link', { name: 'Everyone' }).click();
  await expect(page).toHaveURL(/#\/calendar\?view=list$/);
  await expect(page.locator('.cal-private')).toContainText('2 private events');
});

test('a day billed for a vaccine is a vaccine visit, named for the dose', async ({ page }) => {
  await open(page, '#/calendar?month=2025-10&day=2025-10-20');
  const row = page.locator('.cal-row');
  await expect(row.locator('.row-title')).toHaveText(['Influenza, seasonal, injectable · Example Pediatrics']);
  await expect(row.locator('.row-meta')).toHaveText(['Alex · Vaccine']);
});

test('a day of several vaccines counts its doses, and its page lists each from the clinic’s records', async ({ page }) => {
  await open(page, `#/calendar?view=list&who=${ROBIN}`);
  const october = card(page, 'October 2025');
  await expect(october).toContainText('2 vaccines.');
  await october.getByRole('link', { name: /2 vaccines/ }).click();
  await expect(page.locator('main h1')).toHaveText('2 vaccines');
  await expect(page.locator('.event-sources')).toHaveText('Example Health 2 records');
  const happened = card(page, /^What happened$/);
  await expect(happened.locator('.row-title')).toHaveText(['Influenza, seasonal, injectable', 'COVID-19 vaccine']);
  await expect(happened).toContainText('From the provider’s own records.');
});

test('the month fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await lay(page, STAY);
  await open(page, '#/calendar?month=2026-09');
  await expect(page.locator('.cal-month h2')).toHaveText('September 2026');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const lane = await page.locator('.cal-lane.lane-1 .mark-bar').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lane).toBe('rgb(25, 158, 112)');
});
