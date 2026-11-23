// What belongs to a visit, as the visits timeline and a visit's own page show it.

import { claimAmounts, toCents } from '../model/billing';
import { docTypeLabel, documentTitle, formatMoney, KIND_LABELS, str, studyTitle } from '../model/records';
import type { Visit } from '../model/visits';
import { claimTitle } from '../model/claims';
import { link } from './components';
import { h, icon, type Child } from './dom';
import { dateText } from './format';
import type { Route } from './router';

const itemRoute = (person: string, id: string): Route => ({ name: 'item', person, id });

/** Links on a line, the first few and then how many more. A dot between, since names hold commas ("Cholesterol, total"). */
function linkList(person: string, items: { id: string; title: string }[], max = 4): Child[] {
  const shown = items.slice(0, max).flatMap((x, i) => [i ? ' · ' : null, link(itemRoute(person, x.id), x.title)]);
  return items.length > max ? [...shown, ` and ${items.length - max} more`] : shown;
}

const RECORDED_LABEL: Record<string, [string, string]> = {
  condition: ['Diagnosis', 'Diagnoses'],
  result: ['Result', 'Results'],
  procedure: ['Procedure', 'Procedures'],
  medication: ['Medicine', 'Medicines'],
  immunization: ['Vaccine', 'Vaccines'],
  allergy: ['Allergy', 'Allergies'],
  report: ['Report', 'Reports'],
};

/** What belongs to a visit: its documents, then what was recorded, its claim and imaging. */
export function visitContents(person: string, v: Visit): HTMLElement[] {
  const line = (label: string, body: Child) => h('p', { class: 'small visit-line' }, h('span', { class: 'muted' }, `${label}: `), body);
  const out: HTMLElement[] = [];
  if (v.documents.length) {
    out.push(
      h(
        'ul',
        { class: 'visit-docs' },
        v.documents.map(({ doc }) => h('li', null, icon('file', 16), h('span', null, link(itemRoute(person, doc.id), documentTitle(doc)), h('span', { class: 'muted small' }, ` ${docTypeLabel(doc.doc_type)}`)))),
      ),
    );
  }
  for (const g of v.recorded) {
    const [one, many] = RECORDED_LABEL[g.kind] ?? [KIND_LABELS[g.kind] ?? g.kind, KIND_LABELS[g.kind] ?? g.kind];
    out.push(line(g.records.length === 1 ? one : many, linkList(person, g.records.map((r) => ({ id: r.id, title: r.display || r.code?.display || one })))));
  }
  for (const c of v.claims) {
    const share = claimAmounts(c).yourShare;
    const cents = toCents(share);
    const what = cents === 0 ? 'nothing for you to pay' : share ? `your share ${formatMoney(share)}` : claimTitle(c);
    out.push(line('Claim', [link(itemRoute(person, c.id), what), str(c.fields.insurer) ? ` from ${str(c.fields.insurer)}` : null]));
  }
  if (v.studies.length) out.push(line('Imaging', linkList(person, v.studies.map((x) => ({ id: x.id, title: studyTitle(x) })))));
  return out;
}

export function visitWhen(v: Visit): string {
  return v.end && v.start && v.end !== v.start ? `${dateText(v.start)} to ${dateText(v.end)}` : dateText(v.start);
}

