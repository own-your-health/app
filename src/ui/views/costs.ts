// #/costs: what care cost across the household, from the claims the plans
// sent. A period (this or last plan year, a calendar year, every year), a
// person, and any drill-down (a provider, a kind of care, a month, one code)
// narrow it; each is in the address. The totals, plan balances, months,
// breakdown, prices and claims below all count the same lines. Each claim
// leads with what it says you owe, its lines under it. Everyone's costs are a
// shared screen: private claims are in none of it, and a line says so.

import { CATEGORY_LABELS, claimAmounts, type Category, type Cents } from '../../model/claims';
import {
  balances,
  breakdown,
  claimsOf,
  codeKey,
  codeLines,
  comparableCodes,
  DIMENSION_LABELS,
  errorLines,
  householdLines,
  inPeriod,
  keyOf,
  monthLabel,
  monthsSpanned,
  periods,
  planYearsIn,
  systemName,
  toCsv,
  totals,
  type ClaimCost,
  type CostLine,
  type Group,
  type Period,
  type PlanBasis,
  type PlanYear,
} from '../../model/costs';
import { bornClause, coverageChangesIn } from '../../model/coverage';
import { recordPrivate } from '../../model/private';
import { AMOUNT_LABELS, formatMoney, fromCents } from '../../model/records';
import { getPlanStart } from '../../settings';
import type { MedRecord } from '../../model/types';
import { monthChart, priceStrip, stackStrip } from '../costchart';
import { button, card, empty, link, row, type Ctx } from '../components';
import { h } from '../dom';
import { count, dateText, localDay } from '../format';
import { heldNotes, privateLine, quietClaims } from '../../next/shared';
import { errorsNote } from '../inError';
import { href, type CostBy, type CostFilter, type CostFilterBy, type Route } from '../router';
import { called } from '../../model/people';

type CostsRoute = Extract<Route, { name: 'costs' }>;

const money = (c: number | undefined) => (c === undefined ? '' : (formatMoney(fromCents(c)) ?? ''));
const meta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const itemRoute = (person: string, id: string): Route => ({ name: 'item', person, id });

const claimsIn = (lines: CostLine[]): number => new Set(lines.map((l) => l.claim)).size;

/** How many claims show before "Show all". */
const CLAIMS_SHOWN = 25;

const FILTER_LABELS: Record<CostFilterBy, string> = { person: 'Person', provider: 'Provider', category: 'Kind of care', month: 'Month', code: 'Code' };

function matches(l: CostLine, f: CostFilter, names: Map<string, string>): boolean {
  if (f.by === 'code') return !!l.code && l.split && !l.uncounted && codeKey(l) === f.key;
  return keyOf(l, f.by, names).key === f.key;
}

/** A filter's words: "Provider: Example Lab". */
function filterLabel(f: CostFilter, lines: CostLine[], names: Map<string, string>): string {
  if (f.by === 'person') return names.get(f.key) ?? 'Someone';
  if (f.by === 'code') {
    const l = lines.find((x) => matches(x, f, names));
    return l ? `${l.service} (${f.key.replace(':', ' ')})` : 'one not listed here';
  }
  if (f.by === 'month') return monthLabel(f.key);
  if (f.by === 'category') return CATEGORY_LABELS[f.key as Category]?.many ?? f.key;
  return lines.find((x) => matches(x, f, names))?.provider ?? 'one not listed here';
}

/** The totals as a line of label and amount pairs, with a hidden "; " between them for screen readers. */
function totalsLine(c: Cents, owe = 'Your share'): HTMLElement {
  const shown = (['billed', 'allowed', 'planPaid', 'youOwe'] as const).filter((k) => c[k] !== undefined);
  const label: Record<(typeof shown)[number], string> = { billed: 'Billed', allowed: 'Plan allowed', planPaid: 'Plan paid', youOwe: owe };
  return h(
    'div',
    { class: 'totals' },
    shown.map((k, i) => [i ? h('span', { class: 'sr-only' }, '; ') : null, h('span', { class: 'total' }, h('span', { class: 'muted' }, label[k]), ' ', h('span', { class: 'num' }, money(c[k])))]),
  );
}

