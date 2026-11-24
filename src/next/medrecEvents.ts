// medrec's events (src/model/events.ts) as the app's. medrec decides what
// belongs together and how sure it is; the app keeps naming and pricing an
// event from its records (event.ts), so a screen reads the same either way.

import { claimCategory } from '../model/claims';
import type { MedrecEvent, MedrecEvents } from '../model/events';
import type { Household, MedDocument, MedRecord, PersonIndex } from '../model/types';
import { nameEvent, type CareEvent, type ClaimRole, type EventKind } from './event';
import { tidyName } from '../model/words';

const KINDS: Record<string, EventKind> = {
  er: 'er',
  er_no_facility: 'er',
  inpatient: 'stay',
  stay_no_facility: 'stay',
  outpatient: 'outpatient',
  office: 'office',
  service: 'service',
  tests: 'tests',
  dental: 'dental',
  vaccine: 'vaccine',
  fill: 'fill',
  series: 'series',
};

const ROLES: Record<string, ClaimRole> = { facility: 'facility', hospital: 'hospital', ancillary: 'ancillary', office: 'office', dental: 'dental', service: 'service', fill: 'pharmacy' };

/**
 * The app's kind for medrec's. A portal visit with no claim takes the
 * visit's class: a stay, an emergency room visit, else an office visit. A
 * kind the app does not know is a service, shown by medrec's title.
 */
function kindOf(m: MedrecEvent, visit: MedRecord | undefined): { kind: EventKind; title?: string } {
  const known = KINDS[m.kind];
  if (known) return { kind: known };
  if (m.kind !== 'portal') return { kind: 'service', ...(m.title ? { title: m.title } : {}) };
  const cls = String(visit?.fields.class ?? '').toLowerCase();
  return { kind: /inpatient|^imp$|acute/.test(cls) ? 'stay' : /emergency|^emer$/.test(cls) ? 'er' : 'office' };
}

/**
 * medrec's events as the app's, newest first as medrec orders them. A
 * member whose record or paper is not in the index (events written before
 * an index the store has not checked them against) is left out; another
 * person's paper (X2) comes from the papers the store found for it.
 */
export function fromMedrec(file: MedrecEvents, index: PersonIndex, household: Household): CareEvent[] {
  const records = new Map<string, MedRecord>(index.records.map((r) => [r.id, r]));
  const docs = new Map<string, MedDocument>(index.documents.map((d) => [d.id, d]));
  return file.events.flatMap((m): CareEvent[] => {
    const e: CareEvent = { id: m.id, kind: 'service', start: m.start, end: m.end, title: '', claims: [], visits: [], recorded: [], papers: [] };
    for (const x of m.members) {
      if (x.document) {
        const other = x.person ? file.papers.get(x.document) : undefined;
        const doc = x.person ? other?.doc : docs.get(x.document);
        if (doc) e.papers.push({ doc, rule: x.rule, confidence: x.confidence, ...(other ? { person: other.person } : {}) });
        continue;
      }
      const record = records.get(x.record!);
      if (!record) continue;
      if (record.kind === 'claim') e.claims.push({ record, role: ROLES[x.role] ?? 'service', ...(x.provider ? { provider: tidyName(x.provider) } : {}), rule: x.rule, confidence: x.confidence });
      else if (x.role === 'portal' || x.role === 'contact') e.visits.push({ record, rule: x.rule, confidence: x.confidence });
      else e.recorded.push(record);
    }
    if (!e.claims.length && !e.visits.length && !e.recorded.length && !e.papers.length) return [];
    // Papers newest first, as the app lists them.
    e.papers.sort((a, b) => (b.doc.date ?? '').localeCompare(a.doc.date ?? ''));
    const { kind, title } = kindOf(m, e.visits[0]?.record);
    // A day of vaccine claims only is a vaccine visit, as the app's own grouping makes it.
    e.kind = kind === 'service' && !title && e.claims.length && e.claims.every((c) => claimCategory(c.record) === 'vaccine') ? 'vaccine' : kind;
    if (m.kind === 'stay_no_facility' || m.kind === 'er_no_facility') e.noFacility = true;
    if (m.place) e.place = m.place;
    if (m.what) e.what = m.what;
    if (m.expected.length) e.expected = m.expected;
    if (m.confidence === 'unsure') e.doubt = m.could_join.length > 1 ? `It could be part of any of ${m.could_join.length} other visits` : m.could_join.length ? 'It could be part of another visit' : 'medrec is not sure what it belongs with';
    nameEvent(e, household, index.person, title);
    return [e];
  });
}
