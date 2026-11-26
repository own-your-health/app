import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { linesPrivate, rewritten } from './alter';
import { lay } from './lay';
import { macWrites } from './mac';
import { CLIENT, FakeGoogle, FOLDER_NAME } from './fake-google';
import { eventId, itemId, ROBIN, SAM } from '../test/sample';

// Open items with a private part (medrec 0.9.9 and later): a shared screen
// shows the item without it and says how much it leaves out; its person's own
// pages show all of it and say where it stays off. That a shared screen reads
// the same whatever the part says is in private.spec.ts.

const SAID = 'Unmistakable words';
const CLAIM = itemId(ROBIN, 'records', (r) => r.kind === 'claim' && r.date === '2026-10-01');
const BILL = itemId(ROBIN, 'documents', (d) => d.doc_type === 'eob');
const CLAIM_SAYS = '1 service, 1 diagnosis and 1 payer note not shown';
const SAM_CLAIM = itemId(SAM, 'records', (r) => r.kind === 'claim' && r.date === '2026-10-12');
const NOT_SHARED = 'Not on shared screens';

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
  await lay(page, linesPrivate(SAID));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const main = (page: Page) => page.locator('main');

test('a shared screen says how much it leaves out of a visit, a claim and a paper', async ({ page }) => {
  // Each says it, and none marks what it leaves out as left out.
  const none = async () => {
    await expect(main(page)).not.toContainText(SAID);
    await expect(main(page)).not.toContainText(NOT_SHARED);
  };
  await go(page, '#/calendar?view=list');
  const visit = main(page).locator('.cal-row', { hasText: '1 service not shown' }).first();
  await expect(visit).toBeVisible();
  await none();
  await go(page, '#/');
  await expect(main(page)).toContainText('Recently');
  await none();
  await go(page, '#/money/events');
  await expect(main(page).locator('.row', { hasText: '1 service not shown' }).first()).toBeVisible();
  await none();
  await go(page, '#/costs?period=all');
  await expect(main(page).locator('.row', { hasText: CLAIM_SAYS }).first()).toBeVisible();
  await none();
  await go(page, '#/search?q=billing');
  await expect(main(page).locator('.row', { hasText: '1 line not shown' }).first()).toBeVisible();
  await none();
  await go(page, `#/p/${ROBIN}/provider/${CLAIM}/provider?all=1`);
  await expect(main(page).locator('.row', { hasText: CLAIM_SAYS }).first()).toBeVisible();
  await none();
});

test('a claim in error is counted in everyone’s costs by what is left of it', async ({ page }) => {
  const wrong = rewritten(
    linesPrivate(SAID),
    ({ name, index, view }) => {
      if (name !== 'Robin Example') return;
      index.records.find((r) => r.id === CLAIM)!.status = 'entered-in-error';
      view.in_error = { claim: [CLAIM] };
    },
    '0.9.9',
  );
  await lay(page, wrong);
  const said = '1 entered in error, not shown.';
  for (const [only, there] of [['category:imaging', false], ['category:other', true], [`category:imaging&only=person:${ROBIN}`, true]] as const) {
    await go(page, `#/costs?period=all&only=${only}`);
    await expect(main(page)).toContainText('Costs');
    await (there ? expect(main(page), only).toContainText(said) : expect(main(page), only).not.toContainText('entered in error'));
  }
});

test('its person’s own pages show all of it, and say where it stays off', async ({ page }) => {
  const off = 'Shared screens are Home and everyone’s Calendar, Money, Papers and search results.';
  const note = main(page).locator('.part-note');
  await go(page, `#/p/${ROBIN}/r/${CLAIM}`);
  await expect(main(page)).toContainText(SAID);
  await expect(note).toHaveText(`${NOT_SHARED} 1 service, 1 diagnosis and 1 payer note. ${off}`);
  await go(page, `#/p/${ROBIN}/e/${eventId(ROBIN, '2026-10-01')}`);
  await expect(main(page)).toContainText(SAID);
  await expect(note).toHaveText(`${NOT_SHARED} 1 service. ${off}`);
  await go(page, `#/p/${ROBIN}/r/${BILL}`);
  await expect(note).toHaveText(`${NOT_SHARED} 1 line. ${off}`);
  await go(page, `#/calendar?view=list&who=${ROBIN}`);
  await expect(main(page)).toContainText(SAID);
  await expect(main(page)).not.toContainText('not shown');
  await go(page, `#/costs?period=all&only=person:${ROBIN}`);
  await expect(main(page)).toContainText(SAID);
  await go(page, `#/p/${ROBIN}/provider/${CLAIM}/provider`);
  await expect(main(page)).not.toContainText('not shown');
  await go(page, `#/search?q=${encodeURIComponent(SAID)}&who=${ROBIN}`);
  await expect(main(page).locator('.row').first()).toContainText(SAID);
  await expect(main(page).locator('.row', { hasText: 'not shown' })).toHaveCount(0);
});

