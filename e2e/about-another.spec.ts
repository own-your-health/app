import { expect, test, type Page } from '@playwright/test';
import { demoJson, type Overlay } from '../test/helpers';
import { lay } from './lay';
import { itemId, ROBIN, SAM } from '../test/sample';

// What is in a person's chart and about somebody else: the sample with one of
// Robin's results and one of their papers in views.json's about_another.

const result = itemId(ROBIN, 'records', (r) => r.kind === 'result' && r.display === 'Calcium');
const paper = itemId(ROBIN, 'documents', (d) => d.doc_type === 'immunization_record');

const about = (ids: string[]): Overlay => {
  const views = demoJson<{ people: Record<string, Record<string, unknown>> }>('views/views.json');
  views.people[ROBIN]!.about_another = ids;
  return { 'views/views.json': JSON.stringify(views) };
};

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const line = (page: Page) => page.getByText(/about another person/);

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.clock.setFixedTime(new Date('2026-11-21T15:00:00Z'));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('the person’s own results and papers say how many there are, and nothing of them', async ({ page }) => {
  await lay(page, about([result, paper]));
  await go(page, `#/p/${ROBIN}/results`);
  await expect(line(page)).toHaveText('2 items about another person, not shown.');
  await expect(page.getByRole('link', { name: /Creatinine/ }).first()).toBeVisible();
  await expect(page.getByText('Calcium')).toHaveCount(0);

  await go(page, `#/papers?who=${ROBIN}`);
  await expect(line(page)).toHaveText('2 items about another person, not shown.');
  await expect(page.getByText(/Immunization record/i)).toHaveCount(0);

  for (const id of [result, paper]) {
    await go(page, `#/p/${ROBIN}/r/${id}`);
    await expect(page.getByText('This record is not in the index.')).toBeVisible();
    await expect(line(page)).toHaveCount(0);
  }
});

test('nothing says so of another person, or where there are none', async ({ page }) => {
  await lay(page, about([result]));
  for (const path of [`#/p/${SAM}/results`, `#/papers?who=${SAM}`]) {
    await go(page, path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(line(page)).toHaveCount(0);
  }
  await go(page, `#/p/${ROBIN}/results`);
  await expect(line(page)).toHaveText('1 item about another person, not shown.');
});

test('no screen of everyone’s, no search and no sheet says there are any', async ({ page }) => {
  await lay(page, about([result, paper]));
  // Each with a word of its own content, which is there once it is all read.
  const screens: [string, RegExp][] = [
    ['#/', /Robin/],
    ['#/calendar', /Office visit/],
    ['#/calendar?view=list', /Office visit/],
    ['#/money', /Example Lab/],
    ['#/papers', /Basic metabolic panel/],
    ['#/health', /Sam/],
    [`#/health?who=${ROBIN}`, /Potassium/],
    [`#/health/doctor?who=${ROBIN}`, /Creatinine/],
    ['#/search?q=calcium', /^\d+ match(es)?\.$/],
    ['#/settings', /Appearance|Sign out|Folder/],
  ];
  for (const [path, own] of screens) {
    await go(page, path);
    await expect(page.locator('main').getByText(own).first(), path).toBeVisible();
    await expect(page.getByText(/Loading|Reading the text/)).toHaveCount(0);
    await expect(line(page), path).toHaveCount(0);
    await expect(page.getByText('Calcium', { exact: true }), path).toHaveCount(0);
  }
});

test('their own lists and sheet say where medrec’s list does not read, and others do not', async ({ page }) => {
  const unread = 'medrec’s list of what is about another person could not be read, so some of these may be.';
  await lay(page, { 'views/views.json': '{' });
  for (const path of [`#/p/${ROBIN}/results`, `#/papers?who=${ROBIN}`, `#/health/doctor?who=${ROBIN}`]) {
    await go(page, path);
    await expect(line(page), path).toHaveText(unread);
  }
  for (const [path, own] of [['#/papers', /papers/], ['#/health', /Robin/], [`#/p/${ROBIN}/conditions`, /Active/]] as [string, RegExp][]) {
    await go(page, path);
    await expect(page.locator('main').getByText(own).first(), path).toBeVisible();
    await expect(line(page), path).toHaveCount(0);
  }
  const views = demoJson<{ medrec: string; people: Record<string, Record<string, unknown>> }>('views/views.json');
  views.medrec = '0.9.9';
  Object.assign(views.people[ROBIN]!, { about_another: [result], index: 'f'.repeat(32) });
  await lay(page, { 'views/views.json': JSON.stringify(views) });
  await go(page, `#/p/${ROBIN}/results`);
  await page.reload();
  await expect(line(page)).toHaveText(['1 item about another person, not shown.', 'Which of the newest items are about another person is not known yet.']);
});
