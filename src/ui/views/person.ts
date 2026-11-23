// One person's records: the timeline and the views over it.

import {
  docTypeLabel,
  documentTitle,
  formatMoney,
  KIND_LABELS,
  organizationName,
  originNames,
  recordDetail,
  sortByDateDesc,
  str,
  studyTitle,
  timeline,
  type Money,
  type TimelineEntry,
} from '../../model/records';
import { visitKind, visitTimeline, type Visit } from '../../model/visits';
import { birthWords, coverageHistory, isChange, type CoverageSegment } from '../../model/coverage';
import { claimTitle, isPharmacyClaim } from '../../model/claims';
import { recordTitle } from '../../model/titles';
import { BILL_WINDOW_DAYS, claimsWithBills, owedByProvider, planBalances, toCents, type Bill, type Claim, type Owed } from '../../model/billing';
import { isOutOfRange, rangeFor, resultFlag } from '../../model/flags';
import { immunizationsGiven, latestResults, newInLatestLoads, type LatestResult } from '../../model/overview';
import { allergyList, conditionList, CRITICALITY_TEXT, medicineList, statusText, vaccineList, type AllergyItem, type ConditionItem, type MedicineItem } from '../../model/lists';
import { resultGroups } from '../../model/panels';
import { COMING_UP_DAYS, FLU, fluSeason, SCHEDULE_SOURCE, scheduleDigest, scheduleFor, type DoseState, type FluSeason, type ScheduleRow } from '../../model/schedule';
import type { MedRecord, Person, PersonIndex, Provenance } from '../../model/types';
import { resultChart, resultSparkline } from '../chart';
import { button, card, chip, command, driveLink, empty, filterChips, flagChip, link, refreshControl, row, sheet, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, localDay, relative, yearOf } from '../format';
import { searchPanel } from '../search';
import { visitContents, visitWhen } from '../visit';
import { personCosts } from './costs';
import { signInNotice } from './sources';
import { SECTION_LABELS, href, type Route, type Section } from '../router';

const PRIMARY: Section[] = ['overview', 'results', 'medicines', 'timeline'];
const MORE: Section[] = ['documents', 'conditions', 'allergies', 'immunizations', 'claims', 'imaging', 'search'];
const SECTION_ICONS: Partial<Record<Section, string>> = { overview: 'home', timeline: 'clock', results: 'chart', medicines: 'pill', documents: 'file' };

const PAGE = 200;

function itemRoute(person: string, id: string): Route {
  return { name: 'item', person, id };
}

function sectionNav(person: Person, current: Section): HTMLElement {
  const go = (section: Section) => ({ name: 'person', person: person.id, section }) as Route;
  const tabs = h(
    'nav',
    { class: 'section-tabs', 'aria-label': 'Sections' },
    [...PRIMARY, ...MORE].map((s) => h('a', { href: href(go(s)), class: ['tab', s === current ? 'tab-current' : null], 'aria-current': s === current ? 'page' : undefined }, SECTION_LABELS[s])),
  );
  const openMore = () => {
    const body = h(
      'div',
      { class: 'sheet-list' },
      MORE.map((s) => h('a', { href: href(go(s)), class: ['sheet-item', s === current ? 'tab-current' : null], on: { click: () => document.querySelector<HTMLElement>('.scrim .icon-button')?.click() } }, SECTION_LABELS[s])),
    );
    document.body.appendChild(sheet('More', body, () => {}));
  };
  const bottom = h(
    'nav',
    { class: 'bottom-nav', 'aria-label': 'Sections' },
    PRIMARY.map((s) => h('a', { href: href(go(s)), class: ['bottom-item', s === current ? 'bottom-current' : null], 'aria-current': s === current ? 'page' : undefined }, icon(SECTION_ICONS[s] ?? 'list', 22), h('span', null, SECTION_LABELS[s]))),
    h(
      'button',
      {
        type: 'button',
        class: ['bottom-item', MORE.includes(current) ? 'bottom-current' : null],
        'aria-label': MORE.includes(current) ? `More sections, showing ${SECTION_LABELS[current]}` : 'More sections',
        on: { click: openMore },
      },
      icon('more', 22),
      h('span', null, 'More'),
    ),
  );
  return h('div', null, tabs, bottom);
}

function header(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const views = ctx.store.sources(ctx.now()).filter((v) => v.source.person === person.id);
  const latest = views.map((v) => v.lastLoad?.at).filter(Boolean).sort().pop();
  return h(
    'section',
    { class: 'person-head' },
    h(
      'div',
      { class: 'person-title' },
      h('h1', null, person.name),
      h('a', { class: 'icon-button', href: href({ name: 'person', person: person.id, section: 'search' }), 'aria-label': `Search ${person.name}’s records` }, icon('search')),
    ),
    h(
      'p',
      { class: 'muted small' },
      [person.birth_date ? `Born ${dateText(person.birth_date)}` : null, count(idx.records.length, 'record'), count(idx.documents.length, 'document'), latest ? `latest load ${relative(latest, ctx.now())}` : null].filter(Boolean).join(' · '),
    ),
    signInNotice(views),
    views.some((v) => v.status) ? h('div', { class: 'person-actions' }, refreshControl(ctx, { person: person.id }, person.name)) : null,
  );
}

