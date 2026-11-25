import { describe, expect, it } from 'vitest';
import { categoryOf, claimAmounts, claimLines, claimTitle } from '../src/model/claims';
import { recordTitle, visitTitle } from '../src/model/titles';
import { toCents } from '../src/model/records';
import type { MedRecord } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const robin = indexes.get(personNamed(household, 'Robin Example').id)!;
const claimOn = (date: string) => robin.records.find((r) => r.kind === 'claim' && r.date === date)!;

function claim(items: unknown[], extra: Partial<MedRecord> = {}): MedRecord {
  return { id: 'r_x', kind: 'claim', key: 'k', display: 'Professional', fields: { type: 'Professional', provider: 'Example Clinic', items }, documents: [], provenance: [], ...extra } as unknown as MedRecord;
}
const item = (code: string | null, display: string | null, more: object = {}) => ({ service: { system: 'http://www.ama-assn.org/go/cpt', code, display }, ...more });

describe('a claim title', () => {
  it('names the services, not the claim type', () => {
    expect(claimTitle(claimOn('2026-11-18'))).toBe('Office visit');
    expect(claimTitle(claimOn('2026-10-03'))).toBe('Cholesterol tests and blood draw');
    expect(claimTitle(claimOn('2026-10-01'))).toBe('Preventive visit, flu vaccine and 1 more');
  });

  it('names a service once, and keeps an abbreviation’s capitals', () => {
    expect(claimTitle(claim([item('99347', 'Home visit'), item('99347', 'home visit'), item('94760', 'SpO2')]))).toBe('Home visit and SpO2');
    expect(claimTitle(claim([item('77080', 'DXA'), item('93306', 'TTE at rest')]))).toBe('DXA and TTE at rest');
  });

  it('uses the code when a line has no words', () => {
    expect(claimTitle(claim([item('97110', null)]))).toBe('97110');
  });

  it('without lines, uses a name that is more than the type, else the provider', () => {
    expect(claimTitle(claim([]))).toBe('Claim from Example Clinic');
    expect(claimTitle(claim([], { display: 'Hearing aid fitting' }))).toBe('Hearing aid fitting');
    expect(claimTitle(claim([], { fields: { type: 'Professional' } }))).toBe('Claim');
  });

  it('is how every list names a claim', () => {
    expect(recordTitle(claimOn('2026-11-18'))).toBe('Office visit');
  });
});

describe('a visit’s title', () => {
  const visit = (over: Partial<MedRecord>): MedRecord => ({ ...robin.records.find((r) => r.kind === 'encounter')!, ...over });
  const bill = 'YEARLY EXAM RETURNING ADULT';

  it('is the source’s name for it, else its reason, and never billing words', () => {
    expect(recordTitle(visit({ display: 'Clinic visit', fields: { reason: 'Ankle sprain' } }))).toBe('Clinic visit');
    expect(recordTitle(visit({ display: bill, fields: { reason: 'Annual physical' } }))).toBe('Annual physical');
    expect([recordTitle(visit({ display: bill, fields: {} })), recordTitle(visit({ display: bill, fields: { reason: bill } }))]).toEqual(['Visit', 'Visit']);
    expect(visitTitle(visit({ display: bill, fields: {} }))).toBe('The portal’s record of the visit');
  });

  it('is its code’s name, else its kind, where the source gives it none', () => {
    expect(recordTitle(visit({ display: '', code: { display: 'Consultation' }, fields: {} }))).toBe('Consultation');
    expect(recordTitle(visit({ display: '', code: {}, fields: {} }))).toBe('Visit');
  });

  it('leaves every other kind of record its source’s name', () => {
    const procedure = { ...visit({}), kind: 'procedure', display: bill, fields: { reason: 'Annual physical' } };
    expect([recordTitle(procedure), recordTitle({ ...procedure, display: '', code: {} })]).toEqual([bill, 'Procedure']);
  });
});