function shareParts(c: Cents): string | null {
  const parts = (['deductible', 'copay', 'coinsurance', 'notCovered'] as const).filter((k) => (c[k] ?? 0) !== 0).map((k) => `${AMOUNT_LABELS[k].toLowerCase()} ${money(c[k])}`);
  return parts.length ? `Your share is ${parts.join(', ')}.` : null;
}

// One sentence for each place a plan year can come from. "your plan’s" or
// "your plans’" is the only part that changes.
const BASIS_SAYS: Record<PlanBasis, (whose: string) => string> = {
  claims: (whose) => `plan year from ${whose} claims.`,
  setting: (whose) => `plan year as set in Settings; ${whose} records don’t say.`,
  calendar: (whose) => `plan year assumed to be the calendar year; ${whose} records don’t say.`,
};

/** Where each plan's year came from: the sentence alone when every plan shares it, else after the plans it is for. */
export function planBasisText(years: { insurer?: string; basis: PlanBasis }[]): string {
  const plans = (basis?: PlanBasis) => [...new Set(years.filter((y) => !basis || y.basis === basis).map((y) => y.insurer ?? 'A plan'))];
  const all = plans().length;
  return (['claims', 'setting', 'calendar'] as const)
    .flatMap((basis) => {
      const named = plans(basis);
      if (!named.length) return [];
      const says = BASIS_SAYS[basis](named.length > 1 ? 'your plans’' : 'your plan’s');
      return [named.length === all ? `${says[0]!.toUpperCase()}${says.slice(1)}` : `${andList(named)}: ${says}`];
    })
    .join(' ');
}

/** A plan year in words: "2026" when it is a calendar year, else "Jul 1, 2026 to Jun 30, 2027". */
export function yearText(y: PlanYear): string {
  return y.anniversary === '01-01' ? y.start.slice(0, 4) : `${dateText(y.start)} to ${dateText(y.end)}`;
}

const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function download(name: string, text: string): void {
  // A byte-order mark, so a spreadsheet reads the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function legend(items: [string, string][]): HTMLElement {
  return h('p', { class: 'cost-legend small' }, items.map(([cls, text]) => h('span', { class: 'cost-key' }, h('span', { class: ['swatch', cls], 'aria-hidden': 'true' }), text)));
}

/** One of a claim's lines: what was done and your share of it; a line the totals leave out, that it is not owed. */
function claimLine(l: CostLine): HTMLElement {
  const code = l.code ? `${systemName(l.system)} ${l.code}`.trim() : null;
  const what = h('span', { class: 'claim-line-what' }, l.service, code ? h('span', { class: 'muted' }, ` · ${code}`) : null);
  if (l.uncounted) return h('li', null, what, h('span', { class: 'muted' }, 'Left out by the plan, not owed'));
  const share = l.cents.youOwe;
  return h('li', null, what, share !== undefined ? h('span', { class: 'num' }, h('span', { class: 'sr-only' }, 'your share '), money(share)) : null);
}

/**
 * A claim: what it says you owe, then its lines. "You owe" is the payer's
 * own figure; without one, the parts it gives added up are "your share".
 */
function claimRow(c: ClaimCost, record: MedRecord | undefined, who: string | null): HTMLElement {
  const said = record ? claimAmounts(record) : undefined;
  const owe = said?.yourShare && !said.shareAdded ? 'You owe' : 'Your share';
  // A claim of one line is that line: its code goes beside the claim, with nothing to list under it.
  const only = c.of === 1 ? c.lines[0]! : undefined;
  const lines = only ? [] : c.lines;
  return row({
    route: itemRoute(c.person, c.claim),
    title: c.title,
    meta: meta(dateText(c.date), who, c.provider, only?.code ? `${systemName(only.system)} ${only.code}`.trim() : null),
    aside: h('span', { class: 'num strong' }, money(c.cents.youOwe ?? 0)),
    extra: h(
      'div',
      { class: 'claim-extra' },
      totalsLine(c.cents, owe),
      lines.length ? h('ul', { class: 'claim-lines small' }, lines.map(claimLine)) : null,
      c.lines.length < c.of ? h('p', { class: 'small muted' }, `${c.lines.length} of its ${c.of} lines match these choices.`) : null,
    ),
  });
}