function entryRow(person: string, e: TimelineEntry): HTMLElement {
  return row({
    route: itemRoute(person, e.id),
    title: e.title,
    meta: [dateText(e.date), KIND_LABELS[e.kind] ?? e.kind, e.detail].filter(Boolean).join(' · '),
  });
}

/** A list grouped by year, a page at a time, so a phone draws only what it shows. */
function yearList<T extends { date?: string }>(items: T[], render: (x: T) => HTMLElement): HTMLElement {
  const box = h('div');
  let shown = 0;
  let year = '';
  const more = button('Show more', () => draw(), { ghost: true });
  const draw = () => {
    more.remove();
    for (const x of items.slice(shown, shown + PAGE)) {
      const y = yearOf(x.date);
      if (y !== year) {
        year = y;
        box.appendChild(h('h3', { class: 'year' }, y));
      }
      box.appendChild(render(x));
    }
    shown = Math.min(items.length, shown + PAGE);
    if (shown < items.length) box.appendChild(more);
  };
  draw();
  return box;
}

type Chip = [string, 'attention' | 'muted' | 'ok'];

/** Each state of a child's next dose and its chip; a dose months away has none. */
const SCHEDULE_CHIP: Record<Exclude<DoseState, 'given'>, Chip | null> = {
  not_recorded: ['Not in these records', 'attention'],
  coming_up: ['Coming up', 'muted'],
  past_age: ['Past the schedule’s age', 'muted'],
  later: null,
};

function stateChip(state: Exclude<DoseState, 'given'>): HTMLElement | null {
  const c = SCHEDULE_CHIP[state];
  return c ? chip(...c) : null;
}

function scheduleNote(): HTMLElement {
  return h(
    'p',
    { class: 'small muted schedule-note' },
    'By the ',
    h('a', { href: SCHEDULE_SOURCE.url, target: '_blank', rel: 'noopener noreferrer' }, 'CDC child and adolescent immunization schedule'),
    ` of ${dateText(SCHEDULE_SOURCE.date)}, routine doses only. Doses given elsewhere may not be in these records, and the schedule’s catch-up timing and exceptions are not applied here.`,
  );
}

/** When the next dose falls: "at 2 months, from Jan 8, 2027". */
function whenText(next: NonNullable<ScheduleRow['next']>): string {
  return next.state === 'coming_up' || next.state === 'later' ? `${next.when}, from ${dateText(next.from)}` : next.when;
}

function fluRow(flu: FluSeason, brief: boolean): HTMLElement {
  return row({
    title: FLU.name,
    meta: flu.missing ? `${flu.season} season: dose ${flu.given.length + 1} of ${flu.due}` : `${flu.season} season: ${count(flu.given.length, 'dose')} in these records`,
    aside: flu.missing ? stateChip('not_recorded') : brief ? null : chip('This season’s in these records', 'ok'),
  });
}

/**
 * A child's doses against the schedule. `brief` (the overview) lists the
 * model's digest: what the schedule places by now and is not recorded, then
 * what comes up soon. The Immunizations section lists every vaccine.
 */
function scheduleBlock(person: Person, idx: PersonIndex, today: string, brief: boolean): HTMLElement | null {
  if (!person.birth_date) return null;
  const rows = scheduleFor(person.birth_date, idx.records, today);
  if (!rows) return null;
  const flu = fluSeason(person.birth_date, idx.records, today);
  if (brief) {
    const lines = scheduleDigest(rows, flu).map((e) =>
      'flu' in e ? fluRow(e.flu, true) : row({ title: e.row.name, meta: `Dose ${e.row.next.dose} of ${e.row.totalText}, ${whenText(e.row.next)}`, aside: stateChip(e.row.next.state) }),
    );
    return h(
      'div',
      { class: 'schedule' },
      h('h3', { class: 'card-sub' }, 'By the schedule'),
      lines.length ? lines : h('p', { class: 'small' }, `Every dose the schedule places by this age is in these records, and none falls in the next ${COMING_UP_DAYS} days.`),
      scheduleNote(),
    );
  }
  return card(
    { title: 'By the schedule' },
    rows.map((r) => {
      const n = r.next;
      const done = `${r.given.length} of ${r.totalText} ${r.totalText === '1' ? 'dose' : 'doses'} in these records`;
      return row({
        title: r.name,
        meta: !n ? done : n.state === 'past_age' ? `${done} · the schedule no longer gives it at this age` : `${done} · next ${whenText(n)}`,
        aside: n ? stateChip(n.state) : chip('All in these records', 'ok'),
      });
    }),
    flu ? fluRow(flu, false) : null,
    scheduleNote(),
  );
}

/** How many results the overview lists when none is out of range. */
const RESULTS_SHOWN = 6;

/**
 * The person's first screen: what is current now, each card a short list
 * with a link to its whole section. Every row names where it came from.
 */
function overviewSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const now = ctx.now();
  const household = ctx.store.household;
  const from = (prov: Provenance[]) => originNames(prov, household, person.id).join(', ');
  const all = (section: Section, text: string) => h('p', { class: 'card-more' }, link({ name: 'person', person: person.id, section }, text, ' ', icon('next', 14)));
  const recordRow = (r: MedRecord, meta: (string | undefined | null)[], aside?: Child) =>
    row({ route: itemRoute(person.id, r.id), title: recordTitle(r), meta: meta.filter(Boolean).join(' · '), aside });

  const loads = newInLatestLoads(idx, now);
  const newCard = loads.length
    ? card(
        { title: 'New in the latest loads', class: 'overview-wide' },
        loads.map((l) => {
          const items = l.records.length + l.documents.length;
          const shown = [
            ...l.records.slice(0, 4).map((r) => recordRow(r, [dateText(r.date), KIND_LABELS[r.kind] ?? r.kind, recordDetail(r)])),
            ...l.documents.slice(0, Math.max(0, 4 - l.records.length)).map((d) => row({ route: itemRoute(person.id, d.id), title: documentTitle(d), meta: [dateText(d.date), docTypeLabel(d.doc_type)].filter(Boolean).join(' · ') })),
          ];
          const what = [l.records.length ? count(l.records.length, 'record') : null, l.documents.length ? count(l.documents.length, 'document') : null].filter(Boolean).join(' and ');
          return h(
            'div',
            { class: 'load-group' },
            h('p', { class: 'load-head small' }, `${organizationName(household, person.id, l.organization)}, ${relative(l.at, now)}: ${what}`),
            shown,
            items > shown.length ? h('p', { class: 'small muted' }, `and ${items - shown.length} more in the `, link({ name: 'person', person: person.id, section: 'timeline' }, 'timeline')) : null,
          );
        }),
      )
    : null;

  const results = latestResults(idx);
  const flagged = results.filter((r) => isOutOfRange(r.flag));
  const shownResults = [...flagged, ...results.filter((r) => !isOutOfRange(r.flag)).slice(0, Math.max(0, RESULTS_SHOWN - flagged.length))];
  const resultsCard = card(
    { title: 'Latest results' },
    flagged.length ? h('p', { class: 'small attention' }, flagged.length === 1 ? 'The newest result of 1 test is out of its range.' : `The newest results of ${flagged.length} tests are out of their range.`) : null,
    results.length
      ? shownResults.map(({ series, latest, flag }) =>
          row({
            route: { name: 'person', person: person.id, section: 'results', sub: series.key },
            title: series.name,
            meta: [latest.text, dateText(latest.date), latest.range ? `range ${latest.range}` : null].filter(Boolean).join(' · '),
            aside: flagChip(flag),
          }),
        )
      : empty('No results recorded.'),
    results.length ? all('results', results.length > shownResults.length ? `All ${count(results.length, 'test')}` : 'Results over time') : null,
  );

  const conditions = conditionList(idx);
  const notActive = conditions.ended.length + conditions.other.length;
  const conditionsCard = card(
    { title: 'Active conditions' },
    conditions.active.length ? conditions.active.map((i) => recordRow(i.latest, [sinceText(i), from(i.provenance)])) : empty('No active conditions recorded.'),
    conditions.active.length || notActive ? all('conditions', notActive ? `All conditions, ${notActive} past or inactive` : 'All conditions') : null,
  );

  const meds = medicineList(idx).active;
  const medsCard = card(
    { title: 'Current medicines' },
    meds.length ? meds.map((m) => recordRow(m.latest, [str(m.latest.fields.dosage), from(m.provenance)])) : empty('No current medicines recorded.'),
    all('medicines', 'All medicines'),
  );

  const allergies = allergyList(idx).current;
  const allergiesCard = card(
    { title: 'Allergies' },
    allergies.length
      ? allergies.map((i) => recordRow(i.latest, [i.reactions.join(', '), i.criticality ? CRITICALITY_TEXT[i.criticality] ?? i.criticality : null, from(i.provenance)], i.criticality === 'high' ? chip('High risk', 'attention') : undefined))
      : empty('No allergies recorded in these records.'),
    all('allergies', 'All allergies'),
  );

  const doses = immunizationsGiven(idx);
  const schedule = scheduleBlock(person, idx, localDay(now), true);
  const immunizationsCard = card(
    { title: 'Immunizations' },
    schedule,
    schedule && doses.length ? h('h3', { class: 'card-sub' }, 'Given') : null,
    doses.length ? doses.slice(0, 5).map((r) => recordRow(r, [dateText(r.date), from(r.provenance)])) : empty('No immunizations recorded.'),
    doses.length || schedule ? all('immunizations', doses.length > 5 ? `All ${count(doses.length, 'dose')} and the schedule` : schedule ? 'Doses and the schedule' : 'All immunizations') : null,
  );

  // The same visits, and the same documents for each, as the timeline shows.
  const { visits } = visitTimeline(idx, ctx.store.household, person.id, localDay(now));
  const visitsCard = card(
    { title: 'Recent visits' },
    visits.length
      ? visits.slice(0, 3).map((v) => recordRow(v.record, [visitWhen(v), str(v.record.fields.reason), str(v.record.fields.practitioner), str(v.record.fields.location) ?? str(v.record.fields.service_provider), v.documents.length ? count(v.documents.length, 'document') : null]))
      : empty('No visits recorded.'),
    all('timeline', 'Timeline'),
  );

  return h('div', { class: 'overview' }, newCard, resultsCard, conditionsCard, medsCard, allergiesCard, immunizationsCard, visitsCard);
}