describe('claim lines', () => {
  it('carry their code, category and amounts', () => {
    const lines = claimLines(claimOn('2026-10-03'));
    expect(lines.map((l) => [l.label, l.code, l.category])).toEqual([
      ['Cholesterol tests', '80061', 'lab'],
      ['Blood draw', '36415', 'lab'],
    ]);
    expect(lines[0]!.amounts).toMatchObject({ billed: { amount: '180' }, allowed: { amount: '78.4' }, planPaid: { amount: '62.72' }, coinsurance: { amount: '15.68' }, youOwe: { amount: '15.68' } });
    expect(lines[0]!.date).toBe('2026-10-03');
  });

  it('add up to the claim’s totals in the sample', () => {
    for (const r of robin.records.filter((x) => x.kind === 'claim')) {
      const lines = claimLines(r);
      const total = claimAmounts(r);
      for (const k of ['billed', 'allowed', 'planPaid'] as const) {
        expect(lines.reduce((s, l) => s + (toCents(l.amounts[k]) ?? 0), 0)).toBe(toCents(total[k]));
      }
      expect(lines.reduce((s, l) => s + (toCents(l.amounts.youOwe) ?? 0), 0)).toBe(toCents(total.yourShare));
    }
  });

  it('take medrec’s fixed amount names and category over the payer’s words', () => {
    const [l] = claimLines(claim([item('99347', 'Home visit', { category: 'supply', amounts: { billed: { amount: '14.00', currency: 'USD' }, you_owe: { amount: '3.00', currency: 'USD' } }, adjudication: [{ category: 'Submitted Amount', amount: { amount: '11.00', currency: 'USD' } }] })]));
    expect(l!.category).toBe('supply');
    expect(l!.amounts.billed?.amount).toBe('14.00');
    expect(l!.amounts.youOwe?.amount).toBe('3.00');
  });

  it('trust no inherited name from medrec: a category or amount called "constructor" is not one', () => {
    const [l] = claimLines(claim([item('99347', 'Home visit', { category: 'constructor', amounts: { constructor: { amount: '4.00', currency: 'USD' }, toString: { amount: '4.00', currency: 'USD' } } })]));
    expect(l!.category).toBe('visit');
    expect(l!.amounts).toEqual({});
  });

  it('read a payer’s words the way the claim’s totals do', () => {
    const words = (category: string) => ({ category, amount: { amount: '7.00', currency: 'USD' } });
    const r = claim([item('99347', 'Home visit', { adjudication: [words('Paid by plan'), words('Patient pay amount'), words('Copay')] })], {
      fields: { type: 'Professional', items: [item('99347', 'Home visit', { adjudication: [words('Paid by plan'), words('Patient pay amount'), words('Copay')] })], total: [words('Paid by plan'), words('Patient pay amount'), words('Copay')] },
    } as Partial<MedRecord>);
    const [l] = claimLines(r);
    expect(l!.amounts).toMatchObject({ planPaid: { amount: '7.00' }, youOwe: { amount: '7.00' }, copay: { amount: '7.00' } });
    const totals = claimAmounts(r);
    expect(totals.planPaid?.amount).toBe('7.00');
    expect(totals.yourShare?.amount).toBe('7.00');
    expect(totals.parts).toEqual([{ name: 'copay', label: 'Copay', amount: { amount: '7.00', currency: 'USD' } }]);
  });

  it('fall back to the line’s net as what was billed', () => {
    const [l] = claimLines(claim([item('99347', 'Home visit', { net: { amount: '64.00', currency: 'USD' } })]));
    expect(l!.amounts.billed?.amount).toBe('64.00');
  });

  it('are none on a claim without items', () => {
    expect(claimLines(claim([]))).toEqual([]);
    expect(claimLines(claim([{ sequence: 1 }]))).toEqual([]);
  });
});

// The rows of the category table in medrec's data contract.
describe('a line’s category', () => {
  it.each([
    ['99347', 'visit'],
    ['99283', 'visit'],
    ['87086', 'lab'],
    ['36416', 'lab'],
    ['0041U', 'lab'],
    ['0012M', 'lab'],
    ['76705', 'imaging'],
    ['90750', 'vaccine'],
    ['90473', 'vaccine'],
    ['95004', 'medicine'],
    ['99605', 'medicine'],
    ['69210', 'procedure'],
    ['00140', 'anesthesia'],
    ['J3420', 'drug'],
    ['E0114', 'supply'],
    ['D2391', 'dental'],
    ['G0283', 'other'],
    ['1125F', 'other'],
    ['0101T', 'other'],
    [undefined, 'other'],
  ] as const)('%s is %s', (code, category) => {
    expect(categoryOf(code)).toBe(category);
  });

  it('is pharmacy on a pharmacy claim or a drug code', () => {
    expect(categoryOf('00000-7777-12', undefined, 'Pharmacy')).toBe('pharmacy');
    expect(categoryOf('198440', 'http://www.nlm.nih.gov/research/umls/rxnorm')).toBe('pharmacy');
  });
});
