import { expect, test, type Page } from '@playwright/test';
import { demoJson } from '../test/helpers';
import { rewritten } from './alter';
import { lay } from './lay';
import { ALEX, DREW, ROBIN, SAM } from '../test/sample';

// A provider's page, from the items that name it: one person's, or
// everyone's, which leaves private items off.

interface Rec {
  id: string;
  kind: string;
  date?: string;
  fields: Record<string, unknown>;
}
const NAMES: Record<string, string> = { [ROBIN]: 'Robin', [SAM]: 'Sam', [ALEX]: 'Alex', [DREW]: 'Drew' };
const records = (who: string) => demoJson<{ records: Rec[] }>(`${NAMES[who]} Example/index.json`).records;
/** The newest of someone's records that names a provider in a field. */
const recordOf = (who: string, kind: string, field: string, name: string): string =>
  records(who)
    .filter((r) => r.kind === kind && r.fields[field] === name)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!.id;
const providerPath = (who: string, kind: string, field: string, name: string, all = false) => `#/p/${who}/provider/${recordOf(who, kind, field, name)}/${field}${all ? '?all=1' : ''}`;

const PRIVATE = /Sexual Health|Avery Sample|Emtricitabine|HIV/i;
const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const rows = (page: Page, title: string | RegExp) => card(page, title).locator('.row');
const figures = async (page: Page) => Object.fromEntries((await card(page, 'In all').locator('.event-step').allInnerTexts()).map((t) => t.split('\n') as [string, string]));

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('a visit’s place and each of who charged what opens the provider’s page, which its address does not name', async ({ page }) => {
  await go(page, `#/p/${SAM}/e/${recordOf(SAM, 'claim', 'provider', 'Example Endoscopy Center')}`);
  await page.locator('.event > section.card').first().getByRole('link', { name: 'Example Endoscopy Center' }).click();
  await expect(page.locator('h1')).toHaveText('Example Endoscopy Center');
  expect(page.url()).not.toMatch(/endoscopy|example(?!\.)/i);
  expect(new URL(page.url()).hash).toMatch(new RegExp(`^#/p/${SAM}/provider/r_[a-z2-7]{20}/provider$`));
  await expect(page.getByRole('link', { name: 'Sam', exact: true }).first()).toHaveAttribute('href', `#/health?who=${SAM}`);
  await page.goBack();
  const charged = card(page, 'Who charged what').locator('.row');
  await expect(charged.locator('.row-title')).toHaveText(['Example Endoscopy Center', 'Example Digestive Health', 'Example Lab']);
  await charged.filter({ hasText: 'Example Lab' }).getByRole('link').click();
  await expect(page.locator('h1')).toHaveText('Example Lab');
  await expect(rows(page, 'Visits').locator('.row-title')).toHaveText(['Lab tests', 'Hospital visit', 'Lab tests']);
  await rows(page, 'Visits').nth(1).getByRole('link').click();
  await expect(page.locator('h1')).toHaveText('Hospital visit');
});

