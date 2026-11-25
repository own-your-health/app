import { expect, test, type Page } from '@playwright/test';
import { fixture, standingCase } from '../test/helpers';
import { lay } from './lay';
import { ALEX, ROBIN } from '../test/sample';

// What is current by every source's word: the sample with Alex's records
// replaced by medrec's own fixture for readers (test/fixtures/standing/medrec/).

const records = fixture<{ records: { id: string }[] }>('standing/medrec/index.json').records;
const id = (stem: string) => records.find((r) => r.id.startsWith(`r_${stem}`))!.id;

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const row = (within: ReturnType<Page['locator']>, title: string) => within.locator('.row', { has: within.page().locator('.row-title', { hasText: new RegExp(`^${title}$`) }) });
const said = (r: ReturnType<Page['locator']>) => r.locator('.row-said');
const chips = (r: ReturnType<Page['locator']>) => r.locator('.chip');

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.clock.setFixedTime(new Date('2024-06-15T20:00:00Z'));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('conditions: one line each, what every source says of it, and the rest under All', async ({ page }) => {
  await lay(page, standingCase(ALEX));
  await go(page, `#/p/${ALEX}/conditions`);
  const current = card(page, /^Current$/);
  await expect(current.locator('.row')).toHaveCount(11);
  await expect(row(current, 'Sample stiffness').locator('.row-meta')).toHaveText('recorded Apr 20, 2024 · Example Health: active, read May 2, 2024');
  const rash = row(current, 'Sample rash');
  await expect(said(rash)).toHaveText(['Example Health: active, read May 2, 2024', 'Sample Clinic East: resolved, read May 3, 2024']);
  await expect(chips(rash)).toHaveText(['Sources differ']);
  await expect(chips(row(current, 'Sample graze'))).toHaveText(['Not every source heard']);
  await expect(current).toContainText('No problem list from Example Walk-in; diagnoses from visits are listed under All.');
  await expect(current).toContainText('1 entered in error, not shown.');
  await expect(page.locator('main')).not.toContainText('Sample burn');

  const all = page.locator('details.list-all');
  await expect(row(all, 'Sample sprain')).toBeHidden();
  await all.locator('summary', { hasText: 'All: 21 records' }).click();
  await expect(chips(row(all, 'Sample sprain'))).toHaveText(['Diagnosis from a visit']);
  await expect(chips(row(all, 'Sample fever'))).toHaveText(['Ruled out']);
  await expect(chips(row(all, 'Sample rash'))).toHaveText(['Current', 'Ended']);
});

test('medicines: each prescription, those of one medicine under its name, on hold and ended by its date apart', async ({ page }) => {
  await lay(page, standingCase(ALEX));
  await go(page, `#/p/${ALEX}/medicines`);
  const current = card(page, /^Current$/);
  await expect(current.locator('h3')).toHaveText(['Sample tablet']);
  // The rows of one medicine are a group by its name, whose links say the prescription alone.
  const tablet = current.getByRole('group', { name: 'Sample tablet', exact: true });
  await expect(tablet.locator('.row-title')).toHaveText(['Prescription of Feb 20, 2024', 'Prescription of Feb 19, 2024']);
  await expect(page.locator('[role=group]')).toHaveCount(1);
  await expect(current.locator('.row')).toHaveCount(9);
  await expect(current.locator('.row-title').first()).toHaveText('Prescription of Feb 20, 2024');
  await expect(current.locator('.row-title').nth(1)).toHaveText('Prescription of Feb 19, 2024');
  await expect(said(row(current, 'Sample syrup'))).toHaveText(['Example Health: active, ends Mar 31, 2024 (prescription), read May 2, 2024', 'Sample Clinic East: active, read May 3, 2024']);
  await expect(card(page, /^On hold$/).locator('.row-title')).toHaveText(['Sample patch']);
  await expect(card(page, /^Ended by its date$/).locator('.row')).toContainText(['Ended by its date, Mar 31, 2024 (prescription) · recorded Feb 18, 2024 · last filled May 2, 2024']);
  await page.locator('details.list-all summary').click();
  await expect(chips(row(page.locator('details.list-all'), 'Sample gel'))).toHaveText(['Draft']);
});

