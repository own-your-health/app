// The claim fields of medrec's data contract (named amounts, categories,
// diagnoses and links), read where a claim has them, and the app's own
// reading of the payer's words where it does not.
import { describe, expect, it } from 'vitest';
import { claimAmounts, claimCategory, claimDiagnoses, claimLines, claimResultIds, claimTitle, claimVisitId, diagnosisText, isContractClaim } from '../src/model/claims';
import { costLines, toCsv } from '../src/model/costs';
import { formatMoney } from '../src/model/records';
import { search } from '../src/model/search';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { claimContext, visitTimeline } from '../src/model/visits';
import { demo, personNamed } from './demo-data';
import { asFiledBefore, recordsOf, ruled, RULES } from './rules';

const PERSON = ruled('Wyn');
const TODAY = '2026-03-20';
const filed = recordsOf('Wyn');
const visitOf = (display: string) => filed.records.find((r) => r.kind === 'encounter' && r.display === display)!;
const claimOn = (date: string, from = filed) => from.records.find((r) => r.kind === 'claim' && r.date === date)!;
const without = (r: MedRecord, ...keys: string[]): MedRecord => ({ ...r, fields: Object.fromEntries(Object.entries(r.fields).filter(([k]) => !keys.includes(k))) });
const [SKIN, FOLLOW_UP] = [visitOf('Skin visit'), visitOf('Follow-up visit')];
// medrec's claim, less the payer's own words for its amounts, and with the ids
// of records these are without.
const linked: MedRecord = (() => {
  const c = without(claimOn('2026-03-06'), 'total');
  const [visit, test] = c.fields.items as { records: string[] }[];
  return { ...c, fields: { ...c.fields, results: [...(c.fields.results as string[]), 'r_gone'], items: [visit, { ...test, records: [...test!.records, 'r_gone'] }] } as MedRecord['fields'] };
})();
// The claim of the follow-up as a medrec before 0.5.0 filed it, and one whose visit is not in these records.
const worded = asFiledBefore(claimOn('2026-03-11'), { words: true });
const lostLink: MedRecord = { ...claimOn('2026-03-11'), id: 'r_lost', fields: { ...claimOn('2026-03-11').fields, visit: 'r_elsewhere' } };
// A payer that gives only its totals, with the kind of care medrec gives one it can tell.
const noLines: MedRecord = { ...claimOn('2026-01-20'), display: 'Imaging · Example Imaging', fields: { ...without(claimOn('2026-01-20'), 'total').fields, category: 'imaging' } };
// An emergency room's claim as a medrec before 0.8.2 filed it: the revenue code where the service code goes.
const facility: MedRecord = (() => {
  const c = without(claimOn('2026-06-14', recordsOf('Noor')), 'category', 'amounts', 'total');
  const { sequence, revenue, amounts } = (c.fields.items as { sequence: number; revenue: object; amounts: object }[])[0]!;
  return { ...c, fields: { ...c.fields, items: [{ sequence, service: revenue, amounts }] } as MedRecord['fields'] };
})();
const index: PersonIndex = { ...filed, records: [...filed.records.filter((r) => r.kind !== 'claim'), linked, worded, lostLink, noLines, facility] };
const pharmacy = demo().indexes.get(personNamed(demo().household, 'Robin Example').id)!.records.find((r) => r.kind === 'claim' && r.fields.category === 'pharmacy')!;
const household = RULES;
const dollars = (m: { amount: string } | undefined) => m?.amount;