/** Visits or every record: the two ways to read the timeline. */
function timelineSwitch(person: Person, all: boolean): HTMLElement {
  const opt = (label: string, on: boolean, route: Route) => h('a', { href: href(route), class: ['filter', on ? 'filter-on' : null], 'aria-current': on ? 'page' : null }, label);
  return h(
    'nav',
    { class: 'chips', 'aria-label': 'Timeline' },
    opt('Visits', !all, { name: 'person', person: person.id, section: 'timeline' }),
    opt('Every record', all, { name: 'person', person: person.id, section: 'timeline', sub: 'all' }),
  );
}

function timelineSection(ctx: Ctx, person: Person, idx: PersonIndex, sub?: string): HTMLElement {
  return sub === 'all' ? everyRecord(person, idx) : visitsTimeline(ctx, person, idx);
}

function everyRecord(person: Person, idx: PersonIndex): HTMLElement {
  const all = timeline(idx, recordTitle);
  const kinds = [...new Set(all.map((e) => e.kind))];
  const options: [string, string][] = [['all', 'All'], ...kinds.map((k): [string, string] => [k, KIND_LABELS[k] ?? k])];
  const list = h('div');
  let current = 'all';
  const draw = () => {
    const items = current === 'all' ? all : all.filter((e) => e.kind === current);
    list.replaceChildren(items.length ? yearList(items, (e) => entryRow(person.id, e)) : empty('Nothing here yet.'));
  };
  const chips = filterChips(options, current, (v) => ((current = v), draw()), 'Filter by kind');
  draw();
  return card({ title: 'Timeline' }, timelineSwitch(person, true), all.length ? chips : null, all.length ? list : empty('No records yet. They appear once medrec imports or files something for this person.'));
}

function visitsTimeline(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const today = localDay(ctx.now());
  const { visits, loose } = visitTimeline(idx, ctx.store.household, person.id, today);
  const changes = coverageHistory(idx, ctx.store.household, person.id).filter((c) => isChange(c) && c.start <= today);
  // Visits, and the days coverage changed, in one list by date.
  const entries = sortByDateDesc<{ date?: string; visit?: Visit; change?: CoverageSegment }>([
    ...visits.map((visit) => ({ date: visit.start, visit })),
    ...changes.map((change) => ({ date: change.start, change })),
  ]);
  return card(
    { title: 'Timeline' },
    timelineSwitch(person, false),
    entries.length
      ? yearList(entries, ({ visit, change }) => (change ? coverageChangeRow(person, change) : visitRow(person, visit!)))
      : empty('No visits in these records yet.', link({ name: 'person', person: person.id, section: 'timeline', sub: 'all' }, 'See every record')),
    loose.length
      ? h('p', { class: 'small muted' }, `${count(loose.length, 'document')} from no visit in these records (bills, scans, letters) are under `, link({ name: 'person', person: person.id, section: 'documents' }, 'Documents'), '.')
      : null,
  );
}

function visitRow(person: Person, v: Visit): HTMLElement {
  const r = v.record;
  const parts = visitContents(person.id, v);
  return row({
    route: itemRoute(person.id, r.id),
    title: r.display || visitKind(v) || 'Visit',
    meta: meta(visitWhen(v), visitKind(v), str(r.fields.reason), str(r.fields.practitioner), str(r.fields.location) ?? str(r.fields.service_provider)),
    aside: v.documents.length ? h('span', { class: 'muted small' }, count(v.documents.length, 'document')) : null,
    extra: parts.length ? h('div', { class: 'visit-extra' }, parts) : null,
  });
}

/** A chip for a result out of its range; critical in the error colour. None in range. */
function resultRow(personId: string, t: LatestResult): HTMLElement {
  const spark = resultSparkline(t.series.points, t.series.unit);
  return row({
    route: { name: 'person', person: personId, section: 'results', sub: t.series.key },
    title: t.series.name,
    meta: [`${t.latest.text} on ${dateText(t.latest.date)}`, t.latest.range ? `range ${t.latest.range}` : null, t.series.points.length > 1 ? count(t.series.points.length, 'result') : null].filter(Boolean).join(' · '),
    aside: spark || t.flag ? h('div', { class: 'result-aside' }, spark, flagChip(t.flag)) : null,
  });
}