test('two medicines of several prescriptions are each a group by its own name', async ({ page }) => {
  await lay(page, standingCase(ALEX, { line: (x, line) => (x === id('stoppedatone') || x === id('unknown') ? 'sample' : line) }));
  await go(page, `#/p/${ALEX}/medicines`);
  const group = (name: string) => card(page, /^Current$/).getByRole('group', { name, exact: true }).locator('.row');
  await expect(group('Sample tablet')).toHaveCount(2);
  await expect(group('Sample spray')).toHaveCount(2);
});

test('allergies: one line by name, and the ones entered in error counted', async ({ page }) => {
  await lay(page, standingCase(ALEX));
  await go(page, `#/p/${ALEX}/allergies`);
  const current = card(page, /^Current$/);
  await expect(current.locator('.row-title')).toHaveText(['Sample nut', 'Sample glue', 'Sample resin', 'Sample moss', 'Sample fern', 'Sample pollen']);
  await expect(said(row(current, 'Sample glue'))).toHaveText(['Sample Clinic East: inactive, read May 3, 2024', 'Example Health: not heard']);
  await expect(chips(row(current, 'Sample moss'))).toHaveText(['Sources differ', 'Not every source heard']);
  await expect(current).toContainText('1 entered in error, not shown.');
});

test('Health and its sheet for a doctor have the same lists, with what they leave out', async ({ page }) => {
  await lay(page, standingCase(ALEX));
  await go(page, `#/health?who=${ALEX}`);
  const current = card(page, /^Current$/);
  await expect(current.locator('h3')).toHaveText(['Conditions', 'Medicines', 'On hold', 'Ended by its date', 'Allergies']);
  await expect(current.getByRole('group', { name: 'Sample tablet', exact: true }).locator('h4, .row')).toHaveCount(3);
  await expect(row(current, 'Sample rash')).toContainText('Sources differ');
  await expect(current).toContainText('2 entered in error, not shown.');
  await page.locator('details.health-quiet summary').click();
  await expect(page.locator('details.health-quiet')).toContainText('10 other conditions');
  await page.getByRole('link', { name: 'Hand to a doctor' }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('h2')).toHaveText(['Allergies', 'Medicines', 'Medicines on hold', 'Medicines ended by their date', 'Problems', 'Vaccines', 'Labs, last two years', 'Vital signs, last two years', 'Care team']);
  await expect(sheet.locator('li', { hasText: 'Sample rash' })).toContainText('sources differ · Example Health: active, read May 2, 2024; Sample Clinic East: resolved, read May 3, 2024');
  await expect(sheet).toContainText('No problem list from Example Walk-in; diagnoses from visits are not on this sheet.');
  await expect(sheet.locator('li', { hasText: 'Sample capsule' })).toContainText('ended by its date, Mar 31, 2024 (prescription) · last filled May 2, 2024');
});

test('a record’s page says what it is and what each source says of it', async ({ page }) => {
  await lay(page, standingCase(ALEX));
  const says = page.locator('.kv-row', { has: page.locator('dt', { hasText: 'Each source says' }) }).locator('li');
  const head = page.locator('main .card').first();
  for (const [stem, is, chip, lines] of [
    ['bothsay', 'Condition · Current', ['Sources differ'], ['Example Health: active, read May 2, 2024', 'Sample Clinic East: resolved, read May 3, 2024']],
    ['visitonly', 'Condition · Diagnosis from a visit', [], ['Example Walk-in: active, read May 4, 2024']],
    ['erroraaa', 'Condition · Entered in error', [], ['Example Health: no status, entered in error, read May 2, 2024']],
    ['refutedaller', 'Allergy · Ruled out', [], ['Example Health: active, ruled out, read May 2, 2024']],
    ['endsaaaa', 'Medicine · Ended by its date, Mar 31, 2024 (prescription), filled May 2, 2024', [], ['Example Health: active, ends Mar 31, 2024 (prescription), read May 2, 2024']],
    ['noendtwice', 'Medicine · Current', [], ['Sample Clinic East: active, read May 3, 2024']],
    ['stoppedatone', 'Medicine · Current', ['Sources differ'], ['Example Health: active, read May 2, 2024', 'Sample Clinic East: stopped, read May 3, 2024']],
  ] as const) {
    await go(page, `#/p/${ALEX}/r/${id(stem)}`);
    await expect(head.locator('p').first()).toContainText(is);
    await expect(chips(head)).toHaveText([...chip]);
    await expect(says).toHaveText([...lines]);
  }
  // A fill is a fact: it has no standing, and says what it is and when.
  for (const [stem, is] of [
    ['fillafter', /^Medicine · Filled · May 2, 2024 · /],
    ['fillreturned', /^Medicine · Cancelled · May 20, 2024 · /],
    ['fillerror', /^Medicine · Entered in error · May 21, 2024 · /],
  ] as const) {
    await go(page, `#/p/${ALEX}/r/${id(stem)}`);
    await expect(head.locator('p').first()).toHaveText(is);
    await expect(says).toHaveCount(0);
  }
});