test('its person’s own pages mark each part shared screens leave out, in the words they begin with', async ({ page }) => {
  const marked = (where: ReturnType<typeof main>) => where.locator('.chip', { hasText: NOT_SHARED });
  const named = (where: ReturnType<typeof main>, words: string) => where.locator('.marked-name', { hasText: words });
  // A claim: its line and its payer's note, and no other.
  await go(page, `#/p/${ROBIN}/r/${CLAIM}`);
  await expect(marked(main(page).locator('.part-note'))).toHaveCount(1);
  const lines = main(page).locator('.card', { has: page.getByRole('heading', { name: '3 lines' }) }).locator('.row');
  await expect(lines).toHaveCount(3);
  await expect(lines.filter({ has: page.locator('.chip', { hasText: NOT_SHARED }) })).toHaveCount(1);
  await expect(lines.filter({ has: page.locator('.chip', { hasText: NOT_SHARED }) })).toContainText(SAID);
  const notes = main(page).locator('.kv-row', { hasText: 'The plan’s notes' });
  await expect(notes.locator('dd')).toHaveText(`${SAID} ${NOT_SHARED} · Placeholder note`);
  await expect(marked(named(notes, SAID))).toHaveCount(1);
  await expect(marked(named(notes, 'Placeholder note'))).toHaveCount(0);
  await expect(marked(main(page))).toHaveCount(3);
  // A claim's diagnosis, where its names are and in its details.
  await go(page, `#/p/${SAM}/r/${SAM_CLAIM}`);
  await expect(marked(main(page).locator('.kv-row', { hasText: /^Diagnosis/ }).first())).toHaveCount(1);
  // A visit of claims alone: what it was billed for and its diagnosis.
  await go(page, `#/p/${SAM}/e/${eventId(SAM, '2026-10-12')}`);
  const billed = main(page).locator('p', { hasText: 'Billed for:' });
  await expect(marked(named(billed, SAID))).toHaveCount(1);
  await expect(billed.locator('.marked-name')).toHaveCount(2);
  await expect(marked(billed)).toHaveCount(1);
  await expect(marked(main(page).locator('p', { hasText: /^Diagnos[ie]s?:/ }))).toHaveCount(1);
  // A paper's text, once shown.
  await go(page, `#/p/${ROBIN}/r/${BILL}`);
  await main(page).getByRole('button', { name: 'Show extracted text' }).click();
  await expect(main(page).locator('pre.text mark.not-shared')).toHaveText([SAID]);
  await expect(marked(main(page).locator('pre.text'))).toHaveCount(1);
  // Costs: on its person's own, each line, and on everyone's, none.
  await go(page, `#/costs?period=all&only=person:${ROBIN}`);
  const costLines = main(page).locator('.claim-lines li');
  await expect(costLines.filter({ has: page.locator('.chip', { hasText: NOT_SHARED }) })).toHaveCount(3);
  for (const line of await costLines.filter({ has: page.locator('.chip', { hasText: NOT_SHARED }) }).all()) await expect(line).toContainText(SAID);
  await expect(costLines.filter({ hasText: SAID })).toHaveCount(3);
});

test('a diagnosis is marked in its claim’s details too, by its published title and in the claim’s words', async ({ page }) => {
  // The private diagnosis in one word in capitals, the claim's own, for a code medrec names otherwise.
  const titled = rewritten(linesPrivate(SAID), ({ name, index }) => {
    if (name !== 'Sam Example') return;
    const diagnoses = index.records.find((r) => r.id === SAM_CLAIM)!.fields.diagnoses as { code: { code: string; display: string } }[];
    Object.assign(diagnoses[0]!.code, { code: 'E55.9', display: 'UNMISTAKABLE' });
  });
  await lay(page, titled);
  await go(page, `#/p/${SAM}/r/${SAM_CLAIM}`);
  await main(page).locator('details.tech summary').click();
  const told = main(page).locator('details.tech .kv-row', { hasText: /^Diagnosis, / });
  await expect(told).toHaveCount(2);
  for (const row of await told.all()) await expect(row.locator('.chip', { hasText: NOT_SHARED })).toHaveCount(1);
});

