// One person's full lists, reached from their Health: results, medicines,
// conditions, allergies, immunizations and imaging. Their documents are on
// Papers.

import { conditionName } from '../../model/codeNames';
import { originNames, sortByDateDesc, str, studyTitle } from '../../model/records';
import { isOutOfRange, rangeFor, resultFlag } from '../../model/flags';
import type { LatestResult } from '../../model/overview';
import { allergyList, conditionList, CRITICALITY_TEXT, medicineList, statusText, underHeadings, vaccineList, type AllergyItem, type ConditionItem, type ItemStanding, type MedicineItem } from '../../model/lists';
import { resultGroups } from '../../model/panels';
import { COMING_UP_DAYS, FLU, fluSeason, SCHEDULE_SOURCE, scheduleDigest, scheduleFor, type DoseState, type FluSeason, type ScheduleRow } from '../../model/schedule';
import type { Person, PersonIndex, Provenance } from '../../model/types';
import { resultChart, resultSparkline } from '../chart';
import { aboutNote, unsureNote } from '../about';
import { button, card, chip, command, empty, flagChip, link, row, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, localDay, yearOf } from '../format';
import { SECTION_LABELS, type ListSection, type Route } from '../router';
import { headedRows, isText, isWord, listNotes, prescriptionOf, standingMeta, standingNote } from '../standing';
import { called } from '../../model/people';

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
      unsureNote(idx),
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
  if (!groups.length) return card({ title: 'Results' }, empty('No results yet.'), unsureNote(idx), aboutNote(idx));
  return h(
    'div',
    { class: 'stack' },
    unsureNote(idx),
    groups.map((g) =>
      card(
        { title: g.name, actions: g.outOfRange ? chip(`${g.outOfRange} out of range`, 'attention') : null },
        g.tests.map((t) => resultRow(person.id, t)),
      ),
    ),
    aboutNote(idx),
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
const conditionChips = (i: ConditionItem): (HTMLElement | null)[] => [i.unconfirmed ? chip('Unconfirmed', 'muted') : null, i.refuted ? chip('Ruled out', 'muted') : null, i.statusNote ? chip(i.statusNote, i.isActive ? 'attention' : 'muted') : null];

/** A row's words and chips: by what each source says of it, where that is known, else by where its records are from. */
function saying(ctx: Ctx, person: Person, i: { provenance: Provenance[]; standing?: ItemStanding }, text: string | null, chips: (HTMLElement | null)[]): { meta: Child; aside: Child } {
  if (i.standing) return { meta: standingMeta(text, i.standing, ...chips), aside: null };
  const some = chips.filter((c): c is HTMLElement => !!c);
  return { meta: meta(text, sourcesText(ctx, person, i.provenance)), aside: some.length > 1 ? h('div', { class: 'chips-aside' }, some) : some[0] ?? null };
}

/** Every record of a kind, one tap away, each with what it is by its sources' words. */
function allOf<T extends { standing?: ItemStanding }>(ctx: Ctx, title: string, all: T[], render: (x: T, is: HTMLElement | null) => HTMLElement): HTMLElement | null {
  if (!all.length) return null;
  const today = localDay(ctx.now());
  return h('details', { class: 'card list-all' }, h('summary', null, `${title}: ${count(all.length, 'record')}`), all.map((x) => render(x, chip(x.standing ? isWord(x.standing.of, today) : 'Filled', 'muted'))));
}

function conditionsSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const { active, ended, other, all, notes } = conditionList(idx, localDay(ctx.now()));
  const render = (i: ConditionItem, is: HTMLElement | null = null) =>
    row({
      route: itemRoute(person.id, i.latest.id),
      title: conditionName(idx, i.latest).name,
      ...saying(ctx, person, i, i.ended ? `${i.first ? `${dateText(i.first)} to ` : 'ended '}${dateText(i.ended)}` : sinceText(i), is ? [is, i.unconfirmed ? chip('Unconfirmed', 'muted') : null] : conditionChips(i)),
    });
  if (all) {
    if (!all.length && !notes?.inError) return card({ title: 'Conditions' }, empty('No conditions recorded.'));
    return h('div', { class: 'stack' }, card({ title: 'Current' }, active.length ? active.map((i) => render(i)) : empty('No current conditions in these records.'), listNotes(notes)), allOf(ctx, 'All', all, render));
  }
  if (!active.length && !ended.length && !other.length) return card({ title: 'Conditions' }, empty('No conditions recorded.'));
  return h(
    'div',
    { class: 'stack' },
    card({ title: 'Active' }, active.length ? active.map((i) => render(i)) : empty('No active conditions recorded.'), standingNote(ctx, idx)),
    ended.length ? card({ title: 'Resolved or inactive' }, ended.map((i) => render(i))) : null,
    other.length ? card({ title: 'Ruled out or no status' }, other.map((i) => render(i))) : null,
  );
}

