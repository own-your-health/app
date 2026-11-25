import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { demoJson, filesUnder, DEMO, paidCase, privateCase, type Overlay } from '../test/helpers';
import { lay } from './lay';
import { ROBIN, SAM } from '../test/sample';
import { rewritten } from './alter';

// Bills as medrec's bills.json has them: payments the household marked, what
// is left of a bill partly paid, a settled bill that is never open, overdue or
// worth a call, and what the screens say when the list can't be used. The
// "paid" case is medrec's own (scripts/bill-fixtures.mjs).


test.beforeEach(({ page }) => page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z')));

const go = (page: Page, path: string) => page.goto(`./?demo${path}`);
const card = (page: Page, title: string | RegExp) => page.locator('.card', { has: page.locator('.card-head h2', { hasText: title }) });
const kv = (page: Page, label: string) => page.locator('.kv-row', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
const docOf = (folder: string, amount: string) => demoJson<{ documents: { id: string; statement?: { amount_due?: { amount: string } } }[] }>(`${folder}/index.json`).documents.find((d) => d.statement?.amount_due?.amount === amount)!.id;
const billsFile = (person: string) => filesUnder(DEMO).find((f) => f.startsWith(`views/${person}/bills.`))!;

interface BillsView {
  bills: Record<string, { superseded_by?: string }>;
  worth_a_call: object[];
}

/** The folder with one person's bills.json changed, named and checked as medrec would. */
function withBills(person: string, base: Overlay, change: (bills: BillsView) => void): Overlay {
  const views = (base['views/views.json'] ? JSON.parse(base['views/views.json']) : demoJson('views/views.json')) as { people: Record<string, { files: Record<string, string> }> };
  const was = `views/${person}/bills.${views.people[person]!.files['bills.json']!.slice(0, 12)}.json`;
  const bills = base[was] ? (JSON.parse(base[was]) as BillsView) : demoJson<BillsView>(was);
  change(bills);
  const text = JSON.stringify(bills);
  const md5 = createHash('md5').update(text).digest('hex');
  views.people[person]!.files['bills.json'] = md5;
  return { ...base, 'views/views.json': JSON.stringify(views), [`views/${person}/bills.${md5.slice(0, 12)}.json`]: text };
}

/** The sample with Robin's one receipt, for this bill, a paper whose amount does not read. */
const unread = (bill: string): Overlay =>
  rewritten({}, ({ name, index, bills }) => {
    if (name !== 'Robin Example') return;
    for (const d of index.documents as { doc_type?: string; statement?: object }[]) if (d.doc_type === 'receipt') d.statement = { paid_on: '2025-04-20' };
    Object.assign(bills.bills[bill]!, { paid: [], paid_total: '0.00', left: '51.18', settled: false });
    Object.assign(bills, { receipts: [] });
  });

/** The sample with a bill of Sam's that no insurer is billed for, from this sender if one is given, and what medrec says was paid on it. */
const selfPaid = (bill: string, from?: string, paid: object = {}): Overlay =>
  rewritten({}, ({ name, index, bills }) => {
    if (name !== 'Sam Example') return;
    const rest = Object.entries(bills.bills[bill]!).filter(([k]) => k !== 'claim' && k !== 'claim_you_owe');
    bills.bills[bill] = { ...Object.fromEntries(rest), self_pay: 'stated', ...paid };
    bills.worth_a_call = bills.worth_a_call.filter((x) => x.bill !== bill);
    if (from) (index.documents as { id: string; organization?: string }[]).find((d) => d.id === bill)!.organization = from;
  });

test('a bill no insurer is billed for is to pay, with no claim expected, and not worth a call', async ({ page }) => {
  const bill = docOf('Sam Example', '120.00');
  await lay(page, selfPaid(bill));
  await go(page, '#/money/bills');
  const row = card(page, 'Due now').locator('.row', { hasText: '$120.00' });
  await expect(row.locator('.chip')).toHaveText([/^Was due/, 'No claim expected']);
  await expect(page.locator('.money-hero')).toContainText('4 bills, 3 of them asking what their claims say you owe, and 1 for which no claim is expected.');
  await expect(page.locator('.money-hero')).not.toContainText('worth a call');
  await expect(card(page, 'Check before paying')).toHaveCount(0);
  // Its visit's share is not billed by it.
  await expect(card(page, 'No bill listed yet').locator('.row', { hasText: '$50.70' })).toHaveCount(1);
  await go(page, '#/money/calls');
  await expect(page.locator('.main')).not.toContainText('$120.00');

  await go(page, '#/');
  await expect(card(page, /^Bills$/).locator('.row', { hasText: '$120.00' }).locator('.row-meta')).toHaveText('Sam · was due Aug 31 · no claim expected · unless it was paid elsewhere');

  await go(page, `#/p/${SAM}/r/${bill}`);
  await expect(kv(page, 'Claim')).toHaveText('None expected: no insurer is billed for this');
  await page.locator('.event-part a').click();
  const bills = card(page, 'Bills and payments');
  await expect(bills.locator('.row', { hasText: '$120.00' }).locator('.chip')).toHaveText('No claim expected');
  await expect(bills.locator('.event-gap')).toHaveText('No bill from Example Lab filed yet, for the $50.70 its claim says you owe.');
  await expect(page.locator('.event-settled')).toHaveText('$50.70 not billed yet');

  // Nor is it where its sender has a claim there, owed or paid.
  for (const paid of [{}, { paid: [{ from: 'household', on: '2026-11-20', amount: '120.00', currency: 'USD' }], paid_total: '120.00', left: '0.00', settled: true }]) {
    await lay(page, selfPaid(bill, 'Example Lab', paid));
    await go(page, `#/p/${SAM}/r/${bill}`);
    await page.reload();
    await page.locator('.event-part a').click();
    await expect(bills.locator('.row', { hasText: '$120.00' })).toContainText('Bill from Example Lab');
    await expect(bills.locator('.row', { hasText: '$120.00' }).locator('.chip')).toHaveText('No claim expected');
    await expect(bills.locator('.event-gap')).toHaveText('No bill from Example Lab filed yet, for the $50.70 its claim says you owe.');
    await expect(page.locator('.event-settled')).toHaveText('$50.70 not billed yet');
    await go(page, '#/money/bills');
    await expect(card(page, 'No bill listed yet').locator('.row', { hasText: '$50.70' })).toHaveCount(1);
  }

  // One that a claim is for says nothing of the kind.
  await go(page, `#/p/${SAM}/r/${docOf('Sam Example', '90.50')}`);
  await expect(kv(page, 'Amount due')).toHaveText('$90.50');
  await expect(kv(page, 'Claim')).toHaveCount(0);
});

test('a bill the household marked paid is nowhere open, and one partly paid says what is left', async ({ page }) => {
  await lay(page, paidCase());
  await go(page, '#/');
  const bills = card(page, /^Bills$/);
  await expect(bills.locator('.card-head')).toHaveText(/^Bills\s*2 · \$124\.18$/);
  await expect(bills.locator('.need-kind')).toHaveText(['No payment on file', 'Not all paid']);
  await expect(bills.locator('.need-title')).toHaveText(['Hospital visit, Sep 16', 'Office visit, Oct 1']);
  await expect(bills.locator('.row').last()).toContainText('Robin · $20.00 of $53.68 paid · was due Nov 19 · matches the claim');
  await expect(bills.locator('.row-aside')).toHaveText(['$90.50', '$33.68']);
  await expect(bills.locator('.card-all')).toHaveText('All 2 bills');
  await expect(page.locator('.stand', { hasText: 'Sam' }).locator('.row-aside')).toHaveText('1 bill');

  await go(page, '#/money/bills');
  const hero = page.locator('.money-hero');
  await expect(hero.locator('.money-hero-number')).toHaveText('$124.18');
  await expect(hero).toContainText('2 bills, each asking what its claim says you owe.');
  await expect(hero).not.toContainText('worth a call');
  await expect(card(page, 'Due now').locator('.row').last()).toContainText('$20.00 of $53.68 paid');
  await expect(card(page, 'Due now').locator('.row').last().locator('.row-aside')).toHaveText('$33.68');
  await expect(card(page, 'Check before paying')).toHaveCount(0);
  await expect(card(page, /^Paid$/)).toContainText('Paid by a receipt in the folder, or by a payment the household marked.');
  await expect(card(page, /^Paid$/).locator('.row-meta')).toHaveText([
    'Robin · Lab tests, Oct 3, 2026 · $10.00 marked paid, Nov 2, 2026 · $9.28 marked paid, Nov 16, 2026',
    'Sam · Lab tests, Jul 9, 2026 · Marked paid, Nov 20, 2026',
    'Robin · Office visit, Mar 10, 2025 · receipt Apr 20, 2025',
  ]);

  await go(page, '#/money/calls');
  await expect(page.locator('main')).toContainText('No bill listed here asks for more than the claims say you owe.');
  await expect(page.locator('.call')).toHaveCount(0);
  await go(page, '#/money');
  await expect(card(page, /^Bills$/).locator('.row-title')).toHaveText(['2 bills ready to pay', 'No bill listed yet']);
});

test('a visit says its bill is marked paid, or what is left of it', async ({ page }) => {
  await lay(page, paidCase());
  await go(page, '#/money/bills');
  await card(page, /^Paid$/).locator('.row', { hasText: 'Example Billing' }).locator('a.row-main').click();
  await expect(page.locator('.event h1')).toHaveText('Lab tests');
  await expect(page.locator('.event-settled')).toHaveText('Marked paid');
  const bills = card(page, 'Bills and payments');
  await expect(bills.locator('.row-meta')).toHaveText('$120.00 due by Aug 31, 2026 · Marked paid, Nov 20, 2026');
  // The billing company's bill is for what the lab is owed.
  await expect(bills.locator('.event-gap')).toHaveCount(0);

  await go(page, '#/money/bills');
  await card(page, 'Due now').locator('.row').last().locator('a.row-main').click();
  await expect(page.locator('.event-settled')).toHaveText('$53.68 billed, $33.68 left to pay, due Nov 19, 2026');
  await expect(card(page, 'Bills and payments').locator('.row-meta')).toHaveText('$53.68 due by Nov 19, 2026 · $33.68 left to pay');
});

test('a bill’s own page lists its payments, what is left and the statement that has its balance', async ({ page }) => {
  await lay(page, paidCase());
  await go(page, `#/p/${SAM}/r/${docOf('Sam Example', '120.00')}`);
  await expect(kv(page, 'Paid')).toHaveText('$120.00 marked paid, Nov 20, 2026');
  await expect(kv(page, 'Left to pay')).toHaveText('Nothing');
  await go(page, `#/p/${ROBIN}/r/${docOf('Robin Example', '53.68')}`);
  await expect(kv(page, 'Paid')).toHaveText('$20.00 marked paid, Nov 18, 2026');
  await expect(kv(page, 'Left to pay')).toHaveText('$33.68');
  await expect(kv(page, 'Later statement')).toHaveCount(0);
  await go(page, `#/p/${ROBIN}/r/${docOf('Robin Example', '51.18')}`);
  await expect(kv(page, 'Paid')).toHaveText('$51.18, receipt Apr 20, 2025');
  await expect(kv(page, 'Left to pay')).toHaveText('Nothing');
  await expect(kv(page, 'Later statement')).toHaveText('Its balance includes this one: Statement from Example Health.pdf');
  // One nothing is paid on says nothing of it.
  await go(page, `#/p/${SAM}/r/${docOf('Sam Example', '90.50')}`);
  await expect(kv(page, 'Amount due')).toHaveText('$90.50');
  await expect(kv(page, 'Paid')).toHaveCount(0);
  await expect(kv(page, 'Left to pay')).toHaveCount(0);
});

test('a list that can’t be used yet is said, and receipts alone say what is paid', async ({ page }) => {
  const note = 'medrec is still writing its list of what is paid. Meanwhile only receipts say which of Sam’s bills are paid.';
  await lay(page, { ...paidCase(), [Object.keys(paidCase()).find((f) => f.startsWith(`views/${SAM}/bills.`))!]: null });
  for (const path of ['#/', '#/money', '#/money/bills', '#/money/calls', `#/money/bills?who=${SAM}`]) {
    await go(page, path);
    await expect(page.locator('main').getByText(note)).toHaveCount(1);
  }
  await go(page, `#/money/bills?who=${ROBIN}`);
  await expect(card(page, 'Due now').locator('.row-title')).toHaveText(['Not all paidExample Health']);
  await expect(page.locator('main')).not.toContainText('list of what is paid');
  // Sam's marked bill is open again until then.
  await go(page, '#/');
  await expect(card(page, /^Bills$/).locator('.row', { hasText: 'Worth a call' })).toContainText('$120.00');
});

test('a bill with a receipt whose amount could not be read may be paid, and is not chased', async ({ page }) => {
  // Robin's bill of 2025, with no later statement to stand for it and no claim to back it.
  const doc = docOf('Robin Example', '51.18');
  await lay(
    page,
    withBills(ROBIN, unread(doc), (b) => {
      delete b.bills[doc]!.superseded_by;
      b.worth_a_call.push({ reason: 'no_claim', bill: doc, claim: null, event: null, asked: '51.18', owed: null, currency: 'USD' });
    }),
  );
  const said = 'Receipt filed Apr 20, 2025; its amount could not be read';
  await go(page, '#/');
  // Home counts it in a line of its own, and asks for nothing.
  await expect(card(page, /^Bills$/).locator('.card-head')).toHaveText(/^Bills\s*4 · \$283\.46$/);
  await expect(card(page, /^Bills$/).locator('.home-quiet')).toHaveText('Besides, 1 may be paid.');
  await expect(card(page, /^Bills$/).locator('.card-all')).toHaveText('All 5 bills');
  await expect(page.locator('.stand', { hasText: 'Robin' }).locator('.row-aside')).toHaveText('2 bills');

  await go(page, '#/money');
  await expect(card(page, /^Bills$/).locator('.row-title')).toHaveText(['3 bills ready to pay', '1 bill worth a call', '1 bill may be paid', 'No bill listed yet']);
  await go(page, '#/money/bills');
  await expect(page.locator('.money-hero')).toContainText('3 bills, each asking what its claim says you owe. 1 more bill is worth a call first.');
  await expect(card(page, 'Check before paying')).not.toContainText('$51.18');
  const maybe = card(page, 'May be paid');
  await expect(maybe.locator('.row-meta')).toHaveText(`Robin · Office visit, Mar 10, 2025 · statement Apr 2, 2025 · ${said}`);
  await expect(maybe.locator('.row-aside')).toHaveText('$51.18');
  await expect(maybe).not.toContainText('Was due');
  await expect(maybe.locator('.chip')).toHaveCount(0);
  await maybe.getByRole('link', { name: 'The receipt' }).click();
  await expect(kv(page, 'Paid')).toHaveText('The amount could not be read');
  await go(page, '#/money/calls');
  await expect(page.locator('.call')).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText('$51.18');
});

test('a list that isn’t used is said with no bill open, and not for someone with no bill or held back', async ({ page }) => {
  const sam = demoJson<{ documents: { statement?: { amount_due?: { amount: string } } }[] }>('Sam Example/index.json');
  for (const d of sam.documents) if (d.statement?.amount_due) d.statement.amount_due.amount = '0.00';
  const alex = demoJson<{ people: { id: string; name: string }[] }>('household.json').people.find((p) => p.name === 'Alex Example')!.id;
  await lay(page, { 'Sam Example/index.json': JSON.stringify(sam), [billsFile(alex)]: null });
  await go(page, `#/money?who=${SAM}`);
  await expect(card(page, /^Bills$/).locator('.row-title')).toHaveText(['Not billed yet']);
  await expect(card(page, /^Bills$/)).toContainText('Meanwhile only receipts say which of Sam’s bills are paid.');
  // Sam's items are held back from shared screens, the note with them.
  for (const path of ['#/', '#/money', `#/money/bills?who=${alex}`]) {
    await go(page, path);
    await expect(page.locator('main .card').first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText('list of what is paid');
  }
});

test('marks that don’t read are said where the bills are', async ({ page }) => {
  await lay(page, privateCase('unreadable'));
  await go(page, `#/money/bills?who=${SAM}`);
  await expect(page.locator('main')).toContainText('The payments marked for Sam could not be read, so none of them is counted.');
  await go(page, `#/money/bills?who=${ROBIN}`);
  await expect(page.locator('main')).not.toContainText('could not be read');
});

test('a payment at a visit above its claims is on Worth a call, and a private one only on its person’s', async ({ page }) => {
  const receipt = demoJson<{ documents: { id: string; doc_type: string }[] }>('Robin Example/index.json').documents.find((d) => d.doc_type === 'receipt')!.id;
  const desk = (document: string) => ({ reason: 'desk_copay', bill: document, claim: null, event: null, asked: '58.00', owed: '36.00', currency: 'USD' });
  const robins = withBills(ROBIN, privateCase('marked'), (b) => b.worth_a_call.push(desk(receipt)));
  await lay(page, withBills(SAM, robins, (b) => b.worth_a_call.push(desk(docOf('Sam Example', '90.50')))));
  await go(page, '#/money/calls');
  const paid = card(page, 'Paid at a visit');
  await expect(paid.locator('.row-title')).toHaveText(['Example Health']);
  await expect(paid.locator('.row-meta')).toHaveText('Robin · receipt Apr 20, 2025 · paid $58.00; the claims say you owe $36.00');
  await expect(paid.locator('.row-aside')).toHaveText('$22.00');
  await go(page, `#/money/calls?who=${SAM}`);
  await expect(paid.locator('.row-title')).toHaveText(['Example Endoscopy Center']);
  await expect(paid.locator('.chip')).toHaveText('Private');
});

test('bills fit a 360px phone, light and dark', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await lay(page, paidCase());
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const path of ['#/', '#/money/bills', '#/money/calls', `#/p/${ROBIN}/r/${docOf('Robin Example', '51.18')}`]) {
      await go(page, path);
      await expect(page.locator('main .card').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }
  }
});