function resultsSection(person: Person, idx: PersonIndex, sub?: string): HTMLElement {
  const groups = resultGroups(idx);
  if (sub) {
    const group = groups.find((g) => g.tests.some((t) => t.series.key === sub));
    const t = group?.tests.find((x) => x.series.key === sub);
    if (!group || !t) return card({}, empty('This test is not in the records.'));
    const s = t.series;
    const chart = resultChart(s.points, s.unit, s.name);
    const others = group.tests.filter((x) => x !== t);
    return h(
      'div',
      { class: 'stack' },
      h('p', null, link({ name: 'person', person: person.id, section: 'results' }, icon('back', 16), ' All results')),
      card(
        {},
        h('div', { class: 'card-head' }, h('h1', null, s.name), flagChip(t.flag)),
        h('p', { class: 'muted small' }, [group.name, count(s.points.length, 'result'), s.unit, t.latest.range ? `range ${t.latest.range}` : null].filter(Boolean).join(' · ')),
        chart ? h('div', { class: 'chart-box' }, chart) : null,
        chart && s.points.some((p) => rangeFor(p.range, p.unit ?? s.unit)) ? h('p', { class: 'small muted' }, 'The shaded band is the reference range each result came with.') : null,
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Value'), h('th', null, 'Range'), h('th', null, 'Flag'))),
          h(
            'tbody',
            null,
            [...s.points].reverse().map((p) => {
              const flag = resultFlag(p);
              return h(
                'tr',
                null,
                h('td', null, link(itemRoute(person.id, p.id), dateText(p.date))),
                h('td', { class: 'num' }, p.text),
                h('td', null, p.range ?? ''),
                h('td', { class: isOutOfRange(flag) ? 'attention' : undefined }, flag?.label ?? ''),
              );
            }),
          ),
        ),
      ),
      others.length ? card({ title: `Also in ${group.name}` }, others.map((x) => resultRow(person.id, x))) : null,
    );
  }
  if (!groups.length) return card({ title: 'Results' }, empty('No results yet.'));
  return h(
    'div',
    { class: 'stack' },
    groups.map((g) =>
      card(
        { title: g.name, actions: g.outOfRange ? chip(`${g.outOfRange} out of range`, 'attention') : null },
        g.tests.map((t) => resultRow(person.id, t)),
      ),
    ),
  );
}

/** "since Mar 10, 2025", or "recorded Mar 10, 2025" when there is one record. */
function sinceText(item: { first?: string; records: unknown[] }): string | null {
  if (!item.first) return null;
  return item.records.length > 1 ? `since ${dateText(item.first)}` : `recorded ${dateText(item.first)}`;
}

function sourcesText(ctx: Ctx, person: Person, provenance: Provenance[]): string | null {
  const names = originNames(provenance, ctx.store.household, person.id);
  return names.length ? `from ${names.join(' and ')}` : null;
}

const meta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

/** Unconfirmed, Ruled out, and a status the heading does not say (in the attention colour while active). */
function conditionChips(i: ConditionItem): HTMLElement | null {
  const chips = [i.unconfirmed ? chip('Unconfirmed', 'muted') : null, i.refuted ? chip('Ruled out', 'muted') : null, i.statusNote ? chip(i.statusNote, i.isActive ? 'attention' : 'muted') : null].filter((c): c is HTMLElement => !!c);
  return chips.length ? h('div', { class: 'chips-aside' }, chips) : null;
}

function conditionsSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const { active, ended, other } = conditionList(idx);
  const render = (i: ConditionItem) =>
    row({
      route: itemRoute(person.id, i.latest.id),
      title: i.name,
      meta: meta(i.ended ? `${i.first ? `${dateText(i.first)} to ` : 'ended '}${dateText(i.ended)}` : sinceText(i), sourcesText(ctx, person, i.provenance)),
      aside: conditionChips(i),
    });
  if (!active.length && !ended.length && !other.length) return card({ title: 'Conditions' }, empty('No conditions recorded.'));
  return h(
    'div',
    { class: 'stack' },
    card({ title: 'Active' }, active.length ? active.map(render) : empty('No active conditions recorded.')),
    ended.length ? card({ title: 'Resolved or inactive' }, ended.map(render)) : null,
    other.length ? card({ title: 'Ruled out or no status' }, other.map(render)) : null,
  );
}

function allergiesSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const { current, ended } = allergyList(idx);
  const render = (i: AllergyItem, past: boolean) =>
    row({
      route: itemRoute(person.id, i.latest.id),
      title: i.name,
      meta: meta(i.reactions.length ? i.reactions.join(', ') : null, i.criticality ? CRITICALITY_TEXT[i.criticality] ?? i.criticality : null, sinceText(i), sourcesText(ctx, person, i.provenance)),
      aside: past ? chip(statusText(i.latest.status) ?? 'Ended', 'muted') : i.criticality === 'high' ? chip('High risk', 'attention') : null,
    });
  return h(
    'div',
    { class: 'stack' },
    card({ title: 'Allergies' }, current.length ? current.map((i) => render(i, false)) : empty('No allergies recorded in these records.')),
    ended.length ? card({ title: 'No longer active' }, ended.map((i) => render(i, true))) : null,
  );
}

/** An active medicine "since" its first record; a past one by the dates it was recorded. */
function medicineWhen(m: MedicineItem, past: boolean): string | null {
  if (!m.first) return null;
  if (!past) return `since ${dateText(m.first)}`;
  return m.latest.date && m.latest.date !== m.first ? `${dateText(m.first)} to ${dateText(m.latest.date)}` : `recorded ${dateText(m.first)}`;
}

function medicinesSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const { active, past } = medicineList(idx);
  const render = (m: MedicineItem, isPast: boolean) => {
    const fill = m.lastFill;
    return row({
      route: itemRoute(person.id, m.latest.id),
      title: m.name,
      meta: meta(
        str(m.latest.fields.dosage),
        m.prescriber ? `prescribed by ${m.prescriber}` : null,
        medicineWhen(m, isPast),
        fill ? `last filled ${dateText(fill.date)}${fill.pharmacy ? ` at ${fill.pharmacy}` : ''}${fill.daysSupply ? `, ${fill.daysSupply} days` : ''}` : null,
        m.known.length === 1 && m.known[0] === 'reported' ? 'reported, not prescribed in these records' : null,
        sourcesText(ctx, person, m.provenance),
      ),
      aside: isPast ? chip(statusText(m.latest.status) ?? 'Past', 'muted') : null,
    });
  };
  if (!active.length && !past.length) return card({ title: 'Medicines' }, empty('No medicines yet.'));
  return h(
    'div',
    { class: 'stack' },
    card({ title: 'Active' }, active.length ? active.map((m) => render(m, false)) : empty('No active medicines recorded.')),
    past.length ? card({ title: 'Past and other' }, past.map((m) => render(m, true))) : null,
  );
}

function immunizationList(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const { given, notGiven } = vaccineList(idx);
  return h(
    'div',
    { class: 'stack' },
    card(
      { title: 'Doses given' },
      given.length
        ? given.map((v) =>
            row({
              route: itemRoute(person.id, v.latest.id),
              title: v.name,
              meta: meta(v.doses.length > 1 ? `${count(v.doses.length, 'dose')}, the last ${dateText(v.latest.date)}` : dateText(v.latest.date), sourcesText(ctx, person, v.provenance)),
              extra:
                v.doses.length > 1
                  ? h(
                      'p',
                      { class: 'dose-dates small' },
                      v.doses.map((d, i) => [i ? ' · ' : null, link(itemRoute(person.id, d.id), dateText(d.date))]),
                    )
                  : null,
            }),
          )
        : empty('No immunizations recorded.'),
    ),
    notGiven.length
      ? card(
          { title: 'Recorded as not given' },
          notGiven.map((r) => row({ route: itemRoute(person.id, r.id), title: r.display || 'Vaccine', meta: meta(dateText(r.date), sourcesText(ctx, person, r.provenance)) })),
        )
      : null,
  );
}

const money = (m: Money | undefined) => h('span', { class: 'num strong' }, formatMoney(m) ?? '');

function amountsLine(c: Claim): HTMLElement | null {
  const parts: [string, Money | undefined][] = [
    ['Billed', c.billed],
    ['Plan allowed', c.allowed],
    ['Plan paid', c.planPaid],
    ['Your share', c.yourShare],
  ];
  const shown = parts.filter(([, m]) => m);
  // The gap between amounts is visual; a hidden "; " keeps them apart when read aloud.
  return shown.length
    ? h(
        'div',
        { class: 'totals' },
        shown.map(([label, m], i) => [i ? h('span', { class: 'sr-only' }, '; ') : null, h('span', { class: 'total' }, h('span', { class: 'muted' }, label), ' ', h('span', { class: 'num' }, formatMoney(m) ?? ''))]),
      )
    : null;
}

/** The claim's bill, in a sentence with a link to it. */
function billLine(person: Person, c: Claim): HTMLElement | null {
  const share = toCents(c.yourShare);
  if (share === undefined) return null;
  if (share <= 0) return h('p', { class: 'small muted claim-bill' }, 'Nothing for you to pay on this claim.');
  if (isPharmacyClaim(c.record)) return h('p', { class: 'small muted claim-bill' }, 'Your share of a fill is paid to the pharmacy, usually when it is picked up or shipped, so no statement follows.');
  const m = c.bill;
  if (!m) return h('p', { class: 'small muted claim-bill' }, `No bill${c.provider ? ` from ${c.provider}` : ''} in these records within ${BILL_WINDOW_DAYS} days of the visit.`);
  const b = m.bill;
  const what = link(itemRoute(person.id, b.doc.id), `statement of ${dateText(b.date)}`);
  return h(
    'p',
    { class: 'small claim-bill' },
    m.how === 'amount' ? ['Billed on the ', what, `: ${formatMoney(b.amount)}, your share.`] : ['The next ', what, ` from ${b.provider} says ${formatMoney(b.amount) ?? 'an amount'} is due; it may cover other visits too.`],
    b.receipt ? [' A receipt was filed ', link(itemRoute(person.id, b.receipt.id), dateText(b.receipt.date)), '.'] : null,
  );
}

function claimsSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const today = localDay(ctx.now());
  const owed = owedByProvider(idx);
  const balances = planBalances(idx);
  const { claims, otherBills } = claimsWithBills(idx);
  const docs = new Map(idx.documents.map((d) => [d.id, d]));

  const owedRow = (o: Owed) => {
    const paid = !!o.bill.receipt;
    return row({
      route: itemRoute(person.id, o.bill.doc.id),
      title: o.provider,
      meta: meta(o.bill.date ? `statement ${dateText(o.bill.date)}` : null, o.bill.account ? `account ${o.bill.account}` : null, o.bill.due ? `due ${dateText(o.bill.due)}` : null, paid ? `receipt filed ${dateText(o.bill.receipt!.date)}` : null),
      aside: h('div', { class: 'chips-aside' }, money(o.bill.amount), paid ? chip('Receipt filed', 'ok') : o.bill.due && o.bill.due < today ? chip('Due date passed', 'attention') : null),
    });
  };
  const headline = owed.total && owed.due.length ? (owed.due.length === 1 ? `${formatMoney(owed.total)} due to ${owed.due[0]!.provider}` : `${formatMoney(owed.total)} due to ${owed.due.length} providers`) : null;
  const owedCard = card(
    { title: 'Owed to each provider' },
    owed.due.length || owed.paid.length
      ? [
          headline ? h('p', { class: 'glance-answer' }, headline) : h('p', { class: 'small' }, 'Every bill in these records has a receipt filed after it.'),
          owed.due.map(owedRow),
          owed.paid.map(owedRow),
          h('p', { class: 'small muted' }, 'From the newest statement of each provider and account in these records. A payment made since may not be here.'),
        ]
      : empty('No bills filed yet. A statement appears here once medrec files it.'),
  );

  const balancesCard = balances.length
    ? card(
        { title: 'Plan year so far' },
        balances.map((b) => {
          const used = toCents(b.used);
          const limit = toCents(b.limit);
          return row({
            title: b.label,
            meta: meta(b.scope, b.used && b.limit ? `${formatMoney(b.used)} of ${formatMoney(b.limit)} used` : formatMoney(b.used) ? `${formatMoney(b.used)} used` : null),
            extra: used !== undefined && limit ? h('progress', { class: 'meter', max: limit, value: Math.min(used, limit), 'aria-label': `${b.label}, ${b.scope}: ${formatMoney(b.used)} of ${formatMoney(b.limit)} used` }) : null,
          });
        }),
        h('p', { class: 'small muted' }, 'As printed with the claim for ', link(itemRoute(person.id, balances[0]!.claim.id), dateText(balances[0]!.asOf)), '.'),
      )
    : null;

  const claimsCard = card(
    { title: 'Claims', actions: claims.length ? link(personCosts(person.id), 'Costs over time') : null },
    claims.length
      ? yearList(
          claims.map((c) => ({ ...c, date: c.service })),
          (c) =>
            row({
              route: itemRoute(person.id, c.record.id),
              title: claimTitle(c.record),
              meta: meta(dateText(c.service), c.provider, c.insurer ? `by ${c.insurer}` : null, c.record.fields.outcome && c.record.fields.outcome !== 'complete' ? str(c.record.fields.outcome) : null),
              aside: c.yourShare ? money(c.yourShare) : null,
              extra: h(
                'div',
                { class: 'claim-extra' },
                amountsLine(c),
                c.parts.length ? h('p', { class: 'small muted' }, `Your share is ${c.parts.map((p) => `${p.label.toLowerCase()} ${formatMoney(p.amount)}`).join(', ')}.`) : null,
                billLine(person, c),
                c.record.documents.length
                  ? h(
                      'p',
                      { class: 'small' },
                      c.record.documents.map((id, i) => {
                        const d = docs.get(id);
                        return d ? [i ? ' · ' : null, link(itemRoute(person.id, d.id), documentTitle(d))] : null;
                      }),
                    )
                  : null,
              ),
            }),
        )
      : empty('No claims yet. An insurer CLI imports them.'),
  );

  const others = sortByDateDesc([
    ...otherBills.map((b) => ({ date: b.date, doc: b.doc, bill: b })),
    ...idx.documents.filter((d) => (d.doc_type === 'receipt' || d.doc_type === 'eob') && !claims.some((c) => c.record.documents.includes(d.id))).map((d) => ({ date: d.date, doc: d, bill: undefined as Bill | undefined })),
  ]);
  const othersCard = others.length
    ? card(
        { title: 'Other bills and receipts' },
        others.map(({ doc, bill }) =>
          row({
            route: itemRoute(person.id, doc.id),
            title: documentTitle(doc),
            meta: meta(dateText(bill?.date ?? doc.date), docTypeLabel(doc.doc_type), doc.organization, bill?.due ? `due ${dateText(bill.due)}` : null, bill ? 'no claim in these records matches it' : null),
            aside: bill?.amount ? money(bill.amount) : null,
            extra: h('div', { class: 'row-actions' }, driveLink(ctx, doc.path)),
          }),
        ),
      )
    : null;

  return h('div', { class: 'stack' }, owedCard, balancesCard, coverageCard(ctx, person, idx), claimsCard, othersCard);
}

const COVERED_AS: Record<string, string> = { child: 'covered as a child', spouse: 'covered as a spouse', common: 'covered as a partner', parent: 'covered as a parent' };

/** "Jan 1, 2024 to Nov 7, 2026", "since Nov 8, 2026". */
function coverageDays(s: CoverageSegment): string {
  if (s.start && s.end) return `${dateText(s.start)} to ${dateText(s.end)}`;
  if (s.start) return `since ${dateText(s.start)}`;
  return s.end ? `until ${dateText(s.end)}` : 'no dates in these records';
}

const coverageName = (s: CoverageSegment) => (s.plan ? `${s.insurer}, ${s.plan}` : s.insurer);