function allergiesSection(ctx: Ctx, person: Person, idx: PersonIndex): HTMLElement {
  const { current, ended, all, notes } = allergyList(idx, localDay(ctx.now()));
  const render = (i: AllergyItem, past: boolean, is: HTMLElement | null = null) =>
    row({
      route: itemRoute(person.id, i.latest.id),
      title: i.name,
      ...saying(ctx, person, i, meta(i.reactions.length ? i.reactions.join(', ') : null, i.criticality ? CRITICALITY_TEXT[i.criticality] ?? i.criticality : null, sinceText(i)), [is ?? (past ? chip(statusText(i.latest.status) ?? 'Ended', 'muted') : null), !past && i.criticality === 'high' ? chip('High risk', 'attention') : null]),
    });
  if (all) {
    if (!all.length && !notes?.inError) return card({ title: 'Allergies' }, empty('No allergies recorded in these records.'));
    return h('div', { class: 'stack' }, card({ title: 'Current' }, current.length ? current.map((i) => render(i, false)) : empty('No current allergies in these records.'), listNotes(notes)), allOf(ctx, 'All', all, (i, is) => render(i, i.standing?.group !== 'current', is)));
  }
  return h(
    'div',
    { class: 'stack' },
    card({ title: 'Allergies' }, current.length ? current.map((i) => render(i, false)) : empty('No allergies recorded in these records.'), standingNote(ctx, idx)),
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
  const today = localDay(ctx.now());
  const { active, past, onHold, endedByDate, all, notes } = medicineList(idx, today);
  const filled = (m: MedicineItem) => {
    const fill = m.lastFill;
    return fill ? `last filled ${dateText(fill.date)}${fill.pharmacy ? ` at ${fill.pharmacy}` : ''}${fill.daysSupply ? `, ${fill.daysSupply} days` : ''}` : null;
  };
  const render = (m: MedicineItem, isPast: boolean, under = false, is: HTMLElement | null = null) => {
    const dosage = str(m.latest.fields.dosage);
    return row({
      route: itemRoute(person.id, m.latest.id),
      title: under ? (dosage ?? prescriptionOf(m)) : m.name,
      ...saying(
        ctx,
        person,
        m,
        meta(
          under ? null : dosage,
          m.prescriber ? `prescribed by ${m.prescriber}` : null,
          m.standing?.group === 'endedByDate' ? isText(m.standing.of, today) : null,
          medicineWhen(m, isPast || (m.standing !== undefined && !m.active)),
          under ? null : filled(m),
          m.known.length === 1 && m.known[0] === 'reported' ? 'reported, not prescribed in these records' : null,
        ),
        [is ?? (isPast ? chip(statusText(m.latest.status) ?? 'Past', 'muted') : null)],
      ),
    });
  };
  if (all) {
    if (!all.length && !notes?.inError) return card({ title: 'Medicines' }, empty('No medicines yet.'));
    // Prescriptions of one medicine are rows under its name.
    const rows = (xs: MedicineItem[]) => underHeadings(xs).flatMap((of) => (of.length === 1 ? [render(of[0]!, false)] : [headedRows('h3', of[0]!.name, filled(of[0]!), of.map((m) => render(m, false, true)))]));
    return h(
      'div',
      { class: 'stack' },
      card({ title: 'Current' }, active.length ? rows(active) : empty('No current medicines in these records.'), listNotes(notes)),
      onHold.length ? card({ title: 'On hold' }, rows(onHold)) : null,
      endedByDate.length ? card({ title: 'Ended by its date' }, rows(endedByDate)) : null,
      allOf(ctx, 'All', all, (m, is) => render(m, !m.standing, false, is)),
    );
  }
  if (!active.length && !past.length) return card({ title: 'Medicines' }, empty('No medicines yet.'));
  return h(
    'div',
    { class: 'stack' },
    card({ title: 'Active' }, active.length ? active.map((m) => render(m, false)) : empty('No active medicines recorded.'), standingNote(ctx, idx)),
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
  if (err || !idx) return card({ title: called(person) }, empty(err ?? 'Loading…'));
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
    h('p', null, link({ name: 'health', who: person.id }, icon('back', 16), ` ${called(person)}’s health`)),
    h('h1', null, `${called(person)}’s ${SECTION_LABELS[section].toLowerCase()}`),
    body,
  );
}
