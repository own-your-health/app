// One person's full lists, reached from their Health: results, medicines,
// conditions, allergies, immunizations and imaging. Their documents are on
// Papers.

import { originNames, sortByDateDesc, str, studyTitle } from '../../model/records';
import { isOutOfRange, rangeFor, resultFlag } from '../../model/flags';
import type { LatestResult } from '../../model/overview';
import { allergyList, conditionList, CRITICALITY_TEXT, medicineList, statusText, vaccineList, type AllergyItem, type ConditionItem, type MedicineItem } from '../../model/lists';
import { resultGroups } from '../../model/panels';
import { COMING_UP_DAYS, FLU, fluSeason, SCHEDULE_SOURCE, scheduleDigest, scheduleFor, type DoseState, type FluSeason, type ScheduleRow } from '../../model/schedule';
import type { Person, PersonIndex, Provenance } from '../../model/types';
import { resultChart, resultSparkline } from '../chart';
import { button, card, chip, command, empty, flagChip, link, row, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, localDay, yearOf } from '../format';
import { SECTION_LABELS, type ListSection, type Route } from '../router';

const PAGE = 200;

function itemRoute(person: string, id: string): Route {
  return { name: 'item', person, id };
}

/** A list grouped by year, a page at a time, so a phone draws only what it shows. */
export function yearList<T extends { date?: string }>(items: T[], render: (x: T) => HTMLElement): HTMLElement {
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
    ` of ${dateText(SCHEDULE_SOURCE.date)}, routine doses only. CDC restored this version after a court stayed its January 2026 changes on ${dateText(SCHEDULE_SOURCE.stayed)}; the stay can be appealed. Doses given elsewhere may not be in these records, and the schedule’s catch-up timing and exceptions are not applied here.`,
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

export function personView(ctx: Ctx, personId: string, section: ListSection, sub?: string): HTMLElement {
  const person = ctx.store.person(personId);
  if (!person) return card({}, empty('This person is not in the records folder.', link({ name: 'home' }, 'Back to everyone')));
  const err = ctx.store.indexErrors.get(person.id);
  const idx = ctx.store.index(person.id);
  if (err || !idx) return card({ title: person.name }, empty(err ?? 'Loading…'));
  let body: Child;
  switch (section) {
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
    case 'imaging':
      body = imagingSection(ctx, person, idx);
      break;
  }
  return h(
    'div',
    { class: 'stack person' },
    h('p', null, link({ name: 'health', who: person.id }, icon('back', 16), ` ${person.name}’s health`)),
    h('h1', null, `${person.name}’s ${SECTION_LABELS[section].toLowerCase()}`),
    body,
  );
}
