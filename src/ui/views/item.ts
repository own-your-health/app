// A record, document or study, plain first: what it is, what it says and
// what came with it. Its codes, every field, where it came from, the import
// that brought it in, its raw FHIR and its file in Drive sit folded under
// Technical details, whole, for the data-minded.

import { readJson } from '../../folder';
import { claimAmounts, toCents } from '../../model/billing';
import { CATEGORY_LABELS, claimLines, type ClaimLine } from '../../model/claims';
import { isOutOfRange, rangeFor, resultFlag } from '../../model/flags';
import { labTest } from '../../model/labtests';
import { learnMore } from '../../model/learn';
import { conditionList, CRITICALITY_TEXT, medicineList, statusText } from '../../model/lists';
import { isObject } from '../../model/parse';
import { AMOUNT_LABELS, asMoney, docTypeLabel, documentTitle, findItem, formatMoney, importFor, isDoseGiven, KIND_LABELS, numericValue, originNames, str, studyTitle, unitOf, valueText, type AmountName } from '../../model/records';
import { resultContext, unitText, verdict } from '../../model/result';
import { recordTitle } from '../../model/titles';
import type { ImagingStudy, Json, MedDocument, MedRecord, PersonIndex, Provenance } from '../../model/types';
import { visitKind, visitOf } from '../../model/visits';
import { rangeBar, resultChart } from '../chart';
import { button, card, chip, command, driveLink, empty, flagChip, jsonBlock, kv, link, outLink, row, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, dateTime, localDay } from '../format';
import type { Route } from '../router';
import { visitContents, visitWhen } from '../visit';

const itemRoute = (person: string, id: string): Route => ({ name: 'item', person, id });

