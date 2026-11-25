import { expect, test, type Page } from '@playwright/test';

// The setup link, in both its forms, on the real app, up to Google's sign-in
// page, which a stand-in answers: no Google account is used.

const ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const OTHER = '999999999999-zyxwvutsrqponmlkjihgfedcba543210.apps.googleusercontent.com';
const KEY = 'own-your-health-app.client_id';
const GOOGLE = /^https:\/\/accounts\.google\.com\//;

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.route(GOOGLE, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Google sign-in stand-in</title>' }));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

function signInRequest(page: Page): { clientId: string | null; redirect: string | null; prompt: string | null; route: string } {
  const u = new URL(page.url());
  const state = u.searchParams.get('state') ?? '';
  const json = JSON.parse(atob(state.replace(/-/g, '+').replace(/_/g, '/'))) as { r: string };
  return { clientId: u.searchParams.get('client_id'), redirect: u.searchParams.get('redirect_uri'), prompt: u.searchParams.get('prompt'), route: json.r };
}

/** Both forms of the link: the one the app gives, and the one it gave before. */
const FORMS: [string, (id: string, route?: string) => string][] = [
  ['after the #', (id, route = '') => `./#/setup/${id}${route}`],
  ['before the #', (id, route = '') => `./?client=${id}${route && `#${route}`}`],
];

for (const [form, link] of FORMS) {
  test(`a setup link with its client ${form} stores the client and goes straight to sign-in`, async ({ page, baseURL }) => {
    const asked: string[] = [];
    page.on('request', (r) => asked.push(r.url()));
    await page.goto(link(ID, '/hh/hh-demo-robin'));
    await page.waitForURL(GOOGLE);
    // The app's own site receives the older form's client with the page, and nothing else with it.
    expect(asked.filter((u) => u.startsWith(baseURL!) && u.split('#')[0]!.includes(ID))).toHaveLength(form === 'after the #' ? 0 : 1);
    const req = signInRequest(page);
    expect(req.clientId).toBe(ID);
    expect(req.redirect).toBe(baseURL);
    expect(req.prompt).toContain('select_account');
    expect(req.route).toBe('#/hh/hh-demo-robin');
    // The redirect runs before the page has loaded, so the browser replaces the
    // link's history entry: nothing to go back to. The client was kept.
    await page.goto('./#/hh/hh-demo-robin');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(ID);
  });

  test(`a setup link with its client ${form} asks before replacing another client`, async ({ page }) => {
    await page.goto('./');
    await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [KEY, OTHER]);
    await page.goto(link(ID));
    await expect(page.getByRole('heading', { name: 'Use the client in this link?' })).toBeVisible();
    expect(page.url()).not.toContain(ID);
    await page.getByRole('button', { name: 'Keep the current one' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(OTHER);

    await page.goto(link(ID));
    await page.getByRole('button', { name: 'Use the link’s client' }).click();
    await page.waitForURL(GOOGLE);
    expect(signInRequest(page).clientId).toBe(ID);
  });

  test(`a setup link with no valid client id ${form} falls back to the paste field`, async ({ page }) => {
    await page.goto(link('not-a-client-id'));
    await expect(page.getByText(/no valid Google client id/)).toBeVisible();
    await expect(page.locator('input[aria-label="Google OAuth client id or setup link"]')).toBeVisible();
    expect(page.url()).not.toContain('not-a-client-id');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test(`a setup link with its client ${form} pasted into the client field works as the client id does`, async ({ page, baseURL }) => {
    // An app added to an iPhone's Home Screen has its own storage and no
    // address bar, so the link is pasted there.
    await page.goto('./');
    const field = page.locator('input[aria-label="Google OAuth client id or setup link"]');
    const whole = (id: string) => new URL(link(id), baseURL).href;
    await field.fill(whole(ID.slice(0, 40)));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/That link has no valid Google client id/)).toBeVisible();
    await field.fill(whole(ID));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(ID);
  });

  test(`a setup link with its client ${form} changes nothing in the sample folder`, async ({ page }) => {
    await page.goto(link(ID, '/settings').replace('./?', './?demo=1&').replace('./#', './?demo=1#'));
    await expect(page.getByLabel('Plan year starts')).toBeVisible();
    expect(page.url()).not.toContain(ID);
    expect(page.url()).toMatch(/\?demo=1#\/settings$/);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  });
}

test('a setup link opened where the app already runs starts again with it', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('input[aria-label="Google OAuth client id or setup link"]')).toBeVisible();
  await page.evaluate((id) => (location.hash = `#/setup/${id}/hh/hh-demo-robin`), ID);
  await page.waitForURL(GOOGLE);
  expect(signInRequest(page)).toMatchObject({ clientId: ID, route: '#/hh/hh-demo-robin' });
});
