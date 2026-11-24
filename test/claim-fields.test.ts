// The claim fields of medrec's data contract (named amounts, categories,
// diagnoses and links), read where a claim has them, and the app's own
// reading of the payer's words where it does not.
import { describe, expect, it } from 'vitest';
import { claimAmounts, claimCategory, claimDiagnoses, claimLines, claimResultIds, claimTitle, claimVisitId, diagnosisText, isContractClaim } from '../src/model/claims';
import { costLines } from '../src/model/costs';
import { formatMoney } from '../src/model/records';
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

  it('add up your share from its parts when the payer gives no figure for it, and say so', () => {
    expect(claimAmounts(linked).shareAdded).toBeUndefined();
    const amounts = Object.fromEntries(Object.entries(linked.fields.amounts as Record<string, unknown>).filter(([k]) => k !== 'you_owe'));
    const added = claimAmounts({ ...linked, fields: { ...linked.fields, amounts } } as MedRecord);
    expect([dollars(added.yourShare), added.shareAdded]).toEqual(['31.00', true]);
    // A discount is never part of it.
    const fill = Object.fromEntries(Object.entries(pharmacy.fields.amounts as Record<string, unknown>).filter(([k]) => k !== 'you_owe'));
    expect(dollars(claimAmounts({ ...pharmacy, fields: { ...pharmacy.fields, amounts: fill } } as MedRecord).yourShare)).toBe('10.00');
  });

  it('read medrec’s decimal strings to the nearest cent', () => {
    const usd = (amount: string) => ({ amount, currency: 'USD' });
    expect(['150.0', '30.50', '12.3450', '12.345', '0.995', '-2.005', '7'].map((a) => formatMoney(usd(a)))).toEqual(['$150.00', '$30.50', '$12.35', '$12.35', '$1.00', '−$2.01', '$7.00']);
    const share = claimAmounts({ ...worded, fields: { ...worded.fields, total: [], amounts: { copay: usd('10.0'), coinsurance: usd('2.1250') } } } as MedRecord);
    expect(dollars(share.yourShare)).toBe('12.13');
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

describe('a claim’s name', () => {
  it('is its lines’ services, and without lines medrec’s name less the provider the page shows apart', () => {
    expect(claimTitle(linked)).toBe('Office visit and strep test');
    expect(claimTitle(noLines)).toBe('Imaging');
    expect(claimTitle({ ...noLines, display: 'Professional' })).toBe('Claim from Example Imaging');
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

  it('show in search what you owe, or your share when the payer gives only its parts', () => {
    expect(search(index, null, 'strep throat').find((h) => h.id === linked.id)?.claim?.amount).toBe('you owe $31.00');
    const amounts = Object.fromEntries(Object.entries(linked.fields.amounts as Record<string, unknown>).filter(([k]) => k !== 'you_owe'));
    const idx = { ...index, records: index.records.map((r) => (r === linked ? ({ ...linked, fields: { ...linked.fields, amounts } } as MedRecord) : r)) };
    expect(search(idx, null, 'strep throat').find((h) => h.id === linked.id)?.claim?.amount).toBe('your share $31.00');
  });
});

describe('what a claim paid for', () => {
  const { visits } = visitTimeline(index, household, PERSON, TODAY);
  const visit = (id: string) => visits.find((v) => v.record.id === id)!;

  it('is the visit medrec linked, though its provider and day match no visit', () => {
    expect(claimVisitId(linked)).toBe('r_visitaaaaaaaaaaaaaaa');
    expect(visit('r_visitaaaaaaaaaaaaaaa').claims).toEqual([linked]);
  });

  it('is matched by day and provider for a claim from an earlier medrec', () => {
    expect(isContractClaim(worded)).toBe(false);
    expect(visit('r_visitbbbbbbbbbbbbbbb').claims).toEqual([worded]);
  });

  it('is none for medrec’s claim without a link, or with one to a visit not in these records, though a visit matches by day and provider', () => {
    expect(isContractClaim(lostLink)).toBe(true);
    expect(visits.some((v) => v.claims.includes(lostLink))).toBe(false);
    expect(claimContext(index, household, PERSON, TODAY, lostLink).visit).toBeUndefined();
    const unlinked: MedRecord = { ...lostLink, fields: Object.fromEntries(Object.entries(lostLink.fields).filter(([k]) => k !== 'visit')) };
    const idx = { ...index, records: [...index.records.filter((r) => r !== lostLink), unlinked] };
    expect(visitTimeline(idx, household, PERSON, TODAY).visits.some((v) => v.claims.includes(unlinked))).toBe(false);
  });

  it('is none when medrec’s link is to a visit that has not happened', () => {
    const planned: MedRecord = { ...record('r_visitbbbbbbbbbbbbbbb'), id: 'r_plannedaaaaaaaaaaaaa', date: '2026-04-01', status: 'planned' };
    const relinked: MedRecord = { ...lostLink, fields: { ...lostLink.fields, visit: planned.id } };
    const idx = { ...index, records: [...index.records.filter((r) => r !== lostLink), planned, relinked] };
    const v = visitTimeline(idx, household, PERSON, TODAY).visits;
    expect(v.map((x) => x.record.id)).not.toContain(planned.id);
    expect(v.some((x) => x.claims.includes(relinked))).toBe(false);
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
