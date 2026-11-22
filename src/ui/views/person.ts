// One person's records: the timeline and the views over it.

import {
  bills,
  claimTotals,
  docTypeLabel,
  documentTitle,
  formatMoney,
  KIND_LABELS,
  medicines,
  recordDetail,
  recordsOf,
  resultSeries,
  sortByDateDesc,
  studyTitle,
  timeline,
  type TimelineEntry,
} from '../../model/records';
import { search } from '../../model/search';
import type { Json, MedRecord, Person, PersonIndex } from '../../model/types';
import { resultChart } from '../chart';
import { button, card, chip, command, driveLink, empty, link, refreshControl, row, sheet, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, relative, yearOf } from '../format';
import { SECTION_LABELS, href, type Route, type Section } from '../router';

const PRIMARY: Section[] = ['timeline', 'results', 'medicines', 'documents'];
const MORE: Section[] = ['conditions', 'allergies', 'immunizations', 'claims', 'imaging', 'search'];
const SECTION_ICONS: Partial<Record<Section, string>> = { timeline: 'clock', results: 'chart', medicines: 'pill', documents: 'file' };

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

function resultsSection(person: Person, idx: PersonIndex, sub?: string): HTMLElement {
  const series = resultSeries(idx);
  if (sub) {
    const s = series.find((x) => x.key === sub);
    if (!s) return card({}, empty('This test is not in the records.'));
    const chart = resultChart(s.points, s.unit, s.name);
    return h(
      'div',
      { class: 'stack' },
      h('p', null, link({ name: 'person', person: person.id, section: 'results' }, icon('back', 16), ' All results')),
      card(
        {},
        h('div', { class: 'card-head' }, h('h1', null, s.name)),
        h('p', { class: 'muted small' }, [count(s.points.length, 'result'), s.unit].filter(Boolean).join(' · ')),
        chart ? h('div', { class: 'chart-box' }, chart) : null,
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Value'), h('th', null, 'Range'), h('th', null, 'Flag'))),
          h(
            'tbody',
            null,
            [...s.points].reverse().map((p) =>
              h(
                'tr',
                null,
                h('td', null, link(itemRoute(person.id, p.id), dateText(p.date))),
                h('td', { class: 'num' }, p.text),
                h('td', null, p.range ?? ''),
                h('td', { class: p.interpretation && !/normal/i.test(p.interpretation) ? 'attention' : undefined }, p.interpretation ?? ''),
              ),
            ),
          ),
        ),
      ),
    );
  }
  return card(
    { title: 'Results' },
    series.length
      ? series.map((s) =>
          row({
            route: { name: 'person', person: person.id, section: 'results', sub: s.key },
            title: s.name,
            meta: [s.latest ? `${s.latest.text} on ${dateText(s.latest.date)}` : null, s.points.length > 1 ? count(s.points.length, 'result') : null].filter(Boolean).join(' · '),
            aside: s.latest?.interpretation && !/normal/i.test(s.latest.interpretation) ? chip(s.latest.interpretation, 'attention') : null,
          }),
        )
      : empty('No results yet.'),
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
      body = listSection(person, idx, 'immunization', 'Immunizations', (r) => recordDetail(r));
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