test('a provider’s page adds up its claims and bills, and lists what it did, newest first', async ({ page }) => {
  await go(page, providerPath(ROBIN, 'claim', 'provider', 'Example Health'));
  await expect(page.locator('h1')).toHaveText('Example Health');
  await expect(page.locator('.provider > .card').first()).toContainText('Mar 10, 2025 to Nov 18, 2026');
  await expect(page.locator('.provider > .card').first()).toContainText('Source: Example Health Plan.');
  expect(await figures(page)).toEqual({ Charged: '$1,179.00', 'Plan paid': '$628.04', 'Your share': '$129.86', 'Still open': '$53.68', 'Not billed yet': '$25.00' });
  await expect(rows(page, 'Visits').locator('.row-meta')).toContainText(['Nov 18, 2026', 'Oct 1, 2026', 'Sep 15, 2025', 'Mar 10, 2025']);
  await expect(rows(page, 'Bills and payments').locator('.row-meta')).toContainText(['Oct 20, 2026 · was due Nov 19, 2026', 'Apr 2, 2025 · paid, receipt Apr 20, 2025']);
  await expect(rows(page, /^Claims$/)).toHaveCount(4);
  // The rest of a long list on a tap, and the focus goes to the first of it.
  await expect(rows(page, 'Tests')).toHaveCount(3);
  await card(page, 'Tests').getByRole('button', { name: 'Show all 8 tests' }).click();
  await expect(rows(page, 'Tests')).toHaveCount(8);
  await expect(rows(page, 'Tests').nth(3).getByRole('link')).toBeFocused();
  // Names that are only alike are listed apart, each with its own page.
  const alike = rows(page, 'May be the same');
  await expect(alike.locator('.row-title')).toHaveText(['Example Health Main Clinic', 'Example Health', 'Example Health', 'Example Health Plan']);
  await expect(alike.locator('.row-meta')).toHaveText(['4 visit records · 3 vaccines · source: Example Health', '4 papers · source: Scanned', '3 papers · source: Example Health', '1 paper · source: Example Health Plan']);
  await alike.first().getByRole('link').click();
  await expect(page.locator('h1')).toHaveText('Example Health Main Clinic');
  await expect(card(page, 'In all')).toHaveCount(0);
  await expect(rows(page, 'People seen').locator('.row-title')).toHaveText(['Dr. Jordan Sample']);
  await rows(page, 'People seen').getByRole('link').click();
  await expect(page.locator('h1')).toHaveText('Dr. Jordan Sample');
  await expect(rows(page, 'Places').locator('.row-title')).toHaveText(['Example Health Main Clinic']);
  await expect(page.getByText('Names that are only alike are never put together.')).toBeVisible();
});

test('Everyone holds each person’s, and opens each one’s own', async ({ page }) => {
  await go(page, providerPath(ROBIN, 'claim', 'provider', 'Example Health'));
  const whose = page.getByRole('group', { name: 'Whose records' });
  await expect(whose.getByRole('link')).toHaveText(['Everyone', 'Robin']);
  await expect(whose.locator('[aria-current="page"]')).toHaveText('Robin');
  await whose.getByRole('link', { name: 'Everyone' }).click();
  await expect(page).toHaveURL(/\?all=1$/);
  await expect(whose.getByRole('link')).toHaveText(['Everyone', 'Robin', 'Sam']);
  await expect(whose.locator('[aria-current="page"]')).toHaveText('Everyone');
  expect(await figures(page)).toMatchObject({ Charged: '$1,584.00', 'Not billed yet': '$81.40' });
  await expect(rows(page, 'Visits').locator('.row-meta')).toContainText(['Robin', 'Robin', 'Sam']);
  await expect(page.locator('.private-line')).toHaveText('Private items are never listed here. Each shows on its person’s own pages.');
  await whose.getByRole('link', { name: 'Sam' }).click();
  await expect(whose.locator('[aria-current="page"]')).toHaveText('Sam');
  await expect(page).toHaveURL(new RegExp(`#/p/${SAM}/provider/`));
  expect(await figures(page)).toMatchObject({ Charged: '$405.00' });
});

test('a private provider’s page is its person’s own, marked, and everyone’s page of it holds nothing', async ({ page }) => {
  const path = providerPath(SAM, 'claim', 'provider', 'Example Sexual Health Clinic');
  await go(page, path);
  await expect(page.locator('h1')).toHaveText('Example Sexual Health Clinic');
  await expect(page.locator('.event-private')).toHaveText('Private Private items are marked. Everyone’s page leaves them off.');
  await expect(page.getByRole('group', { name: 'Whose records' }).getByRole('link')).toHaveText(['Sam']);
  for (const list of ['Visits', /^Claims$/]) await expect(rows(page, list).locator('.chip')).toHaveText(['Private']);
  await go(page, `${path}?all=1`);
  await expect(page.locator('main')).toContainText('No provider to show here is named by this item.');
  await expect(page.locator('main')).not.toContainText(PRIVATE);
  // The same words as an item that names no provider at all.
  const words = await page.locator('main').innerText();
  await go(page, `#/p/${SAM}/provider/r_aaaaaaaaaaaaaaaaaaaa/provider?all=1`);
  await expect(page.locator('main')).toHaveText(words.replace(/\n+/g, ''), { useInnerText: false });
});

