import { expect, test, type Page } from '@playwright/test';
import { demoJson, paidCase, privateCase, type Overlay } from '../test/helpers';
import { rewritten } from './alter';
import { CLIENT, FakeGoogle, FOLDER_NAME } from './fake-google';
import { lay as layOver } from './lay';

// Mark paid: the form, where it is, what a marked bill says while it waits for
// the Mac, its undo, and what the Mac's answer brings.

const NOW = '2026-11-22T20:00:00Z';
const SAM = 'p_wwezzed7kml67hnp6s7n';
const ROBIN = 'p_xo4em46i7yj3hphlpajo';
const UNDO = 'You can undo this until it is filed.';

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.clock.setFixedTime(new Date(NOW));
  await lay(page, {});
});

test.afterEach(() => expect(problems).toEqual([]));

/** The sample's status, as a Mac with this medrec writes it. */
const statusBy = (medrec: string | undefined) => {
  const status = demoJson<{ refresher: object }>('_status/status.json');
  return JSON.stringify({ ...status, refresher: { ...status.refresher, medrec_version: medrec } });
};
/** Lays files over the sample, whose requests a medrec that records payments answers. */
const lay = (page: Page, overlay: Overlay, medrec = '0.9.6') => layOver(page, { '_status/status.json': statusBy(medrec), ...overlay });

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const billRow = (page: Page, provider: string) => page.locator('.main .row', { hasText: provider });
const markButton = (page: Page, provider: string) => page.locator('.main').getByRole('button', { name: new RegExp(`^Mark paid: ${provider}`) });
const form = (page: Page) => page.getByRole('dialog', { name: 'Mark paid' });
const send = (page: Page) => form(page).getByRole('button', { name: 'Mark paid' });
const doc = (folder: string, amount: string) => demoJson<{ documents: { id: string; statement?: { amount_due?: { amount: string } } }[] }>(`${folder}/index.json`).documents.find((d) => d.statement?.amount_due?.amount === amount)!.id;
const events = (person: string) => demoJson<{ people: Record<string, { files: Record<string, string> }> }>('views/views.json').people[person]!.files['events.json']!.slice(0, 12);
const eventOf = (person: string, document: string) => demoJson<{ events: { id: string; members: { document?: string }[] }[] }>(`views/${person}/events.${events(person)}.json`).events.find((e) => e.members.some((m) => m.document === document))!.id;

const SURGERY = 'Example Surgery Center';

test('a bill is marked paid from Bills, waits for the Mac, and is paid once filed', async ({ page }) => {
  await go(page, '#/money/bills');
  await expect(page.locator('.money-hero-number')).toHaveText('$247.96');
  await markButton(page, SURGERY).click();
  await expect(form(page)).toContainText('Sam · Example Surgery Center, Sep 21, 2026 · $175.00 left to pay');
  await expect(form(page)).toContainText('A payment that is only scheduled, or set to be taken by itself, is not paid yet.');
  await expect(form(page)).toContainText(UNDO);
  await expect(page.getByLabel('Paid on')).toBeFocused();
  await expect(page.getByLabel('Paid on')).toHaveValue('2026-11-22');
  await expect(page.getByLabel('Amount')).toHaveValue('175.00');
  await expect(page.locator('#paid-rest')).toHaveText('That is all that is left to pay.');
  await page.getByLabel('Paid on').fill('2026-11-20');
  await send(page).click();

  await expect(form(page)).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('Marked paid. The Mac files it on its next pass.');
  const marked = card(page, /^Marked paid$/);
  await expect(marked.locator('.mark-line')).toContainText('$175.00 marked paid, Nov 20, 2026. Waiting for the Mac.');
  await expect(marked.locator('.mark-line')).toContainText(UNDO);
  await expect(marked.locator('.mark-paid')).toBeFocused();
  await expect(marked).not.toContainText('Was due');
  await expect(marked.getByRole('button', { name: /^Mark paid/ })).toHaveCount(0);
  await expect(card(page, 'Due now')).not.toContainText(SURGERY);
  await expect(page.locator('.money-hero-number')).toHaveText('$72.96');

  // Money, Home, the visit and the bill itself say the same.
  await go(page, '#/money');
  await expect(card(page, 'Bills').locator('.row', { hasText: '1 bill marked paid' })).toContainText('The Mac files its payment on its next pass.');

  // The Mac files it.
  await go(page, '#/money/bills');
  await expect(marked).toHaveCount(0, { timeout: 20_000 });
  await expect(card(page, /^Paid$/).locator('.row-meta')).toHaveText(['Sam · Hospital visit, Aug 26, 2026 · Marked paid, Nov 20, 2026']);
  await expect(markButton(page, SURGERY)).toHaveCount(0);
});

