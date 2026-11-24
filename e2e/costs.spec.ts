import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// The costs screen over the sample household, through the production build
// and its Content-Security-Policy. Any console error or policy violation fails.

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  // Plan years are counted from today, so the clock is fixed.
  await page.clock.setFixedTime(new Date('2026-11-22T20:00:00Z'));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('costs this plan year across everyone, broken down, and down to one month and back', async ({ page }) => {
  // Home's Money card, then Money's way to every claim.
  await page.goto('./?demo');
  const glance = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Money$/ }) });
  await expect(glance.locator('.glance-answer')).toHaveText('$581.46 your share this plan year');
  await glance.getByRole('link', { name: 'The year, the bills and the biggest costs' }).click();
  await page.getByRole('link', { name: 'Every claim, by provider, kind of care and month' }).click();
  await expect(page).toHaveURL(/#\/costs$/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Money' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main h1')).toHaveText('Costs');

  const summary = page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'This plan year, everyone' }) });
  // Everyone's costs leave Sam's private claim out, totals and all, and say so; Money's totals count it.
  await expect(page.locator('.cost-left')).toHaveText('1 private claim is left out of this shared view, its totals too. Money’s totals count it. Choose a person to see theirs.');
  await expect(summary.locator('.glance-answer')).toHaveText('$551.46 your share');
  await expect(summary.locator('.totals')).toHaveText('Billed $7,276.00; Plan allowed $2,758.10; Plan paid $2,206.64; Your share $551.46');
  await expect(summary).toContainText('13 claims, 20 lines. Your share is deductible $233.50, copay $220.00, coinsurance $97.96.');
  await expect(summary.locator('.plan-note')).toHaveText(
    'Plan years: Example Care Plan, Jul 1, 2026 to Jun 30, 2027; Example Health Plan and Example Pharmacy Benefits, 2026. Example Care Plan: plan year from your plan’s claims. Example Health Plan and Example Pharmacy Benefits: plan year assumed to be the calendar year; your plans’ records don’t say. Set when your plan year starts',
  );
  await expect(page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'This plan year' })).toHaveAttribute('aria-pressed', 'true');

  const balances = page.locator('.card', { hasText: 'Deductible and out-of-pocket' });
  await expect(balances.locator('.row-title')).toHaveText(['Alex, Example Care Plan', 'Sam, Example Care Plan', 'Robin, Example Health Plan']);
  await expect(balances.getByRole('progressbar', { name: 'Sam, Deductible: $233.50 of $750.00 used' })).toBeVisible();

  // Every month of the plan years so far, the quiet ones too, each a link to its lines.
  const months = page.getByRole('group', { name: 'Plan paid and your share by month' }).getByRole('link');
  await expect(months).toHaveCount(11);
  const october = page.getByRole('link', { name: 'Oct 2026: plan paid $291.84, your share $143.26. Show its lines.' });
  await expect(october).toBeVisible();

  // The breakdown keeps the keyboard on the choice pressed, and the address keeps the choice.
  const went = page.locator('.card', { hasText: 'Where it went' });
  await expect(went.locator('.row-title')).toHaveText(['Example Surgery Center', 'Example Lab', 'Example Orthopedic Surgeons', 'Example Health', 'Example Pediatrics', 'Example Pharmacy', 'Example Medical Supply', 'Example Imaging Partners']);
  await expect(went.locator('.row').first().locator('.row-aside')).toHaveText('$175.00');
  const byKind = went.getByRole('button', { name: 'Kind of care' });
  await byKind.focus();
  await page.keyboard.press('Enter');
  await expect(went.getByRole('button', { name: 'Kind of care' })).toBeFocused();
  await expect(went.getByRole('button', { name: 'Kind of care' })).toHaveAttribute('aria-pressed', 'true');
  await expect(went.locator('.row-title')).toHaveText(['Procedures', 'Lab tests', 'Visits', 'Pharmacy', 'Vaccines', 'Supplies and equipment', 'Imaging', 'Drugs given']);
  await expect(page).toHaveURL(/#\/costs\?by=category$/);
  // A screen reader hears what the page now shows.
  await expect(page.getByRole('status')).toHaveText('This plan year, everyone: $551.46 your share, 13 claims, by kind of care.');

  await october.click();
  await expect(page).toHaveURL(/#\/costs\?by=category&only=month%3A2026-10$/);
  await expect(page.getByRole('link', { name: 'Month: Oct 2026. Remove this filter.' })).toBeVisible();
  await expect(summary.locator('.glance-answer')).toHaveText('$143.26 your share');
  await expect(page.locator('.card-head h2', { hasText: /^3 claims$/ })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Deductible and out-of-pocket' })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/#\/costs\?by=category$/);
  await expect(summary.locator('.glance-answer')).toHaveText('$551.46 your share');

  // A calendar year, for taxes.
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '2025' }).click();
  await expect(page).toHaveURL(/period=2025/);
  const y2025 = page.locator('.card', { has: page.locator('.card-head h2', { hasText: '2025, everyone' }) });
  await expect(y2025.locator('.glance-answer')).toHaveText('$51.18 your share');
  await expect(page.getByRole('status')).toHaveText('2025, everyone: $51.18 your share, 3 claims, by kind of care.');
  await expect(y2025).toContainText('A tax return counts what was paid in the year');
  await expect(page.getByRole('group', { name: 'Plan paid and your share by month' }).getByRole('link')).toHaveCount(12);
});

