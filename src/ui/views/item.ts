// A record, document or study, plain first: what it is, what it says and
// what came with it. Its codes, every field, where it came from, the import
// that brought it in, its raw FHIR and its file in Drive sit folded under
// Technical details, whole, for the data-minded.

import { readJson } from '../../folder';
import { billList } from '../../model/billing';
import { CATEGORY_LABELS, claimAmounts, type ClaimLine, claimLines, claimNotes, claimProvider, revenueText } from '../../model/claims';
import { conditionName, diagnosisNames, nameList, secondTitle } from '../../model/codeNames';
import { isOutOfRange, rangeFor, resultFlag } from '../../model/flags';
import { labTest } from '../../model/labtests';
import { learnMore } from '../../model/learn';
import { conditionList, CRITICALITY_TEXT, medicineList, statusText } from '../../model/lists';
import { isObject } from '../../model/parse';
import { AMOUNT_LABELS, asMoney, docTypeLabel, documentTitle, findItem, formatMoney, importFor, isDoseGiven, KIND_LABELS, LINE_AMOUNT_ORDER, originNames, resultPoint, resultReading, str, studyTitle, toCents, valueText } from '../../model/records';
import { resultContext, unitText, verdict } from '../../model/result';
import { recordTitle, visitTitle } from '../../model/titles';
import type { ImagingStudy, Json, MedDocument, MedRecord, PersonIndex, Provenance } from '../../model/types';
import { claimContext, visitKind, visitOf } from '../../model/visits';
import { tidyName } from '../../model/words';
import { partOfEvent } from '../../next/eventView';
import { markedPayments, paidControl, viewOnlyNote } from '../../next/markPaid';
import { paymentText, unreadText } from '../../next/money';
import { providerLink } from '../../next/providerView';
import { rangeBar, resultChart } from '../chart';
import { button, card, chip, command, dotted, driveLink, empty, flagChip, jsonBlock, kv, link, outLink, phoneLink, row, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, dateTime, localDay } from '../format';
import type { Route } from '../router';
import { visitContents, visitWhen } from '../visit';
import { called } from '../../model/people';

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

/** Links to records, "LDL cholesterol, Glucose and HDL cholesterol". */
function recordLinks(person: string, rs: MedRecord[]): Child[] {
  return rs.flatMap((x, i) => [i === 0 ? null : i === rs.length - 1 ? ' and ' : ', ', link(itemRoute(person, x.id), recordTitle(x))]);
}

/** A claim's lines: what each paid for, its code, the amounts, and the records medrec linked to it. */
function linesCard(person: string, lines: readonly Readonly<ClaimLine>[], lineRecords: MedRecord[][]): HTMLElement {
  // medrec links every lab line to all of its day's results, so lines that
  // all link the same records say nothing the Paid for card does not. A line
  // the totals leave out paid for nothing.
  const linked = lineRecords.filter((rs, i) => rs.length && lines[i]?.counted).map((rs) => rs.map((r) => r.id).join(' '));
  const telling = linked.length < 2 || new Set(linked).size > 1;
  return card(
    { title: lines.length === 1 ? 'Line' : `${lines.length} lines` },
    lines.map((l, i) => {
      const amounts = LINE_AMOUNT_ORDER.filter((k) => l.amounts[k]).map((k) => `${AMOUNT_LABELS[k]} ${formatMoney(l.amounts[k])}`);
      const paidFor = telling ? (lineRecords[i] ?? []) : [];
      // A revenue code beside the service code says which part of the hospital it was billed under.
      const revenue = l.revenue && l.revenue.code !== l.code ? revenueText(l.revenue) : null;
      const lineMeta = [l.code, CATEGORY_LABELS[l.category].one, revenue, l.date ? dateText(l.date) : null].filter(Boolean).join(' · ');
      const notes = l.payerNotes.length ? h('p', { class: 'small muted claim-notes' }, `The plan’s ${l.payerNotes.length === 1 ? 'note' : 'notes'}: ${l.payerNotes.join(' · ')}`) : null;
      // A line the plan replaced or wrote off: what was billed, never what it marked not covered, as none of it is owed.
      if (!l.counted) {
        return row({
          title: l.label,
          meta: lineMeta,
          aside: chip('Left out'),
          extra: [h('p', { class: 'small claim-amounts' }, `Left out by the plan, not owed: the claim’s totals do not count this line.${l.amounts.billed ? ` Billed ${formatMoney(l.amounts.billed)}.` : ''}`), notes],
        });
      }
      return row({
        title: l.label,
        meta: lineMeta,
        extra: [
          h('p', { class: ['small', 'claim-amounts', amounts.length ? null : 'muted'] }, amounts.length ? amounts.join(' · ') : 'The claim gives no amounts for this line.'),
          notes,
          paidFor.length ? h('p', { class: 'small claim-paid-for' }, 'Paid for: ', ...recordLinks(person, paidFor)) : null,
        ],
      });
    }),
  );
}