const PROVENANCE_SHOWN = ['source', 'method', 'source_resource', 'fetched_at', 'filed_at', 'raw_path', 'classified_by', 'derived_from', 'filed_by'];

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A field as text where its shape is known (a quantity, a period, money), else as JSON. */
function fieldValue(v: Json): Child {
  if (v === null) return null;
  if (typeof v === 'string') return DATETIME.test(v) ? dateTime(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ');
  if (isObject(v)) {
    const money = asMoney(v);
    if (money && Object.keys(v).length <= 2) return formatMoney(money);
    if ('value' in v && Object.keys(v).every((k) => ['value', 'unit', 'system', 'code'].includes(k))) return valueText(v) ?? jsonBlock(v);
    if (Object.keys(v).every((k) => k === 'start' || k === 'end')) {
      const fmt = (x: Json | undefined) => (typeof x === 'string' ? (DATETIME.test(x) ? dateTime(x) : dateText(x)) : '');
      return [fmt(v.start), fmt(v.end)].filter(Boolean).join(' to ');
    }
  }
  return jsonBlock(v);
}

function fieldLabel(k: string): string {
  const t = k.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A raw file: shown on request, with its earlier versions beside it. */
function rawFile(ctx: Ctx, path: string): HTMLElement {
  const box = h('div', { class: 'raw' });
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const stem = name.replace(/\.json$/, '');
  const versions = h('div');
  const show = (p: string, label: string) => {
    const pre = h('div', null, h('p', { class: 'muted small' }, `Reading ${label}…`));
    box.appendChild(pre);
    readJson(ctx.store.folder, p).then(
      (v) => pre.replaceChildren(h('p', { class: 'small strong' }, label), v === null ? empty('The file is not in the folder.') : jsonBlock(v)),
      (e: unknown) => pre.replaceChildren(empty(e instanceof Error ? e.message : 'The file could not be read.')),
    );
  };
  const raw = button(
    'Show raw FHIR',
    () => {
      raw.remove();
      show(path, 'As the source served it');
      void ctx.store.folder.list(dir).then((entries) => {
        const earlier = (entries ?? []).filter((e) => !e.folder && e.name.startsWith(`${stem}~`) && e.name.endsWith('.json') && !e.name.includes('~refresh-'));
        if (earlier.length) {
          versions.replaceChildren(
            h('p', { class: 'small' }, count(earlier.length, 'earlier version')),
            ...earlier.map((e) => {
              const tag = e.name.slice(stem.length + 1, -5);
              return button(`Version ${tag}`, () => show(`${dir}/${e.name}`, `Earlier version ${tag}`), { ghost: true, small: true });
            }),
          );
        }
      });
    },
    { small: true },
  );
  box.append(h('div', { class: 'row-actions' }, raw, driveLink(ctx, path, 'Open the file in Drive')), versions);
  return box;
}

function provenanceCard(ctx: Ctx, idx: PersonIndex, p: Provenance, i: number, total: number): HTMLElement {
  const run = importFor(p, idx.imports);
  const extra = Object.entries(p).filter(([k, v]) => !PROVENANCE_SHOWN.includes(k) && v !== undefined && v !== null);
  return card(
    { title: total > 1 ? `Source ${i + 1} of ${total}` : 'Where it came from' },
    kv([
      ['From', [p.source.cli, p.source.organization_id].filter(Boolean).join(' · ') || p.source.kind],
      ['Method', p.method],
      ['Read by', p.source.cli ? `${p.source.cli} ${p.source.cli_version ?? ''}`.trim() : undefined],
      ['Server', p.source.fhir_base],
      ['Resource', p.source_resource ? `${p.source_resource.type}/${p.source_resource.id}${p.source_resource.version_id ? ` (version ${p.source_resource.version_id})` : ''}` : undefined],
      ['Updated at source', p.source_resource?.last_updated ? dateTime(p.source_resource.last_updated) : undefined],
      ['Fetched', p.fetched_at ? dateTime(p.fetched_at) : undefined],
      ['Filed', dateTime(p.filed_at)],
      ['Classified by', p.classified_by],
      ['Filed by', p.filed_by],
      ['Derived from', p.derived_from ? link({ name: 'item', person: idx.person, id: p.derived_from.document_id }, `document, rule ${p.derived_from.rule_id}`) : undefined],
    ]),
    run
      ? h(
          'div',
          { class: 'subcard' },
          h('h3', null, 'The import that brought it in'),
          kv([
            ['Import', h('code', null, run.id)],
            ['Imported', dateTime(run.imported_at)],
            ['Pulled from the source', dateTime(run.pulled_at)],
            ['Provider CLI', `${run.cli} ${run.cli_version}`],
            ['That import', `${run.records_added} new, ${run.records_updated} changed, ${run.records_unchanged} unchanged records`],
          ]),
        )
      : null,
    extra.length ? h('div', { class: 'subcard' }, h('h3', null, 'More'), kv(extra.map(([k, v]) => [fieldLabel(k), fieldValue(v as Json)]))) : null,
    p.raw_path ? h('div', { class: 'subcard' }, h('h3', null, 'Raw record'), h('p', { class: 'muted small mono' }, p.raw_path), rawFile(ctx, p.raw_path)) : null,
  );
}

/** A claim's lines: what each paid for, its code, and the amounts. */
function linesCard(lines: ClaimLine[]): HTMLElement {
  return card(
    { title: lines.length === 1 ? 'Line' : `${lines.length} lines` },
    lines.map((l) => {
      const amounts = (Object.keys(AMOUNT_LABELS) as AmountName[]).filter((k) => l.amounts[k]).map((k) => `${AMOUNT_LABELS[k]} ${formatMoney(l.amounts[k])}`);
      return row({
        title: l.label,
        meta: [l.code, CATEGORY_LABELS[l.category].one, l.date ? dateText(l.date) : null].filter(Boolean).join(' · '),
        extra: h('p', { class: ['small', 'claim-amounts', amounts.length ? null : 'muted'] }, amounts.length ? amounts.join(' · ') : 'The claim gives no amounts for this line.'),
      });
    }),
  );
}

/** Everything for the data-minded, folded away: codes, every field, where it came from, identifiers and the raw FHIR. */
function technical(...cards: Child[]): HTMLElement {
  return h('details', { class: 'tech' }, h('summary', null, 'Technical details'), h('div', { class: 'stack' }, ...cards));
}

/** The record as medrec keeps it: its code, status and every field. */
function fieldsCard(r: MedRecord, skip: string[] = []): HTMLElement {
  const fields = Object.entries(r.fields).filter(([k]) => k !== 'when' && !skip.includes(k));
  return card(
    { title: 'The record' },
    kv([
      ['Kind', KIND_LABELS[r.kind] ?? r.kind],
      ['Name at the source', r.display],
      ['Code', r.code ? [r.code.display, r.code.code].filter(Boolean).join(' · ') : undefined],
      ['Code system', r.code?.system],
      ['Status', r.status],
      ['Date', r.date],
      ...fields.map(([k, v]): [string, Child] => [fieldLabel(k), fieldValue(v)]),
    ]),
  );
}

function recordTechnical(ctx: Ctx, idx: PersonIndex, r: MedRecord, skip: string[] = []): HTMLElement {
  return technical(
    fieldsCard(r, skip),
    ...r.provenance.map((p, i) => provenanceCard(ctx, idx, p, i, r.provenance.length)),
    card({ title: 'Identifiers' }, kv([['Record', h('code', null, r.id)], ['Merge key', h('code', null, r.key)]])),
  );
}

/** The newest `n` points, newest first, with the one shown always among them. */
function newestWith<T extends { id: string }>(points: T[], id: string, n: number): T[] {
  const newest = [...points].reverse();
  const out = newest.slice(0, n);
  if (out.some((p) => p.id === id)) return out;
  const own = newest.find((p) => p.id === id);
  return own ? [...out.slice(0, n - 1), own] : out;
}

/** "Read about LDL cholesterol on MedlinePlus", saying where it goes and what it carries. */
function learnLink(r: MedRecord, name: string): HTMLElement | null {
  const l = learnMore(r, name);
  if (!l) return null;
  const site = l.site === 'CDC' ? 'CDC' : 'MedlinePlus';
  const c = l.carries;
  const note =
    'search' in c
      ? `Searches the National Library of Medicine’s health site for “${c.search}”, the name in these records. Nothing else goes with it.`
      : c.vaccine
        ? 'Opens the CDC’s statement on this vaccine. The link names only the vaccine, nothing about the person.'
        : `Opens the National Library of Medicine’s health site. The link carries only ${c.named ? 'the code and its name' : 'the code'}, nothing about the person.`;
  // The site's name and the icon stay on one line.
  return h(
    'div',
    { class: 'learn-more' },
    outLink(l.url, `Read about ${name} on `, h('span', { class: 'learn-site' }, site, ' ', icon('external', 14)), h('span', { class: 'sr-only' }, ' (opens in a new tab)')),
    h('p', { class: 'small muted' }, note),
  );
}

/** A record page's head: its name, a chip only when it says something, and one plain line. */
function head(title: string, chipEl: Child, metaParts: (string | null | undefined | false)[], ...rest: Child[]): HTMLElement {
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h1', null, title), chipEl), h('p', { class: 'muted' }, metaParts.filter(Boolean).join(' · ')), ...rest);
}

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const fromText = (ctx: Ctx, idx: PersonIndex, r: MedRecord) => {
  const names = originNames(r.provenance, ctx.store.household, idx.person);
  return names.length ? `from ${names.join(' and ')}` : null;
};

const RESULT_STATUS: Record<string, [string, 'attention' | 'muted']> = {
  preliminary: ['Preliminary', 'attention'],
  registered: ['Not resulted yet', 'attention'],
  amended: ['Amended', 'muted'],
  corrected: ['Corrected', 'muted'],
  cancelled: ['Cancelled', 'muted'],
  'entered-in-error': ['Entered in error', 'attention'],
};

function resultView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const person = idx.person;
  const c = resultContext(idx, ctx.store.household, person, localDay(ctx.now()), r);
  const point = c.point ?? { id: r.id, value: numericValue(r.fields.value), unit: unitOf(r.fields.value), range: str(r.fields.reference_range), interpretation: str(r.fields.interpretation), text: valueText(r.fields.value) ?? '' };
  const v = verdict(point);
  const name = recordTitle(r);
  const test = labTest(r.code);
  const value = valueText(r.fields.value);
  const shown = value ? (unitText(value) ?? value) : 'No value';
  const status = r.status && Object.hasOwn(RESULT_STATUS, r.status) ? RESULT_STATUS[r.status]! : undefined;
  const series = c.series;
  const chart = series ? resultChart(series.points, series.unit, name) : null;
  const sameDay = c.sameDraw.reduce((n, g) => n + g.records.length, 0);
  const seriesRoute: Route | undefined = series ? { name: 'person', person, section: 'results', sub: series.key } : undefined;
  return [
    head(
      name,
      status ? chip(status[0], status[1]) : null,
      [c.panel, dateText(r.date), fromText(ctx, idx, r)],
      h('p', { class: 'result-value' }, shown),
      h('p', { class: ['verdict', v.outOfRange ? 'verdict-out' : null] }, v.text),
      point.value !== undefined && v.range ? rangeBar(point.value, v.range, v.outOfRange, `${shown}. ${v.text}`) : null,
      test?.about
        ? h(
            'div',
            { class: 'about' },
            h('h2', null, 'What it measures'),
            h('p', null, test.about),
            h('p', { class: 'small muted' }, 'What a result means for you is a question for your doctor.'),
            test.page ? h('p', { class: 'small muted' }, 'Written for this app from ', outLink(test.page, 'MedlinePlus'), ', the National Library of Medicine’s health site.') : null,
          )
        : null,
      learnLink(r, name),
    ),
    series && series.points.length > 1
      ? card(
          { title: 'Over time' },
          chart ? h('div', { class: 'chart-box' }, chart) : null,
          chart && series.points.some((p) => rangeFor(p.range, p.unit ?? series.unit)) ? h('p', { class: 'small muted' }, 'The shaded band is the lab’s range at each result.') : null,
          h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Value'), h('th', null, 'Range'))),
            h(
              'tbody',
              null,
              newestWith(series.points, r.id, 6).map((p) => {
                  const f = resultFlag(p);
                  const current = p.id === r.id;
                  return h(
                    'tr',
                    { class: current ? 'current' : undefined, 'aria-current': current ? 'true' : undefined },
                    h('td', null, current ? [dateText(p.date), h('span', { class: 'sr-only' }, ' (this result)')] : link(itemRoute(person, p.id), dateText(p.date))),
                    h('td', { class: 'num' }, unitText(p.text) ?? p.text, isOutOfRange(f) ? [' ', flagChip(f)] : null),
                    h('td', null, p.range ? (unitText(p.range) ?? p.range) : ''),
                  );
                }),
            ),
          ),
          series.points.length > 6 && seriesRoute ? h('p', { class: 'card-more' }, link(seriesRoute, `All ${series.points.length} results`, ' ', icon('next', 14))) : null,
        )
      : null,
    sameDay
      ? card(
          { title: `Also tested on ${dateText(r.date)}` },
          c.sameDraw.map((g) => [
            c.sameDraw.length > 1 ? h('h3', { class: 'group-head' }, g.panel) : null,
            g.records.map((x) => {
              const f = resultFlag({ value: numericValue(x.fields.value), unit: unitOf(x.fields.value), range: str(x.fields.reference_range), interpretation: str(x.fields.interpretation) });
              const xv = valueText(x.fields.value);
              return row({ route: itemRoute(person, x.id), title: recordTitle(x), meta: xv ? (unitText(xv) ?? xv) : undefined, aside: flagChip(f) });
            }),
          ]),
        )
      : null,
    c.visit || c.documents.length || c.reports.length
      ? card(
          { title: 'Came with' },
          c.visit ? row({ route: itemRoute(person, c.visit.record.id), title: recordTitle(c.visit.record), meta: ['Visit', visitWhen(c.visit), str(c.visit.record.fields.location)].filter(Boolean).join(' · ') }) : null,
          c.reports.map((x) => row({ route: itemRoute(person, x.id), title: recordTitle(x), meta: ['Report', dateText(x.date)].join(' · ') })),
          c.documents.map((d) => row({ route: itemRoute(person, d.id), title: documentTitle(d), meta: [docTypeLabel(d.doc_type), dateText(d.date), d.organization].filter(Boolean).join(' · ') })),
        )
      : null,
    recordTechnical(ctx, idx, r),
  ];
}

