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
  await page.goto('./?demo');
  const glance = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Costs$/ }) });
  await expect(glance.locator('.glance-answer')).toHaveText('$263.96 your share this plan year');
  await glance.getByRole('link', { name: 'Costs by provider, kind of care and month' }).click();
  await expect(page).toHaveURL(/#\/costs$/);
  await expect(page.locator('main h1')).toHaveText('Costs');

  const summary = page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'This plan year, everyone' }) });
  await expect(summary.locator('.glance-answer')).toHaveText('$263.96 your share');
  await expect(summary.locator('.totals')).toHaveText('Billed $1,458.00; Plan allowed $742.40; Plan paid $478.44; Your share $263.96');
  await expect(summary).toContainText('8 claims, 14 lines. Your share is deductible $121.00, copay $45.00, coinsurance $97.96.');
  await expect(summary.locator('.plan-note')).toHaveText(
    'Plan years: Example Care Plan, Jul 1, 2026 to Jun 30, 2027; Example Health Plan and Example Pharmacy Benefits, 2026. Example Care Plan: plan year from your plan’s claims. Example Health Plan and Example Pharmacy Benefits: plan year assumed to be the calendar year; your plans’ records don’t say. Set when your plan year starts',
  );
  await expect(page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'This plan year' })).toHaveAttribute('aria-pressed', 'true');

  const balances = page.locator('.card', { hasText: 'Deductible and out-of-pocket' });
  await expect(balances.locator('.row-title')).toHaveText(['Alex Example, Example Care Plan', 'Sam Example, Example Care Plan', 'Robin Example, Example Health Plan']);
  await expect(balances.getByRole('progressbar', { name: 'Sam Example, Deductible: $121.00 of $750.00 used' })).toBeVisible();

  // Every month of the plan years so far, the quiet ones too, each a link to its lines.
  const months = page.getByRole('group', { name: 'Plan paid and your share by month' }).getByRole('link');
  await expect(months).toHaveCount(11);
  const october = page.getByRole('link', { name: 'Oct 2026: plan paid $291.84, your share $143.26. Show its lines.' });
  await expect(october).toBeVisible();

  // The breakdown keeps the keyboard on the choice pressed, and the address keeps the choice.
  const went = page.locator('.card', { hasText: 'Where it went' });
  await expect(went.locator('.row-title')).toHaveText(['Example Lab', 'Example Health', 'Example Pediatrics', 'Example Pharmacy']);
  await expect(went.locator('.row').first().locator('.row-aside')).toHaveText('$140.28');
  const byKind = went.getByRole('button', { name: 'Kind of care' });
  await byKind.focus();
  await page.keyboard.press('Enter');
  await expect(went.getByRole('button', { name: 'Kind of care' })).toBeFocused();
  await expect(went.getByRole('button', { name: 'Kind of care' })).toHaveAttribute('aria-pressed', 'true');
  await expect(went.locator('.row-title')).toHaveText(['Lab tests', 'Visits', 'Pharmacy', 'Vaccines']);
  await expect(page).toHaveURL(/#\/costs\?by=category$/);
  // A screen reader hears what the page now shows.
  await expect(page.getByRole('status')).toHaveText('This plan year, everyone: $263.96 your share, 8 claims, by kind of care.');

  await october.click();
  await expect(page).toHaveURL(/#\/costs\?by=category&only=month%3A2026-10$/);
  await expect(page.getByRole('link', { name: 'Month: Oct 2026. Remove this filter.' })).toBeVisible();
  await expect(summary.locator('.glance-answer')).toHaveText('$143.26 your share');
  await expect(page.locator('.card-head h2', { hasText: /^3 claims$/ })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Deductible and out-of-pocket' })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/#\/costs\?by=category$/);
  await expect(summary.locator('.glance-answer')).toHaveText('$263.96 your share');

  // A calendar year, for taxes.
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '2025' }).click();
  await expect(page).toHaveURL(/period=2025/);
  const y2025 = page.locator('.card', { has: page.locator('.card-head h2', { hasText: '2025, everyone' }) });
  await expect(y2025.locator('.glance-answer')).toHaveText('$51.18 your share');
  await expect(page.getByRole('status')).toHaveText('2025, everyone: $51.18 your share, 3 claims, by kind of care.');
  await expect(y2025).toContainText('A tax return counts what was paid in the year');
  await expect(page.getByRole('group', { name: 'Plan paid and your share by month' }).getByRole('link')).toHaveCount(12);
});