/** Everything for the data-minded, folded away: codes, every field, where it came from, identifiers and the raw FHIR. */
function technical(...cards: Child[]): HTMLElement {
  return h('details', { class: 'tech' }, h('summary', null, 'Technical details'), h('div', { class: 'stack' }, ...cards));
}

/** The record as medrec keeps it: its code, status and every field. */
function fieldsCard(r: MedRecord, skip: string[], extra: [string, Child][]): HTMLElement {
  const fields = Object.entries(r.fields).filter(([k]) => k !== 'when' && !skip.includes(k));
  return card(
    { title: 'The record' },
    kv([
      ['Kind', KIND_LABELS[r.kind] ?? r.kind],
      ['Name at the source', r.display],
      ['Code', r.code ? [r.code.display, r.code.code].filter(Boolean).join(' · ') : undefined],
      ['Code system', r.code?.system],
      ...extra,
      ['Status', r.status],
      ['Date', r.date],
      ...fields.map(([k, v]): [string, Child] => [fieldLabel(k), fieldValue(v)]),
    ]),
  );
}

/** A record whole, folded: without the fields to skip, and with what its page adds after its code. */
function recordTechnical(ctx: Ctx, idx: PersonIndex, r: MedRecord, skip: string[] = [], extra: [string, Child][] = []): HTMLElement {
  return technical(
    fieldsCard(r, skip, extra),
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
function head(title: string, chipEl: Child, metaParts: Child[], ...rest: Child[]): HTMLElement {
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h1', null, title), chipEl), h('p', { class: 'muted' }, dotted(metaParts)), ...rest);
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
  const point = c.point ?? resultPoint(r);
  const v = verdict(point);
  const name = recordTitle(r);
  const test = labTest(r.code);
  const value = resultReading(r.fields).text;
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
      h('p', { class: ['verdict', v.flag?.level === 'normal' ? 'verdict-in' : null, v.outOfRange ? ['verdict-out', `verdict-${v.flag!.level}`] : null].flat() }, v.text),
      point.value !== undefined && v.range ? rangeBar(point.value, v.range, v.flag?.level, `${shown}. ${v.text}`) : null,
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
              const xp = resultPoint(x);
              const f = resultFlag(xp);
              const xv = resultReading(x.fields).text;
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
  // The record of the medicine that prints the name.
  const named = (field: 'prescriber' | 'pharmacy', text: string | undefined) => providerLink(ctx, idx, (m?.records ?? []).find((x) => tidyName(str(x.fields[field])) === tidyName(text))?.id ?? r.id, [field], text);
  const state = m ? (m.active ? 'Taking now' : 'Past medicine') : (statusText(r.status) ?? undefined);
  return [
    head(
      name,
      null,
      ['Medicine', state, m?.first ? `since ${dateText(m.first)}` : dateText(r.date), fromText(ctx, idx, r)],
      str(r.fields.dosage) ? h('p', { class: 'result-value result-value-text' }, str(r.fields.dosage)) : null,
      kv([
        ['Prescribed by', named('prescriber', m?.prescriber ?? str(r.fields.prescriber))],
        ['Last filled', m?.lastFill ? [dateText(m.lastFill.date), m.lastFill.pharmacy ? [' at ', named('pharmacy', m.lastFill.pharmacy)] : null, m.lastFill.daysSupply ? ` for ${m.lastFill.daysSupply} days` : null] : undefined],
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
  const named = conditionName(idx, r);
  const status = statusText(r.status);
  return [
    head(
      named.name,
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
    recordTechnical(ctx, idx, r, [], [['The code’s published title', secondTitle(named)]]),
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
        ['Where', providerLink(ctx, idx, r.id, ['performer'], str(r.fields.performer))],
        ['Site', str(r.fields.site)],
        ['How', route !== undefined ? fieldValue(route) : undefined],
        ['Lot', str(r.fields.lot_number)],
      ]),
      learnLink(r, name),
    ),
    recordTechnical(ctx, idx, r),
  ];
}

function encounterView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const visit = visitOf(idx, ctx.store.household, idx.person, localDay(ctx.now()), r.id);
  const inVisit = visit ? visitContents(idx, visit) : [];
  const kind = visit ? visitKind(visit) : undefined;
  return [
    head(
      recordTitle(r),
      null,
      [kind ?? 'Visit', visit ? visitWhen(visit) : dateText(r.date), fromText(ctx, idx, r)],
      kv([
        ['Reason', str(r.fields.reason)],
        ['With', providerLink(ctx, idx, r.id, ['practitioner'], str(r.fields.practitioner))],
        ['Where', providerLink(ctx, idx, r.id, ['location', 'service_provider'], str(r.fields.location) ?? str(r.fields.service_provider))],
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
  const c = claimContext(idx, ctx.store.household, idx.person, localDay(ctx.now()), r);
  const diagnoses = diagnosisNames(idx, r);
  const titles = diagnoses.flatMap((d) => secondTitle(d) ?? []);
  const words = diagnoses.flatMap((d) => d.source ?? []);
  const docs = r.documents.map((id) => idx.documents.find((d) => d.id === id)).filter((d): d is MedDocument => !!d);
  const start = isObject(r.fields.billable_period) ? str(r.fields.billable_period.start) : undefined;
  return [
    head(
      recordTitle(r),
      null,
      ['Claim', dateText(start ?? r.date), providerLink(ctx, idx, r.id, ['provider'], claimProvider(r)), str(r.fields.insurer) ? `by ${str(r.fields.insurer)}` : null],
      // The payer's figure is what you owe; the parts added up are your share.
      a.yourShare ? h('p', { class: 'result-value' }, toCents(a.yourShare) === 0 ? 'Nothing for you to pay' : `${a.shareAdded ? 'Your share' : 'You owe'} ${formatMoney(a.yourShare)}`) : null,
      kv([
        ['Billed', formatMoney(a.billed)],
        ['Discount', toCents(a.discount) ? formatMoney(a.discount) : undefined],
        ['Plan allowed', formatMoney(a.allowed)],
        ['Plan paid', formatMoney(a.planPaid)],
        ['Your share comes from', a.parts.length ? sentence(a.parts.map((p) => `${p.label.toLowerCase()} ${formatMoney(p.amount)}`).join(', ')) : undefined],
        [diagnoses.length > 1 ? 'Diagnoses' : 'Diagnosis', diagnoses.length ? nameList(diagnoses.map((d) => d.name)) : undefined],
        ['Outcome', str(r.fields.outcome) && r.fields.outcome !== 'complete' ? str(r.fields.outcome) : undefined],
        ['The plan’s notes', claimNotes(r).join(' · ') || undefined],
      ]),
    ),
    c.visit || c.results.length
      ? card(
          { title: 'Paid for' },
          c.visit ? row({ route: itemRoute(idx.person, c.visit.record.id), title: visitTitle(c.visit.record), meta: ['Visit', visitWhen(c.visit), str(c.visit.record.fields.location)].filter(Boolean).join(' · ') }) : null,
          c.results.map((x) => {
            const reading = x.kind === 'result' ? resultReading(x.fields).text : undefined;
            return row({ route: itemRoute(idx.person, x.id), title: recordTitle(x), meta: [KIND_LABELS[x.kind] ?? x.kind, dateText(x.date), reading ? (unitText(reading) ?? reading) : null].filter(Boolean).join(' · '), aside: x.kind === 'result' ? flagChip(resultFlag(resultPoint(x))) : null });
          }),
        )
      : null,
    lines.length ? linesCard(idx.person, lines, c.lineRecords) : null,
    docs.length ? card({ title: 'Documents' }, docs.map((d) => row({ route: itemRoute(idx.person, d.id), title: documentTitle(d), meta: [docTypeLabel(d.doc_type), dateText(d.date)].filter(Boolean).join(' · ') }))) : null,
    recordTechnical(ctx, idx, r, lines.length ? ['items'] : [], [
      [titles.length > 1 ? 'Diagnoses, by published title' : 'Diagnosis, by published title', titles.length ? nameList(titles) : undefined],
      [words.length > 1 ? 'Diagnoses, in the claim’s words' : 'Diagnosis, in the claim’s words', words.length ? nameList(words) : undefined],
    ]),
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
        ['Where', providerLink(ctx, idx, r.id, ['location'], str(r.fields.location))],
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
  const bill = d.doc_type === 'bill' ? billList(idx).find((b) => b.doc.id === (same ?? d).id) : undefined;
  const later = bill?.medrec && bill.replacedBy ? idx.documents.find((x) => x.id === bill.replacedBy) : undefined;
  return [
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h1', null, documentTitle(d)), chip(docTypeLabel(d.doc_type), 'muted')),
      h('p', { class: 'muted' }, dotted([dateText(d.date), providerLink(ctx, idx, d.id, ['organization'], d.organization)])),
      h('div', { class: 'row-actions' }, driveLink(ctx, d.path, 'Open in Drive')),
      kv([
        ['Amount due', formatMoney(d.statement?.amount_due)],
        ['Due', d.statement?.due_date ? dateText(d.statement.due_date) : undefined],
        ['Call', d.statement?.phone ? phoneLink(d.statement.phone) : undefined],
        ['Statement date', d.statement?.statement_date ? dateText(d.statement.statement_date) : undefined],
        ['Paid', d.doc_type === 'receipt' ? (formatMoney(d.statement?.amount_paid) ?? 'The amount could not be read') : bill?.payments.length ? bill.payments.map((p) => paymentText(p, true)).join(', ') : bill ? unreadText(bill.unread) : undefined],
        ['Paid on', d.doc_type === 'receipt' && d.statement?.paid_on ? dateText(d.statement.paid_on) : undefined],
        ['Left to pay', bill && (bill.settled || bill.payments.length) ? (bill.settled ? 'Nothing' : formatMoney(bill.left)) : undefined],
        ['Later statement', later ? ['Its balance includes this one: ', link({ name: 'item', person: idx.person, id: later.id }, documentTitle(later))] : undefined],
        ['Same statement as', same ? link({ name: 'item', person: idx.person, id: same.id }, documentTitle(same)) : undefined],
        ['Pages', d.pages !== undefined ? String(d.pages) : undefined],
      ]),
      bill ? [markedPayments(ctx, idx, bill), paidControl(ctx, idx, bill), viewOnlyNote(ctx, idx, bill)] : null,
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
      h('p', { class: 'muted' }, dotted([dateText(st.date), providerLink(ctx, idx, st.id, ['facility'], st.facility)])),
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
  const back = person ? h('p', null, link({ name: 'health', who: personId }, icon('back', 16), ` ${called(person)}`)) : null;
  if (!person || !idx) return card({}, empty('This person is not in the records folder.'));
  const item = findItem(idx, id);
  if (!item) return h('div', { class: 'stack' }, back, card({}, empty('This record is not in the index. It may have been merged or removed by medrec.')));
  const body = item.type === 'record' ? recordView(ctx, idx, item.record) : item.type === 'document' ? documentView(ctx, idx, item.document) : studyView(ctx, idx, item.study);
  return h('div', { class: 'stack' }, back, partOfEvent(ctx, personId, idx, id), ...body);
}