function medicationView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const { active, past } = medicineList(idx);
  const m = [...active, ...past].find((x) => x.records.includes(r));
  const name = recordTitle(r);
  const fills = (m?.records ?? []).filter((x) => x.fields.source === 'dispense');
  const qty = (x: MedRecord) => {
    const q = x.fields.quantity;
    return isObject(q) && q.value !== undefined && q.value !== null ? [String(q.value), str(q.unit as Json)].filter(Boolean).join(' ') : undefined;
  };
  const days = (x: MedRecord) => (typeof x.fields.days_supply === 'number' ? `${x.fields.days_supply} days` : undefined);
  const state = m ? (m.active ? 'Taking now' : 'Past medicine') : (statusText(r.status) ?? undefined);
  return [
    head(
      name,
      null,
      ['Medicine', state, m?.first ? `since ${dateText(m.first)}` : dateText(r.date), fromText(ctx, idx, r)],
      str(r.fields.dosage) ? h('p', { class: 'result-value result-value-text' }, str(r.fields.dosage)) : null,
      kv([
        ['Prescribed by', m?.prescriber ?? str(r.fields.prescriber)],
        ['Last filled', m?.lastFill ? [dateText(m.lastFill.date), m.lastFill.pharmacy ? `at ${m.lastFill.pharmacy}` : null, m.lastFill.daysSupply ? `for ${m.lastFill.daysSupply} days` : null].filter(Boolean).join(' ') : undefined],
        ['How the records know of it', m?.known.length ? m.known.join(', ') : undefined],
      ]),
      learnLink(r, name),
    ),
    fills.length > 1
      ? card(
          { title: 'Fills' },
          fills.map((x) => row({ route: itemRoute(idx.person, x.id), title: dateText(x.date), meta: [qty(x), days(x), str(x.fields.pharmacy)].filter(Boolean).join(' · ') })),
        )
      : null,
    recordTechnical(ctx, idx, r),
  ];
}