test('what a record says of itself is on its page and its rows: not sure of it, at high risk while it is current, who prescribed it', async ({ page }) => {
  await lay(
    page,
    standingCase(ALEX, {
      change: (r) => {
        if (r.id === id('bothsay')) r.fields.verification_status = 'provisional';
        if (r.display === 'Sample nut' || r.display === 'Sample latex') r.fields.criticality = 'high';
        if (r.id === id('endsaaaa')) r.fields.prescriber = 'Dr. Sample One';
        if (r.id === id('fillafter')) r.fields.prescriber = 'Dr. Sample Two';
      },
    }),
  );
  const head = page.locator('main .card').first();
  await go(page, `#/p/${ALEX}/r/${id('bothsay')}`);
  await expect(chips(head)).toHaveText(['Unconfirmed', 'Sources differ']);
  await go(page, `#/p/${ALEX}/conditions`);
  const all = page.locator('details.list-all');
  await all.locator('summary').click();
  await expect(chips(row(all, 'Sample ache'))).toHaveText(['Current', 'Unconfirmed', 'Sources differ']);

  await go(page, `#/p/${ALEX}/allergies`);
  await expect(chips(row(card(page, /^Current$/), 'Sample nut'))).toHaveText(['High risk']);
  await all.locator('summary').click();
  await expect(chips(row(all, 'Sample nut'))).toHaveText(['Current', 'High risk']);
  await expect(chips(row(all, 'Sample latex'))).toHaveText(['Ruled out']);

  const prescribed = page.locator('.kv-row', { has: page.locator('dt', { hasText: 'Prescribed by' }) });
  for (const [stem, by] of [
    ['endsaaaa', 'Dr. Sample One'],
    ['fillafter', 'Dr. Sample Two'],
  ] as const) {
    await go(page, `#/p/${ALEX}/r/${id(stem)}`);
    await expect(prescribed).toContainText(by);
  }
  await go(page, `#/p/${ALEX}/r/${id('fillsoon')}`);
  await expect(head).toContainText('Filled');
  await expect(prescribed).toHaveCount(0);
});

test('why the lists go by each record’s own status is said where medrec’s list does not read, and nowhere else', async ({ page }) => {
  await lay(page, standingCase(ALEX, { schema: 'medrec-standing/v2' }));
  const why = 'medrec’s list of what is current could not be read: it is written by a newer medrec. Update the app. Meanwhile each record’s own status says what is current.';
  for (const path of ['conditions', 'allergies', 'medicines']) {
    await go(page, `#/p/${ALEX}/${path}`);
    await expect(page.locator('main .card').first().locator('p.muted')).toHaveText(why);
  }
  for (const path of [`#/health?who=${ALEX}`, `#/health/doctor?who=${ALEX}`]) {
    await go(page, path);
    await expect(page.getByText(why)).toHaveCount(1);
  }
  for (const path of [`#/p/${ROBIN}/conditions`, `#/health?who=${ROBIN}`, '#/health']) {
    await go(page, path);
    await expect(page.locator('main .card').first()).toBeVisible();
    await expect(page.getByText('what is current could not be read')).toHaveCount(0);
  }
});