test('while it waits, Home, Money, the visit and the bill say it is marked, and undo takes it back', async ({ page }) => {
  const bill = doc('Sam Example', '175.00');
  await go(page, '#/');
  const needs = card(page, /^Needs you$/);
  const row = needs.locator('.row', { hasText: SURGERY });
  await expect(row.locator('.need-kind')).toHaveText('No payment on file, unless it was paid elsewhere');
  const before = await page.locator('.stand', { hasText: 'Sam' }).locator('.kv-row').first().innerText();
  await markButton(page, SURGERY).click();
  await send(page).click();
  await expect(row.locator('.need-kind')).toHaveText('Marked paid');
  await expect(row).not.toContainText('was due');
  await expect(row).toContainText(`$175.00 marked paid, Nov 22, 2026. Waiting for the Mac.`);
  await expect(page.locator('.stand', { hasText: 'Sam' }).locator('.kv-row').first()).toHaveText('To pay$120.00 in 1 bill, 1 worth a call');
  for (const path of [`#/p/${SAM}/e/${eventOf(SAM, bill)}`, `#/p/${SAM}/r/${bill}`]) {
    await page.evaluate((to) => (location.hash = to), path);
    await expect(page.locator('.mark-line')).toContainText(UNDO);
  }
  await page.getByRole('button', { name: 'Undo: $175.00 marked paid, Nov 22, 2026' }).click();
  await expect(page.locator('.toast')).toHaveText('The request is taken back');
  await expect(page.locator('.mark-line')).toHaveCount(0);
  await expect(markButton(page, SURGERY)).toBeVisible();
  await page.evaluate(() => (location.hash = '#/'));
  await expect(row.locator('.need-kind')).toHaveText('No payment on file, unless it was paid elsewhere');
  expect(await page.locator('.stand', { hasText: 'Sam' }).locator('.kv-row').first().innerText()).toBe(before);
});

test('a part paid leaves the rest to pay and to mark', async ({ page }) => {
  await go(page, '#/money/bills');
  await markButton(page, SURGERY).click();
  const rest = page.locator('#paid-rest');
  await page.getByLabel('Amount').fill('75');
  await expect(rest).toHaveText('$100.00 of $175.00 would be left to pay.');
  await page.getByLabel('Amount').fill('200');
  await expect(rest).toHaveText('That is $25.00 more than is left to pay.');
  await page.getByLabel('Amount').fill('$75.5');
  await expect(rest).toHaveText('$99.50 of $175.00 would be left to pay.');
  await send(page).click();
  const row = card(page, 'Due now').locator('.row', { hasText: SURGERY });
  await expect(row.locator('.mark-line')).toContainText('$75.50 marked paid, Nov 22, 2026.');
  await expect(row).toContainText('Was due Oct 21, 2026');
  await row.getByRole('button', { name: /^Mark paid/ }).click();
  await expect(page.getByLabel('Amount')).toHaveValue('99.50');
  await expect(form(page)).toContainText('$99.50 left to pay');
  await page.keyboard.press('Escape');
  await expect(row).toContainText('$75.50 of $175.00 paid', { timeout: 20_000 });
  await expect(row.locator('.mark-line')).toHaveCount(0);
});