function conditionView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const { active, ended, other } = conditionList(idx);
  const i = [...active, ...ended, ...other].find((x) => x.records.includes(r));
  const name = recordTitle(r);
  const status = statusText(r.status);
  return [
    head(
      name,
      i?.refuted ? chip('Ruled out', 'muted') : i?.unconfirmed ? chip('Unconfirmed', 'muted') : null,
      ['Condition', status, fromText(ctx, idx, r)],
      kv([
        ['Since', i?.first ? dateText(i.first) : r.date ? dateText(r.date) : undefined],
        ['Ended', i?.ended ? dateText(i.ended) : str(r.fields.abatement) ? fieldValue(r.fields.abatement!) : undefined],
        ['Kind', str(r.fields.category)],
        ['Recorded', i && i.records.length > 1 ? count(i.records.length, 'time') : undefined],
      ]),
      learnLink(r, name),
    ),
    recordTechnical(ctx, idx, r),
  ];
}

function allergyView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const name = recordTitle(r);
  const reactions = Array.isArray(r.fields.reaction) ? r.fields.reaction.filter((x): x is string => typeof x === 'string') : str(r.fields.reaction) ? [str(r.fields.reaction)!] : [];
  const crit = str(r.fields.criticality);
  return [
    head(
      name,
      null,
      ['Allergy', statusText(r.status), r.date ? `since ${dateText(r.date)}` : null, fromText(ctx, idx, r)],
      kv([
        ['Reaction', reactions.length ? reactions.join(', ') : undefined],
        ['Risk', crit && Object.hasOwn(CRITICALITY_TEXT, crit) ? sentence(CRITICALITY_TEXT[crit]!) : crit],
        ['Kind', str(r.fields.category)],
      ]),
      learnLink(r, name),
    ),
    recordTechnical(ctx, idx, r),
  ];
}

