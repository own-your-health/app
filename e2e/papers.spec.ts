import { expect, test, type Page } from '@playwright/test';

// Papers: the Drive folder, each paper with the visit it belongs to, or with
// none and why. It took the place of each person's list of documents.

const ROBIN = 'p_xo4em46i7yj3hphlpajo';

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await page.goto(`./?demo${path}`);
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
  await expect(page.locator('.papers').getByRole('status')).toHaveText('1 paper with no visit.');
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

test('a person’s Health and their old documents address open their Papers, which narrows by kind and counts pages', async ({ page }) => {
  await open(page, `#/health?who=${ROBIN}`);
  await page.locator('.health-actions').getByRole('link', { name: 'Papers' }).click();
  await expect(page).toHaveURL(new RegExp(`#/papers\\?who=${ROBIN}$`));
  await page.goto(`./?demo#/p/${ROBIN}/documents`);
  await expect(page).toHaveURL(new RegExp(`#/papers\\?who=${ROBIN}$`));
  await expect(page.locator('main h1')).toHaveText('Robin Example’s papers');

  const kinds = page.getByRole('group', { name: 'Kind of paper' });
  await expect(kinds.getByRole('button')).toHaveText(['Every kind', 'Bill (3)', 'Explanation of benefits (1)', 'Immunization record (1)', 'Lab report (2)', 'Receipt (1)', 'Visit summary (1)']);
  await expect(paper(page, 'Explanation of Benefits').locator('.row-meta')).toHaveText('Explanation of benefits · Oct 20, 2026 · Example Health Plan · 2 pages');
  await kinds.getByRole('button', { name: 'Bill (3)' }).click();
  await expect(kinds.getByRole('button', { name: 'Bill (3)' })).toBeFocused();
  await expect(page.locator('.papers').getByRole('status')).toHaveText('3 papers in all, bill.');
  await expect(page.locator('.papers .row-meta')).toHaveText([/^Bill · /, /^Bill · /, /^Bill · /]);
  // With the visit filter: none of the bills is without one.
  await page.getByRole('button', { name: 'With none (1)' }).click();
  await expect(page.locator('.papers')).toContainText('Every bill here is with its visit.');
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