test('each claim leads with what it says you owe, and a line the plan left out is listed, not owed', async ({ page }) => {
  await page.goto('./?demo#/costs');
  const claims = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^13 claims$/ }) });
  // Alex's sick visit: the practice billed a costlier strep test, and the plan paid it as the quick one.
  const visit = claims.locator('.row', { has: page.locator('.row-title', { hasText: /^Office visit and strep test$/ }) });
  await expect(visit.locator('.row-meta')).toHaveText('Nov 20, 2026 · Alex · Example Pediatrics');
  await expect(visit.locator('.row-aside')).toHaveText('$25.00');
  await expect(visit.locator('.totals')).toHaveText('Billed $213.00; Plan allowed $119.30; Plan paid $94.30; You owe $25.00');
  await expect(visit.locator('.claim-lines li')).toHaveText(['Office visit · CPT 99213your share $25.00', 'Strep test, DNA method · CPT 87651Left out by the plan, not owed', 'Strep test · CPT 87880your share $0.00']);
  const listed = (await claims.locator('.row').allTextContents()).join('\n');
  expect(listed).not.toContain('$132.00');
  expect(listed).not.toContain('Not split by line');
  // A claim of one line names its code beside the claim.
  await expect(claims.locator('.row', { has: page.locator('.row-title', { hasText: /^Office visit$/ }) }).locator('.row-meta')).toHaveText('Nov 18, 2026 · Robin · Example Health · CPT 99213');

  // Its page leads with the same, and says the same of the line.
  await visit.locator('a.row-main').click();
  await expect(page.locator('main h1')).toHaveText('Office visit and strep test');
  await expect(page.locator('.result-value')).toHaveText('You owe $25.00');
  const lines = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^3 lines$/ }) });
  const left = lines.locator('.row', { has: page.locator('.row-title', { hasText: /^Strep test, DNA method$/ }) });
  await expect(left.locator('.chip')).toHaveText('Left out');
  await expect(left.locator('.claim-amounts')).toHaveText('Left out by the plan, not owed: the claim’s totals do not count this line. Billed $132.00.');
  await expect(left.locator('.claim-notes')).toHaveText('The plan’s note: C7 -- This service was paid under a different code than the one billed.');
  await expect(lines).not.toContainText('Not covered $132.00');
});

test('one code’s prices, across providers and dates', async ({ page }) => {
  await page.goto('./?demo#/costs');
  const same = page.locator('.card', { hasText: 'Same service, different prices' });
  const office = same.locator('.row', { hasText: 'CPT 99213' });
  await expect(office).toContainText('Office visit');
  await expect(office).toContainText('CPT 99213 · 3 times at 2 providers');
  await expect(office.locator('.row-aside')).toHaveText('$98.00 to $121.10');
  await office.locator('a').first().click();
  await expect(page).toHaveURL(/#\/costs\?period=all&only=code%3ACPT%3A99213$/);
  await expect(page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'All years' })).toHaveAttribute('aria-pressed', 'true');

  const each = page.locator('.card', { hasText: 'What it cost each time' });
  await expect(each.locator('.glance-answer')).toHaveText('$98.00 to $121.10 allowed');
  await expect(each.locator('.row-title')).toHaveText(['Nov 20, 2026, Example Pediatrics', 'Nov 18, 2026, Example Health', 'Sep 15, 2025, Example Health']);
  await expect(each.getByRole('img', { name: 'Nov 20, 2026, Example Pediatrics: billed $165.00, allowed $98.00' })).toBeVisible();
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'All years, everyone' }) }).locator('.glance-answer')).toHaveText('$50.00 your share');

  // Each time opens its claim.
  await each.locator('.row').nth(1).locator('a').first().click();
  await expect(page.locator('main h1')).toHaveText('Office visit');
  await page.goBack();
  await page.getByRole('link', { name: 'Code: Office visit (CPT 99213). Remove this filter.' }).click();
  await expect(page).toHaveURL(/#\/costs\?period=all$/);
  await expect(page.locator('.card', { hasText: 'Same service, different prices' })).toBeVisible();
});