function immunizationView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const name = recordTitle(r);
  const given = isDoseGiven(r);
  const route = r.fields.route;
  return [
    head(
      name,
      given ? null : chip(statusText(r.status) ?? 'Not given', 'muted'),
      ['Vaccine', given ? `given ${dateText(r.date)}` : dateText(r.date), fromText(ctx, idx, r)],
      kv([
        ['Where', str(r.fields.performer) ?? str(r.fields.location)],
        ['Site', str(r.fields.site)],
        ['How', route !== undefined ? fieldValue(route) : undefined],
        ['Lot', str(r.fields.lot_number)],
        ['Why not given', given ? undefined : str(r.fields.status_reason)],
      ]),
      learnLink(r, name),
    ),
    recordTechnical(ctx, idx, r),
  ];
}

function encounterView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const visit = visitOf(idx, ctx.store.household, idx.person, localDay(ctx.now()), r.id);
  const inVisit = visit ? visitContents(idx.person, visit) : [];
  const kind = visit ? visitKind(visit) : undefined;
  return [
    head(
      recordTitle(r),
      null,
      [kind ?? 'Visit', visit ? visitWhen(visit) : dateText(r.date), fromText(ctx, idx, r)],
      kv([
        ['Reason', str(r.fields.reason)],
        ['With', str(r.fields.practitioner)],
        ['Where', str(r.fields.location) ?? str(r.fields.service_provider)],
        ['Status', r.status && r.status !== 'finished' ? (statusText(r.status) ?? r.status) : undefined],
      ]),
    ),
    visit
      ? card(
          { title: 'At this visit' },
          inVisit.length ? inVisit : empty('Nothing else in these records is from this visit.'),
          h('p', { class: 'small muted' }, `Documents medrec linked to the visit, and records and documents from ${visitWhen(visit)} at the same place.`),
        )
      : null,
    recordTechnical(ctx, idx, r),
  ];
}