export function costsView(ctx: Ctx, route: CostsRoute): HTMLElement {
  const store = ctx.store;
  const people = store.household.people;
  const names = new Map(people.map((p) => [p.id, called(p)]));
  const opts = { planStart: getPlanStart() ?? undefined };
  const whole = householdLines(
    people.map((p) => ({ id: p.id, index: store.index(p.id) })),
    opts,
  );
  const records = new Map<string, MedRecord>();
  for (const p of people) for (const r of store.index(p.id)?.records ?? []) if (r.kind === 'claim') records.set(r.id, r);
  const today = localDay(ctx.now());
  // One person's costs count their private claims; everyone's leave every private one out.
  const only = route.only ?? [];
  const own = only.some((f) => f.by === 'person');
  const quiet = quietClaims(store, today);
  const shared = whole.filter((l) => !quiet.has(l.claim));
  const all = own ? whole : shared;
  // Claims entered in error are in none of it: the list of claims counts those its choices would have.
  const wrong = people.flatMap((p) => {
    const idx = store.index(p.id);
    return idx ? errorLines(p.id, idx, opts).filter((l) => own || !recordPrivate(idx, l.claim)) : [];
  });
  const leftLine = privateLine('Private claims are left out here, totals too. ');
  leftLine.append(link({ name: 'money' }, 'Money’s totals'), ' count every claim. Choose a person to see theirs.');
  const leftOut = own ? [] : [leftLine, ...heldNotes(ctx, 'this shared view, its totals too')];

  const page = h('div', { class: 'stack' });
  const head = h(
    'section',
    { class: 'person-head' },
    h('h1', null, 'Costs'),
    h('p', { class: 'muted small' }, 'What each visit, test and fill cost, from the claims the health plans sent: what was billed, what the plan allowed and paid, and your share.'),
  );
  if (!all.length) {
    page.append(head, card({}, empty(`No claims ${own ? 'in these records' : 'listed here'} yet. Once medrec imports a health plan’s claims, what each visit cost shows here.`)), errorsNote(claimsIn(wrong.filter((l) => only.every((f) => matches(l, f, names))))) ?? '', ...leftOut);
    return page;
  }

  // The route's choices, kept as the page is used; a choice replaces the address, a drill-down adds to history.
  let period = route.period;
  let by: CostBy | undefined = route.by;
  const body = h('div', { class: 'stack' });
  // A choice redraws the page below it; this says what the page now shows. It is never redrawn itself.
  const said = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  page.append(head, said, body);

  const routeWith = (changes: Partial<CostsRoute>): CostsRoute => {
    const r: CostsRoute = { name: 'costs', period, by, only, ...changes };
    if (!r.only?.length) delete r.only;
    if (!r.period) delete r.period;
    if (!r.by) delete r.by;
    return r;
  };
  const adding = (f: CostFilter, changes: Partial<CostsRoute> = {}): CostsRoute => routeWith({ ...changes, only: [...only.filter((x) => x.by !== f.by), f] });
  const without = (kind: CostFilterBy): CostsRoute => routeWith({ only: only.filter((x) => x.by !== kind) });

  const draw = (focus?: string) => {
    const filtered = all.filter((l) => only.every((f) => matches(l, f, names)));
    // The periods these lines span; a month or code narrows within them, so they come from the rest.
    const spanned = all.filter((l) => only.every((f) => f.by === 'month' || matches(l, f, names)));
    const choices: Period[] = periods(spanned, today);
    const chosen = choices.find((p) => p.id === period) ?? choices[0];
    const lines = chosen ? filtered.filter((l) => inPeriod(l, chosen.id, today)) : [];
    const personFilter = only.find((f) => f.by === 'person');
    const drilled = only.filter((f) => f.by !== 'person');

    const pick = (next: { period?: string; by?: CostBy }, id: string) => () => {
      if ('period' in next) period = next.period;
      if ('by' in next) by = next.by;
      history.replaceState(null, '', href(routeWith({})));
      draw(id);
      said.textContent = body.querySelector('[data-said]')?.getAttribute('data-said') ?? '';
    };
    const chips = (label: string, items: { id: string; text: string; on: boolean; go: () => void }[]) =>
      h(
        'div',
        { class: 'chips', role: 'group', 'aria-label': label },
        items.map((i) => h('button', { type: 'button', class: ['filter', i.on ? 'filter-on' : null], 'aria-pressed': i.on ? 'true' : 'false', 'data-focus': i.id, on: { click: i.go } }, i.text)),
      );

    // People with claims a shared view may list, and the one chosen; choosing one is a filter like any other, kept in the address.
    const withClaims = people.filter((p) => p.id === personFilter?.key || shared.some((l) => l.person === p.id));
    const personChips =
      withClaims.length > 1
        ? h(
            'div',
            { class: 'chips', role: 'group', 'aria-label': 'Whose costs' },
            [{ id: '', name: 'Everyone' }, ...withClaims].map((p) => {
              const on = p.id ? personFilter?.key === p.id : !personFilter;
              return h('a', { class: ['filter', on ? 'filter-on' : null], href: href(p.id ? adding({ by: 'person', key: p.id }) : without('person')), 'aria-current': on ? 'true' : false }, called(p));
            }),
          )
        : null;
    const periodChips = chips(
      'Period',
      choices.map((p) => ({ id: `period-${p.id}`, text: p.label, on: p.id === chosen?.id, go: pick({ period: p.id }, `period-${p.id}`) })),
    );
    const drillChips = drilled.length
      ? h(
          'div',
          { class: 'cost-drill' },
          h('span', { class: 'small muted' }, 'Showing only'),
          drilled.map((f) => h('a', { class: 'filter filter-on', href: href(without(f.by)), 'aria-label': `${FILTER_LABELS[f.by]}: ${filterLabel(f, all, names)}. Remove this filter.` }, `${FILTER_LABELS[f.by]}: ${filterLabel(f, all, names)}`, h('span', { 'aria-hidden': 'true' }, '×'))),
        )
      : null;
    const controls = h('div', { class: 'cost-controls' }, personChips, periodChips, drillChips, leftOut);

    if (!chosen || !lines.length) {
      const none = card({}, empty('No claim lines match these choices.', link(routeWith({ only: personFilter ? [personFilter] : [] }), 'Show every line')));
      none.setAttribute('data-said', 'No claim lines match these choices.');
      body.replaceChildren(controls, none);
      refocus(focus);
      return;
    }

    const dims = (['person', 'provider', 'category'] as const).filter((d) => !only.some((f) => f.by === d) && !(d === 'person' && withClaims.length < 2));
    const dim: CostBy | undefined = by && (dims as readonly string[]).includes(by) ? by : dims.includes('provider') ? 'provider' : dims[0];
    const t = totals(lines);
    const whose = personFilter ? (names.get(personFilter.key) ?? 'Someone') : 'Everyone';
    const years = planYearsIn(lines);
    const calendar = /^\d{4}$/.test(chosen.id);
    // Plans that share a year are named together: "Example Health Plan and Example Pharmacy Benefits, 2026".
    const sameYear = new Map<string, string[]>();
    for (const y of years) sameYear.set(yearText(y.year), [...new Set([...(sameYear.get(yearText(y.year)) ?? []), y.insurer ?? 'A plan'])]);
    const planNote =
      chosen.id === 'plan' || chosen.id === 'plan-1'
        ? h(
            'p',
            { class: 'small muted plan-note' },
            `${years.length === 1 ? 'Plan year' : 'Plan years'}: ${[...sameYear].map(([when, plans]) => `${andList(plans)}, ${when}`).join('; ')}. `,
            planBasisText(years),
            years.some((y) => y.basis === 'calendar') ? [' ', link({ name: 'settings' }, 'Set when your plan year starts')] : null,
          )
        : null;
    const taxNote = calendar ? h('p', { class: 'small muted' }, 'A calendar year counts care by the day it was given. A tax return counts what was paid in the year, so a bill paid the next January belongs to that year.') : null;
    // A coverage that changed inside the period: the plan, and so the deductible, may differ either side of it.
    const changes = coverageChangesIn(lines, chosen.id, (pid) => store.index(pid), store.household);
    const coverageNote = changes.length
      ? h(
          'p',
          { class: 'small muted coverage-note' },
          'Coverage changed in this period: ',
          changes.map(({ person, change }, i) => {
            const born = bornClause(change);
            return [
              i ? '; ' : null,
              link({ name: 'money', who: person }, names.get(person) ?? 'Someone'),
              `, ${change.insurer} from ${dateText(change.start)}${born ? `, ${born}` : ''}`,
            ];
          }),
          '.',
        )
      : null;
    const fileName = `costs-${chosen.id}${drilled.length ? '-filtered' : ''}.csv`;
    const title = `${chosen.label}, ${whose.toLowerCase() === 'everyone' ? 'everyone' : whose}`;
    const summary = card(
      { title, class: 'cost-summary' },
      h('p', { class: 'glance-answer' }, `${money(t.cents.youOwe ?? 0)} your share`),
      totalsLine(t.cents),
      h('p', { class: 'small muted' }, `${count(t.claims, 'claim')}, ${count(t.lines, 'line')}.`, shareParts(t.cents) ? ` ${shareParts(t.cents)}` : null),
      planNote,
      coverageNote,
      taxNote,
      h('p', { class: 'small muted' }, 'Bills and receipts no claim covers are not counted; they are under each person’s Claims and bills.'),
      h(
        'div',
        { class: 'cost-actions' },
        button(
          'Download CSV',
          () => {
            download(fileName, toCsv(lines, names));
            said.textContent = `Saved ${fileName}.`;
          },
          { small: true },
        ),
      ),
    );
    summary.setAttribute('data-said', `${title}: ${money(t.cents.youOwe ?? 0)} your share, ${count(t.claims, 'claim')}${dim ? `, by ${DIMENSION_LABELS[dim].toLowerCase()}` : ''}.`);

    // Deductible and out-of-pocket, as each plan printed them, while nothing but a person narrows the lines.
    const bal = drilled.length ? [] : balances(lines, records);
    const balanceCard = bal.length
      ? card(
          { title: 'Deductible and out-of-pocket' },
          bal.map((b) => {
            const who = names.get(b.person) ?? 'Someone';
            const plan = b.insurer ?? 'The plan';
            return row({
              title: personFilter ? plan : `${who}, ${plan}`,
              meta: meta(`plan year ${yearText(b.planYear)}`, b.items[0]?.scope),
              extra: h(
                'div',
                { class: 'claim-extra balance-items' },
                b.items.map((i) => {
                  const scope = i.scope && i.scope !== b.items[0]?.scope ? ` (${i.scope})` : '';
                  const amount = i.used !== undefined && i.limit ? `${money(i.used)} of ${money(i.limit)} used` : i.used !== undefined ? `${money(i.used)} used` : 'not given';
                  return h(
                    'div',
                    { class: 'balance-item' },
                    h('p', { class: 'small' }, h('span', { class: 'strong' }, `${i.label}${scope}`), `: ${amount}`),
                    i.used !== undefined && i.limit ? h('progress', { class: 'meter', max: i.limit, value: Math.min(Math.max(i.used, 0), i.limit), 'aria-label': `${who}, ${i.label}${scope}: ${amount}` }) : null,
                  );
                }),
                h('p', { class: 'small muted' }, 'As printed with the ', link(itemRoute(b.person, b.claim), `claim for ${dateText(b.asOf)}`), '.'),
              ),
            });
          }),
          h('p', { class: 'small muted' }, 'A plan counts every claim it has paid toward these, including any not in these records.'),
        )
      : null;

    // Month by month, the quiet months too; each month opens its lines.
    const byMonth = new Map(breakdown(lines, 'month', names).map((g) => [g.key, g]));
    const months = monthsSpanned(lines, chosen.id, today).map((ym) => {
      const g = byMonth.get(ym);
      return { ym, label: monthLabel(ym), planPaid: g?.cents.planPaid ?? 0, share: g?.cents.youOwe ?? 0, group: g };
    });
    const chart = only.some((f) => f.by === 'month') ? null : monthChart(months, (ym) => adding({ by: 'month', key: ym }));
    const monthCard = chart
      ? card(
          { title: 'By month' },
          legend([
            ['swatch-plan', 'Plan paid'],
            ['swatch-share', 'Your share'],
          ]),
          h('div', { class: 'chart-box' }, chart),
          h(
            'details',
            { class: 'cost-table' },
            h('summary', null, 'The months as a table'),
            h(
              'table',
              { class: 'table' },
              h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Month'), h('th', { scope: 'col', class: 'num' }, 'Billed'), h('th', { scope: 'col', class: 'num' }, 'Plan paid'), h('th', { scope: 'col', class: 'num' }, 'Your share'))),
              h(
                'tbody',
                null,
                months.map((m) => h('tr', null, h('td', null, m.group ? link(adding({ by: 'month', key: m.ym }), m.label) : m.label), h('td', { class: 'num' }, money(m.group?.cents.billed ?? 0)), h('td', { class: 'num' }, money(m.planPaid)), h('td', { class: 'num' }, money(m.share)))),
              ),
            ),
          ),
        )
      : null;

    // The breakdown: by whatever is not already narrowed to one.
    let breakdownCard: HTMLElement | null = null;
    if (dim) {
      const groups = breakdown(lines, dim, names);
      const max = Math.max(...groups.map((g) => Math.max(0, g.cents.planPaid ?? 0) + Math.max(0, g.cents.youOwe ?? 0)));
      breakdownCard = card(
        { title: 'Where it went' },
        dims.length > 1 ? chips('Break down by', dims.map((d) => ({ id: `by-${d}`, text: DIMENSION_LABELS[d], on: d === dim, go: pick({ by: d }, `by-${d}`) }))) : null,
        legend([
          ['swatch-plan', 'Plan paid'],
          ['swatch-share', 'Your share'],
        ]),
        groups.map((g: Group) =>
          row({
            route: adding({ by: dim, key: g.key }),
            title: g.label,
            meta: meta(count(g.claims, 'claim'), g.cents.billed !== undefined ? `billed ${money(g.cents.billed)}` : null, g.cents.planPaid !== undefined ? `plan paid ${money(g.cents.planPaid)}` : null),
            aside: h('span', { class: 'num strong' }, money(g.cents.youOwe ?? 0)),
            extra: stackStrip({ planPaid: g.cents.planPaid ?? 0, share: g.cents.youOwe ?? 0 }, max),
          }),
        ),
      );
    }

    // One code's prices: every time it was billed, across the dates and providers; or the codes that can be compared.
    const codeFilter = only.find((f) => f.by === 'code');
    let priceCard: HTMLElement | null = null;
    if (codeFilter) {
      const ls = codeLines(filtered, codeFilter.key);
      const max = Math.max(...ls.map((l) => Math.max(l.cents.billed ?? 0, l.cents.allowed ?? 0)));
      const allowed = ls.map((l) => l.cents.allowed).filter((c): c is number => c !== undefined);
      priceCard = card(
        { title: 'What it cost each time' },
        allowed.length > 1 ? h('p', { class: 'glance-answer' }, Math.min(...allowed) === Math.max(...allowed) ? `${money(allowed[0])} allowed every time` : `${money(Math.min(...allowed))} to ${money(Math.max(...allowed))} allowed`) : null,
        legend([
          ['swatch-ring', 'Billed'],
          ['swatch-dot', 'Plan allowed'],
        ]),
        ls.map((l) =>
          row({
            route: itemRoute(l.person, l.claim),
            title: `${dateText(l.date)}, ${l.provider}`,
            meta: meta(personFilter ? null : names.get(l.person), l.insurer, l.cents.billed !== undefined ? `billed ${money(l.cents.billed)}` : null, l.cents.youOwe !== undefined ? `your share ${money(l.cents.youOwe)}` : null),
            aside: h('span', { class: 'num strong' }, money(l.cents.allowed)),
            extra: priceStrip(l.cents.billed, l.cents.allowed, max, `${dateText(l.date)}, ${l.provider}`),
          }),
        ),
        h('p', { class: 'small muted' }, 'The allowed amount is the price the plan agreed for it; providers bill more and the plan pays its part of the allowed amount. Every year in these records is shown.'),
      );
    } else {
      const codes = comparableCodes(all.filter((l) => !personFilter || l.person === personFilter.key)).slice(0, 8);
      if (codes.length) {
        priceCard = card(
          { title: 'Same service, different prices' },
          h('p', { class: 'small muted' }, 'Services billed more than once, by their billing code. Open one to see what each provider billed and what the plan allowed, every time.'),
          codes.map((c) =>
            row({
              route: routeWith({ period: 'all', only: [...(personFilter ? [personFilter] : []), { by: 'code', key: c.key }] }),
              title: c.label,
              meta: meta(`${systemName(c.system)} ${c.code}`, `${count(c.count, 'time')} at ${count(c.providers, 'provider')}`),
              aside: c.minAllowed !== undefined ? h('span', { class: 'num' }, c.minAllowed === c.maxAllowed ? money(c.minAllowed) : `${money(c.minAllowed)} to ${money(c.maxAllowed)}`) : null,
            }),
          ),
        );
      }
    }

    // The claims, each opening its own page: what the claim says you owe first, then its lines.
    const claims = claimsOf(lines, all);
    const list = h('div', null);
    const showClaims = (n: number) =>
      list.replaceChildren(
        ...claims.slice(0, n).map((c) => claimRow(c, records.get(c.claim), personFilter ? null : (names.get(c.person) ?? 'Someone'))),
        claims.length > n
          ? h(
              'div',
              { class: 'cost-actions' },
              button(`Show all ${claims.length} claims`, () => {
                showClaims(claims.length);
                list.querySelectorAll<HTMLElement>('.row')[n]?.querySelector<HTMLElement>('a')?.focus();
              }, { small: true }),
            )
          : '',
      );
    showClaims(CLAIMS_SHOWN);
    const claimsCard = card(
      { title: count(claims.length, 'claim') },
      h('p', { class: 'small muted' }, 'Newest first, each with what it says you owe and the lines it paid for. A line the plan left out of its totals, one it replaced with its own or wrote off, is listed, not owed. Amounts a claim gave only in total are a line of their own, “Not split by line”. The CSV download has a row for each line.'),
      list,
      errorsNote(claimsIn(wrong.filter((l) => only.every((f) => matches(l, f, names)) && (!chosen || inPeriod(l, chosen.id, today))))),
    );

    body.replaceChildren(controls, summary, balanceCard ?? '', monthCard ?? '', breakdownCard ?? '', priceCard ?? '', claimsCard);
    refocus(focus);
  };

  // A choice redraws the page: keep the keyboard on the control that was pressed.
  const refocus = (id: string | undefined) => {
    if (id) body.querySelector<HTMLElement>(`[data-focus="${CSS.escape(id)}"]`)?.focus();
  };

  draw();
  return page;
}
