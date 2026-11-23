// Inspect: any record, document or study, with its provenance, the import
// that brought it in, its raw FHIR and its file in Drive.

import { readJson } from '../../folder';
import { asMoney, docTypeLabel, documentTitle, findItem, formatMoney, importFor, KIND_LABELS, studyTitle, valueText } from '../../model/records';
import { isObject } from '../../model/parse';
import type { ImagingStudy, Json, MedDocument, MedRecord, PersonIndex, Provenance } from '../../model/types';
import { button, card, chip, command, driveLink, empty, jsonBlock, kv, link, row, type Ctx } from '../components';
import { h, icon, type Child } from '../dom';
import { bytes, count, dateText, dateTime, localDay } from '../format';
import { visitOf } from '../../model/visits';
import { CATEGORY_LABELS, claimLines, recordTitle, type ClaimLine, type LineAmounts } from '../../model/claims';
import { visitContents, visitWhen } from '../visit';

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

const AMOUNT_TEXT: [keyof LineAmounts, string][] = [
  ['billed', 'Billed'],
  ['allowed', 'Allowed'],
  ['planPaid', 'Plan paid'],
  ['deductible', 'Deductible'],
  ['copay', 'Copay'],
  ['coinsurance', 'Coinsurance'],
  ['notCovered', 'Not covered'],
  ['youOwe', 'You owe'],
];

/** A claim's lines: what each paid for, its code, and the amounts. */
function linesCard(lines: ClaimLine[]): HTMLElement {
  return card(
    { title: lines.length === 1 ? 'Line' : `${lines.length} lines` },
    lines.map((l) =>
      row({
        title: l.label,
        meta: [l.code, CATEGORY_LABELS[l.category], l.date ? dateText(l.date) : null].filter(Boolean).join(' · '),
        extra: h('p', { class: 'small claim-amounts' }, AMOUNT_TEXT.filter(([k]) => l.amounts[k]).map(([k, label]) => `${label} ${formatMoney(l.amounts[k])}`).join(' · ')),
      }),
    ),
  );
}

function recordView(ctx: Ctx, idx: PersonIndex, r: MedRecord): Child[] {
  const lines = r.kind === 'claim' ? claimLines(r) : [];
  // A claim's lines have their own card.
  const fields = Object.entries(r.fields).filter(([k]) => k !== 'when' && !(lines.length && k === 'items'));
  const visit = r.kind === 'encounter' ? visitOf(idx, ctx.store.household, idx.person, localDay(ctx.now()), r.id) : undefined;
  const inVisit = visit ? visitContents(idx.person, visit) : [];
  // A visit lists its documents with the rest of what belongs to it; any other record, its linked ones.
  const docs = visit ? [] : r.documents.map((id) => idx.documents.find((d) => d.id === id)).filter((d): d is MedDocument => !!d);
  return [
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h1', null, recordTitle(r, KIND_LABELS[r.kind] || r.kind)), r.status ? chip(r.status, 'muted') : null),
      h('p', { class: 'muted' }, [KIND_LABELS[r.kind] ?? r.kind, dateText(r.date)].join(' · ')),
      kv([
        ['Code', r.code ? [r.code.display, r.code.code].filter(Boolean).join(' · ') : undefined],
        ['Code system', r.code?.system],
        ...fields.map(([k, v]): [string, Child] => [fieldLabel(k), fieldValue(v)]),
      ]),
    ),
    visit
      ? card(
          { title: 'At this visit' },
          inVisit.length ? inVisit : empty('Nothing else in these records is from this visit.'),
          h('p', { class: 'small muted' }, `Documents medrec linked to the visit, and records and documents from ${visitWhen(visit)} at the same place.`),
        )
      : null,
    lines.length ? linesCard(lines) : null,
    docs.length ? card({ title: 'Documents' }, docs.map((d) => h('p', null, link({ name: 'item', person: idx.person, id: d.id }, documentTitle(d))))) : null,
    ...r.provenance.map((p, i) => provenanceCard(ctx, idx, p, i, r.provenance.length)),
    card({ title: 'Identifiers' }, kv([['Record', h('code', null, r.id)], ['Merge key', h('code', null, r.key)]])),
  ];
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
        ['Statement date', d.statement?.statement_date ? dateText(d.statement.statement_date) : undefined],
        ['Amount due', formatMoney(d.statement?.amount_due)],
        ['Due', d.statement?.due_date ? dateText(d.statement.due_date) : undefined],
        ['Account', d.statement?.account],
        ['Same statement as', same ? link({ name: 'item', person: idx.person, id: same.id }, documentTitle(same)) : undefined],
        ['Pages', d.pages !== undefined ? String(d.pages) : undefined],
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
      d.text?.chars ? h('div', null, showText, textBox) : null,
    ),
    provenanceCard(ctx, idx, d.provenance, 0, 1),
    card({ title: 'Identifiers' }, kv([['Document', h('code', null, d.id)], ['SHA-256', h('code', { class: 'wrap' }, d.sha256)]])),
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
        ['Accession', st.accession],
        ['Referring', st.referring],
        ['Images', `${count(st.instances, 'image')} in ${count(st.series.length, 'series', 'series')}`],
        ['Size', bytes(st.size)],
        ['Report', report ? link({ name: 'item', person: idx.person, id: st.report! }, report.type === 'document' ? documentTitle(report.document) : report.type === 'record' ? report.record.display : 'Report') : undefined],
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