function claimView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const lines = claimLines(r);
  const a = claimAmounts(r);
  const docs = r.documents.map((id) => idx.documents.find((d) => d.id === id)).filter((d): d is MedDocument => !!d);
  const start = isObject(r.fields.billable_period) ? str(r.fields.billable_period.start) : undefined;
  return [
    head(
      recordTitle(r),
      null,
      ['Claim', dateText(start ?? r.date), str(r.fields.provider), str(r.fields.insurer) ? `by ${str(r.fields.insurer)}` : null],
      a.yourShare ? h('p', { class: 'result-value' }, toCents(a.yourShare) === 0 ? 'Nothing for you to pay' : `You owe ${formatMoney(a.yourShare)}`) : null,
      kv([
        ['Billed', formatMoney(a.billed)],
        ['Plan allowed', formatMoney(a.allowed)],
        ['Plan paid', formatMoney(a.planPaid)],
        ['Your share comes from', a.parts.length ? sentence(a.parts.map((p) => `${p.label.toLowerCase()} ${formatMoney(p.amount)}`).join(', ')) : undefined],
        ['Outcome', str(r.fields.outcome) && r.fields.outcome !== 'complete' ? str(r.fields.outcome) : undefined],
      ]),
    ),
    lines.length ? linesCard(lines) : null,
    docs.length ? card({ title: 'Documents' }, docs.map((d) => row({ route: itemRoute(idx.person, d.id), title: documentTitle(d), meta: [docTypeLabel(d.doc_type), dateText(d.date)].filter(Boolean).join(' · ') }))) : null,
    recordTechnical(ctx, idx, r, lines.length ? ['items'] : []),
  ];
}