test('a day to come, no day, or an amount that is none is refused where it was entered', async ({ page }) => {
  await go(page, '#/money/bills');
  await markButton(page, SURGERY).click();
  const problem = page.locator('#paid-problem');
  const [on, amount] = [page.getByLabel('Paid on'), page.getByLabel('Amount')];
  await on.fill('2026-11-23');
  await send(page).click();
  await expect(problem).toHaveText('That day is still to come. Mark it once it is paid.');
  await expect(on).toBeFocused();
  await expect(on).toHaveAttribute('aria-invalid', 'true');
  await on.fill('');
  await send(page).click();
  await expect(problem).toHaveText('Choose the day it was paid.');
  await on.fill('2026-11-22');
  for (const typed of ['', '0', 'abc', '5.001']) {
    await amount.fill(typed);
    await send(page).click();
    await expect(problem).toHaveText('Enter the amount paid, like 120.00.');
    await expect(amount).toBeFocused();
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(on).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#paid-rest')).toHaveText('$175.00 is left to pay.');
  }
  await form(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(markButton(page, SURGERY)).toBeFocused();
  await expect(page.locator('.mark-line')).toHaveCount(0);
});

test('the form holds the keyboard, and closes when the page is left', async ({ page }) => {
  await go(page, '#/money/bills');
  await markButton(page, SURGERY).click();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('.sheet'));
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
  }
  await page.locator('.sheet-head .icon-button').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(form(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.sheet-head .icon-button')).toBeFocused();
  await page.evaluate(() => (location.hash = '#/money'));
  await expect(form(page)).toHaveCount(0);
});

test('a bill that may be paid starts from its receipt’s day, and is no longer asked about once marked', async ({ page }) => {
  // A receipt from the bill's provider, dated after it, whose amount could not be read.
  await lay(page, withReceipt('2026-10-05'));
  await go(page, '#/money/bills');
  const maybe = card(page, /^May be paid$/);
  await expect(maybe.locator('.row')).toContainText([SURGERY]);
  await maybe.getByRole('button', { name: /^Mark paid/ }).click();
  await expect(page.getByLabel('Paid on')).toHaveValue('2026-10-05');
  await expect(form(page)).toContainText('The day on the receipt in the folder. Its amount could not be read, so check it.');
  await send(page).click();
  await expect(maybe).toHaveCount(0);
  await expect(card(page, /^Marked paid$/).locator('.mark-line')).toContainText('$175.00 marked paid, Oct 5, 2026.');
  await page.evaluate(() => (location.hash = '#/'));
  const row = card(page, /^Needs you$/).locator('.row', { hasText: SURGERY });
  await expect(row.locator('.need-kind')).toHaveText('Marked paid');
  await expect(row).not.toContainText('could not be read');
});

test('a receipt dated ahead of today leaves today in the form', async ({ page }) => {
  await lay(page, withReceipt('2026-11-25'));
  await go(page, '#/money/bills');
  await card(page, /^May be paid$/).getByRole('button', { name: /^Mark paid/ }).click();
  await expect(page.getByLabel('Paid on')).toHaveValue('2026-11-22');
  await expect(form(page)).toContainText('A receipt for it is in the folder. Its amount could not be read, so check it.');
});

test('every page a bill is on has Mark paid: Worth a call, the bill, its visit, and Home past its due date', async ({ page }) => {
  const billing = doc('Sam Example', '120.00');
  for (const path of ['#/money/calls', '#/money/bills', `#/p/${SAM}/r/${billing}`, `#/p/${SAM}/e/${eventOf(SAM, billing)}`]) {
    await go(page, path);
    await expect(markButton(page, 'Example Billing, Aug 1, 2026, \\$120.00')).toHaveCount(1);
  }
  await go(page, '#/');
  await expect(card(page, /^Needs you$/).locator('.row', { hasText: 'No payment on file' }).getByRole('button', { name: /^Mark paid/ })).toHaveCount(2);
  // Not yet due, and worth a call, Home has no control for.
  for (const kind of ['Worth a call', 'Bill to pay']) await expect(card(page, /^Needs you$/).locator('.row', { hasText: kind }).getByRole('button')).toHaveCount(0);
  // A statement whose balance a later one has is paid there.
  await go(page, `#/p/${ROBIN}/r/${doc('Robin Example', '51.18')}`);
  await expect(page.locator('.kv')).toContainText(['Later statement']);
  await expect(page.locator('.mark-paid')).toHaveCount(0);
});

test('a visit with two copies of one statement has one Mark paid, and so has one with a copy alone', async ({ page }) => {
  const bill = doc('Sam Example', '175.00');
  const copied = (original: boolean) =>
    rewritten({}, (files) => {
      const first = files.index.documents.find((d) => d.id === bill);
      if (!first) return;
      files.index.documents.push({ ...first, id: 'd_copyaaaaaaaaaaaaaaaa', same_statement_as: bill });
      for (const e of files.events.events) {
        const at = e.members?.findIndex((m) => m.document === bill) ?? -1;
        if (at >= 0) e.members!.splice(at, original ? 0 : 1, { ...e.members![at]!, document: 'd_copyaaaaaaaaaaaaaaaa' });
      }
    });
  for (const original of [true, false]) {
    await lay(page, copied(original));
    await go(page, `#/p/${SAM}/e/${eventOf(SAM, bill)}`);
    const rows = card(page, /^Bills and payments$/).locator('.row', { hasText: `Bill from ${SURGERY}` });
    await expect(rows).toHaveCount(original ? 2 : 1);
    await expect(markButton(page, SURGERY)).toHaveCount(1);
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('a bill that asks less than its claims say has Mark paid under Worth a look', async ({ page }) => {
  const bill = doc('Sam Example', '175.00');
  await lay(
    page,
    rewritten({}, ({ index, bills }) => {
      const listed = bills.bills[bill];
      if (!listed) return;
      for (const d of index.documents) if (d.id === bill) d.statement = { ...(d.statement as object), amount_due: { amount: '150.00', currency: 'USD' } };
      Object.assign(listed, { amount_due: '150.00', left: '150.00' });
      bills.worth_a_call.push({ reason: 'asks_less', bill, asked: '150.00', owed: '175.00', currency: 'USD' } as { bill: string });
    }),
  );
  await go(page, '#/money/calls');
  await markButton(page, SURGERY).click();
  await expect(page.getByLabel('Amount')).toHaveValue('150.00');
  await page.getByLabel('Amount').fill('50');
  await send(page).click();
  await expect(card(page, /^Worth a look$/).locator('.mark-line')).toContainText('$50.00 marked paid, Nov 22, 2026.');
});

test('where medrec’s list does not say what is left there is no Mark paid, and what waits is still said', async ({ page }) => {
  const bill = doc('Sam Example', '175.00');
  const views = demoJson<{ people: Record<string, { marks: string | null; files: Record<string, string> }> }>('views/views.json');
  const of = (change: (sam: { marks: string | null; files: Record<string, string> }) => void) => {
    const changed = structuredClone(views);
    change(changed.people[SAM]!);
    return { 'views/views.json': JSON.stringify(changed) };
  };
  const waiting = { '_requests/20261122T195900Z_x_abcdefghijklmnopqrst.json': request('x_abcdefghijklmnopqrst', bill, '75.00', '2026-11-22T19:59:00Z') };
  const unreadable = rewritten({}, (files) => files.name === 'Sam Example' && Object.assign(files.bills, { marks_unreadable: true }));
  const leftOut = rewritten({}, (files) => files.name === 'Sam Example' && delete files.bills.bills[bill]);
  for (const [name, overlay] of Object.entries({
    // Payments were recorded since the list was written.
    behind: of((sam) => (sam.marks = '0'.repeat(32))),
    arriving: of((sam) => (sam.files['bills.json'] = `${'0'.repeat(32)}`)),
    none: of((sam) => delete sam.files['bills.json']),
    unreadable,
    leftOut,
  }) as [string, Overlay][]) {
    await lay(page, { ...overlay, ...waiting });
    for (const path of [`#/money/bills?who=${SAM}`, `#/p/${SAM}/r/${bill}`, `#/p/${SAM}/e/${eventOf(SAM, bill)}`, '#/']) {
      await go(page, path);
      await expect(page.locator('.main'), `${name} ${path}`).toContainText('Example');
      if (path !== '#/') await expect(page.locator('.mark-line').first(), `${name} ${path}`).toContainText('$75.00 marked paid, Nov 1, 2026. Waiting for the Mac.');
      await expect(markButton(page, SURGERY), `${name} ${path}`).toHaveCount(0);
    }
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('on Home, of two bills for one visit only the one marked is, and one not yet due says what is marked of it', async ({ page }) => {
  const [first, second] = [doc('Robin Example', '53.68'), doc('Robin Example', '19.28')];
  await lay(
    page,
    rewritten({}, (files) => {
      const [to, from] = [first, second].map((id) => files.events.events.find((e) => e.members?.some((m) => m.document === id)));
      if (!to || !from) return;
      to.members!.push(...from.members!.filter((m) => m.document === second));
      from.members = from.members!.filter((m) => m.document !== second);
    }),
  );
  await go(page, '#/money/bills');
  await markButton(page, 'Example Lab').click();
  await page.getByLabel('Amount').fill('5');
  await send(page).click();
  await markButton(page, 'Example Health').click();
  await send(page).click();
  await expect(card(page, /^Marked paid$/).locator('.mark-line')).toHaveCount(1);
  await page.evaluate(() => (location.hash = '#/'));
  const rows = card(page, /^Needs you$/).locator('.row', { hasText: 'Robin' }).filter({ hasText: 'Example' });
  await expect(rows.locator('.mark-line')).toHaveText([/^\$5\.00 marked paid/, /^\$53\.68 marked paid/]);
  await expect(rows.filter({ hasText: '$53.68 marked paid' }).locator('.need-kind')).toHaveText('Marked paid');
  await expect(rows.filter({ hasText: '$5.00 marked paid' }).locator('.need-kind')).toHaveText('Bill to pay');
});

test('on Home, a bill that shares its row with another has its provider on its button', async ({ page }) => {
  const [first, second] = [doc('Robin Example', '53.68'), doc('Robin Example', '19.28')];
  await lay(
    page,
    rewritten({}, (files) => {
      const [to, from] = [first, second].map((id) => files.events.events.find((e) => e.members?.some((m) => m.document === id)));
      if (!to || !from) return;
      to.members!.push(...from.members!.filter((m) => m.document === second));
      from.members = from.members!.filter((m) => m.document !== second);
      for (const d of files.index.documents) if (d.id === second) d.statement = { ...(d.statement as object), due_date: '2026-11-18' };
      const listed = files.bills.bills[second];
      if (listed) listed.due_date = '2026-11-18';
    }),
  );
  await go(page, '#/');
  await expect(page.locator('.mark-paid').getByRole('button', { name: /Example (Health|Lab)/ })).toHaveText(['Mark paid: Example Lab', 'Mark paid: Example Health']);
});

test('a filed payment is undone on the Mac, or from medrec 0.9.7 here', async ({ page }) => {
  const bill = doc('Sam Example', '175.00');
  await go(page, `#/p/${SAM}/r/${bill}`);
  await markButton(page, SURGERY).click();
  await send(page).click();
  const undo = page.locator('.mark-undo');
  await expect(undo.locator('summary')).toHaveText('Undo: $175.00 marked paid, Nov 22, 2026', { timeout: 20_000 });
  await undo.locator('summary').click();
  await expect(undo.locator('code')).toHaveText(/^medrec bills undo o_[a-z2-7]{20} --profile $/);

  await page.goto('about:blank');
  await lay(page, {}, '0.9.7');
  await go(page, `#/p/${SAM}/r/${bill}`);
  await markButton(page, SURGERY).click();
  await send(page).click();
  const button = page.getByRole('button', { name: 'Undo: $175.00 marked paid, Nov 22, 2026' });
  // The waiting payment's undo goes; the filed one's comes.
  await expect(page.locator('.mark-line')).not.toContainText('Waiting for the Mac.', { timeout: 20_000 });
  await button.click();
  await expect(page.locator('.mark-line')).toContainText('$175.00 marked paid, Nov 22, 2026. Undo asked; waiting for the Mac.');
  await page.getByRole('button', { name: 'Keep the payment' }).click();
  await expect(page.locator('.toast')).toHaveText('The request is taken back');
  await button.click();
  await expect(markButton(page, SURGERY)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.mark-line')).toHaveCount(0);
});

test('an older medrec on the Mac that answers requests, or none, has no Mark paid, whichever wrote the views', async ({ page }) => {
  const status = (version: string | undefined) => ({ '_status/status.json': statusBy(version) });
  for (const overlay of [status('0.9.0'), status(undefined), status('soon'), { '_status/status.json': null }, { '_status/status.json': '{' }, { 'views/views.json': null }] as Overlay[]) {
    await lay(page, overlay);
    await go(page, `#/money/bills?who=${SAM}`);
    await expect(billRow(page, SURGERY).first()).toBeVisible();
    await expect(page.locator('.mark-paid')).toHaveCount(0);
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('a folder with no place for requests has no Mark paid', async ({ page }) => {
  const requests = demoJson<{ files: string[] }>('manifest.json').files.filter((f) => f.startsWith('_requests/'));
  await lay(page, Object.fromEntries(requests.map((f) => [f, null])));
  await go(page, '#/money/bills');
  await expect(billRow(page, SURGERY)).toHaveCount(1);
  await expect(page.locator('.mark-paid')).toHaveCount(0);
});

test('a payment that could not be recorded is not said of a bill that is paid since', async ({ page }) => {
  const bill = doc('Sam Example', '120.00');
  const failed = { [`_requests/done/20261121T120000Z_x_abcdefghijklmnopqrst.json`]: request('x_abcdefghijklmnopqrst', bill, '120.00', '2026-11-21T12:00:00Z', 'The folder could not be written.') };
  for (const [base, said] of [[{}, 1], [paidCase(), 0]] as const) {
    await lay(page, { ...base, ...failed });
    await go(page, `#/p/${SAM}/r/${bill}`);
    await expect(markButton(page, 'Example Billing')).toHaveCount(said);
    await expect(page.locator('.kv').first()).toContainText('Amount due$120.00');
    await expect(page.getByText('was not recorded')).toHaveCount(said);
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('of the payments that could not be recorded the last is said, for two weeks', async ({ page }) => {
  const bill = doc('Sam Example', '120.00');
  const failed = (n: string, at: string) => ({ [`_requests/done/${at.replace(/[-:]/g, '')}_x_${n.repeat(20)}.json`]: request(`x_${n.repeat(20)}`, bill, '120.00', at, `Reason ${n}.`) });
  const said = page.locator('.mark-paid p');
  for (const [overlay, text] of [
    [{ ...failed('a', '2026-11-20T12:00:00Z'), ...failed('b', '2026-11-21T12:00:00Z') }, ['The payment marked for Nov 1, 2026 was not recorded. Reason b.']],
    [failed('c', '2026-11-08T20:00:01Z'), ['The payment marked for Nov 1, 2026 was not recorded. Reason c.']],
    [failed('d', '2026-11-08T20:00:00Z'), []],
  ] as [Overlay, string[]][]) {
    await lay(page, overlay);
    await go(page, `#/p/${SAM}/r/${bill}`);
    await expect(markButton(page, 'Example Billing')).toHaveCount(1);
    await expect(said).toHaveText(text);
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('an undo asked on another device waits here, and one naming another person changes nothing', async ({ page }) => {
  const bill = doc('Sam Example', '120.00');
  const base = paidCase();
  const [, list] = Object.entries(base).find(([f]) => f.startsWith(`views/${SAM}/bills.`))!;
  const payment = (JSON.parse(list!) as { bills: Record<string, { paid: { id: string }[] }> }).bills[bill]!.paid[0]!.id;
  for (const [person, waits] of [[SAM, true], [ROBIN, false]] as const) {
    await lay(page, { ...base, '_requests/20261122T195900Z_x_abcdefghijklmnopqrst.json': undoRequest('x_abcdefghijklmnopqrst', person, payment, '2026-11-22T19:59:00Z') }, '0.9.7');
    await go(page, `#/p/${SAM}/r/${bill}`);
    const line = page.locator('.mark-line');
    await expect(line).toContainText(waits ? 'Undo asked; waiting for the Mac.' : '$120.00 marked paid, Nov 20, 2026');
    await expect(line.getByRole('button')).toHaveText(waits ? [] : ['Undo']);
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('an undo the Mac could not record says why beside the payment, for two weeks', async ({ page }) => {
  const bill = doc('Sam Example', '120.00');
  const base = paidCase();
  const [, list] = Object.entries(base).find(([f]) => f.startsWith(`views/${SAM}/bills.`))!;
  const payment = (JSON.parse(list!) as { bills: Record<string, { paid: { id: string }[] }> }).bills[bill]!.paid[0]!.id;
  const answered = (n: string, at: string, outcome: string, of = payment, person = SAM) => ({ [`_requests/done/${at.replace(/[-:]/g, '')}_x_${n.repeat(20)}.json`]: undoRequest(`x_${n.repeat(20)}`, person, of, at, { outcome, message: `Reason ${n}.` }) });
  const waiting = { '_requests/20261122T195900Z_x_abcdefghijklmnopqrst.json': undoRequest('x_abcdefghijklmnopqrst', SAM, payment, '2026-11-22T19:59:00Z') };
  const said = page.locator('.mark-paid p.attention');
  for (const [overlay, text, medrec] of [
    [{ ...answered('a', '2026-11-20T12:00:00Z', 'failed'), ...answered('b', '2026-11-21T12:00:00Z', 'invalid') }, ['The undo was not recorded. Reason b.'], '0.9.7'],
    [answered('c', '2026-11-21T12:00:00Z', 'failed'), ['The undo was not recorded. Reason c.'], '0.9.6'],
    [answered('d', '2026-11-08T20:00:00Z', 'failed'), [], '0.9.7'],
    [{ ...answered('e', '2026-11-20T12:00:00Z', 'failed'), ...answered('f', '2026-11-21T12:00:00Z', 'ok') }, [], '0.9.7'],
    [{ ...answered('g', '2026-11-20T12:00:00Z', 'failed'), ...waiting }, [], '0.9.7'],
    [{ ...answered('h', '2026-11-20T12:00:00Z', 'failed', 'o_aaaaaaaaaaaaaaaaaaaa'), ...answered('i', '2026-11-20T12:00:00Z', 'failed', payment, ROBIN) }, [], '0.9.7'],
  ] as [Overlay, string[], string][]) {
    await lay(page, { ...base, ...overlay }, medrec);
    await go(page, `#/p/${SAM}/r/${bill}`);
    await expect(page.locator('.mark-paid').filter({ hasText: '$120.00 marked paid, Nov 20, 2026' })).toBeVisible();
    await expect(said).toHaveText(text);
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('an undo the Mac has done says so until the records can be read again', async ({ page }) => {
  const base = paidCase();
  await lay(page, base, '0.9.7');
  await go(page, `#/p/${SAM}/r/${doc('Sam Example', '120.00')}`);
  const line = page.locator('.mark-line');
  await line.getByRole('button', { name: /^Undo/ }).click();
  await expect(line).toContainText('Undo asked; waiting for the Mac.');
  await page.route(/\/demo\/Alex%20Example\/index\.json/, (route) => route.fulfill({ status: 503, body: '' }));
  await expect(line).toContainText('$120.00 marked paid, Nov 20, 2026. The Mac has undone it.', { timeout: 20_000 });
  await expect(line.getByRole('button')).toHaveCount(0);
  expect(problems.filter((x) => !x.includes('503'))).toEqual([]);
  problems = [];
});

test('a filed payment has no undo where this account can ask for nothing', async ({ page }) => {
  const requests = demoJson<{ files: string[] }>('manifest.json').files.filter((f) => f.startsWith('_requests/'));
  const base = paidCase();
  const bill = doc('Sam Example', '120.00');
  for (const [overlay, count] of [[base, 1], [{ ...base, ...Object.fromEntries(requests.map((f) => [f, null])) }, 0]] as [Overlay, number][]) {
    await lay(page, overlay);
    await go(page, `#/p/${SAM}/r/${bill}`);
    await expect(page.locator('.main')).toContainText('$120.00 marked paid, Nov 20, 2026');
    await expect(page.locator('.mark-undo')).toHaveCount(count);
    await page.unrouteAll();
    await page.goto('about:blank');
  }
});

test('a private bill is marked on its person’s own pages, and nothing of that is on everyone’s', async ({ page }) => {
  await lay(page, privateCase('marked'));
  await go(page, `#/money/bills?who=${SAM}`);
  const mine = page.locator('.main .row', { has: page.locator('.chip', { hasText: 'Private' }) }).filter({ has: page.getByRole('button', { name: /^Mark paid/ }) });
  await expect(mine).toHaveCount(1);
  const provider = await mine.locator('.row-title').innerText();
  const shared = async () => {
    const out: string[] = [];
    for (const path of ['#/', '#/money', '#/money/bills', '#/money/calls']) {
      await page.evaluate((to) => (location.hash = to), path);
      await expect(page.locator('.private-line')).toBeVisible();
      out.push(await page.locator('.main').innerText());
    }
    return out;
  };
  const before = await shared();
  await page.evaluate((to) => (location.hash = to), `#/money/bills?who=${SAM}`);
  await mine.getByRole('button', { name: /^Mark paid/ }).click();
  await send(page).click();
  await expect(card(page, /^Marked paid$/)).toContainText(provider);
  expect(await shared()).toEqual(before);
});

test('a number the bill gives is one to call', async ({ page }) => {
  const withPhone = (phone: string) =>
    rewritten({}, (files) => {
      for (const d of files.index.documents) {
        const s = d.statement as { amount_due?: { amount: string }; phone?: string } | undefined;
        if (s?.amount_due?.amount === '120.00') s.phone = phone;
      }
    });
  await go(page, '#/money/calls');
  await expect(page.locator('.call')).toContainText('The bill’s phone number isn’t in these records; it is on the paper.');
  for (const [phone, to] of [['(555) 010-0123', 'tel:5550100123'], ['555-010-0123 ext. 4', null]] as const) {
    await page.goto('about:blank');
    await page.unrouteAll();
    await lay(page, withPhone(phone));
    for (const path of ['#/money/calls', `#/p/${SAM}/r/${doc('Sam Example', '120.00')}`]) {
      await go(page, path);
      const call = page.locator('.kv-row', { has: page.locator('dt', { hasText: /^Call$/ }) }).locator('dd');
      await expect(call).toHaveText(phone);
      await expect(call.locator('a')).toHaveCount(to ? 1 : 0);
      if (to) await expect(call.locator('a')).toHaveAttribute('href', to);
      await expect(page.locator('.main')).not.toContainText('it is on the paper');
    }
  }
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the form and a marked bill fit a phone in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 360, height: 740 });
    await go(page, '#/money/bills');
    await markButton(page, SURGERY).click();
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    for (const el of [send(page), form(page).getByRole('button', { name: 'Cancel' }), page.getByLabel('Paid on'), page.getByLabel('Amount')]) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const box = (await form(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(740);
    await send(page).click();
    await expect(card(page, /^Marked paid$/)).toBeVisible();
    expect(await fits()).toBe(true);
    expect((await page.getByRole('button', { name: /^Undo/ }).boundingBox())!.height).toBeGreaterThanOrEqual(36);
  });
}

/** A request from another device that marks one of Sam's bills paid; with `handled`, one the Mac could not record, and why. */
function request(id: string, document: string, amount: string, at: string, handled?: string): string {
  return JSON.stringify({
    schema: 'medrec-request/v1',
    id,
    requested_at: at,
    requested_by: { name: 'Another device' },
    app: { name: 'own-your-health-app', version: '0.1.0' },
    paid: { person: SAM, document, on: '2026-11-01', amount },
    ...(handled ? { handled: { picked_up_at: at, finished_at: at, outcome: 'failed', sources: [], message: handled, by: 'medrec 0.9.6' } } : {}),
  });
}

/** A request from another device to undo a payment; with `handled`, one the Mac answered. */
function undoRequest(id: string, person: string, payment: string, at: string, handled?: { outcome: string; message: string }): string {
  const asked = JSON.parse(request(id, '', '1.00', at)) as Record<string, unknown>;
  delete asked.paid;
  return JSON.stringify({ ...asked, unpaid: { person, payment }, ...(handled ? { handled: { picked_up_at: at, finished_at: at, sources: [], by: 'medrec 0.9.7', ...handled } } : {}) });
}

/** A receipt for the surgery center's bill on a day, with no amount that reads. */
function withReceipt(on: string): Overlay {
  return rewritten({}, (files) => {
    const bill = files.index.documents.find((d) => (d.statement as { amount_due?: { amount: string } } | undefined)?.amount_due?.amount === '175.00');
    if (bill) files.index.documents.push({ ...bill, id: 'd_unreadreceiptaaaaaaa', doc_type: 'receipt', date: on, statement: { paid_on: on }, title: 'Receipt' });
  });
}

test.describe('signed in', () => {
  let google: FakeGoogle;

  test.beforeEach(async ({ context }) => {
    google = new FakeGoogle();
    google.writeAsMac('_status/status.json', google.shift(statusBy('0.9.6')));
    await google.install(context);
  });

  test.afterEach(() => expect(google.strays).toEqual([]));

  async function open(page: Page): Promise<void> {
    await page.goto(`./?client=${CLIENT}`);
    await page.locator('.row', { hasText: FOLDER_NAME }).getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('.signin-notice')).toBeVisible();
    await page.evaluate(() => (location.hash = '#/money/bills'));
    await expect(page.locator('.money-hero')).toBeVisible();
  }

  test('it writes one request and nothing else, and undo removes that one', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await page.getByLabel('Paid on').fill('2026-11-01');
    await send(page).click();
    await expect(card(page, /^Marked paid$/)).toBeVisible();
    expect(google.changes).toEqual([{ method: 'CREATE', path: expect.stringMatching(/^_requests\/\d{8}T\d{6}Z_x_[a-z2-7]{20}\.json$/) }]);
    const path = google.changes[0]!.path;
    expect(JSON.parse(google.read(path)!)).toEqual({
      schema: 'medrec-request/v1',
      id: expect.stringMatching(/^x_[a-z2-7]{20}$/),
      requested_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      requested_by: expect.objectContaining({ email: expect.any(String) }),
      app: { name: 'own-your-health-app', version: expect.any(String) },
      paid: { person: SAM, document: doc('Sam Example', '175.00'), on: '2026-11-01', amount: '175.00' },
    });
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(card(page, /^Marked paid$/)).toHaveCount(0);
    expect(google.changes.slice(1)).toEqual([{ method: 'DELETE', path }]);
  });

  test('an account that may only view the folder has no Mark paid', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    google.viewer = true;
    await open(page);
    await expect(billRow(page, SURGERY)).toHaveCount(1);
    await expect(page.locator('.mark-paid')).toHaveCount(0);
  });

  test('without the Drive file permission there is no Mark paid', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    google.granted = google.granted.filter((s) => !s.endsWith('drive.file'));
    await open(page);
    await expect(billRow(page, SURGERY)).toHaveCount(1);
    await expect(page.locator('.mark-paid')).toHaveCount(0);
  });

  for (const outcome of ['failed', 'invalid']) test(`what the Mac could not record says so beside the bill: ${outcome}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await send(page).click();
    await expect(card(page, /^Marked paid$/)).toBeVisible();
    const path = google.changes[0]!.path;
    const at = now();
    google.writeAsMac(path.replace('_requests/', '_requests/done/'), JSON.stringify({ ...(JSON.parse(google.read(path)!) as object), handled: { picked_up_at: at, finished_at: at, outcome, sources: [], message: 'The folder could not be written.', by: 'medrec 0.9.6' } }));
    google.removeAsMac(path);
    await look(page);
    await expect(card(page, 'Due now').locator('.row', { hasText: SURGERY }).locator('.mark-paid')).toContainText(/^The payment marked for .* was not recorded\. The folder could not be written\./);
    await expect(markButton(page, SURGERY)).toBeVisible();
  });

  const now = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const asked = (id: string, handled?: string, at = now()) => request(id, doc('Sam Example', '175.00'), '175.00', at, handled);

  test('what is marked on another device, and what the Mac says of it, shows here', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    const due = card(page, 'Due now').locator('.row', { hasText: SURGERY });
    await expect(due).toHaveCount(1);
    google.writeAsMac('_requests/20261122T200312Z_x_abcdefghijklmnopqrst.json', asked('x_abcdefghijklmnopqrst'));
    await look(page);
    await expect(card(page, /^Marked paid$/).locator('.mark-line')).toContainText('$175.00 marked paid, Nov 1, 2026. Waiting for the Mac.');
    await expect(due).toHaveCount(0);
    // Only the device that asked can take it back.
    await expect(page.getByRole('button', { name: /^Undo/ })).toHaveCount(0);
    google.removeAsMac('_requests/20261122T200312Z_x_abcdefghijklmnopqrst.json');
    await look(page);
    await expect(due).toHaveCount(1);
    // Asked and answered between two looks.
    google.writeAsMac('_requests/done/20261122T200412Z_x_bcdefghijklmnopqrstu.json', asked('x_bcdefghijklmnopqrstu', 'The folder could not be written.'));
    await look(page);
    await expect(due.locator('.mark-paid')).toContainText('was not recorded. The folder could not be written.');
    // Marked again, the earlier failure is not said.
    google.writeAsMac('_requests/20261122T200512Z_x_cdefghijklmnopqrstuv.json', asked('x_cdefghijklmnopqrstuv'));
    await look(page);
    await expect(card(page, /^Marked paid$/).locator('.mark-line')).toHaveCount(1);
    await expect(page.locator('.main')).not.toContainText('was not recorded');
    // Asked yesterday and not taken by a Mac that is on.
    google.writeAsMac('_requests/20261122T200512Z_x_cdefghijklmnopqrstuv.json', asked('x_cdefghijklmnopqrstuv', undefined, now(86_400_000)));
    await page.reload();
    await expect(card(page, /^Marked paid$/).locator('.mark-line')).toContainText('$175.00 marked paid, Nov 1, 2026. The Mac has not taken it yet.');
  });

  test('what the Mac has recorded says so until the records can be read again', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await send(page).click();
    const line = card(page, /^Marked paid$/).locator('.mark-line');
    await expect(line).toContainText('Waiting for the Mac.');
    const path = google.changes[0]!.path;
    google.failing = 'household.json';
    google.writeAsMac(path.replace('_requests/', '_requests/done/'), JSON.stringify({ ...(JSON.parse(google.read(path)!) as object), handled: { picked_up_at: now(), finished_at: now(), outcome: 'ok', sources: [], message: '', by: 'medrec 0.9.6' } }));
    google.removeAsMac(path);
    await look(page);
    await expect(line).toContainText('The Mac has recorded it.');
    await expect(page.getByRole('button', { name: /^Undo/ })).toHaveCount(0);
    // The read that failed is the stand-in's.
    expect(problems.filter((x) => !x.includes('503'))).toEqual([]);
    problems = [];
  });

  test('an account that may only view from now on has no Mark paid once the folder is read again', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    const buttons = page.getByRole('button', { name: /^Mark paid/ });
    await expect(buttons).not.toHaveCount(0);
    google.writeAsMac('_requests/20261122T200312Z_x_abcdefghijklmnopqrst.json', asked('x_abcdefghijklmnopqrst'));
    await look(page);
    await expect(card(page, /^Marked paid$/)).toBeVisible();
    google.viewer = true;
    google.writeAsMac('_requests/done/20261122T200312Z_x_abcdefghijklmnopqrst.json', asked('x_abcdefghijklmnopqrst', 'The folder could not be written.'));
    google.removeAsMac('_requests/20261122T200312Z_x_abcdefghijklmnopqrst.json');
    await look(page);
    await expect(card(page, /^Marked paid$/)).toHaveCount(0);
    await expect(async () => {
      await look(page);
      await expect(buttons).toHaveCount(0, { timeout: 300 });
    }).toPass();
    await expect(billRow(page, SURGERY)).toHaveCount(1);
  });

  test('a payment tapped twice is sent once', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    // Both before anything is answered.
    await send(page).evaluate((b: HTMLButtonElement) => [b.click(), b.click()]);
    await expect(card(page, /^Marked paid$/).locator('.mark-line')).toHaveCount(1);
    expect(google.changes).toHaveLength(1);
  });

  test('a payment Drive did not take stays in the form', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await page.getByLabel('Amount').fill('75');
    google.failing = '*';
    await send(page).click();
    // Said in the form, where the keyboard still is, and nowhere else.
    await expect(page.locator('#paid-problem')).not.toBeEmpty();
    await expect(send(page)).toBeFocused();
    await expect(send(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(page.getByLabel('Amount')).toHaveValue('75');
    google.failing = null;
    await page.keyboard.press('Enter');
    await expect(form(page)).toHaveCount(0);
    await expect(card(page, 'Due now').locator('.row', { hasText: SURGERY }).locator('.mark-line')).toContainText('$75.00 marked paid');
    expect(problems.filter((x) => !x.includes('503'))).toEqual([]);
    problems = [];
  });

  test('a payment taken back that the Mac had read says so, and medrec’s list before it stands until it has written the next', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await send(page).click();
    const path = google.changes[0]!.path;
    const written = JSON.parse(google.read(path)!) as object;
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.locator('.toast')).toHaveText('The request is taken back');
    const due = card(page, 'Due now').locator('.row', { hasText: SURGERY });
    await expect(due).toHaveCount(1);
    for (let i = 0; i < 3; i++) await look(page);
    google.writeAsMac('Sam Example/marks.json', JSON.stringify({ schema: 'medrec-marks/v1', person: SAM, payments: [] }));
    google.writeAsMac(path.replace('_requests/', '_requests/done/'), JSON.stringify({ ...written, handled: { picked_up_at: now(), finished_at: now(), outcome: 'ok', sources: [], message: '', by: 'medrec 0.9.6' } }));
    await look(page);
    const line = card(page, /^Marked paid$/).locator('.mark-line');
    await expect(line).toContainText('The Mac had read it before you took it back, and has recorded it.');
    await expect(line.getByRole('button')).toHaveCount(0);
    await expect(due).toHaveCount(0);
    // The other bills are as medrec's list had them, not judged by receipts alone.
    await expect(page.locator('.main')).not.toContainText('older than their records');
    await expect(markButton(page, 'Example Billing')).toHaveCount(1);
  });

  test('an undo whose request the Mac has answered and left says so', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await send(page).click();
    await expect(card(page, /^Marked paid$/)).toBeVisible();
    const path = google.changes[0]!.path;
    google.writeAsMac(path.replace('_requests/', '_requests/done/'), JSON.stringify({ ...(JSON.parse(google.read(path)!) as object), handled: { picked_up_at: now(), finished_at: now(), outcome: 'ok', sources: [], message: '', by: 'medrec 0.9.6' } }));
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.locator('.toast')).toHaveText('The Mac had already taken it');
    await expect(card(page, /^Marked paid$/).locator('.mark-line')).toContainText('The Mac has recorded it.');
  });

  test('an undo the Mac came before says so', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await send(page).click();
    await expect(card(page, /^Marked paid$/)).toBeVisible();
    google.removeAsMac(google.changes[0]!.path);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.locator('.toast')).toHaveText('The Mac had already taken it');
  });

  test('an undo after the hour renews the sign-in and says it was not done', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await send(page).click();
    await expect(card(page, /^Marked paid$/)).toBeVisible();
    await page.clock.setFixedTime(new Date(Date.now() + 61 * 60_000));
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.locator('.toast')).toContainText('The payment was not undone: tap Undo again.');
    expect(google.changes).toHaveLength(1);
  });

  test('a payment marked after the hour renews the sign-in and says it was not sent', async ({ page }) => {
    await page.clock.setFixedTime(new Date());
    await open(page);
    await markButton(page, SURGERY).click();
    await page.clock.setFixedTime(new Date(Date.now() + 61 * 60_000));
    await send(page).click();
    await expect(page.locator('.toast')).toContainText('The payment was not marked: open the bill and tap Mark paid again.');
    expect(google.changes).toEqual([]);
  });
});
