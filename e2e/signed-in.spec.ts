import { expect, test, type Page } from '@playwright/test';
import { CLIENT, FakeGoogle, FOLDER_NAME, OTHER_CLIENT, OTHER_USER, READ, TOKEN, USER, WRITE } from './fake-google';
import { ROBIN, SAM } from '../test/sample';

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

// Home's line for the sample's one sign-in that needs a person: the folder has loaded.
const NOTICE = 'Example Pediatrics needs a sign-inOn the Mac';
const ACCOUNT_KEY = 'own-your-health-app.account';
const REQUEST_FILE = /^_requests\/\d{8}T\d{6}Z_x_[a-z2-7]{20}\.json$/;

/** Opens the household's setup link and picks the records folder. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`./?client=${CLIENT}`);
  const row = page.locator('.row', { hasText: FOLDER_NAME });
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.signin-notice')).toHaveText(NOTICE);
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

/** How many calls Drive has had, once no more come. */
async function settled(): Promise<number> {
  for (let n = -1; ; ) {
    if (n === google.driveCalls) return n;
    n = google.driveCalls;
    await new Promise((r) => setTimeout(r, 150));
  }
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
  await expect(page.locator('.signin-notice')).toHaveText(NOTICE);
  await expect(page.locator('.stand-name')).toHaveCount(4);

  const kept = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(Object.keys(kept.local).sort()).toEqual(['own-your-health-app.account', 'own-your-health-app.client_id', 'own-your-health-app.folder']);
  expect(kept.local[ACCOUNT_KEY]).toBe(USER.emailAddress);
  expect(kept.session).toEqual({});
  expect(JSON.stringify(kept)).not.toContain(TOKEN);
  expect(google.changes).toEqual([]);
});

