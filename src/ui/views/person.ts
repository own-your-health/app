// One person's records: the timeline and the views over it.

import {
  bills,
  claimTotals,
  docTypeLabel,
  documentTitle,
  formatMoney,
  KIND_LABELS,
  medicines,
  organizationName,
  originNames,
  recordDetail,
  recordsOf,
  sortByDateDesc,
  studyTitle,
  timeline,
  type TimelineEntry,
} from '../../model/records';
import { isOutOfRange, rangeFor, resultFlag, type ResultFlag } from '../../model/flags';
import { activeConditions, currentAllergies, currentMedicines, immunizationsGiven, latestResults, newInLatestLoads, recentVisits, type LatestResult } from '../../model/overview';
import { resultGroups } from '../../model/panels';
import { COMING_UP_DAYS, FLU, fluSeason, SCHEDULE_SOURCE, scheduleDigest, scheduleFor, type DoseState, type FluSeason, type ScheduleRow } from '../../model/schedule';
import { search } from '../../model/search';
import type { Json, MedRecord, Person, PersonIndex, Provenance } from '../../model/types';
import { resultChart, resultSparkline } from '../chart';
import { button, card, chip, command, driveLink, empty, link, refreshControl, row, sheet, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, relative, yearOf } from '../format';
import { SECTION_LABELS, href, type Route, type Section } from '../router';

const PRIMARY: Section[] = ['overview', 'results', 'medicines', 'timeline'];
const MORE: Section[] = ['documents', 'conditions', 'allergies', 'immunizations', 'claims', 'imaging', 'search'];
const SECTION_ICONS: Partial<Record<Section, string>> = { overview: 'home', timeline: 'clock', results: 'chart', medicines: 'pill', documents: 'file' };

const PAGE = 200;

function str(v: Json | undefined): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

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
  const views = ctx.store.sources().filter((v) => v.source.person === person.id);
  const latest = views.map((v) => v.lastLoad?.at).filter(Boolean).sort().pop();
  const needs = views.filter((v) => v.health === 'needs_person').length;
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
    needs ? h('p', { class: 'small attention' }, link({ name: 'sources' }, needs === 1 ? 'A sign-in for this person needs a person on the Mac' : `${needs} sign-ins for this person need a person on the Mac`)) : null,
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

function filterChips<T extends string>(options: [T, string][], current: T, onPick: (v: T) => void): HTMLElement {
  return h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Filter' },
    options.map(([v, label]) => h('button', { type: 'button', class: ['filter', v === current ? 'filter-on' : null], 'aria-pressed': v === current ? 'true' : 'false', on: { click: () => onPick(v) } }, label)),
  );
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

