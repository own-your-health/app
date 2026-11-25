import { expect, test, type Page } from '@playwright/test';
import { CLIENT, FakeGoogle, FOLDER_NAME, OTHER_USER, USER } from './fake-google';
import { SAM } from '../test/sample';
import { demoJson } from '../test/helpers';

// The records folder shared with another account (fake-google.ts): finding it,
// what an account that may only view it is told, and a folder it cannot open.

let problems: string[] = [];
let google: FakeGoogle;

test.beforeEach(async ({ page, context }) => {
  problems = [];
  page.on('console', (m) => {
    // Chrome logs Drive's answer for a folder the account cannot open, and for a search that fails.
    if ((m.type() === 'error' || m.type() === 'warning') && !/status of (404|503)/.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  google = new FakeGoogle();
  google.chooses = OTHER_USER;
  await google.install(context);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
  expect(google.strays).toEqual([]);
  expect(google.changes).toEqual([]);
});

const folderRow = (page: Page) => page.locator('.row', { hasText: FOLDER_NAME });
const SIGN_IN_ROW = '.signin-notice';

/** Sam's bill with something left to pay. */
function samsBill(): string {
  const { documents } = demoJson<{ documents: { id: string; statement?: { amount_due?: { amount: string } } }[] }>('Sam Example/index.json');
  return documents.find((d) => d.statement?.amount_due?.amount === '90.50')!.id;
}

async function open(page: Page): Promise<void> {
  await page.goto(`./?client=${CLIENT}`);
  await folderRow(page).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator(SIGN_IN_ROW)).toBeVisible();
}

for (const throughFolder of [true, false]) test(`a folder shared to view only is found, ${throughFolder ? 'where Drive’s search by name finds none of its files' : 'once'}`, async ({ page }) => {
  google.viewer = true;
  google.throughFolder = throughFolder;
  await page.goto(`./?client=${CLIENT}`);
  await expect(folderRow(page)).toHaveCount(1);
  await expect(folderRow(page).locator('.row-meta')).toHaveText(/^Shared by Robin Example, to view only · household\.json changed /);
  await expect(page.getByText(`Signed in as ${OTHER_USER.emailAddress}.`)).toBeVisible();
});

test('an account’s own folder says nothing of sharing', async ({ page }) => {
  await page.goto(`./?client=${CLIENT}`);
  await expect(folderRow(page).locator('.row-meta')).toHaveText(/^household\.json changed /);
});

test('an account that may only view is told so where it would ask the Mac, and has no button for it', async ({ page }) => {
  google.viewer = true;
  await open(page);
  const buttons = page.getByRole('button', { name: /^(Refresh|Mark paid)/ });
  const only = page.locator('.status-strip').getByRole('link', { name: 'View only: this account cannot ask the Mac to refresh, see Settings' });
  await expect(only).toHaveText('View only');
  await expect(buttons).toHaveCount(0);
  // Sources says it once, not on every row.
  await page.goto('./#/sources');
  await expect(page.locator('.glance')).toContainText('This account can only view the records folder, so it cannot ask the Mac to refresh.');
  await expect(page.getByText('can only view')).toHaveCount(1);
  await expect(page.locator('.row-actions')).toHaveCount(0);
  await expect(buttons).toHaveCount(0);
  await page.locator('.card', { hasText: 'Other sources' }).locator('.row-main', { has: page.getByText('Example Health', { exact: true }) }).first().click();
  await expect(page.locator('h1')).toHaveText('Example Health');
  await expect(page.getByText('can only view')).toHaveCount(1);
  await expect(buttons).toHaveCount(0);
  // A bill with something left to pay says why it has no Mark paid.
  await page.goto(`./#/p/${SAM}/r/${samsBill()}`);
  await expect(page.getByText('This account can only view the records folder, so it cannot mark this bill paid.')).toBeVisible();
  await expect(buttons).toHaveCount(0);
  await page.goto('./');
  await only.click();
  await expect(page).toHaveURL(/#\/settings$/);
  const row = (label: string) => page.locator('.kv-row', { has: page.getByText(label, { exact: true }) });
  await expect(row('This account')).toContainText('Can only view it: it cannot ask the Mac to refresh, or mark a bill paid. The folder’s owner can make this account an Editor in Google Drive.');
  await expect(row('Ask the Mac')).toContainText('Not in this folder, which this account can only view');
});

test('the owner keeps Refresh, whatever Drive says of adding to the folder', async ({ page }) => {
  google.saysNo = true;
  await open(page);
  await expect(page.getByRole('button', { name: 'Refresh everything' })).toBeVisible();
  await page.goto('./#/settings');
  await expect(page.getByText('This account', { exact: true })).toHaveCount(0);
  await expect(page.locator('.kv-row', { hasText: 'Ask the Mac' })).toContainText('Allowed');
});

test('a folder not shared yet names the account to share it with, and is found once it is', async ({ page }) => {
  google.viewer = true;
  google.unshared = true;
  await page.goto(`./?client=${CLIENT}`);
  await expect(page.getByText('No folder with a household.json was found in this account, or in the folders shared with it.')).toBeVisible();
  await expect(page.getByText(`ask them to share the folder with ${OTHER_USER.emailAddress} in Google Drive.`)).toBeVisible();
  await page.getByRole('textbox', { name: 'Folder link' }).fill(`https://drive.google.com/drive/folders/${google.rootId}`);
  const paste = page.locator('.card', { hasText: 'Or paste its link' });
  await paste.getByRole('button', { name: 'Open' }).click();
  await expect(paste.locator('.error-text')).toHaveText(`${OTHER_USER.emailAddress} cannot open that folder. If it is someone else’s, ask them to share it with ${OTHER_USER.emailAddress} in Google Drive, then open it again.`);
  google.unshared = false;
  await page.getByRole('button', { name: 'Look again' }).click();
  await expect(folderRow(page)).toHaveCount(1);
  await paste.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator(SIGN_IN_ROW)).toBeVisible();
});

test('a folder no longer shared says which account cannot open it', async ({ page }) => {
  google.viewer = true;
  await open(page);
  google.unshared = true;
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'That folder could not be opened' })).toBeVisible();
  await expect(page.locator('main')).toContainText(`${OTHER_USER.emailAddress} cannot open that folder.`);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await expect(page.getByText(`Signed in as ${OTHER_USER.emailAddress}.`)).toBeVisible();
});

