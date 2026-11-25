// Papers: every file medrec filed in the Drive folder, each with the visit
// it belongs to, or why it belongs to none. A paper is with a visit when the
// visit holds it, when a record of the visit links it (an explanation of
// benefits names its claim), or when it is the receipt for a bill the visit
// holds. One that fits several visits, which medrec merges into none, says
// which.

import { billList } from '../model/billing';
import { inVisit, paperPrivate, recordPrivate, takenOut } from '../model/private';
import type { Household, MedDocument, PersonIndex } from '../model/types';
import { dateText } from '../ui/format';
import { eventPrivate, sharedForm, type CareEvent, type Confidence } from './event';
import { personEvents } from './load';
import { papersHeldFor } from './medrecEvents';

/** How a paper is with its visit: the visit holds it, a record of the visit links it, or it is the receipt for the visit's bill. */
export type PaperHow = 'event' | 'claim' | 'record' | 'bill';

export interface Paper {
  doc: MedDocument;
  /** Whose folder holds it. */
  person: string;
  /** Its visit, and whose visit that is: a parent's for a paper dated before its person's birth (medrec's X2); `private` says why a shared screen does not name it. */
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
  insurance_card: 'An insurance card is about no one visit.',
  immunization_record: 'A vaccine record covers many visits.',
};

const newestFirst = (a: Paper, b: Paper) => (b.doc.date ?? '').localeCompare(a.doc.date ?? '') || a.doc.id.localeCompare(b.doc.id);

/**
 * A person's papers, newest first, with where each belongs. `indexes` holds
 * everyone's, for the papers another person's visits hold (X2); one of theirs
 * is named only as a shared screen names it, and not when it is private.
 * `shared` places them as if no private visit, record or bill were there,
 * whether or not any is.
 */
export function papersOf(index: PersonIndex, household: Household, today: string, indexes: Map<string, PersonIndex>, shared = false): Paper[] {
  const person = index.person;
  const eventsOf = (idx: PersonIndex, own: boolean) => personEvents(idx, household, today).flatMap((e) => (own ? [e] : eventPrivate(e, idx) ? [] : [sharedForm(e)]));
  const events = eventsOf(index, !shared);
  const byDoc = new Map<string, { event: CareEvent; person: string; confidence: Confidence }>();
  for (const e of events) for (const p of e.papers) if (!p.person && !byDoc.has(p.doc.id)) byDoc.set(p.doc.id, { event: e, person, confidence: p.confidence });
  // A paper of this person's in another person's visit.
  for (const [other, idx] of indexes) {
    if (other === person) continue;
    const visits = new Map(eventsOf(idx, false).map((e) => [e.id, e]));
    for (const x of idx.events ? papersHeldFor(idx.events, person) : []) {
      const event = visits.get(x.event);
      if (event && !byDoc.has(x.document)) byDoc.set(x.document, { event, person: other, confidence: x.confidence });
    }
  }
  const byRecord = new Map<string, CareEvent>();
  for (const e of events) for (const r of [...e.claims.map((c) => c.record), ...e.visits.map((v) => v.record), ...e.recorded]) if (!byRecord.has(r.id)) byRecord.set(r.id, e);
  const linking = new Map<string, { event: CareEvent; claim: boolean }>();
  for (const r of index.records) {
    const e = shared && recordPrivate(index, r.id) ? undefined : byRecord.get(r.id);
    if (e) for (const d of r.documents) if (!linking.has(d)) linking.set(d, { event: e, claim: r.kind === 'claim' });
  }
  // The bills a receipt pays, or can be for when its amount did not read.
  const billsOf = new Map<string, string[]>();
  for (const b of billList(index).filter((x) => !shared || !paperPrivate(index, x.doc.id))) for (const r of [...b.payments.flatMap((p) => p.receipt ?? []), ...b.unread]) billsOf.set(r.id, [...(billsOf.get(r.id) ?? []), b.doc.id]);
  const byId = new Map(events.map((e) => [e.id, e]));
  const pending = new Map((index.events?.pending ?? []).map((p) => [p.document, p.could_join.flatMap((id) => byId.get(id) ?? [])]));

  return index.documents
    .map((doc): Paper => {
      const own = paperPrivate(index, doc.id);
      const place = (event: CareEvent, of: string, how: PaperHow, confidence: Confidence): Paper => {
        const visits = of === person ? eventPrivate(event, index) : undefined;
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
      const bills = billsOf.get(doc.id) ?? [];
      const billed = bills.length === 1 ? byDoc.get(bills[0]!) : undefined;
      if (billed) return place(billed.event, billed.person, 'bill', 'likely');
      // A paper that could be part of a private visit is private too: its line names that visit.
      const loose = (why: string, could?: CareEvent[]): Paper => {
        const area = own ?? (could ?? []).map((e) => eventPrivate(e, index)).find(Boolean);
        return { doc, person, why, ...(could?.length ? { could } : {}), ...(area ? { private: area } : {}) };
      };
      const could = pending.get(doc.id);
      if (could?.length) return loose(`It fits ${could.length} visits, so medrec puts it with none of them.`, could);
      const across = doc.doc_type === 'eob' ? `An explanation of benefits covers claims, and ${shared ? 'no visit listed here' : 'none of this person’s visits'} has its claim.` : ACROSS[doc.doc_type ?? ''];
      if (across) return loose(across);
      if (!doc.date) return loose('It has no date to match a visit by.');
      return loose(`No visit ${shared ? 'listed here' : 'of this person’s'} is on or near ${dateText(doc.date)}.`);
    })
    .sort(newestFirst);
}

/** The papers of a person's that a shared screen may name. */
const cleared = (idx: PersonIndex, household: Household, today: string, indexes: Map<string, PersonIndex>): Set<string> => new Set(papersOf(idx, household, today, indexes).filter((x) => !x.private).map((x) => x.doc.id));

/** Whether a shared screen may name a paper, whoever's: one everyone's Papers lists. Never one that is in nobody's records. */
export function sharedPaper(household: Household, indexes: Map<string, PersonIndex>, today: string): (id: string) => boolean {
  let all: Set<string> | undefined;
  return (id) => (all ??= new Set(household.people.flatMap((p) => [...(indexes.has(p.id) ? cleared(indexes.get(p.id)!, household, today, indexes) : [])]))).has(id);
}

/** Everyone's papers for a shared screen, newest first: none that is private, each placed as if nothing private were there. */
export function sharedPapers(household: Household, indexes: Map<string, PersonIndex>, today: string): Paper[] {
  return household.people
    .flatMap((p) => {
      const idx = indexes.get(p.id);
      if (!idx) return [];
      const may = cleared(idx, household, today, indexes);
      return papersOf(idx, household, today, indexes, true).filter((x) => may.has(x.doc.id));
    })
    .sort(newestFirst);
}