test('a private provider’s item under another person’s address reads as one that names no provider', async ({ page }) => {
  const id = recordOf(SAM, 'claim', 'provider', 'Example Sexual Health Clinic');
  const texts: string[] = [];
  for (const path of [`#/p/${ROBIN}/provider/${id}/provider`, `#/p/${ROBIN}/provider/r_aaaaaaaaaaaaaaaaaaaa/provider`]) {
    await go(page, path);
    await expect(page.locator('main')).toContainText('No provider to show here is named by this item.');
    texts.push(await page.locator('main').innerText());
  }
  expect(texts[0]).toBe(texts[1]);
});

test('from a screen the household shares a name opens everyone’s page', async ({ page }) => {
  await go(page, '#/money/calls');
  await page.locator('main').getByRole('link', { name: 'Example Billing', exact: true }).click();
  await expect(page).toHaveURL(/\/organization\?all=1$/);
  await expect(page.locator('h1')).toHaveText('Example Billing');
  await expect(page.locator('.chip', { hasText: 'Private' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Whose records' }).locator('[aria-current="page"]')).toHaveText('Everyone');
  // From one person's, it opens theirs.
  await go(page, `#/money/calls?who=${SAM}`);
  await page.locator('main').getByRole('link', { name: 'Example Billing', exact: true }).click();
  await expect(page).toHaveURL(/\/organization$/);
});

test('one name in two people’s records is two providers where no identifier says they are one', async ({ page }) => {
  await go(page, providerPath(ALEX, 'encounter', 'location', 'Example Pediatrics', true));
  await expect(page.locator('h1')).toHaveText('Example Pediatrics');
  await expect(page.getByRole('group', { name: 'Whose records' }).getByRole('link')).toHaveText(['Everyone', 'Alex']);
  await expect(rows(page, 'Visits').locator('.row-meta').filter({ hasText: 'Drew' })).toHaveCount(0);
  await expect(rows(page, 'May be the same').locator('.row-meta').filter({ hasText: /^Drew · / })).not.toHaveCount(0);
});

test('an alike name only a private item prints is neither in everyone’s list nor in its count', async ({ page }) => {
  // Papers of invented names alike to Robin's provider, the last of them private.
  const NAMED = ['Example Health North', 'Example Health South', 'Example Health East'];
  const laid = (isPrivate: boolean) =>
    rewritten({}, (f) => {
      if (f.name !== 'Robin Example') return;
      const paper = f.index.documents.find((d) => d.organization === 'Example Health Plan')!;
      for (const [i, organization] of NAMED.entries()) {
        const id = `d_${String(i).repeat(20)}`;
        f.index.documents.push({ ...paper, id, organization });
        if (isPrivate && i === 2) f.list.documents[id] = 'household';
      }
    });
  const alike = async (all: boolean) => {
    await page.goto('about:blank');
    await go(page, providerPath(ROBIN, 'claim', 'provider', 'Example Health', all));
    const at = card(page, 'May be the same');
    const count = Number(await at.locator('.card-head .num').innerText());
    await at.getByRole('button', { name: `Show all ${count} names`, exact: true }).click();
    const titles = await at.locator('.row-title').allInnerTexts();
    expect(titles).toHaveLength(count);
    return titles.sort();
  };
  await lay(page, laid(false));
  const [everyone, own] = [await alike(true), await alike(false)];
  for (const name of NAMED) for (const list of [everyone, own]) expect(list).toContain(name);
  await page.unrouteAll();
  await lay(page, laid(true));
  expect(await alike(true)).toEqual(everyone.filter((t) => t !== NAMED[2]));
  await expect(page.locator('main')).not.toContainText(NAMED[2]!);
  expect(await alike(false)).toEqual(own);
});

test('everyone’s page of a shared provider names no private item', async ({ page }) => {
  for (const [who, kind, field, name] of [
    [ROBIN, 'claim', 'provider', 'Example Lab'],
    [ROBIN, 'claim', 'provider', 'Example Pharmacy'],
    [SAM, 'medication', 'pharmacy', 'Example Pharmacy'],
    [ALEX, 'encounter', 'location', 'Example Pediatrics'],
  ] as const) {
    // By the person's own page, whose newest item may be private: Everyone opens from one that is not.
    await go(page, providerPath(who, kind, field, name));
    await page.getByRole('link', { name: 'Everyone', exact: true }).click();
    await expect(page).toHaveURL(/\?all=1$/);
    await expect(page.locator('h1')).toHaveText(name);
    const more = page.getByRole('button', { name: /^Show all/ });
    while (await more.count()) await more.first().click();
    await expect(page.locator('main'), name).not.toContainText(PRIVATE);
    await expect(page.locator('.chip', { hasText: 'Private' }), name).toHaveCount(0);
  }
});

test('a claim, a visit, a medicine, a vaccine, a paper and a bill worth a call link the provider they name', async ({ page }) => {
  const claim = recordOf(ROBIN, 'claim', 'provider', 'Example Lab');
  const visit = recordOf(ROBIN, 'encounter', 'practitioner', 'Dr. Jordan Sample');
  const fill = recordOf(ROBIN, 'medication', 'pharmacy', 'Example Pharmacy');
  const vaccine = recordOf(ALEX, 'immunization', 'performer', 'Example Pediatrics');
  for (const [path, name] of [
    [`#/p/${ROBIN}/r/${claim}`, 'Example Lab'],
    [`#/p/${ROBIN}/r/${visit}`, 'Dr. Jordan Sample'],
    [`#/p/${ROBIN}/r/${visit}`, 'Example Health Main Clinic'],
    [`#/p/${ROBIN}/r/${fill}`, 'Example Pharmacy'],
    [`#/p/${ROBIN}/r/${fill}`, 'Dr. Jordan Sample'],
    [`#/p/${ALEX}/r/${vaccine}`, 'Example Pediatrics'],
    [`#/money/calls?who=${SAM}`, 'Example Billing'],
  ] as const) {
    await go(page, path);
    await page.locator('main').getByRole('link', { name, exact: true }).first().click();
    await expect(page.locator('h1'), path).toHaveText(name);
  }
  const paper = demoJson<{ documents: { id: string; organization?: string }[] }>('Sam Example/index.json').documents.find((d) => d.organization === 'Example Endoscopy Center')!;
  await go(page, `#/p/${SAM}/r/${paper.id}`);
  await page.locator('main').getByRole('link', { name: 'Example Endoscopy Center', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/provider/${paper.id}/organization$`));
});

test('an address that names no provider says so', async ({ page }) => {
  await go(page, `#/p/${SAM}/provider/${recordOf(SAM, 'claim', 'provider', 'Example Lab')}/pharmacy`);
  await expect(page.locator('main')).toContainText('No provider to show here is named by this item.');
  await go(page, `#/p/${SAM}/provider/${recordOf(SAM, 'claim', 'provider', 'Example Lab')}/nothing`);
  await expect(page.locator('main')).toContainText('Page not found');
});

test('a provider’s page fits a 360px phone, light and dark', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const path of [providerPath(ROBIN, 'claim', 'provider', 'Example Health'), providerPath(ALEX, 'encounter', 'location', 'Example Pediatrics', true), providerPath(SAM, 'claim', 'provider', 'Example Sexual Health Clinic')]) {
      await go(page, path);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }
  }
});