/** Each insurer and plan the person has had, newest first, and a change that fell on someone's birthday. */
function coverageCard(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement | null {
  const segments = coverageHistory(idx, ctx.store.household, person.id);
  if (!segments.length) return null;
  const from = (s: CoverageSegment) => s.organizations.map((o) => organizationName(ctx.store.household, person.id, o));
  return card(
    { title: 'Coverage', class: 'coverage-history' },
    segments.map((s) => {
      const born = birthWords(s, dateText);
      const sources = from(s);
      return row({
        route: itemRoute(person.id, s.records[0]!.id),
        title: coverageName(s),
        meta: meta(coverageDays(s), s.relationship ? COVERED_AS[s.relationship] : null),
        extra: h(
          'div',
          { class: 'coverage-extra' },
          born ? h('p', { class: 'small coverage-born' }, born) : null,
          sources.length ? h('p', { class: 'small muted' }, `In records from ${sources.join(' and ')}.`) : null,
        ),
      });
    }),
    segments.some((s) => s.born)
      ? h('p', { class: 'small muted' }, 'A birthday beside a change is a date the two share. These records don’t say why coverage changed.')
      : null,
  );
}

/** A day coverage changed, on the timeline. */
function coverageChangeRow(person: Person, s: CoverageSegment): HTMLElement {
  const born = birthWords(s, dateText);
  return row({
    route: itemRoute(person.id, s.records[0]!.id),
    title: s.first ? 'Coverage started' : 'Coverage changed',
    meta: meta(dateText(s.start), coverageName(s)),
    extra: born ? h('p', { class: 'small coverage-born' }, born) : null,
  });
}

function documentsSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const docs = sortByDateDesc(idx.documents);
  const types = [...new Set(docs.map((d) => d.doc_type ?? 'other'))];
  const options: [string, string][] = [['all', 'All'], ...types.map((t): [string, string] => [t, docTypeLabel(t)])];
  let current = 'all';
  const list = h('div');
  const draw = () => {
    const items = current === 'all' ? docs : docs.filter((d) => (d.doc_type ?? 'other') === current);
    list.replaceChildren(
      yearList(items, (d) =>
        row({
          route: itemRoute(person.id, d.id),
          title: documentTitle(d),
          meta: [dateText(d.date), docTypeLabel(d.doc_type), d.organization, d.pages ? count(d.pages, 'page') : null].filter(Boolean).join(' · '),
          extra: h('div', { class: 'row-actions' }, driveLink(ctx, d.path)),
        }),
      ),
    );
  };
  if (!docs.length) return card({ title: 'Documents' }, empty('No documents yet.'));
  const chips = filterChips(options, current, (v) => ((current = v), draw()), 'Filter by type');
  draw();
  return card({ title: 'Documents' }, chips, list);
}

function imagingSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const studies = sortByDateDesc(idx.studies);
  return card(
    { title: 'Imaging' },
    h('p', { class: 'muted small' }, 'Studies open in the DICOM viewer on the Mac. The app lists them; it has no viewer of its own.'),
    studies.length
      ? studies.map((st) =>
          row({
            route: itemRoute(person.id, st.id),
            title: studyTitle(st),
            meta: [dateText(st.date), st.modalities.join('/'), st.body_part, st.facility, `${count(st.series.length, 'series', 'series')}, ${count(st.instances, 'image')}`, bytes(st.size)].filter(Boolean).join(' · '),
            extra: h('div', { class: 'row-actions' }, command(`medrec images open ${st.id}`, ctx)),
          }),
        )
      : empty('No imaging studies filed yet.'),
  );
}

function searchSection(ctx: Ctx, person: Person, query: string | undefined, words: true | undefined): HTMLElement {
  return searchPanel(ctx, {
    people: [person],
    query,
    words,
    route: (q, w) => ({ name: 'person', person: person.id, section: 'search', ...(q ? { query: q } : {}), ...(q && w ? { words: true as const } : {}) }),
    title: 'Search',
    intro: 'Searches this person’s records, documents and imaging, and the text medrec extracted from their documents, here in the browser.',
  });
}

export function personView(ctx: Ctx, personId: string, section: Section, sub?: string, query?: string, words?: true): HTMLElement {
  const person = ctx.store.person(personId);
  if (!person) return card({}, empty('This person is not in the records folder.', link({ name: 'home' }, 'Back to everyone')));
  const err = ctx.store.indexErrors.get(person.id);
  const idx = ctx.store.index(person.id);
  if (err || !idx) return card({ title: person.name }, empty(err ?? 'Loading…'));
  let body: Child;
  switch (section) {
    case 'overview':
      body = overviewSection(ctx, person, idx);
      break;
    case 'timeline':
      body = timelineSection(ctx, person, idx, sub);
      break;
    case 'results':
      body = resultsSection(person, idx, sub);
      break;
    case 'medicines':
      body = medicinesSection(ctx, person, idx);
      break;
    case 'conditions':
      body = conditionsSection(ctx, person, idx);
      break;
    case 'allergies':
      body = allergiesSection(ctx, person, idx);
      break;
    case 'immunizations':
      body = h('div', { class: 'stack' }, scheduleBlock(person, idx, localDay(ctx.now()), false), immunizationList(ctx, person, idx));
      break;
    case 'claims':
      body = claimsSection(ctx, person, idx);
      break;
    case 'documents':
      body = documentsSection(ctx, person, idx);
      break;
    case 'imaging':
      body = imagingSection(ctx, person, idx);
      break;
    case 'search':
      body = searchSection(ctx, person, query, words);
      break;
  }
  return h('div', { class: 'stack person' }, header(ctx, person, idx), sectionNav(person, section), body);
}