/** The person's local calendar day, for "has this visit happened". */
function localDay(now: Date): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function reactions(r: MedRecord): string | undefined {
  return Array.isArray(r.fields.reaction) ? r.fields.reaction.filter((x): x is string => typeof x === 'string').join(', ') || undefined : undefined;
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
    row({ route: itemRoute(person.id, r.id), title: r.display || KIND_LABELS[r.kind] || r.kind, meta: meta.filter(Boolean).join(' · '), aside });

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

  const conditions = activeConditions(idx);
  const conditionsCard = card(
    { title: 'Active conditions' },
    conditions.active.length ? conditions.active.map((r) => recordRow(r, [r.date ? `since ${dateText(r.date)}` : null, from(r.provenance)])) : empty('No active conditions recorded.'),
    conditions.active.length || conditions.other ? all('conditions', conditions.other ? `All conditions, ${conditions.other} past or inactive` : 'All conditions') : null,
  );

  const meds = currentMedicines(idx);
  const medsCard = card(
    { title: 'Current medicines' },
    meds.length ? meds.map((g) => recordRow(g.latest, [str(g.latest.fields.dosage), from(g.records.flatMap((r) => r.provenance))])) : empty('No current medicines recorded.'),
    all('medicines', 'All medicines'),
  );

  const allergies = currentAllergies(idx);
  const allergiesCard = card(
    { title: 'Allergies' },
    allergies.length ? allergies.map((r) => recordRow(r, [reactions(r), str(r.fields.criticality) ? `criticality ${str(r.fields.criticality)}` : null, from(r.provenance)])) : empty('No allergies recorded in these records.'),
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

  const visits = recentVisits(idx, localDay(now));
  const visitsCard = card(
    { title: 'Recent visits' },
    visits.length
      ? visits.slice(0, 3).map((r) => recordRow(r, [dateText(r.date), str(r.fields.reason), str(r.fields.practitioner), str(r.fields.location) ?? str(r.fields.service_provider), r.documents.length ? count(r.documents.length, 'document') : null]))
      : empty('No visits recorded.'),
    all('timeline', 'Timeline'),
  );

  return h('div', { class: 'overview' }, newCard, resultsCard, conditionsCard, medsCard, allergiesCard, immunizationsCard, visitsCard);
}

function timelineSection(person: Person, idx: PersonIndex): HTMLElement {
  const all = timeline(idx);
  const kinds = [...new Set(all.map((e) => e.kind))];
  const options: [string, string][] = [['all', 'All'], ...kinds.map((k): [string, string] => [k, KIND_LABELS[k] ?? k])];
  const list = h('div');
  let current = 'all';
  const chipsBox = h('div');
  const draw = () => {
    const items = current === 'all' ? all : all.filter((e) => e.kind === current);
    chipsBox.replaceChildren(filterChips(options, current, (v) => ((current = v), draw())));
    list.replaceChildren(items.length ? yearList(items, (e) => entryRow(person.id, e)) : empty('Nothing here yet.'));
  };
  draw();
  return card({ title: 'Timeline' }, all.length ? chipsBox : null, all.length ? list : empty('No records yet. They appear once medrec imports or files something for this person.'));
}

/** A chip for a result out of its range; critical in the error colour. None in range. */
function flagChip(flag: ResultFlag | undefined): HTMLElement | null {
  return isOutOfRange(flag) ? chip(flag.label, flag.critical ? 'error' : 'attention') : null;
}

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

const MED_SOURCE: Record<string, string> = { request: 'prescribed', statement: 'reported', dispense: 'filled' };

function medicinesSection(person: Person, idx: PersonIndex): HTMLElement {
  const groups = medicines(idx);
  const render = (title: string, gs: typeof groups) =>
    gs.length
      ? card(
          { title },
          gs.map((g) => {
            const kinds = [...new Set(g.records.map((r) => MED_SOURCE[str(r.fields.source) ?? ''] ?? null).filter(Boolean))].join(', ');
            return row({
              route: itemRoute(person.id, g.latest.id),
              title: g.name,
              meta: [str(g.latest.fields.dosage), dateText(g.latest.date), kinds, g.records.length > 1 ? count(g.records.length, 'entry', 'entries') : null].filter(Boolean).join(' · '),
              aside: g.latest.status ? chip(g.latest.status, g.active ? 'ok' : 'muted') : null,
            });
          }),
        )
      : null;
  const active = groups.filter((g) => g.active);
  const past = groups.filter((g) => !g.active);
  if (!groups.length) return card({ title: 'Medicines' }, empty('No medicines yet.'));
  return h('div', { class: 'stack' }, render('Active', active), render(active.length ? 'Past and other' : 'Medicines', past));
}

function listSection(person: Person, idx: PersonIndex, kind: string, title: string, meta: (r: MedRecord) => string | undefined): HTMLElement {
  const rs = recordsOf(idx, kind);
  return card(
    { title },
    rs.length
      ? rs.map((r) =>
          row({
            route: itemRoute(person.id, r.id),
            title: r.display || KIND_LABELS[r.kind] || r.kind,
            meta: [dateText(r.date), meta(r)].filter(Boolean).join(' · '),
            aside: r.status ? chip(r.status, r.status === 'active' ? 'attention' : 'muted') : null,
          }),
        )
      : empty(`No ${title.toLowerCase()} recorded.`),
  );
}

function claimsSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const claims = recordsOf(idx, 'claim');
  const bs = bills(idx);
  return h(
    'div',
    { class: 'stack' },
    card(
      { title: 'Claims' },
      claims.length
        ? yearList(claims, (r) => {
            const totals = claimTotals(r);
            return row({
              route: itemRoute(person.id, r.id),
              title: r.display || 'Claim',
              meta: [dateText(r.date), str(r.fields.provider), str(r.fields.outcome)].filter(Boolean).join(' · '),
              extra: totals.length ? h('div', { class: 'totals' }, totals.map((t) => h('span', { class: 'total' }, h('span', { class: 'muted' }, t.label), ' ', h('span', { class: 'num' }, formatMoney(t.amount) ?? '')))) : null,
            });
          })
        : empty('No claims yet. An insurer CLI imports them.'),
    ),
    card(
      { title: 'Bills and statements' },
      bs.length
        ? bs.map((d) =>
            row({
              route: itemRoute(person.id, d.id),
              title: documentTitle(d),
              meta: [dateText(d.statement?.statement_date ?? d.date), docTypeLabel(d.doc_type), d.organization, d.statement?.due_date ? `due ${dateText(d.statement.due_date)}` : null, d.same_statement_as ? 'same statement as another' : null].filter(Boolean).join(' · '),
              aside: d.statement?.amount_due ? h('span', { class: 'num strong' }, formatMoney(d.statement.amount_due)) : null,
              extra: h('div', { class: 'row-actions' }, driveLink(ctx, d.path)),
            }),
          )
        : empty('No bills filed yet.'),
    ),
  );
}

function documentsSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const docs = sortByDateDesc(idx.documents);
  const types = [...new Set(docs.map((d) => d.doc_type ?? 'other'))];
  const options: [string, string][] = [['all', 'All'], ...types.map((t): [string, string] => [t, docTypeLabel(t)])];
  let current = 'all';
  const chipsBox = h('div');
  const list = h('div');
  const draw = () => {
    const items = current === 'all' ? docs : docs.filter((d) => (d.doc_type ?? 'other') === current);
    chipsBox.replaceChildren(filterChips(options, current, (v) => ((current = v), draw())));
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
  draw();
  return card({ title: 'Documents' }, chipsBox, list);
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

function searchSection(ctx: Ctx, person: Person, idx: PersonIndex, query: string | undefined): HTMLElement {
  const input = h('input', { type: 'search', class: 'input', placeholder: 'Search titles and document text', 'aria-label': 'Search', value: query ?? '', autocomplete: 'off', enterkeyhint: 'search' });
  const results = h('div');
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  let timer: number | undefined;
  let text: Awaited<ReturnType<typeof ctx.store.text>> = null;
  let textLoaded = false;
  const run = async () => {
    const q = input.value.trim();
    history.replaceState(null, '', href({ name: 'person', person: person.id, section: 'search', ...(q ? { query: q } : {}) }));
    if (!q) {
      results.replaceChildren();
      status.textContent = '';
      return;
    }
    if (!textLoaded) {
      status.textContent = 'Reading document text…';
      text = await ctx.store.text(person.id).catch(() => null);
      textLoaded = true;
    }
    const hits = search(idx, text, q);
    status.textContent = `${count(hits.length, 'match', 'matches')}${text ? '' : ' (titles only; this folder has no extracted text)'}`;
    results.replaceChildren(
      ...hits.map((hit) =>
        row({
          route: itemRoute(person.id, hit.id),
          title: hit.title,
          meta: [dateText(hit.date), KIND_LABELS[hit.kind] ?? hit.kind].join(' · '),
          extra: hit.snippet ? h('p', { class: 'snippet' }, hit.snippet) : null,
        }),
      ),
    );
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 200);
  });
  if (query) void run();
  return card({ title: 'Search' }, h('p', { class: 'muted small' }, 'Searches this person’s records and the text medrec extracted from their documents, here in the browser.'), input, status, results);
}

export function personView(ctx: Ctx, personId: string, section: Section, sub?: string, query?: string): HTMLElement {
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
      body = timelineSection(person, idx);
      break;
    case 'results':
      body = resultsSection(person, idx, sub);
      break;
    case 'medicines':
      body = medicinesSection(person, idx);
      break;
    case 'conditions':
      body = listSection(person, idx, 'condition', 'Conditions', (r) => [str(r.fields.verification_status), str(r.fields.abatement) ? `ended ${dateText(str(r.fields.abatement))}` : null].filter(Boolean).join(' · ') || undefined);
      break;
    case 'allergies':
      body = listSection(person, idx, 'allergy', 'Allergies', (r) => {
        const reactions = Array.isArray(r.fields.reaction) ? r.fields.reaction.filter((x): x is string => typeof x === 'string').join(', ') : undefined;
        return [reactions, str(r.fields.criticality) ? `criticality ${str(r.fields.criticality)}` : null].filter(Boolean).join(' · ') || undefined;
      });
      break;
    case 'immunizations':
      body = h('div', { class: 'stack' }, scheduleBlock(person, idx, localDay(ctx.now()), false), listSection(person, idx, 'immunization', 'Immunizations', (r) => recordDetail(r)));
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
      body = searchSection(ctx, person, idx, query);
      break;
  }
  return h('div', { class: 'stack person' }, header(ctx, person, idx), sectionNav(person, section), body);
}

