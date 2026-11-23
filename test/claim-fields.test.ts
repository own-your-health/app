// The claim fields of medrec's data contract (named amounts, categories,
// diagnoses and links), read where a claim has them, and the app's own
// reading of the payer's words where it does not.
import { describe, expect, it } from 'vitest';
import { claimAmounts } from '../src/model/billing';
import { claimCategory, claimDiagnoses, claimLines, claimResultIds, claimVisitId, diagnosisText } from '../src/model/claims';
import { costLines } from '../src/model/costs';
import { parseIndex } from '../src/model/parse';
import { search } from '../src/model/search';
import type { MedRecord } from '../src/model/types';
import { claimContext, visitTimeline } from '../src/model/visits';
import { demo } from './demo-data';
import { fixture } from './helpers';

const PERSON = 'p_fixtureclaimsaaaaaaa';
const TODAY = '2026-03-20';
const { household } = demo();
const index = parseIndex(fixture('folder/index-claim-fields.json'), PERSON);
const record = (id: string): MedRecord => index.records.find((r) => r.id === id)!;
const linked = record('r_claimlinkedaaaaaaaaa');
const worded = record('r_claimwordsaaaaaaaaaa');
const lostLink = record('r_claimlostlinkaaaaaaa');
const pharmacy = record('r_claimpharmacyaaaaaaa');
const facility = record('r_claimfacilityaaaaaaa');
const noLines = record('r_claimnolinesaaaaaaaa');
const dollars = (m: { amount: string } | undefined) => m?.amount;

describe('a claim’s amounts', () => {
  it('come from medrec’s names when the claim has no words for them', () => {
    const a = claimAmounts(linked);
    expect([a.billed, a.allowed, a.planPaid, a.yourShare].map(dollars)).toEqual(['230.00', '130.00', '99.00', '31.00']);
    expect(a.parts.map((p) => [p.name, p.label, p.amount.amount])).toEqual([
      ['copay', 'Copay', '25.00'],
      ['coinsurance', 'Coinsurance', '6.00'],
    ]);
  });

  it('still come from the payer’s words on a claim from an older medrec', () => {
    const a = claimAmounts(worded);
    expect([a.billed, a.allowed, a.planPaid, a.yourShare].map(dollars)).toEqual(['120.00', '80.00', '55.00', '25.00']);
    expect(a.parts.map((p) => p.label)).toEqual(['Copay']);
  });

  it('take medrec’s name over the payer’s words for the same amount', () => {
    const both: MedRecord = { ...worded, fields: { ...worded.fields, amounts: { you_owe: { amount: '20.00', currency: 'USD' } } } };
    const a = claimAmounts(both);
    expect(dollars(a.yourShare)).toBe('20.00');
    // An amount medrec leaves out is unknown, so the words still give it.
    expect(dollars(a.billed)).toBe('120.00');
  });

  it('carry a discount, which is no part of your share', () => {
    const a = claimAmounts(pharmacy);
    expect(dollars(a.discount)).toBe('20.10');
    expect(a.parts.map((p) => p.label)).toEqual(['Copay']);
    expect(claimLines(pharmacy)[0]!.amounts.discount?.amount).toBe('20.10');
    const words: MedRecord = { ...worded, fields: { ...worded.fields, total: [{ category: 'Discount', amount: { amount: '5.00', currency: 'USD' } }] } };
    expect(dollars(claimAmounts(words).discount)).toBe('5.00');
    expect(claimAmounts(words).parts).toEqual([]);
  });
});

