import { expect, test, type Page } from '@playwright/test';
import { CLIENT, FakeGoogle, FOLDER_NAME, OTHER_CLIENT, OTHER_USER, READ, TOKEN, USER, WRITE } from './fake-google';

// The signed-in app against a stand-in for Google and Drive (fake-google.ts):
// sign-in, the folder, Refresh and its answer, and what the app may change.
// No Google account is used, and every other host is blocked.

let problems: string[] = [];
let google: FakeGoogle;

test.beforeEach(async ({ page, context }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  google = new FakeGoogle();
  await google.install(context);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
  expect(google.strays).toEqual([]);
});

const HEADLINE = '1 sign-in needs a person';
const ACCOUNT_KEY = 'own-your-health-app.account';
const REQUEST_FILE = /^_requests\/\d{8}T\d{6}Z_x_[a-z2-7]{20}\.json$/;

/** Opens the household's setup link and picks the records folder. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`./?client=${CLIENT}`);
  const row = page.locator('.row', { hasText: FOLDER_NAME });
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.glance-answer')).toHaveText(HEADLINE);
}

/** medrec on the Mac takes a request: its answer in done/, the pending file gone. */
function answerAsMac(path: string, opts: { removePending?: boolean } = {}): void {
  const req = JSON.parse(google.read(path)!) as Record<string, unknown>;
  const now = new Date();
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const handled = {
    picked_up_at: at(-2000),
    finished_at: at(0),
    outcome: 'ok',
    sources: [{ source: 's_odljb2zaec4qvcbrepln', outcome: 'ok', attempt: 't_aaaaaaaaaaaaaaaaaaaa', next_allowed_at: at(86_400_000) }],
    message: '1 source imported',
    by: 'medrec 0.3.0',
  };
  google.writeAsMac(path.replace('_requests/', '_requests/done/'), JSON.stringify({ ...req, handled }, null, 2));
  if (opts.removePending !== false) google.removeAsMac(path);
  const status = JSON.parse(google.read('_status/status.json')!) as { updated_at: string };
  status.updated_at = at(0);
  google.writeAsMac('_status/status.json', JSON.stringify(status, null, 2));
}

/** What the app does when the phone's screen comes back on: it reads the folder again. */
async function lookAgain(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

test('a setup link signs in, finds the records folder and reads it', async ({ page, baseURL }) => {
  await page.goto(`./?client=${CLIENT}`);
  await expect(page.locator('.row', { hasText: FOLDER_NAME })).toBeVisible();
  expect(google.signIns).toEqual([{ clientId: CLIENT, prompt: 'select_account', scope: `${READ} ${WRITE}`, hint: null }]);
  // Google's answer leaves the address at once.
  expect(page.url()).toBe(`${baseURL}#/`);
  await page.locator('.row', { hasText: FOLDER_NAME }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.glance-answer')).toHaveText(HEADLINE);
  await expect(page.locator('.card', { hasText: 'People' }).locator('.row')).toHaveCount(3);

  const kept = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(Object.keys(kept.local).sort()).toEqual(['own-your-health-app.account', 'own-your-health-app.client_id', 'own-your-health-app.folder']);
  expect(kept.local[ACCOUNT_KEY]).toBe(USER.emailAddress);
  expect(kept.session).toEqual({});
  expect(JSON.stringify(kept)).not.toContain(TOKEN);
  expect(google.changes).toEqual([]);
});

test('the next visit signs in without a prompt, as the same account, and opens the same folder', async ({ page }) => {
  // The browser holds two Google accounts: without the hint Google would
  // answer interaction_required.
  await signIn(page);
  await page.goto('./');
  await expect(page.locator('.glance-answer')).toHaveText(HEADLINE);
  expect(google.signIns.map((s) => [s.prompt, s.hint])).toEqual([
    ['select_account', null],
    ['none', USER.emailAddress],
  ]);
});

test('with no account stored, a browser with two Google accounts asks once', async ({ page }) => {
  await signIn(page);
  await page.evaluate((k) => localStorage.removeItem(k), ACCOUNT_KEY);
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.locator('.error-text')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use a different account' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('.glance-answer')).toHaveText(HEADLINE);
  expect(google.signIns.map((s) => [s.prompt, s.hint])).toEqual([
    ['select_account', null],
    ['none', null],
    ['select_account', null],
  ]);
  expect(await page.evaluate((k) => localStorage.getItem(k), ACCOUNT_KEY)).toBe(USER.emailAddress);
});

test('an hour later the sign-in renews itself, as the same account, on the same screen', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  await page.getByRole('link', { name: /^Robin Example/ }).first().click();
  await expect(page.locator('.person-head h1')).toHaveText('Robin Example');
  const route = new URL(page.url()).hash;
  await page.clock.fastForward('01:00:00');
  await lookAgain(page);
  await expect(page).toHaveURL((u) => u.hash === route && google.signIns.length === 2);
  await expect(page.locator('.person-head h1')).toHaveText('Robin Example');
  expect(google.signIns[1]).toMatchObject({ prompt: 'none', hint: USER.emailAddress });
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
});

test('a Drive read after the hour renews the sign-in on its own', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  // While a request waits, the app looks for the answer every 30 seconds;
  // the first look after the hour needs a new token.
  await page.clock.fastForward('01:00:00');
  await expect.poll(() => google.signIns.length).toBe(2);
  expect(google.signIns[1]).toMatchObject({ prompt: 'none', hint: USER.emailAddress });
  // Back on the same screen with the request still there; an hour on, the
  // stand-in's Mac has not taken it.
  await expect(page.getByText(/^Asked 1 hour ago; the Mac has not taken it yet/).first()).toBeVisible();
  expect(google.changes).toHaveLength(1);
});