describe('a claim’s amounts', () => {
  it('come from medrec’s names when the claim has no words for them', () => {
    const a = claimAmounts(linked);
    expect([a.billed, a.allowed, a.planPaid, a.yourShare].map(dollars)).toEqual(['210', '110', '76', '34']);
    expect(a.parts.map((p) => [p.name, p.label, p.amount.amount])).toEqual([
      ['copay', 'Copay', '30'],
      ['coinsurance', 'Coinsurance', '4'],
    ]);
  });

  it('still come from the payer’s words on a claim from an older medrec', () => {
    const a = claimAmounts(worded);
    expect([a.billed, a.allowed, a.planPaid, a.yourShare].map(dollars)).toEqual(['120', '80', '55', '25']);
    expect(a.parts.map((p) => p.label)).toEqual(['Copay']);
  });

  it('take medrec’s name over the payer’s words for the same amount', () => {
    const both: MedRecord = { ...worded, fields: { ...worded.fields, amounts: { you_owe: { amount: '20.00', currency: 'USD' } } } };
    const a = claimAmounts(both);
    expect(dollars(a.yourShare)).toBe('20.00');
    // An amount medrec leaves out is unknown, so the words still give it.
    expect(dollars(a.billed)).toBe('120');
  });

  it('add up your share from its parts when the payer gives no figure for it, and say so', () => {
    expect(claimAmounts(linked).shareAdded).toBeUndefined();
    const amounts = Object.fromEntries(Object.entries(linked.fields.amounts as Record<string, unknown>).filter(([k]) => k !== 'you_owe'));
    const added = claimAmounts({ ...linked, fields: { ...linked.fields, amounts } } as MedRecord);
    expect([dollars(added.yourShare), added.shareAdded]).toEqual(['34.00', true]);
    // A discount is never part of it.
    const fill = Object.fromEntries(Object.entries(pharmacy.fields.amounts as Record<string, unknown>).filter(([k]) => k !== 'you_owe'));
    expect(dollars(claimAmounts({ ...pharmacy, fields: { ...pharmacy.fields, total: [], amounts: fill } } as MedRecord).yourShare)).toBe('5.00');
  });

  it('read medrec’s decimal strings to the nearest cent', () => {
    const usd = (amount: string) => ({ amount, currency: 'USD' });
    expect(['150.0', '30.50', '12.3450', '12.345', '0.995', '-2.005', '7'].map((a) => formatMoney(usd(a)))).toEqual(['$150.00', '$30.50', '$12.35', '$12.35', '$1.00', '−$2.01', '$7.00']);
    const share = claimAmounts({ ...worded, fields: { ...worded.fields, total: [], amounts: { copay: usd('10.0'), coinsurance: usd('2.1250') } } } as MedRecord);
    expect(dollars(share.yourShare)).toBe('12.13');
  });

  it('carry a discount, which is no part of your share', () => {
    const a = claimAmounts(pharmacy);
    expect(dollars(a.discount)).toBe('34.85');
    expect(a.parts.map((p) => p.label)).not.toContain('Discount');
    expect(claimLines(pharmacy)[0]!.amounts.discount?.amount).toBe('34.85');
    const words: MedRecord = { ...worded, fields: { ...worded.fields, total: [{ category: 'Discount', amount: { amount: '5.00', currency: 'USD' } }] } };
    expect(dollars(claimAmounts(words).discount)).toBe('5.00');
    expect(claimAmounts(words).parts).toEqual([]);
  });
});

describe('a claim’s name', () => {
  it('is its lines’ services, and without lines medrec’s name less the provider the page shows apart', () => {
    expect(claimTitle(linked)).toBe('Office visit and skin scraping test');
    expect(claimTitle(noLines)).toBe('Imaging');
    expect(claimTitle({ ...noLines, display: 'Professional' })).toBe('Claim from Example Imaging');
  });
});

describe('a claim’s lines and kind of care', () => {
  it('take each line’s category and amounts from medrec', () => {
    expect(claimLines(linked).map((l) => [l.label, l.category, l.amounts.billed?.amount, l.amounts.youOwe?.amount])).toEqual([
      ['Office visit', 'visit', '165', '30'],
      ['Skin scraping test', 'lab', '45', '4'],
    ]);
  });

  it('read a hospital’s revenue code as a facility charge', () => {
    expect(claimLines(facility).map((l) => l.category)).toEqual(['facility']);
    expect(claimCategory(facility)).toBe('facility');
  });

  it('read a revenue code an earlier medrec put where the service code goes as the line’s revenue code too', () => {
    const [line] = claimLines(facility);
    expect([line!.code, line!.revenue?.code]).toEqual(['0450', '0450']);
    const [, row] = toCsv(costLines(PERSON, index).filter((l) => l.claim === facility.id), new Map()).trimEnd().split('\r\n');
    expect(row).toContain(',Emergency room,0450,Revenue code,Facility charge,');
    expect(row!.split(',').slice(-3)).toEqual([facility.id, '', '0450']);
    // Said once, as the line's code, never again beside it.
    expect(search(index, null, 'emergency room').find((h) => h.id === facility.id)?.line).toBe('Emergency room (0450) · you owe $150.00');
  });

  it('name the claim’s kind of care: medrec’s, else its lines’ one kind, else mixed', () => {
    expect(claimCategory(linked)).toBe('mixed');
    expect(claimCategory(noLines)).toBe('imaging');
    expect(claimCategory(worded)).toBe('visit');
    expect(claimCategory(without(linked, 'category'))).toBe('mixed');
    expect(claimCategory({ ...noLines, fields: { ...noLines.fields, category: 'not a category' } })).toBeUndefined();
  });

  it('put a claim without lines under the kind medrec gave it in Costs', () => {
    const lines = costLines(PERSON, index).filter((l) => l.claim === noLines.id);
    expect(lines.map((l) => [l.category, l.cents.billed, l.cents.youOwe])).toEqual([['imaging', 40000, 6000]]);
  });
});

