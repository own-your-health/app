import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { demoJson, type Overlay } from '../test/helpers';
import { CLIENT, FakeGoogle, FOLDER_NAME } from './fake-google';
import { lay } from './lay';
import { macWrites } from './mac';
import { readFileSync } from 'node:fs';
import { ROBIN } from '../test/sample';

// views.json's `reader` (medrec 0.9.11 and later): the oldest medrec contract a
// reader must follow to read the views, `medrec` standing in where it is
// absent. An app that follows an older one reads nothing of the folder and
// says it must be updated; this one looks for its own update first.

const VIEWS = 'views/views.json';
const NOTE = 'These records were written by a newer medrec. Update the app to see them.';
/** The sample's people by the first names its screens give them. */
const PEOPLE = demoJson<{ people: { name: string }[] }>('household.json').people.map((p) => p.name.split(' ')[0]!);

/** The sample's views.json with these `reader` and `medrec`; one left out is absent. */
function views(fields: { reader?: string; medrec?: string }): string {
  const v = demoJson<Record<string, unknown>>(VIEWS);
  delete v.reader;
  delete v.medrec;
  return JSON.stringify({ ...v, ...fields });
}

const withViews = (fields: { reader?: string; medrec?: string }): Overlay => ({ [VIEWS]: views(fields) });
const main = (page: Page) => page.locator('main');

/** Opens the sample, counting the page's loads. */
async function openSample(page: Page, overlay: Overlay): Promise<{ loads: () => number }> {
  await lay(page, overlay);
  let loads = 0;
  page.on('load', () => (loads += 1));
  await page.goto('./?demo');
  return { loads: () => loads };
}

const FAILED = `${NOTE} The app’s site could not be reached to look for a newer app. Check the connection and look again.`;
const NONE_YET = `${NOTE} There is no newer app yet. Look again later.`;

/** The page says to update, its heading taking focus and read with the text, and shows nothing of the folder: no one's name, no tabs, sheet, toast or sample banner. */
async function refused(page: Page, text = NOTE): Promise<void> {
  const heading = main(page).getByRole('heading', { name: 'Update the app' });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAccessibleDescription(text);
  await expect(main(page)).toContainText(text);
  await expect(page.locator('.app-tabs, .banner-sample, .scrim, .toast')).toHaveCount(0);
  const shown = await page.locator('body').innerText();
  expect(PEOPLE.filter((name) => shown.includes(name))).toEqual([]);
}

test.describe('a folder whose views do not name their reader', () => {
  for (const medrec of ['0.9.5', '0.9.10']) {
    test(`opens, written by medrec ${medrec}`, async ({ page }) => {
      await openSample(page, withViews({ medrec }));
      await expect(main(page)).toContainText('Where everyone stands');
    });
  }
});

test('a folder whose reader is the contract the app follows opens', async ({ page }) => {
  await openSample(page, withViews({ reader: '0.9.10', medrec: '0.9.11' }));
  await expect(main(page)).toContainText('Where everyone stands');
});

test('a folder whose reader is newer, with no newer app on the site, shows nothing of itself on any screen, and says to update', async ({ page, baseURL }) => {
  const asked: string[] = [];
  page.on('request', (r) => void (r.resourceType() === 'fetch' && r.url() === baseURL && asked.push(r.url())));
  const { loads } = await openSample(page, withViews({ reader: '0.9.11', medrec: '0.9.11' }));
  await refused(page);
  expect([asked.length, loads()]).toEqual([1, 1]);
  for (const to of ['#/', `#/p/${ROBIN}`, `#/p/${ROBIN}/results`, '#/search?q=a', '#/calendar']) {
    await page.evaluate((hash) => (location.hash = hash), to);
    await refused(page);
  }
  await main(page).getByRole('button', { name: 'Look for an update' }).click();
  await refused(page, NONE_YET);
  expect([asked.length, loads()]).toEqual([2, 1]);
  await expect(main(page).getByRole('button', { name: 'Choose a folder' })).toHaveCount(0);
});

test('a folder whose reader is newer, where the site cannot be reached, says the look failed', async ({ page, baseURL }) => {
  let site = false;
  await page.route(`${baseURL}`, (route) => (route.request().resourceType() === 'fetch' && !site ? route.abort('internetdisconnected') : route.continue()));
  await openSample(page, withViews({ reader: '0.9.11', medrec: '0.9.11' }));
  await refused(page, FAILED);
  site = true;
  await main(page).getByRole('button', { name: 'Look for an update' }).click();
  await refused(page, NONE_YET);
});

