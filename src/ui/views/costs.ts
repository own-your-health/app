// #/costs: what care cost across the household, from the claims the plans
// sent. A period (this or last plan year, a calendar year, every year), a
// person, and any drill-down (a provider, a kind of care, a month, one code)
// narrow it; each is in the address. The totals, plan balances, months,
// breakdown, prices and lines below all count the same lines.

import { fromCents } from '../../model/billing';
import { CATEGORY_LABELS, type Category } from '../../model/claims';
import {
  balances,
  breakdown,
  codeKey,
  codeLines,
  comparableCodes,
  DIMENSION_LABELS,
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
  type Cents,
  type CostLine,
  type Group,
  type Period,
  type PlanYear,
} from '../../model/costs';
import { AMOUNT_LABELS, formatMoney } from '../../model/records';
import type { MedRecord } from '../../model/types';
import { monthChart, priceStrip, stackStrip } from '../costchart';
import { button, card, empty, link, row, type Ctx } from '../components';
import { h } from '../dom';
import { count, dateText, localDay } from '../format';
import { href, type CostBy, type CostFilter, type CostFilterBy, type Route } from '../router';

type CostsRoute = Extract<Route, { name: 'costs' }>;

const money = (c: number | undefined) => (c === undefined ? '' : (formatMoney(fromCents(c)) ?? ''));
const meta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const itemRoute = (person: string, id: string): Route => ({ name: 'item', person, id });

/** How many lines show before "Show all". */
const LINES_SHOWN = 25;

const FILTER_LABELS: Record<CostFilterBy, string> = { person: 'Person', provider: 'Provider', category: 'Kind of care', month: 'Month', code: 'Code' };

function matches(l: CostLine, f: CostFilter, names: Map<string, string>): boolean {
  if (f.by === 'code') return !!l.code && l.split && codeKey(l) === f.key;
  return keyOf(l, f.by, names).key === f.key;
}

/** A filter's words: "Provider: Example Lab". */
function filterLabel(f: CostFilter, lines: CostLine[], names: Map<string, string>): string {
  if (f.by === 'person') return names.get(f.key) ?? 'Someone';
  if (f.by === 'code') {
    const l = lines.find((x) => matches(x, f, names));
    return l ? `${l.service} (${f.key.replace(':', ' ')})` : f.key.replace(':', ' ');
  }
  if (f.by === 'month') return monthLabel(f.key);
  if (f.by === 'category') return CATEGORY_LABELS[f.key as Category]?.many ?? f.key;
  return lines.find((x) => matches(x, f, names))?.provider ?? f.key;
}