describe('a claim’s diagnoses', () => {
  it('are in the payer’s order, each with its code', () => {
    expect(claimDiagnoses(linked).map(diagnosisText)).toEqual(['Rash (R21)', 'Ringworm (B35.4)']);
    expect(claimDiagnoses(worded)).toEqual([]);
    expect(diagnosisText({ code: 'R21' })).toBe('R21');
    expect(diagnosisText({ display: 'Rash' })).toBe('Rash');
  });

  it('are found by search, in their own words', () => {
    const hit = search(index, null, 'ringworm').find((h) => h.id === linked.id);
    expect(hit).toMatchObject({ field: 'Diagnosis', snippet: 'Ringworm (B35.4)' });
    // medrec's links and amounts are not words to search.
    expect(search(index, null, SKIN.id)).toEqual([]);
  });

  it('show in search what you owe, or your share when the payer gives only its parts', () => {
    expect(search(index, null, 'ringworm').find((h) => h.id === linked.id)?.claim?.amount).toBe('you owe $34.00');
    const amounts = Object.fromEntries(Object.entries(linked.fields.amounts as Record<string, unknown>).filter(([k]) => k !== 'you_owe'));
    const idx = { ...index, records: index.records.map((r) => (r === linked ? ({ ...linked, fields: { ...linked.fields, amounts } } as MedRecord) : r)) };
    expect(search(idx, null, 'ringworm').find((h) => h.id === linked.id)?.claim?.amount).toBe('your share $34.00');
  });
});

describe('what a claim paid for', () => {
  const { visits } = visitTimeline(index, household, PERSON, TODAY);
  const visit = (id: string) => visits.find((v) => v.record.id === id)!;

  it('is the visit medrec linked, though its provider and day match no visit', () => {
    expect(claimVisitId(linked)).toBe(SKIN.id);
    expect(visit(SKIN.id).claims).toEqual([linked]);
  });

  it('is matched by day and provider for a claim from an earlier medrec', () => {
    expect(isContractClaim(worded)).toBe(false);
    expect(visit(FOLLOW_UP.id).claims).toEqual([worded]);
  });

  it('is none for medrec’s claim without a link, or with one to a visit not in these records, though a visit matches by day and provider', () => {
    expect(isContractClaim(lostLink)).toBe(true);
    // Either of the two makes it one.
    for (const k of ['amounts', 'category']) expect(isContractClaim(without(lostLink, k))).toBe(true);
    expect(visits.some((v) => v.claims.includes(lostLink))).toBe(false);
    expect(claimContext(index, household, PERSON, TODAY, lostLink).visit).toBeUndefined();
    const unlinked = without(lostLink, 'visit');
    const idx = { ...index, records: [...index.records.filter((r) => r !== lostLink), unlinked] };
    expect(visitTimeline(idx, household, PERSON, TODAY).visits.some((v) => v.claims.includes(unlinked))).toBe(false);
  });

  it('is none when medrec’s link is to a visit that has not happened', () => {
    const planned: MedRecord = { ...FOLLOW_UP, id: 'r_plannedaaaaaaaaaaaaa', date: '2026-04-01', status: 'planned' };
    const relinked: MedRecord = { ...lostLink, fields: { ...lostLink.fields, visit: planned.id } };
    const idx = { ...index, records: [...index.records.filter((r) => r !== lostLink), planned, relinked] };
    const v = visitTimeline(idx, household, PERSON, TODAY).visits;
    expect(v.map((x) => x.record.id)).not.toContain(planned.id);
    expect(v.some((x) => x.claims.includes(relinked))).toBe(false);
  });

  it('lists the results medrec linked and each line’s records, leaving out ids these records lack', () => {
    expect(claimResultIds(linked)).toHaveLength(3);
    const c = claimContext(index, household, PERSON, TODAY, linked);
    expect(c.visit?.record.id).toBe(SKIN.id);
    expect(c.results.map((r) => r.display)).toEqual(['Fungus, skin scraping', 'Zinc']);
    expect(c.lineRecords.map((rs) => rs.map((r) => r.display))).toEqual([['Skin visit'], ['Fungus, skin scraping', 'Zinc']]);
  });

  it('is the matched visit for a claim from an older medrec, with no results or line records', () => {
    const c = claimContext(index, household, PERSON, TODAY, worded);
    expect(c.visit?.record.id).toBe(FOLLOW_UP.id);
    expect(c.results).toEqual([]);
    expect(c.lineRecords).toEqual([[]]);
  });
});