test('with no records folder yet, the folder screen points to the guide', async ({ page }) => {
  google.removeAsMac('household.json');
  await page.goto(`./?client=${CLIENT}`);
  await expect(page.getByText('No folder with a household.json was found in this account, or in the folders shared with it.')).toBeVisible();
  await expect(page.getByText('If no one does yet, medrec makes the folder:')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Getting started with medrec' })).toHaveAttribute('href', 'https://github.com/own-your-health/app/blob/main/docs/getting-started.md');
});

test('the next visit signs in without a prompt, as the same account, and opens the same folder', async ({ page }) => {
  // The browser holds two Google accounts: without the hint Google would
  // answer interaction_required.
  await signIn(page);
  await page.goto('./');
  await expect(page.locator('.signin-notice')).toHaveText(NOTICE);
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
  await expect(page.locator('.signin-notice')).toHaveText(NOTICE);
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
  await page.locator('.stand').getByRole('link', { name: /^Robin/ }).click();
  const lead = page.locator('main .lead');
  await expect(lead).toHaveText('Where Robin stands: what is due, what is current, and what is worth a look.');
  const route = new URL(page.url()).hash;
  await page.clock.fastForward('01:00:00');
  await lookAgain(page);
  await expect(page).toHaveURL((u) => u.hash === route && google.signIns.length === 2);
  await expect(lead).toHaveText('Where Robin stands: what is due, what is current, and what is worth a look.');
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
  await expect(page.locator('.signin-notice')).toHaveText(NOTICE);
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

test('a finished Refresh shows what it brought, without a reload', async ({ page }) => {
  const robin = ROBIN;
  await signIn(page);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  await page.evaluate((to) => void (location.hash = to), `#/p/${robin}/allergies`);
  await expect(page.locator('main .row', { hasText: 'Sulfa drugs' })).toBeVisible();

  // The import filed a new name, and medrec wrote its views of the new index.
  const index = JSON.parse(google.read('Robin Example/index.json')!) as { rev: number; records: { kind: string; display: string }[] };
  index.rev += 1;
  index.records.find((r) => r.display === 'Sulfa drugs')!.display = 'An invented allergy';
  const md5 = google.writeAsMac('Robin Example/index.json', JSON.stringify(index));
  const views = JSON.parse(google.read('views/views.json')!) as { people: Record<string, { index: string; linked: Record<string, { index: string }> }> };
  views.people[robin]!.index = md5;
  for (const p of Object.values(views.people)) if (p.linked[robin]) p.linked[robin]!.index = md5;
  google.writeAsMac('views/views.json', JSON.stringify(views));
  // While the request waits, a look reads no records.
  const before = google.reads.length;
  await lookAgain(page);
  await expect.poll(() => google.reads.slice(before)).toContain('_status/status.json');
  // The look reads the request too: the Mac takes it away only after that.
  await expect.poll(() => google.reads.slice(before)).toContain(google.changes[0]!.path);
  expect(google.reads.slice(before).filter((f) => !f.startsWith('_'))).toEqual([]);

  answerAsMac(google.changes[0]!.path);
  await lookAgain(page);
  await expect(page.locator('main .row', { hasText: 'An invented allergy' })).toBeVisible();
  await expect(page.locator('main .row', { hasText: 'Sulfa drugs' })).toHaveCount(0);
  // medrec's lists are of the new index, so nothing is held back.
  await page.evaluate(() => void (location.hash = '#/'));
  await expect(page.locator('.stand-name')).toHaveCount(4);
  await expect(page.locator('main .held-note')).toHaveCount(0);
});

test('a read that fails after a finished Refresh is tried again while the app stays in front', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  google.failing = 'household.json';
  answerAsMac(google.changes[0]!.path);
  const reads = () => google.reads.filter((f) => f === 'household.json').length;
  const before = reads();
  // Each look is the timer's: nothing brings the app to the front.
  await page.clock.fastForward('00:31');
  await expect(page.getByText(/Last refresh request just now: loaded/).first()).toBeVisible();
  await expect.poll(reads).toBe(before + 1);
  await page.clock.fastForward('00:31');
  await expect.poll(reads).toBe(before + 2);
  await expect(page.locator('.toast-error')).toHaveCount(0);
  // Then Drive answers nothing at all, its listings neither: those tries count too.
  google.failing = '*';
  await page.clock.fastForward('01:01');
  await expect(page.locator('.toast-error')).toHaveText('The records could not be read again, so these are from before. Drive: Backend Error');
  google.failing = null;
  await page.clock.fastForward('02:01');
  await expect.poll(reads).toBe(before + 3);
  // Read, so nothing looks again.
  await page.clock.fastForward('20:00');
  expect(reads()).toBe(before + 3);
  problems = problems.filter((p) => !/503/.test(p));
});

test('while Drive is out after a finished Refresh, the looks end', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  await page.getByRole('button', { name: 'Refresh everything' }).click();
  await expect(page.getByText(/waiting for the Mac/).first()).toBeVisible();
  google.failing = 'household.json';
  answerAsMac(google.changes[0]!.path);
  await page.clock.fastForward('00:31');
  await expect(page.getByText(/Last refresh request just now: loaded/).first()).toBeVisible();
  google.failing = '*';
  // Each later try, after twice as long: six in all, each one tick of the timer.
  for (const wait of ['00:31', '01:01', '02:01', '04:01', '08:01']) {
    const before = await settled();
    await page.clock.fastForward(wait);
    await expect.poll(() => google.driveCalls).toBeGreaterThan(before);
  }
  const calls = await settled();
  for (let i = 0; i < 3; i += 1) await page.clock.fastForward('10:00');
  expect(await settled()).toBe(calls);
  // At the front they start over.
  google.failing = null;
  await lookAgain(page);
  await expect.poll(() => google.driveCalls).toBeGreaterThan(calls + 5);
  problems = problems.filter((p) => !/503/.test(p));
});

test('someone held back is shown again when the app comes to the front after medrec has written their list', async ({ page }) => {
  const sam = SAM;
  const list = google.list(`views/${sam}`).find((f) => f.startsWith('private.'))!;
  const content = google.read(`views/${sam}/${list}`)!;
  google.removeAsMac(`views/${sam}/${list}`);
  await signIn(page);
  const note = page.locator('main .held-note');
  await expect(note).toHaveText('Sam’s items are left off Home. medrec is still writing its list of which items are private. Sam’s own pages show them.');

  // Still not there: the line stays.
  const before = google.reads.length;
  await lookAgain(page);
  await expect.poll(() => google.reads.slice(before).filter((f) => f === 'views/views.json').length).toBe(1);
  await expect(note).toHaveCount(1);
  google.writeAsMac(`views/${sam}/${list}`, content);
  await lookAgain(page);
  await expect(note).toHaveCount(0);

  // With no one held back, a look reads no records again.
  const settled = google.reads.length;
  await lookAgain(page);
  await expect.poll(() => google.reads.slice(settled)).toContain('_status/status.json');
  expect(google.reads.slice(settled).filter((f) => !f.startsWith('_'))).toEqual([]);
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
  await expect(card.locator('code.setup-link')).toHaveText(`${baseURL}#/setup/${CLIENT}`);
  await card.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Setup link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}#/setup/${CLIENT}`);
});

test('signing out forgets the token without revoking it, so medrec on the Mac stays signed in', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByText('Signing out forgets this browser’s sign-in. medrec on the Mac stays signed in.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  // Google's revoke would end every sign-in to the project, medrec's included.
  expect(google.revoked).toEqual([]);
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