test('each claim leads with what it says you owe, and a line the plan replaced is listed, not owed', async ({ page }) => {
  await page.goto('./?demo#/costs');
  const claims = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^8 claims$/ }) });
  // Alex's sick visit: the practice billed a longer visit, and the plan paid it as a routine one.
  const visit = claims.locator('.row', { has: page.locator('.row-title', { hasText: /^Office visit and strep test$/ }) });
  await expect(visit.locator('.row-meta')).toHaveText('Nov 20, 2026 · Alex Example · Example Pediatrics');
  await expect(visit.locator('.row-aside')).toHaveText('$25.00');
  await expect(visit.locator('.totals')).toHaveText('Billed $213.00; Plan allowed $119.30; Plan paid $94.30; You owe $25.00');
  await expect(visit.locator('.claim-lines li')).toHaveText(['Office visit, extended · CPT 99215Replaced by the plan, not owed', 'Office visit · CPT 99213your share $25.00', 'Strep test · CPT 87880your share $0.00']);
  const listed = (await claims.locator('.row').allTextContents()).join('\n');
  expect(listed).not.toContain('$240.00');
  expect(listed).not.toContain('Not split by line');
  // A claim of one line names its code beside the claim.
  await expect(claims.locator('.row', { has: page.locator('.row-title', { hasText: /^Office visit$/ }) }).locator('.row-meta')).toHaveText('Nov 18, 2026 · Robin Example · Example Health · CPT 99213');

  // Its page leads with the same, and says the same of the line.
  await visit.locator('a.row-main').click();
  await expect(page.locator('main h1')).toHaveText('Office visit and strep test');
  await expect(page.locator('.result-value')).toHaveText('You owe $25.00');
  const lines = page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^3 lines$/ }) });
  const replaced = lines.locator('.row', { has: page.locator('.row-title', { hasText: /^Office visit, extended$/ }) });
  await expect(replaced.locator('.chip')).toHaveText('Replaced');
  await expect(replaced.locator('.claim-amounts')).toHaveText('Replaced by the plan, not owed: the claim’s totals leave this line out. Billed $240.00.');
  await expect(lines).not.toContainText('Not covered $240.00');
});

test('one code’s prices, across providers and dates', async ({ page }) => {
  await page.goto('./?demo#/costs');
  const same = page.locator('.card', { hasText: 'Same service, different prices' });
  await expect(same.locator('.row').first()).toContainText('Office visit');
  await expect(same.locator('.row').first()).toContainText('CPT 99213 · 3 times at 2 providers');
  await expect(same.locator('.row').first().locator('.row-aside')).toHaveText('$98.00 to $121.10');
  await same.locator('.row').first().locator('a').first().click();
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
  await expect(page.locator('.card-head h2', { hasText: 'This plan year, Robin Example' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('costs-plan.csv');
  await expect(page.getByRole('status')).toHaveText('Saved costs-plan.csv.');
  const text = (await readFile((await download.path())!, 'utf8')).replace(/^\uFEFF/, '');
  const rows = text.trimEnd().split('\r\n');
  expect(rows[0]).toBe('Date,Person,Provider,Insurer,Plan year,Service,Code,Code system,Kind of care,Billed,Allowed,Plan paid,Deductible,Copay,Coinsurance,Not covered,You owe,Claim');
  expect(rows).toHaveLength(9);
  expect(rows[1]).toMatch(/^2026-11-18,Robin Example,Example Health,Example Health Plan,2026-01-01 to 2026-12-31,Office visit,99213,CPT,Visit,180\.00,112\.50,87\.50,/);
  await expect(page.locator('main h1')).toHaveText('Costs');
});

test('a person’s costs, from their claims', async ({ page }) => {
  await page.goto('./?demo#/p/p_wwezzed7kml67hnp6s7n/claims');
  await page.locator('.card', { has: page.locator('.card-head h2', { hasText: /^Claims$/ }) }).getByRole('link', { name: 'Costs over time' }).click();
  await expect(page).toHaveURL(/#\/costs\?only=person%3Ap_wwezzed7kml67hnp6s7n$/);
  await expect(page.getByRole('group', { name: 'Whose costs' }).getByRole('link', { name: 'Sam Example' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.card', { has: page.locator('.card-head h2', { hasText: 'This plan year, Sam Example' }) }).locator('.glance-answer')).toHaveText('$121.00 your share');
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
  // Every text box of the chart within the chart's own box.
  const outside = () =>
    page.locator('svg.cost-chart').evaluate((svg) => {
      const b = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')].filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
      }).map((t) => t.textContent);
    });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./?demo#/costs');
    const chart = page.locator('svg.cost-chart');
    await expect(chart).toBeVisible();
    expect(await outside()).toEqual([]);
    // Drawn at its box's width, so a label is the size the stylesheet gives it, at any width.
    const [svgWidth, boxWidth, labelPx] = await chart.evaluate((svg) => [svg.getBoundingClientRect().width, svg.parentElement!.getBoundingClientRect().width, Number(getComputedStyle(svg.querySelector('text')!).fontSize.replace('px', '')) * (svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width)]);
    expect(Math.abs(svgWidth - boxWidth)).toBeLessThan(1);
    expect(labelPx).toBeCloseTo(12, 0);
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