test('a Refresh tapped after the hour renews the sign-in and says the request was not sent', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  // The page stayed in view, so nothing renewed it before the tap.
  await page.clock.fastForward('01:00:00');
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText('Your Google sign-in had ended, so the app signed in again. The refresh request was not sent: tap Refresh again.')).toBeVisible();
  expect(google.signIns[1]).toMatchObject({ prompt: 'none', hint: USER.emailAddress });
  expect(google.changes).toEqual([]);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  expect(google.changes).toHaveLength(1);
});

test('when Google needs the person, the renewal says so, and another account can be chosen', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  google.accounts = [];
  await page.clock.fastForward('01:00:00');
  await lookAgain(page);
  await expect(page.getByText('Your Google sign-in ended, as it does after an hour, and Google needs you to sign in again.')).toBeVisible();
  await expect(page.getByText(`As ${USER.emailAddress}, the account that signed in last.`)).toBeVisible();

  google.accounts = [USER, OTHER_USER];
  google.chooses = OTHER_USER;
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await expect(page.locator('.glance-answer')).toHaveText(HEADLINE);
  expect(google.signIns.map((s) => [s.prompt, s.hint])).toEqual([
    ['select_account', null],
    ['none', USER.emailAddress],
    ['select_account', null],
  ]);
  expect(await page.evaluate((k) => localStorage.getItem(k), ACCOUNT_KEY)).toBe(OTHER_USER.emailAddress);
});

test('Refresh writes one request and shows the Mac’s answer', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  expect(google.changes).toHaveLength(1);
  const { method, path } = google.changes[0]!;
  expect(method).toBe('CREATE');
  expect(path).toMatch(REQUEST_FILE);
  expect(JSON.parse(google.read(path)!)).toMatchObject({
    schema: 'medrec-request/v1',
    scope: { all: true },
    requested_by: { email: USER.emailAddress, name: USER.displayName },
    app: { name: 'own-your-health-app' },
  });

  answerAsMac(path);
  await lookAgain(page);
  await expect(page.getByText(/Last refresh request just now: loaded/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
  expect(google.changes).toHaveLength(1);
});

test('a request is cancelled by removing only its own file', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
  const path = google.changes[0]!.path;
  expect(google.changes).toEqual([
    { method: 'CREATE', path },
    { method: 'DELETE', path },
  ]);
  expect(google.list('_requests')).toEqual(['done']);
});

test('an answered request medrec could not remove is tidied by the app', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  const path = google.changes[0]!.path;
  answerAsMac(path, { removePending: false });
  await lookAgain(page);
  await expect(page.getByText(/Last refresh request just now: loaded/).first()).toBeVisible();
  await expect.poll(() => google.changes).toEqual([
    { method: 'CREATE', path },
    { method: 'DELETE', path },
  ]);
});

test('Settings gives the setup link for another device', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await page.evaluate(() => (location.hash = '#/settings'));
  const card = page.locator('.card', { hasText: 'Setup link for another device' });
  await expect(card.locator('code.setup-link')).toHaveText(`${baseURL}?client=${CLIENT}`);
  await card.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Setup link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}?client=${CLIENT}`);
});

test('signing out revokes the token', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect(google.revoked).toEqual([TOKEN]);
  expect(await page.evaluate((k) => localStorage.getItem(k), ACCOUNT_KEY)).toBeNull();
  await expect(page.getByRole('button', { name: 'Use a different account' })).toHaveCount(0);
  expect(google.changes).toEqual([]);
});

test('a token Google issued to another app is refused before Drive is read', async ({ page }) => {
  google.audience = OTHER_CLIENT;
  await page.goto(`./?client=${CLIENT}`);
  await expect(page.getByText('Google did not confirm this sign-in for your client. Sign in again.')).toBeVisible();
  expect(google.driveCalls).toBe(0);
});

test('without Drive read access the app says what to allow', async ({ page }) => {
  google.granted = [WRITE];
  await page.goto(`./?client=${CLIENT}`);
  await expect(page.getByText(/needs permission to read your Drive/)).toBeVisible();
  expect(google.driveCalls).toBe(0);
});

test('without the Drive file permission the records show, and Refresh says what is missing', async ({ page }) => {
  google.granted = [READ];
  await signIn(page);
  await expect(page.getByText('Refresh needs the Drive file permission (Settings)').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toHaveCount(0);
  expect(google.changes).toEqual([]);
});
