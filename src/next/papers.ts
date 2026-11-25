// Papers: every file medrec filed in the Drive folder, each with the visit
// it belongs to, or why it belongs to none. A paper is with a visit when the
// visit holds it, when a record of the visit links it (an explanation of
// benefits names its claim), or when it is the receipt for a bill the visit
// holds. One that fits several visits, which medrec merges into none, says
// which.

import { billList } from '../model/billing';
import { HELD, inVisit, paperPrivate, takenOut } from '../model/private';
import type { Household, MedDocument, PersonIndex } from '../model/types';
import { dateText } from '../ui/format';
import { eventPrivate, type CareEvent, type Confidence } from './event';
import { personEvents } from './load';

/** How a paper is with its visit: the visit holds it, a record of the visit links it, or it is the receipt for the visit's bill. */
export type PaperHow = 'event' | 'claim' | 'record' | 'bill';

export interface Paper {
  doc: MedDocument;
  /** Whose folder holds it. */
  person: string;
  /** Its visit, and whose visit that is: another person's for a paper filed under a parent before a birth (medrec's X2); `private` says why a shared screen does not name it. */
  with?: { event: CareEvent; person: string; how: PaperHow; confidence: Confidence; private?: string };
  /** Why it is with no visit. */
  why?: string;
  /** The visits a paper with none could be part of. */
  could?: CareEvent[];
  /**
   * Why it stays off shared screens: the private area of it, a record that
   * names it, its visit or a visit it could be part of, or HELD. medrec judged
   * a paper its events hold with that visit, so one it left out, the household
   * took out, and only its visit stays private.
   */
  private?: string;
}

/** Why a paper of a kind that is about no one visit is with none. */
const ACROSS: Record<string, string> = {
  eob: 'An explanation of benefits covers claims, and none of this person’s visits has its claim.',
  insurance_card: 'An insurance card is about no one visit.',
  immunization_record: 'A vaccine record covers many visits.',
};

const newestFirst = (a: Paper, b: Paper) => (b.doc.date ?? '').localeCompare(a.doc.date ?? '') || a.doc.id.localeCompare(b.doc.id);

/**
 * A person's papers, newest first, with where each belongs. `indexes` holds
 * everyone's, for the papers another person's visits hold (X2).
 */
export function papersOf(index: PersonIndex, household: Household, today: string, indexes: Map<string, PersonIndex>): Paper[] {
  const person = index.person;
  const events = personEvents(index, household, today);
  const byDoc = new Map<string, { event: CareEvent; person: string; confidence: Confidence }>();
  for (const e of events) for (const p of e.papers) if (!p.person && !byDoc.has(p.doc.id)) byDoc.set(p.doc.id, { event: e, person, confidence: p.confidence });
  // A paper of this person's in another person's visit.
  for (const [other, idx] of indexes) {
    if (other === person) continue;
    for (const e of personEvents(idx, household, today)) for (const p of e.papers) if (p.person === person && !byDoc.has(p.doc.id)) byDoc.set(p.doc.id, { event: e, person: other, confidence: p.confidence });
  }
  const byRecord = new Map<string, CareEvent>();
  for (const e of events) for (const r of [...e.claims.map((c) => c.record), ...e.visits.map((v) => v.record), ...e.recorded]) if (!byRecord.has(r.id)) byRecord.set(r.id, e);
  const linking = new Map<string, { event: CareEvent; claim: boolean }>();
  for (const r of index.records) {
    const e = byRecord.get(r.id);
    if (e) for (const d of r.documents) if (!linking.has(d)) linking.set(d, { event: e, claim: r.kind === 'claim' });
  }
  const paidBill = new Map<string, string>();
  for (const b of billList(index)) for (const p of b.payments) if (p.receipt && !paidBill.has(p.receipt.id)) paidBill.set(p.receipt.id, b.doc.id);
  const byId = new Map(events.map((e) => [e.id, e]));
  const pending = new Map((index.events?.pending ?? []).map((p) => [p.document, p.could_join.flatMap((id) => byId.get(id) ?? [])]));

  return index.documents
    .map((doc): Paper => {
      const own = paperPrivate(index, doc.id);
      const areaOf = (e: CareEvent, of: string) => {
        const idx = of === person ? index : indexes.get(of);
        return idx ? eventPrivate(e, idx) : HELD;
      };
      const place = (event: CareEvent, of: string, how: PaperHow, confidence: Confidence): Paper => {
        const visits = areaOf(event, of);
        // Another person's visit (X2) does not decide: the paper is judged as its own person's. Nor does
        // a visit it was judged with, through medrec's events or the record that links it.
        const judged = of !== person || takenOut(index, doc.id) || (index.events !== undefined && (how === 'event' ? inVisit(index, doc.id) : how !== 'bill'));
        const area = own ?? (judged ? undefined : visits);
        return { doc, person, with: { event, person: of, how, confidence, ...(visits ? { private: visits } : {}) }, ...(area ? { private: area } : {}) };
      };
      const held = byDoc.get(doc.id);
      if (held) return place(held.event, held.person, 'event', held.confidence);
      const linked = linking.get(doc.id);
      if (linked) return place(linked.event, person, linked.claim ? 'claim' : 'record', 'sure');
      const bill = paidBill.get(doc.id);
      const billed = bill ? byDoc.get(bill) : undefined;
      if (billed) return place(billed.event, billed.person, 'bill', 'likely');
      // A paper that could be part of a private visit is private too: its line names that visit.
      const loose = (why: string, could?: CareEvent[]): Paper => {
        const area = own ?? (could ?? []).map((e) => areaOf(e, person)).find(Boolean);
        return { doc, person, why, ...(could?.length ? { could } : {}), ...(area ? { private: area } : {}) };
      };
      const could = pending.get(doc.id);
      if (could?.length) return loose(`It fits ${could.length} visits, so medrec puts it with none of them.`, could);
      const across = ACROSS[doc.doc_type ?? ''];
      if (across) return loose(across);
      if (!doc.date) return loose('It has no date to match a visit by.');
      return loose(`No visit in these records is on or near ${dateText(doc.date)}.`);
    })
    .sort(newestFirst);
}

/** Everyone's papers, newest first. */
export function householdPapers(household: Household, indexes: Map<string, PersonIndex>, today: string): Paper[] {
  return household.people.flatMap((p) => {
    const idx = indexes.get(p.id);
    return idx ? papersOf(idx, household, today, indexes) : [];
  }).sort(newestFirst);
}