test('a search Drive does not answer is tried again', async ({ page }) => {
  // An owner whose folder the search by name would find is not told there is none.
  google.searchDown = 'by name';
  await page.goto(`./?client=${CLIENT}`);
  await expect(page.getByText('Drive: Backend Error')).toBeVisible();
  await expect(page.getByText('No folder with a household.json')).toHaveCount(0);
  google.searchDown = undefined;
  await page.getByRole('button', { name: 'Look again' }).click();
  await expect(folderRow(page)).toHaveCount(1);
  await expect(page.getByText('there may be more')).toHaveCount(0);
});

test('a list Drive did not all answer for says there may be more', async ({ page }) => {
  google.viewer = true;
  google.searchDown = 'by name';
  await page.goto(`./?client=${CLIENT}`);
  await expect(folderRow(page)).toHaveCount(1);
  await expect(page.getByText('Google Drive did not answer everything it was asked, so there may be more.')).toBeVisible();
  google.searchDown = undefined;
  await page.getByRole('button', { name: 'Look again' }).click();
  await expect(page.getByText('there may be more')).toHaveCount(0);
  await expect(folderRow(page)).toHaveCount(1);
});

test('the folder screen signs in as a different account', async ({ page }) => {
  google.viewer = true;
  google.unshared = true;
  await page.goto(`./?client=${CLIENT}`);
  await expect(page.getByText(`Signed in as ${OTHER_USER.emailAddress}.`)).toBeVisible();
  google.viewer = false;
  google.unshared = false;
  google.chooses = USER;
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await expect(page.getByText(`Signed in as ${USER.emailAddress}.`)).toBeVisible();
  await expect(folderRow(page)).toHaveCount(1);
  expect(google.signIns.map((s) => [s.prompt, s.hint])).toEqual([
    ['select_account', null],
    ['select_account', null],
  ]);
});