describe('a claim’s lines and kind of care', () => {
  it('take each line’s category and amounts from medrec', () => {
    expect(claimLines(linked).map((l) => [l.label, l.category, l.amounts.billed?.amount, l.amounts.youOwe?.amount])).toEqual([
      ['Office visit', 'visit', '180.00', '25.00'],
      ['Strep test', 'lab', '50.00', '6.00'],
    ]);
  });

  it('read a hospital’s revenue code as a facility charge', () => {
    expect(claimLines(facility).map((l) => l.category)).toEqual(['facility']);
    expect(claimCategory(facility)).toBe('facility');
  });

  it('name the claim’s kind of care: medrec’s, else its lines’ one kind, else mixed', () => {
    expect(claimCategory(linked)).toBe('mixed');
    expect(claimCategory(noLines)).toBe('imaging');
    expect(claimCategory(worded)).toBe('visit');
    const twoKinds: MedRecord = { ...linked, fields: Object.fromEntries(Object.entries(linked.fields).filter(([k]) => k !== 'category')) };
    expect(claimCategory(twoKinds)).toBe('mixed');
    expect(claimCategory({ ...noLines, fields: { ...noLines.fields, category: 'not a category' } })).toBeUndefined();
  });

  it('put a claim without lines under the kind medrec gave it in Costs', () => {
    const lines = costLines(PERSON, index).filter((l) => l.claim === noLines.id);
    expect(lines.map((l) => [l.category, l.cents.billed, l.cents.youOwe])).toEqual([['imaging', 40000, 6000]]);
  });
});

describe('a claim’s diagnoses', () => {
  it('are in the payer’s order, each with its code', () => {
    expect(claimDiagnoses(linked).map(diagnosisText)).toEqual(['Fever (R50.9)', 'Strep throat (J02.0)']);
    expect(claimDiagnoses(worded)).toEqual([]);
    expect(diagnosisText({ code: 'R50.9' })).toBe('R50.9');
    expect(diagnosisText({ display: 'Fever' })).toBe('Fever');
  });

  it('are found by search, in their own words', () => {
    const hit = search(index, null, 'strep throat').find((h) => h.id === linked.id);
    expect(hit).toMatchObject({ field: 'Diagnosis', snippet: 'Strep throat (J02.0)' });
    // medrec's links and amounts are not words to search.
    expect(search(index, null, 'r_visitaaaaaaaaaaaaaaa')).toEqual([]);
  });
});

describe('what a claim paid for', () => {
  const { visits } = visitTimeline(index, household, PERSON, TODAY);
  const visit = (id: string) => visits.find((v) => v.record.id === id)!;

  it('is the visit medrec linked, though its provider and day match no visit', () => {
    expect(claimVisitId(linked)).toBe('r_visitaaaaaaaaaaaaaaa');
    expect(visit('r_visitaaaaaaaaaaaaaaa').claims).toEqual([linked]);
  });

  it('is matched by day and provider without a link, or with one to a visit not in these records', () => {
    expect(visit('r_visitbbbbbbbbbbbbbbb').claims).toEqual([worded, lostLink]);
  });

  it('is matched the same way when the link is to a visit that has not happened', () => {
    const planned: MedRecord = { ...record('r_visitbbbbbbbbbbbbbbb'), id: 'r_plannedaaaaaaaaaaaaa', date: '2026-04-01', status: 'planned' };
    const relinked: MedRecord = { ...lostLink, fields: { ...lostLink.fields, visit: planned.id } };
    const idx = { ...index, records: [...index.records.filter((r) => r !== lostLink), planned, relinked] };
    const v = visitTimeline(idx, household, PERSON, TODAY).visits;
    expect(v.map((x) => x.record.id)).not.toContain(planned.id);
    expect(v.find((x) => x.record.id === 'r_visitbbbbbbbbbbbbbbb')!.claims).toEqual([worded, relinked]);
  });

  it('lists the results medrec linked and each line’s records, leaving out ids these records lack', () => {
    expect(claimResultIds(linked)).toHaveLength(3);
    const c = claimContext(index, household, PERSON, TODAY, linked);
    expect(c.visit?.record.id).toBe('r_visitaaaaaaaaaaaaaaa');
    expect(c.results.map((r) => r.display)).toEqual(['Strep A test', 'Hemoglobin']);
    expect(c.lineRecords.map((rs) => rs.map((r) => r.display))).toEqual([['Sick visit'], ['Strep A test']]);
  });

  it('is the matched visit for a claim from an older medrec, with no results or line records', () => {
    const c = claimContext(index, household, PERSON, TODAY, worded);
    expect(c.visit?.record.id).toBe('r_visitbbbbbbbbbbbbbbb');
    expect(c.results).toEqual([]);
    expect(c.lineRecords).toEqual([[]]);
  });
});
