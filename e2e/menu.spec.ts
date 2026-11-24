import { expect, test, type Page } from '@playwright/test';

// The bar's menu holds what the four tabs leave out: each person's documents,
// the sources and the settings. Its button carries the dot while a source
// needs attention at the Mac.

const ROBIN = 'p_xo4em46i7yj3hphlpajo';

const menu = (page: Page) => page.getByRole('dialog', { name: 'Menu' });

async function openMenu(page: Page) {
  await page.getByRole('button', { name: /^Menu/ }).click();
  await expect(menu(page)).toBeVisible();
}

test('the menu opens each person’s documents, the sources and the settings', async ({ page }) => {
  await page.goto('./?demo');
  // The sample has a source that needs a sign-in, so the button says so.
  const button = page.getByRole('button', { name: 'Menu: a source needs attention' });
  await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  await openMenu(page);
  await expect(menu(page).locator('h3')).toHaveText(['Documents', 'This app']);
  await expect(menu(page).locator('.menu-item')).toHaveText(['Robin', 'Sam', 'Alex', 'Jamie', 'SourcesA source needs attention', 'Settings']);
  // The first choice takes focus, and Escape gives it back to the button.
  await expect(menu(page).locator('.menu-item').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(button).toBeFocused();

  await openMenu(page);
  await menu(page).getByRole('link', { name: 'Robin' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/p/${ROBIN}/documents$`));
  await expect(page.locator('main h1')).toHaveText('Robin’s documents');

  await openMenu(page);
  await menu(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  // Settings and Sources belong to no tab.
  await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveCount(0);

  await openMenu(page);
  await menu(page).getByRole('link', { name: /^Sources/ }).click();
  await expect(page).toHaveURL(/#\/sources$/);
});

test('the menu fits a 360px phone in the dark theme, and a printed page leaves the tabs out', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./?demo');
  await openMenu(page);
  const box = (await menu(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  for (const item of await menu(page).locator('.menu-item').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');

  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
});