test('a folder whose reader is newer loads the newer app on the site, which opens it', async ({ page, baseURL }) => {
  // The site after a deploy: its page names another build, whose script follows medrec 0.9.11's contract.
  let deployed = false;
  let raised = 0;
  await page.route(`${baseURL}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    const res = await route.fetch();
    deployed = true;
    await route.fulfill({ response: res, body: (await res.text()).replace(/assets\/index-[\w-]+\.js/, 'assets/index-NEWBUILD.js') });
  });
  await page.route(/\/app\/assets\/index-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    const script = await res.text();
    if (!deployed) return route.fulfill({ response: res, body: script });
    raised = script.split('`0.9.10`').length - 1;
    await route.fulfill({ response: res, body: script.replace('`0.9.10`', '`0.9.11`') });
  });
  const { loads } = await openSample(page, withViews({ reader: '0.9.11', medrec: '0.9.11' }));
  await expect(main(page)).toContainText('Where everyone stands');
  expect([loads(), raised]).toEqual([2, 1]);
  expect(new URL(page.url()).search).toBe('?demo');
});

test('a page that still loads the old app after reloading for a newer one says to update and reloads no more by itself, but the button loads it again', async ({ page, baseURL }) => {
  await page.route(`${baseURL}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/assets\/index-[\w-]+\.js/, 'assets/index-NEWBUILD.js') });
  });
  const { loads } = await openSample(page, withViews({ reader: '0.9.11', medrec: '0.9.11' }));
  await refused(page);
  expect(loads()).toBe(2);
  await main(page).getByRole('button', { name: 'Look for an update' }).click();
  await expect.poll(loads).toBe(3);
  await refused(page);
  expect(loads()).toBe(3);
});

test('the sample, read again after medrec writes views with a newer reader, leaves the screen and its sample banner', async ({ page }) => {
  const overlay: Overlay = {};
  await openSample(page, overlay);
  await expect(main(page)).toContainText('Where everyone stands');
  await expect(page.locator('.banner-sample')).toBeVisible();
  Object.assign(overlay, withViews({ reader: '0.9.11', medrec: '0.9.11' }));
  await main(page).getByRole('button', { name: 'Refresh' }).click();
  // The sample's Mac picks the request up and loads in about 6 seconds.
  await expect(main(page).getByRole('heading', { name: 'Update the app' })).toBeVisible({ timeout: 20_000 });
  await refused(page);
});

test('the site says which medrec contract it follows, to anyone, as JSON', async ({ request }) => {
  const res = await request.get('medrec-contract.json');
  expect([res.status(), res.headers()['content-type']]).toEqual([200, 'application/json']);
  expect(await res.text()).toBe(readFileSync('src/medrec-contract.json', 'utf8'));
  expect(await res.json()).toEqual({ schema: 'own-your-health-app/medrec-contract/v1', follows: '0.9.10' });
});

test.describe('signed in to Drive', () => {
  async function signIn(page: Page, context: BrowserContext, overlay: Overlay = {}): Promise<FakeGoogle> {
    const google = new FakeGoogle(new Date('2026-11-22T20:00:00Z'));
    for (const [path, text] of Object.entries(overlay)) if (text !== null) google.writeAsMac(path, text);
    await google.install(context);
    await page.goto(`./?client=${CLIENT}`);
    await page.locator('.row', { hasText: FOLDER_NAME }).getByRole('button', { name: 'Open' }).click();
    return google;
  }

  test('a folder whose reader is newer is not opened: nothing but views.json, household.json and the answered requests is read, and it stays chosen', async ({ page, context }) => {
    const google = await signIn(page, context, withViews({ reader: '0.9.11', medrec: '0.9.11' }));
    await refused(page);
    await page.waitForTimeout(300);
    expect([...new Set(google.reads)].filter((r) => ![VIEWS, 'household.json'].includes(r) && !r.startsWith('_requests/done'))).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('own-your-health-app.folder') ?? 'null') as { name?: string } | null)).toMatchObject({ name: FOLDER_NAME });
    // Another folder is one tap away; choosing forgets this one.
    await main(page).getByRole('button', { name: 'Choose a folder' }).click();
    await expect(page.locator('.row', { hasText: FOLDER_NAME })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('own-your-health-app.folder'))).toBeNull();
  });

  test('an open folder whose household.json medrec writes again in a newer format leaves the screen, and says to update', async ({ page, context }) => {
    const google = await signIn(page, context);
    await expect(main(page)).toContainText('Where everyone stands');
    const household = { ...demoJson<Record<string, unknown>>('household.json'), format: 99 };
    await macWrites(page, google, { 'household.json': JSON.stringify(household) }, 1);
    const said = main(page).locator('p').first();
    await expect(said).toHaveText(/newer than this app reads\b.* Update the app\.$/);
    await refused(page, await said.innerText());
  });

  test('an open Mark paid sheet closes when the folder is refused on reading it again', async ({ page, context }) => {
    const google = await signIn(page, context);
    await expect(main(page)).toContainText('Where everyone stands');
    await page.evaluate(() => (location.hash = '#/money/bills'));
    await main(page).getByRole('button', { name: /^Mark paid:/ }).first().click();
    await expect(page.getByRole('dialog', { name: 'Mark paid' })).toBeVisible();
    await macWrites(page, google, withViews({ reader: '0.9.11', medrec: '0.9.11' }), 2);
    await refused(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('an open folder whose views medrec writes again with a newer reader leaves the screen, and says to update', async ({ page, context }) => {
    const google = await signIn(page, context);
    await expect(main(page)).toContainText('Where everyone stands');
    await page.evaluate((hash) => (location.hash = hash), `#/p/${ROBIN}/results`);
    await expect(main(page).locator('.row').first()).toBeVisible();
    await macWrites(page, google, withViews({ reader: '0.9.11', medrec: '0.9.11' }), 0);
    await refused(page);
  });
});