/** The totals as a line of label and amount pairs, with a hidden "; " between them for screen readers. */
function totalsLine(c: Cents): HTMLElement {
  const shown = (['billed', 'allowed', 'planPaid', 'youOwe'] as const).filter((k) => c[k] !== undefined);
  const label: Record<(typeof shown)[number], string> = { billed: 'Billed', allowed: 'Plan allowed', planPaid: 'Plan paid', youOwe: 'Your share' };
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

/** A plan year in words: "2026" when it is a calendar year, else "Jul 1, 2026 to Jun 30, 2027". */
function yearText(y: PlanYear): string {
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

function legend(items: [string, string][]): HTMLElement {
  return h('p', { class: 'cost-legend small' }, items.map(([cls, text]) => h('span', { class: 'cost-key' }, h('span', { class: ['swatch', cls], 'aria-hidden': 'true' }), text)));
}

export function costsView(ctx: Ctx, route: CostsRoute): HTMLElement {
  const store = ctx.store;
  const people = store.household.people;
  const names = new Map(people.map((p) => [p.id, p.name]));
  const all = householdLines(people.map((p) => ({ id: p.id, index: store.index(p.id) })));
  const records = new Map<string, MedRecord>();
  for (const p of people) for (const r of store.index(p.id)?.records ?? []) if (r.kind === 'claim') records.set(r.id, r);
  const today = localDay(ctx.now());

  const page = h('div', { class: 'stack' });
  const head = h(
    'section',
    { class: 'person-head' },
    h('h1', null, 'Costs'),
    h('p', { class: 'muted small' }, 'What each visit, test and fill cost, from the claims the health plans sent: what was billed, what the plan allowed and paid, and your share.'),
  );
  if (!all.length) {
    page.append(head, card({}, empty('No claims in these records yet. Once medrec imports a health plan’s claims, what each visit cost shows here.')));
    return page;
  }

  // The route's choices, kept as the page is used; a choice replaces the address, a drill-down adds to history.
  let period = route.period;
  let by: CostBy | undefined = route.by;
  const only = route.only ?? [];
  const body = h('div', { class: 'stack' });
  page.append(head, body);

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
    };
    const chips = (label: string, items: { id: string; text: string; on: boolean; go: () => void }[]) =>
      h(
        'div',
        { class: 'chips', role: 'group', 'aria-label': label },
        items.map((i) => h('button', { type: 'button', class: ['filter', i.on ? 'filter-on' : null], 'aria-pressed': i.on ? 'true' : 'false', 'data-focus': i.id, on: { click: i.go } }, i.text)),
      );

    // People with claims; choosing one is a filter like any other, kept in the address.
    const withClaims = people.filter((p) => all.some((l) => l.person === p.id));
    const personChips =
      withClaims.length > 1
        ? h(
            'div',
            { class: 'chips', role: 'group', 'aria-label': 'Whose costs' },
            [{ id: '', name: 'Everyone' }, ...withClaims].map((p) => {
              const on = p.id ? personFilter?.key === p.id : !personFilter;
              return h('a', { class: ['filter', on ? 'filter-on' : null], href: href(p.id ? adding({ by: 'person', key: p.id }) : without('person')), 'aria-current': on ? 'true' : false }, p.name);
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
    const controls = h('div', { class: 'cost-controls' }, personChips, periodChips, drillChips);

    if (!chosen || !lines.length) {
      body.replaceChildren(controls, card({}, empty('No claim lines match these choices.', link(routeWith({ only: personFilter ? [personFilter] : [] }), 'Show every line'))));
      refocus(focus);
      return;
    }

    const t = totals(lines);
    const whose = personFilter ? (names.get(personFilter.key) ?? 'Someone') : 'Everyone';
    const years = planYearsIn(lines);
    const calendar = /^\d{4}$/.test(chosen.id);
    // Plans that share a year are named together: "Example Health Plan and Example Pharmacy Benefits, 2026".
    const sameYear = new Map<string, string[]>();
    for (const y of years) sameYear.set(yearText(y.year), [...(sameYear.get(yearText(y.year)) ?? []), y.insurer ?? 'A plan']);
    const planNote =
      chosen.id === 'plan' || chosen.id === 'plan-1'
        ? h(
            'p',
            { class: 'small muted' },
            `${years.length === 1 ? 'Plan year' : 'Plan years'}: ${[...sameYear].map(([when, plans]) => `${andList(plans)}, ${when}`).join('; ')}. A plan year starts on the day its coverage in these records does; January 1 when there is none.`,
          )
        : null;
    const taxNote = calendar ? h('p', { class: 'small muted' }, 'A calendar year counts care by the day it was given. A tax return counts what was paid in the year, so a bill paid the next January belongs to that year.') : null;
    const fileName = `costs-${chosen.id}${drilled.length ? '-filtered' : ''}.csv`;
    const summary = card(
      { title: `${chosen.label}, ${whose.toLowerCase() === 'everyone' ? 'everyone' : whose}` },
      h('p', { class: 'glance-answer' }, `${money(t.cents.youOwe ?? 0)} your share`),
      totalsLine(t.cents),
      h('p', { class: 'small muted' }, `${count(t.claims, 'claim')}, ${count(t.lines, 'line')}.`, shareParts(t.cents) ? ` ${shareParts(t.cents)}` : null),
      planNote,
      taxNote,
      h('p', { class: 'small muted' }, 'Bills and receipts no claim covers are not counted; they are under each person’s Claims and bills.'),
      h('div', { class: 'cost-actions' }, button('Download CSV', () => download(fileName, toCsv(lines, names)), { small: true })),
    );

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
    const dims = (['person', 'provider', 'category'] as const).filter((d) => !only.some((f) => f.by === d) && !(d === 'person' && withClaims.length < 2));
    const dim: CostBy | undefined = by && (dims as readonly string[]).includes(by) ? by : dims.includes('provider') ? 'provider' : dims[0];
    let breakdownCard: HTMLElement | null = null;
    if (dim && dim !== 'month') {
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

    // The lines themselves, each opening its claim.
    const list = h('div', null);
    const showLines = (n: number) =>
      list.replaceChildren(
        ...lines.slice(0, n).map((l) =>
          row({
            route: itemRoute(l.person, l.claim),
            title: l.service,
            meta: meta(dateText(l.date), personFilter ? null : names.get(l.person), l.provider, l.code ? `${systemName(l.system)} ${l.code}`.trim() : null, CATEGORY_LABELS[l.category].one),
            aside: h('span', { class: 'num strong' }, money(l.cents.youOwe ?? 0)),
            extra: totalsLine(l.cents),
          }),
        ),
        lines.length > n
          ? h(
              'div',
              { class: 'cost-actions' },
              button(`Show all ${lines.length} lines`, () => {
                showLines(lines.length);
                list.querySelectorAll<HTMLElement>('.row')[n]?.querySelector<HTMLElement>('a')?.focus();
              }, { small: true }),
            )
          : '',
      );
    showLines(LINES_SHOWN);
    const linesCard = card({ title: count(lines.length, 'line') }, h('p', { class: 'small muted' }, 'Each thing a claim paid for, newest first. Amounts a claim gave only in total are a line of their own, “Not split by line”.'), list);

    body.replaceChildren(controls, summary, balanceCard ?? '', monthCard ?? '', breakdownCard ?? '', priceCard ?? '', linesCard);
    refocus(focus);
  };

  // A choice redraws the page: keep the keyboard on the control that was pressed.
  const refocus = (id: string | undefined) => {
    if (id) body.querySelector<HTMLElement>(`[data-focus="${CSS.escape(id)}"]`)?.focus();
  };

  draw();
  return page;
}

/** For the home screen: this plan year's share so far across everyone, or null with no claims. */
export function costsGlance(ctx: Ctx): HTMLElement | null {
  const store = ctx.store;
  const all = householdLines(store.household.people.map((p) => ({ id: p.id, index: store.index(p.id) })));
  if (!all.length) return null;
  const today = localDay(ctx.now());
  const year = all.filter((l) => inPeriod(l, 'plan', today));
  const t = totals(year);
  return card(
    { title: 'Costs' },
    year.length ? h('p', { class: 'glance-answer' }, `${money(t.cents.youOwe ?? 0)} your share this plan year`) : h('p', null, 'No claims yet this plan year.'),
    year.length ? totalsLine(t.cents) : null,
    h('p', { class: 'small' }, link({ name: 'costs' }, 'Costs by provider, kind of care and month')),
  );
}

/** The costs screen for one person. */
export const personCosts = (person: string): Route => ({ name: 'costs', only: [{ by: 'person', key: person }] });