/** Any other kind (a procedure, a report, a coverage): its name, plain line and what it says, then the rest folded. */
function otherView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const name = recordTitle(r);
  const docs = r.documents.map((id) => idx.documents.find((d) => d.id === id)).filter((d): d is MedDocument => !!d);
  return [
    head(
      name,
      null,
      [KIND_LABELS[r.kind] ?? r.kind, statusText(r.status), dateText(r.date), fromText(ctx, idx, r)],
      kv([
        ['Conclusion', str(r.fields.conclusion)],
        ['Where', str(r.fields.location)],
        ['Plan', str(r.fields.plan)],
        ['Paid by', str(r.fields.payer)],
      ]),
      learnLink(r, name),
    ),
    docs.length ? card({ title: 'Documents' }, docs.map((d) => row({ route: itemRoute(idx.person, d.id), title: documentTitle(d), meta: [docTypeLabel(d.doc_type), dateText(d.date)].filter(Boolean).join(' · ') }))) : null,
    recordTechnical(ctx, idx, r),
  ];
}

function recordView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  switch (r.kind) {
    case 'result':
      return resultView(ctx, idx, r);
    case 'medication':
      return medicationView(ctx, idx, r);
    case 'condition':
      return conditionView(ctx, idx, r);
    case 'allergy':
      return allergyView(ctx, idx, r);
    case 'immunization':
      return immunizationView(ctx, idx, r);
    case 'encounter':
      return encounterView(ctx, idx, r);
    case 'claim':
      return claimView(ctx, idx, r);
    default:
      return otherView(ctx, idx, r);
  }
}

function documentView(ctx: Ctx, idx: PersonIndex, d: MedDocument): Child[] {
  const textBox = h('div');
  const showText = button(
    'Show extracted text',
    () => {
      showText.remove();
      textBox.replaceChildren(h('p', { class: 'muted small' }, 'Reading…'));
      void ctx.store.text(idx.person).then((t) => {
        const body = t?.texts[d.id];
        textBox.replaceChildren(body ? h('pre', { class: 'text' }, body) : empty('No extracted text for this document.'));
      });
    },
    { small: true },
  );
  const same = d.same_statement_as ? idx.documents.find((x) => x.id === d.same_statement_as) : undefined;
  return [
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h1', null, documentTitle(d)), chip(docTypeLabel(d.doc_type), 'muted')),
      h('p', { class: 'muted' }, [dateText(d.date), d.organization].filter(Boolean).join(' · ')),
      h('div', { class: 'row-actions' }, driveLink(ctx, d.path, 'Open in Drive')),
      kv([
        ['Amount due', formatMoney(d.statement?.amount_due)],
        ['Due', d.statement?.due_date ? dateText(d.statement.due_date) : undefined],
        ['Statement date', d.statement?.statement_date ? dateText(d.statement.statement_date) : undefined],
        ['Same statement as', same ? link({ name: 'item', person: idx.person, id: same.id }, documentTitle(same)) : undefined],
        ['Pages', d.pages !== undefined ? String(d.pages) : undefined],
      ]),
      d.text?.chars ? h('div', null, showText, textBox) : null,
    ),
    technical(
      card(
        { title: 'The file' },
        kv([
          ['Account', d.statement?.account],
          ['Size', bytes(d.size)],
          ['Type of file', d.media_type],
          ['Original name', d.original_name],
          ['Filed', dateTime(d.filed_at)],
          ['Came in', d.origin ? `${d.origin.kind}, ${d.origin.action}` : undefined],
          ['Text', d.text ? `${count(d.text.chars, 'character')}${d.text.ocr_pages ? `, ${count(d.text.ocr_pages, 'page')} read by OCR` : ''}` : undefined],
          ['Path', h('span', { class: 'mono small' }, d.path)],
        ]),
        d.near_duplicates?.length
          ? h(
              'div',
              { class: 'subcard' },
              h('h3', null, 'Likely duplicates'),
              d.near_duplicates.map((n) => {
                const o = idx.documents.find((x) => x.id === n.document);
                return h('p', null, link({ name: 'item', person: idx.person, id: n.document }, o ? documentTitle(o) : n.document), ` · ${Math.round(n.similarity * 100)}% similar text`);
              }),
            )
          : null,
      ),
      provenanceCard(ctx, idx, d.provenance, 0, 1),
      card({ title: 'Identifiers' }, kv([['Document', h('code', null, d.id)], ['SHA-256', h('code', { class: 'wrap' }, d.sha256)]])),
    ),
  ];
}