test('the lines download as CSV, without leaving the page', async ({ page }) => {
  await page.goto('./?demo#/costs?only=person:p_xo4em46i7yj3hphlpajo');
  await expect(page.locator('.card-head h2', { hasText: 'This plan year, Robin' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('costs-plan.csv');
  await expect(page.getByRole('status')).toHaveText('Saved costs-plan.csv.');
  const text = (await readFile((await download.path())!, 'utf8')).replace(/^\uFEFF/, '');
  const rows = text.trimEnd().split('\r\n');
  expect(rows[0]).toBe('Date,Person,Provider,Insurer,Plan year,Service,Code,Code system,Kind of care,Billed,Allowed,Plan paid,Deductible,Copay,Coinsurance,Not covered,You owe,Claim,Left out by the plan,Revenue code');
  expect(rows).toHaveLength(9);
  expect(rows[1]).toMatch(/^2026-11-18,Robin,Example Health,Example Health Plan,2026-01-01 to 2026-12-31,Office visit,99213,CPT,Visit,180\.00,112\.50,87\.50,/);
  await expect(page.locator('main h1')).toHaveText('Costs');
});

test('a person’s costs, from their claims', async ({ page }) => {
  // Sam's old claims address opens Sam's Money, which leads to every claim of Sam's.
  await page.goto('./?demo#/p/p_wwezzed7kml67hnp6s7n/claims');
  await expect(page).toHaveURL(/#\/money\?who=p_wwezzed7kml67hnp6s7n$/);
  await page.getByRole('link', { name: 'Every claim, by provider, kind of care and month' }).click();
  await expect(page).toHaveURL(/#\/costs\?only=person%3Ap_wwezzed7kml67hnp6s7n$/);
  await expect(page.getByRole('group', { name: 'Whose costs' }).getByRole('link', { name: 'Sam' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'This plan year, Sam' }) }).locator('.glance-answer')).toHaveText('$438.50 your share');
  // A person's breakdown is by provider or kind of care.
  await expect(page.locator('.card', { hasText: 'Where it went' }).getByRole('button')).toHaveText(['Provider', 'Kind of care']);
  await page.getByRole('group', { name: 'Whose costs' }).getByRole('link', { name: 'Everyone' }).click();
  await expect(page).toHaveURL(/#\/costs$/);
});

test('choices that match nothing say so', async ({ page }) => {
  await page.goto('./?demo#/costs?only=provider:nowhere');
  await expect(page.locator('main')).toContainText('No claim lines match these choices.');
  await page.getByRole('link', { name: 'Show every line' }).click();
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'This plan year, everyone' }) })).toBeVisible();
});

test('a plan year set in Settings applies to the plans whose claims do not give one', async ({ page }) => {
  await page.goto('./?demo#/costs');
  const note = page.locator('.plan-note');
  await expect(note).toContainText('plan year assumed to be the calendar year');
  await note.getByRole('link', { name: 'Set when your plan year starts' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await page.getByLabel('Plan year starts').selectOption({ label: 'April 1' });
  await expect(page.locator('.toast')).toContainText('Plan year set to start April 1');
  expect(await page.evaluate(() => localStorage.getItem('own-your-health-app.plan_year_start'))).toBe('04-01');
  await page.goto('./?demo#/costs');
  await expect(page.locator('.plan-note')).toHaveText(
    'Plan years: Example Care Plan, Jul 1, 2026 to Jun 30, 2027; Example Health Plan and Example Pharmacy Benefits, Apr 1, 2026 to Mar 31, 2027. Example Care Plan: plan year from your plan’s claims. Example Health Plan and Example Pharmacy Benefits: plan year as set in Settings; your plans’ records don’t say.',
  );
  // Back to the calendar year.
  await page.goto('./?demo#/settings');
  await page.getByLabel('Plan year starts').selectOption({ label: 'Not set: the calendar year' });
  expect(await page.evaluate(() => localStorage.getItem('own-your-health-app.plan_year_start'))).toBeNull();
});

test('the month chart fills its card at 12px text, and no label crosses its edge, from 320px up', async ({ page }) => {
  // The chart on the page now: it is drawn again when its width changes, and
  // the one drawn before is gone, so each look finds it afresh.
  const measure = () =>
    page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>('svg.cost-chart')!;
      const b = svg.getBoundingClientRect();
      // Every text box of the chart within the chart's own box.
      const outside = [...svg.querySelectorAll('text')].filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
      }).map((t) => t.textContent);
      // Drawn at its box's width, so a label is the size the stylesheet gives it, at any width.
      const fits = Math.abs(b.width - svg.parentElement!.getBoundingClientRect().width) < 1;
      const labelPx = Math.round(Number(getComputedStyle(svg.querySelector('text')!).fontSize.replace('px', '')) * (b.width / svg.viewBox.baseVal.width));
      return { outside, fits, labelPx };
    });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./?demo#/costs');
    const chart = page.locator('svg.cost-chart');
    await expect(chart).toBeVisible();
    await expect.poll(measure).toEqual({ outside: [], fits: true, labelPx: 12 });
    // Short amounts on the axis, and the year with the first month named.
    await expect(chart.locator('text', { hasText: /^\$\d[\d.]*[kM]?$/ }).first()).toBeVisible();
    await expect(chart.locator('text', { hasText: '’26' })).toHaveCount(1);
  }
});

test('a month column keeps keyboard focus when the chart is redrawn for a new width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./?demo#/costs');
  const column = page.locator('svg.cost-chart a.cost-col').last();
  const target = await column.getAttribute('href');
  await column.focus();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator('svg.cost-chart')).toHaveAttribute('viewBox', /^0 0 3\d\d 200$/);
  await expect(page.locator(`svg.cost-chart a.cost-col[href="${target}"]`)).toBeFocused();
});
