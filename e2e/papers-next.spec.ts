import { expect, test, type Page } from '@playwright/test';

// Papers under ?next: the Drive folder, each paper with the visit it belongs
// to, or with none and why.

const ROBIN = 'p_xo4em46i7yj3hphlpajo';

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo&next${path}`);
}

const paper = (page: Page, title: string) => page.locator('.papers .row', { has: page.locator('.row-title', { hasText: new RegExp(`^${title}$`) }) });

test('Home leads to every paper, each with its visit or why it has none', async ({ page }) => {
  await open(page, '#/');
  await page.getByRole('link', { name: 'Papers: every file in the Drive folder, with its visit' }).click();
  await expect(page).toHaveURL(/#\/papers$/);
  await expect(page.locator('main h1')).toHaveText('Papers');
  await expect(page.locator('.papers-count')).toHaveText('16 papers: 15 with a visit, 1 with none.');
  await expect(page.locator('.papers h3.year')).toHaveText(['2026', '2025', '2024']);

  // An explanation of benefits is with its claim's visit, and the link opens it.
  const eob = paper(page, 'Explanation of Benefits');
  await expect(eob.locator('.paper-place')).toHaveText('With Office visit, Oct 1, 2026, through its claim.');
  await eob.locator('.paper-place a').click();
  await expect(page.locator('.event h1')).toHaveText('Office visit');
  await page.goBack();

  // The ones with none, and why.
  await page.getByRole('button', { name: 'With none (1)' }).click();
  await expect(page.getByRole('button', { name: 'With none (1)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.papers .row-title')).toHaveText(['Vaccination card']);
  await expect(page.locator('.paper-none')).toHaveText('With no visit. A vaccine record covers many visits.');
});

test('a person’s papers are theirs, and a receipt is with its bill’s visit', async ({ page }) => {
  await open(page, '#/papers');
  await page.getByRole('group', { name: 'Whose papers' }).getByRole('link', { name: 'Robin Example' }).click();
  await expect(page).toHaveURL(new RegExp(`#/papers\\?who=${ROBIN}$`));
  await expect(page.locator('main h1')).toHaveText('Robin Example’s papers');
  await expect(page.getByRole('group', { name: 'Whose papers' }).getByRole('link', { name: 'Robin Example' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.papers-count')).toHaveText('9 papers: 8 with a visit, 1 with none.');
  await expect(paper(page, 'Payment receipt from Example Health').locator('.paper-place')).toHaveText('With Office visit, Mar 10, 2025, as the receipt for its bill, likely.');
  // A paper opens on its own page.
  await paper(page, 'Vaccination card').locator('a.row-main').click();
  await expect(page.locator('main h1')).toHaveText('Vaccination card');
});

test('Papers asks for ?next', async ({ page }) => {
  await page.goto('./?demo#/papers');
  await expect(page.getByText('Papers is part of the redesign. Add ?next to the address to try it.')).toBeVisible();
});

test('Papers fits a 360px phone in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['#/papers', `#/papers?who=${ROBIN}`]) {
    await open(page, path);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