function studyView(ctx: Ctx, idx: PersonIndex, st: ImagingStudy): Child[] {
  const report = st.report ? findItem(idx, st.report) : undefined;
  return [
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h1', null, studyTitle(st)), chip(st.modalities.join('/') || 'Imaging', 'muted')),
      h('p', { class: 'muted' }, [dateText(st.date), st.facility].filter(Boolean).join(' · ')),
      h('p', { class: 'small' }, 'Open it in the DICOM viewer on the Mac:'),
      command(`medrec images open ${st.id}`, ctx),
      h('div', { class: 'row-actions' }, driveLink(ctx, st.path, 'The study’s folder in Drive')),
      kv([
        ['Body part', st.body_part],
        ['Referred by', st.referring],
        ['Images', `${count(st.instances, 'image')} in ${count(st.series.length, 'series', 'series')}`],
        ['Report', report ? link({ name: 'item', person: idx.person, id: st.report! }, report.type === 'document' ? documentTitle(report.document) : report.type === 'record' ? recordTitle(report.record) : 'Report') : undefined],
      ]),
    ),
    technical(
      card(
        { title: 'The study' },
        kv([
          ['Accession', st.accession],
          ['Size', bytes(st.size)],
          ['Filed', dateTime(st.filed_at)],
          ['Study UID', h('code', { class: 'wrap' }, st.study_uid)],
        ]),
      ),
      st.series.length
        ? card(
            { title: 'Series' },
            h(
              'table',
              { class: 'table' },
              h('thead', null, h('tr', null, h('th', null, 'Number'), h('th', null, 'Modality'), h('th', null, 'Description'), h('th', null, 'Images'))),
              h('tbody', null, st.series.map((se) => h('tr', null, h('td', null, se.number !== undefined ? String(se.number) : ''), h('td', null, se.modality ?? ''), h('td', null, se.description ?? ''), h('td', { class: 'num' }, String(Object.keys(se.instances ?? {}).length))))),
            ),
          )
        : null,
      ...st.provenance.map((p, i) => provenanceCard(ctx, idx, p, i, st.provenance.length)),
    ),
  ];
}

export function itemView(ctx: Ctx, personId: string, id: string): HTMLElement {
  const person = ctx.store.person(personId);
  const idx = ctx.store.index(personId);
  const back = person ? h('p', null, link({ name: 'person', person: personId, section: 'overview' }, icon('back', 16), ` ${person.name}`)) : null;
  if (!person || !idx) return card({}, empty('This person is not in the records folder.'));
  const item = findItem(idx, id);
  if (!item) return h('div', { class: 'stack' }, back, card({}, empty('This record is not in the index. It may have been merged or removed by medrec.')));
  const body = item.type === 'record' ? recordView(ctx, idx, item.record) : item.type === 'document' ? documentView(ctx, idx, item.document) : studyView(ctx, idx, item.study);
  return h('div', { class: 'stack' }, back, ...body);
}
