// An index without some of its items, and without the links to them: what is
// about somebody else (aboutAnother.ts) leaves no id behind, whichever list
// or page the link is on.

import { isObject } from './parse';
import type { ImagingStudy, Json, MedDocument, MedRecord, PersonIndex, Provenance } from './types';

const source = (p: Provenance, gone: ReadonlySet<string>): Provenance => {
  const { derived_from: from, ...rest } = p;
  return from && gone.has(from.document_id) ? rest : p;
};

function record(r: MedRecord, gone: ReadonlySet<string>): MedRecord {
  const kept = (ids: Json): Json => (Array.isArray(ids) ? ids.filter((id) => typeof id !== 'string' || !gone.has(id)) : ids);
  const line = (l: Json): Json => (isObject(l) && l.records !== undefined ? { ...l, records: kept(l.records) } : l);
  // The fields stay in the source's order, which their list on a page has.
  const fields = Object.entries(r.fields).flatMap(([k, v]): [string, Json][] => {
    if (k === 'visit' && typeof v === 'string' && gone.has(v)) return [];
    return [[k, k === 'results' ? kept(v) : k === 'items' && Array.isArray(v) ? v.map(line) : v]];
  });
  return { ...r, documents: r.documents.filter((d) => !gone.has(d)), fields: Object.fromEntries(fields), provenance: r.provenance.map((p) => source(p, gone)) };
}

/** The papers but these. A statement whose first paper is gone is its next copy's. */
function papers(documents: MedDocument[], gone: ReadonlySet<string>): MedDocument[] {
  const next = new Map<string, string>();
  return documents
    .filter((d) => !gone.has(d.id))
    .map((d) => {
      const { same_statement_as: of, near_duplicates: near, ...rest } = d;
      const first = of && gone.has(of) ? next.get(of) : of;
      if (of && gone.has(of) && !first) next.set(of, d.id);
      return { ...rest, ...(first ? { same_statement_as: first } : {}), ...(near ? { near_duplicates: near.filter((n) => !gone.has(n.document)) } : {}), provenance: source(d.provenance, gone) };
    });
}

function study(s: ImagingStudy, gone: ReadonlySet<string>): ImagingStudy {
  const { report, ...rest } = s;
  return { ...rest, ...(report && !gone.has(report) ? { report } : {}), provenance: s.provenance.map((p) => source(p, gone)) };
}

export function withoutItems(index: PersonIndex, gone: ReadonlySet<string>): PersonIndex {
  return {
    ...index,
    records: index.records.filter((r) => !gone.has(r.id)).map((r) => record(r, gone)),
    documents: papers(index.documents, gone),
    studies: index.studies.map((s) => study(s, gone)),
  };
}