test('what is left out fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['#/calendar?view=list', '#/costs?period=all', '#/money/events', '#/search?q=billing', `#/p/${ROBIN}/r/${CLAIM}`]) {
    await go(page, path);
    await expect(main(page)).toContainText(/not shown|Not on shared screens/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});

test('what is marked fits a 320 px phone, with a long word in each part', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const long = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
  await lay(page, linesPrivate(long));
  for (const path of [`#/p/${ROBIN}/r/${CLAIM}`, `#/p/${SAM}/r/${SAM_CLAIM}`, `#/p/${SAM}/e/${eventId(SAM, '2026-10-12')}`, `#/costs?period=all&only=person:${ROBIN}`, `#/p/${ROBIN}/r/${BILL}`]) {
    await go(page, path);
    await expect(main(page)).toContainText(NOT_SHARED);
    if (path.includes(BILL)) await main(page).getByRole('button', { name: 'Show extracted text' }).click();
    if (path.includes(SAM_CLAIM)) await main(page).locator('details.tech summary').click();
    await expect(main(page)).toContainText(long);
    const past = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 && !el.closest('pre')).map((el) => `${el.tagName}.${el.className}`));
    expect(past, path).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});

/** Signed in to Drive, whose folder has the private parts. */
async function signedIn(page: Page, context: BrowserContext): Promise<FakeGoogle> {
  const google = new FakeGoogle(new Date('2026-11-22T20:00:00Z'));
  for (const [path, text] of Object.entries(linesPrivate(SAID))) if (text !== null) google.writeAsMac(path, text);
  await google.install(context);
  await page.goto(`./?client=${CLIENT}`);
  await page.locator('.row', { hasText: FOLDER_NAME }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.signin-notice')).toBeVisible();
  return google;
}

test('everyone’s search goes by the text and the private lines of each read of the records, with its page open', async ({ page, context }) => {
  const google = await signedIn(page, context);
  await page.evaluate(() => (location.hash = '#/search?q=billing'));
  const results = main(page).locator('.row');
  await expect(results.first()).toBeVisible();
  const reads = () => google.reads.filter((x) => x === 'Robin Example/text.json').length;
  await page.getByRole('searchbox').fill('billing code');
  await expect(page.locator('main [aria-live]').filter({ hasText: 'match' })).toBeVisible();
  expect(reads()).toBe(1);
  // medrec wrote the texts again, with other private lines, and its list of them.
  await macWrites(page, google, linesPrivate(`Newer and longer ${SAID}`), 0);
  const search = page.getByRole('searchbox');
  const who = (name: string) => page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name });
  // Robin's own search finds the new words once the records are read again.
  await who('Robin').click();
  await expect(async () => {
    await search.fill('');
    await search.fill('newer and longer');
    await expect(results.first()).toContainText(`Newer and longer ${SAID}`, { timeout: 1000 });
  }).toPass();
  expect(reads()).toBe(2);
  // Everyone's goes by the same read: the text is searched, without what is private in it.
  await who('Everyone').click();
  await expect(page.locator('main [aria-live]').filter({ hasText: 'match' })).toHaveText(/^0 matches\./);
  await expect(main(page)).not.toContainText(SAID);
  await search.fill('example');
  await expect(page.locator('main [aria-live]').filter({ hasText: 'match' })).toHaveText(/^[1-9]\d* matches\./);
  await expect(main(page)).not.toContainText('is not searched here');
  expect(google.strays).toEqual([]);
});

test('the text of papers that changed since medrec said what in it is private is in one person’s search, not everyone’s', async ({ page, context }) => {
  const google = await signedIn(page, context);
  const path = 'Robin Example/text.json';
  const text = JSON.parse(google.read(path)!) as { texts: Record<string, string> };
  text.texts[BILL] = `A new line\nPlaceholder words\n${text.texts[BILL]}`;
  google.writeAsMac(path, JSON.stringify(text));
  await page.evaluate(() => (location.hash = '#/search?q=placeholder'));
  await expect(main(page)).toContainText('The text of Robin’s papers is not searched here: it changed since medrec said what in it is private. medrec says it again after its next import or refresh.');
  await expect(main(page).locator('.row', { hasText: 'Placeholder words' })).toHaveCount(0);
  await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Robin' }).click();
  await expect(main(page).locator('.row', { hasText: 'Placeholder words' })).toHaveCount(1);
  await expect(main(page)).not.toContainText('is not searched here');
  expect(google.strays).toEqual([]);
});