test('a private record is left out before the rest is worked out, on every shared screen', async ({ page }) => {
  // Both prescriptions of the tablet have the private fill, which is to be refilled: one item.
  const tablet = (r: { id: string; date?: string; display: string; code?: object; fields: Record<string, unknown> }) => {
    if (r.id === id('fillsoon')) Object.assign(r, { display: 'Sample tablet', date: '2024-05-18', code: { system: 'http://example.org/codes', code: 'M-1', display: 'Sample tablet' }, fields: { source: 'dispense', days_supply: 30 } });
  };
  await lay(page, standingCase(ALEX, { change: tablet }));
  await go(page, '#/health');
  await expect(card(page, /^Alex$/)).toContainText('Sample tablet refill');
  const others = Number(/(\d+) private items? (?:is|are) kept off/.exec(await page.locator('main').innerText())?.[1] ?? 0);
  await lay(page, standingCase(ALEX, { hidden: [id('tworecordsot'), id('onhold'), id('nutaaaa'), id('fillsoon')], change: tablet }));
  await page.reload();
  const alex = card(page, /^Alex$/);
  await expect(alex).toContainText('11 conditions, 8 medicines, 6 allergies');
  await expect(alex).not.toContainText('refill');
  await expect(page.locator('main')).toContainText(`${others + 4} private items are kept off this shared view`);
  // Their own page has it all, marked.
  await go(page, `#/health?who=${ALEX}`);
  const current = card(page, /^Current$/);
  await expect(chips(row(current, 'Sample rash'))).toHaveText(['Private', 'Sources differ']);
  await expect(chips(row(current, 'Sample patch'))).toHaveText(['Private']);
  await go(page, `#/health/doctor?who=${ALEX}`);
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('li', { hasText: 'Sample rash' })).not.toContainText('differ');
  await expect(sheet.locator('li', { hasText: 'Sample Clinic East: resolved, read May 3, 2024' })).toHaveCount(1);
  await expect(sheet.locator('h2', { hasText: 'on hold' })).toHaveCount(0);
  await expect(page.locator('.sheet-private')).toContainText('4 private items are left off.');
  await page.getByRole('button', { name: 'Include 4 private items' }).click();
  await expect(sheet.locator('h2', { hasText: 'on hold' })).toHaveCount(1);
});

test('a folder of an earlier medrec goes by each record’s own status, and says nothing of sources', async ({ page }) => {
  await lay(page, standingCase(ALEX, { standing: false }));
  await go(page, `#/p/${ALEX}/conditions`);
  await expect(page.locator('main .card-head h2')).toHaveText(['Active', 'Resolved or inactive', 'Ruled out or no status']);
  await expect(page.locator('main')).not.toContainText('Sources differ');
  await go(page, `#/p/${ALEX}/r/${id('bothsay')}`);
  await expect(page.locator('main .card').first().locator('p').first()).toContainText('Condition · Active');
  await expect(page.locator('main')).not.toContainText('Each source says');
});

test('everything fits 360 px, light and dark', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await lay(page, standingCase(ALEX));
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const path of [`#/p/${ALEX}/conditions`, `#/p/${ALEX}/medicines`, `#/p/${ALEX}/allergies`, `#/health?who=${ALEX}`, `#/health/doctor?who=${ALEX}`, `#/p/${ALEX}/r/${id('bothsay')}`]) {
      await go(page, path);
      await expect(page.locator('main .card').first()).toBeVisible();
      for (const d of await page.locator('details.list-all').all()) await d.locator('summary').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360);
      // No row is squeezed to a column of letters.
      expect(await page.locator('main .row-body').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width < 200 && el.getBoundingClientRect().height > 0).length), path).toBe(0);
    }
  }
});

test('a record’s page fits 320 px with a long name and a source not heard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await lay(page, standingCase(ALEX, { change: (r) => void (r.display === 'Sample moss' && (r.display = 'Sample chlorobenzylidenemalononitrile')) }));
  await go(page, `#/p/${ALEX}/r/${id('unheardrefuted')}`);
  const head = page.locator('main .card').first();
  await expect(chips(head)).toContainText(['Not every source heard']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await head.evaluate((el) => [...el.querySelectorAll('h1, .chip, p, dd')].every((x) => x.getBoundingClientRect().right <= el.getBoundingClientRect().right))).toBe(true);
});
