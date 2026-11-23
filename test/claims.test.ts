import { describe, expect, it } from 'vitest';
import { categoryOf, claimLines, claimTitle } from '../src/model/claims';
import { recordTitle } from '../src/model/titles';
import { claimAmounts, toCents } from '../src/model/billing';
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
    expect(claimTitle(claimOn('2026-10-03'))).toBe('Lipid panel and blood draw');
    expect(claimTitle(claimOn('2026-10-01'))).toBe('Preventive visit, flu vaccine and 1 more');
  });

  it('names a service once, and keeps an abbreviation’s capitals', () => {
    expect(claimTitle(claim([item('99213', 'Office visit'), item('99213', 'office visit'), item('83036', 'HbA1c')]))).toBe('Office visit and HbA1c');
    expect(claimTitle(claim([item('85025', 'CBC'), item('70551', 'MRI brain')]))).toBe('CBC and MRI brain');
  });

  it('uses the code when a line has no words', () => {
    expect(claimTitle(claim([item('99213', null)]))).toBe('99213');
  });

  it('without lines, uses a name that is more than the type, else the provider', () => {
    expect(claimTitle(claim([]))).toBe('Claim from Example Clinic');
    expect(claimTitle(claim([], { display: 'Knee x-ray' }))).toBe('Knee x-ray');
    expect(claimTitle(claim([], { fields: { type: 'Professional' } }))).toBe('Claim');
  });

  it('is how every list names a claim', () => {
    expect(recordTitle(claimOn('2026-11-18'))).toBe('Office visit');
    const visit = robin.records.find((r) => r.kind === 'encounter')!;
    expect(recordTitle(visit)).toBe(visit.display);
  });
});

describe('claim lines', () => {
  it('carry their code, category and amounts', () => {
    const lines = claimLines(claimOn('2026-10-03'));
    expect(lines.map((l) => [l.label, l.code, l.category])).toEqual([
      ['Lipid panel', '80061', 'lab'],
      ['Blood draw', '36415', 'lab'],
    ]);
    expect(lines[0]!.amounts).toMatchObject({ billed: { amount: '180.00' }, allowed: { amount: '78.40' }, planPaid: { amount: '62.72' }, coinsurance: { amount: '15.68' }, youOwe: { amount: '15.68' } });
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
    const [l] = claimLines(claim([item('99213', 'Office visit', { category: 'lab', amounts: { billed: { amount: '10.00', currency: 'USD' }, you_owe: { amount: '2.00', currency: 'USD' } }, adjudication: [{ category: 'Submitted Amount', amount: { amount: '9.00', currency: 'USD' } }] })]));
    expect(l!.category).toBe('lab');
    expect(l!.amounts.billed?.amount).toBe('10.00');
    expect(l!.amounts.youOwe?.amount).toBe('2.00');
  });

  it('trust no inherited name from medrec: a category or amount called "constructor" is not one', () => {
    const [l] = claimLines(claim([item('99213', 'Office visit', { category: 'constructor', amounts: { constructor: { amount: '1.00', currency: 'USD' }, toString: { amount: '1.00', currency: 'USD' } } })]));
    expect(l!.category).toBe('visit');
    expect(l!.amounts).toEqual({});
  });

  it('read a payer’s words the way the claim’s totals do', () => {
    const words = (category: string) => ({ category, amount: { amount: '5.00', currency: 'USD' } });
    const r = claim([item('99213', 'Office visit', { adjudication: [words('Paid by plan'), words('Patient pay amount'), words('Copay')] })], {
      fields: { type: 'Professional', items: [item('99213', 'Office visit', { adjudication: [words('Paid by plan'), words('Patient pay amount'), words('Copay')] })], total: [words('Paid by plan'), words('Patient pay amount'), words('Copay')] },
    } as Partial<MedRecord>);
    const [l] = claimLines(r);
    expect(l!.amounts).toMatchObject({ planPaid: { amount: '5.00' }, youOwe: { amount: '5.00' }, copay: { amount: '5.00' } });
    const totals = claimAmounts(r);
    expect(totals.planPaid?.amount).toBe('5.00');
    expect(totals.yourShare?.amount).toBe('5.00');
    expect(totals.parts).toEqual([{ label: 'Copay', amount: { amount: '5.00', currency: 'USD' } }]);
  });

  it('fall back to the line’s net as what was billed', () => {
    const [l] = claimLines(claim([item('99213', 'Office visit', { net: { amount: '50.00', currency: 'USD' } })]));
    expect(l!.amounts.billed?.amount).toBe('50.00');
  });

  it('are none on a claim without items', () => {
    expect(claimLines(claim([]))).toEqual([]);
    expect(claimLines(claim([{ sequence: 1 }]))).toEqual([]);
  });
});

describe('a line’s category', () => {
  it.each([
    ['99213', 'visit'],
    ['99396', 'visit'],
    ['80061', 'lab'],
    ['36415', 'lab'],
    ['71046', 'imaging'],
    ['90686', 'vaccine'],
    ['90471', 'vaccine'],
    ['93000', 'medicine'],
    ['45378', 'procedure'],
    ['00810', 'anesthesia'],
    ['J1100', 'drug'],
    ['E0607', 'supply'],
    ['G0439', 'medicine'],
    ['0001U', 'other'],
    [undefined, 'other'],
  ] as const)('%s is %s', (code, category) => {
    expect(categoryOf(code)).toBe(category);
  });

  it('is pharmacy on a pharmacy claim or a drug code', () => {
    expect(categoryOf('00000-0001-01', undefined, 'Pharmacy')).toBe('pharmacy');
    expect(categoryOf('197361', 'http://www.nlm.nih.gov/research/umls/rxnorm')).toBe('pharmacy');
  });
});
