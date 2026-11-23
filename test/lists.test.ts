import { describe, expect, it } from 'vitest';
import { allergyList, conditionList, medicineList, statusText, vaccineList } from '../src/model/lists';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const index = (name: string) => indexes.get(personNamed(household, name).id)!;
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

/** The index with records added, each with only what it gives: one without a code is grouped by its name. */
function withRecords(idx: PersonIndex, extra: Partial<MedRecord>[]): PersonIndex {
  const base = idx.records[0]!;
  return { ...idx, records: [...idx.records, ...extra.map((x, i) => ({ ...base, id: `r_extra${i}`, code: undefined, status: undefined, fields: {}, documents: [], ...x }) as MedRecord)] };
}

describe('conditions', () => {
  it('splits active from resolved, newest first, with when each began and ended', () => {
    const c = conditionList(index('Sam Example'));
    expect(names(c.active)).toEqual(['Vitamin D deficiency']);
    expect(c.active[0]!.first).toBe('2026-04-02');
    expect(names(c.ended)).toEqual(['Right ankle sprain']);
    expect(c.ended[0]).toMatchObject({ first: '2026-05-20', ended: '2026-07-01' });
    expect(c.other).toEqual([]);
  });

  it('goes by a condition’s newest record, and leaves out one entered in error', () => {
    const idx = index('Robin Example');
    const htn = idx.records.find((r) => r.display === 'High blood pressure')!;
    const later = conditionList(withRecords(idx, [{ kind: 'condition', code: htn.code, display: 'High blood pressure', date: '2026-11-01', status: 'resolved' }]));
    expect(later.active).toEqual([]);
    expect(later.ended.find((i) => i.name === 'High blood pressure')).toMatchObject({ first: '2025-03-10', records: [expect.anything(), expect.anything()] });
    const mistaken = conditionList(withRecords(idx, [{ kind: 'condition', display: 'Asthma', date: '2026-11-01', status: 'entered-in-error' }]));
    expect(names([...mistaken.active, ...mistaken.ended, ...mistaken.other])).not.toContain('Asthma');
  });

  it('notes an unconfirmed one beside its status, and puts a ruled-out or status-less one under other', () => {
    const c = conditionList(
      withRecords(index('Sam Example'), [
        { kind: 'condition', display: 'Migraine', date: '2026-09-01', status: 'recurrence', fields: { verification_status: 'provisional' } },
        { kind: 'condition', display: 'Anemia', date: '2026-09-01', status: 'active', fields: { verification_status: 'refuted' } },
        { kind: 'condition', display: 'Back pain', date: '2026-08-01' },
      ]),
    );
    expect(c.active.find((i) => i.name === 'Migraine')).toMatchObject({ isActive: true, unconfirmed: true, refuted: false, statusNote: 'Recurred' });
    expect(names(c.other)).toEqual(['Anemia', 'Back pain']);
    expect(c.other.map((i) => [i.refuted, i.isActive])).toEqual([[true, false], [false, false]]);
    // The heading says active or resolved, so those need no note.
    expect([...c.active, ...c.ended].filter((i) => ['Vitamin D deficiency', 'Right ankle sprain'].includes(i.name)).map((i) => i.statusNote)).toEqual([undefined, undefined]);
  });

  it('keeps a ruled-out condition out of Resolved, whatever its status', () => {
    const c = conditionList(withRecords(index('Sam Example'), [{ kind: 'condition', display: 'Gout', date: '2026-09-01', status: 'resolved', fields: { verification_status: 'refuted' } }]));
    expect(names(c.ended)).not.toContain('Gout');
    expect(c.other.find((i) => i.name === 'Gout')).toMatchObject({ refuted: true });
  });
});

describe('allergies', () => {
  it('keeps every reaction and the criticality, and splits off the inactive ones', () => {
    const sam = allergyList(index('Sam Example'));
    expect(sam.current).toHaveLength(1);
    expect(sam.current[0]).toMatchObject({ name: 'Peanuts', reactions: ['Hives', 'Swelling of the lips'], criticality: 'high' });
    const robin = allergyList(index('Robin Example'));
    expect(names(robin.current)).toEqual(['Sulfa drugs']);
    expect(names(robin.ended)).toEqual(['Latex']);
  });

  it('shows one without a status as current', () => {
    const a = allergyList(withRecords(index('Sam Example'), [{ kind: 'allergy', display: 'Penicillin', date: '2020-01-01' }, { kind: 'allergy', display: 'Mold', date: '2020-01-01', status: 'resolved' }]));
    expect(names(a.current)).toEqual(['Penicillin', 'Peanuts']);
    expect(names(a.ended)).toEqual(['Mold']);
  });
});

describe('medicines', () => {
  it('joins a prescription to its fills: who prescribed, since when, the last fill and where', () => {
    const { active, past } = medicineList(index('Robin Example'));
    expect(names(active)).toEqual(['Lisinopril 10 mg tablet']);
    expect(active[0]).toMatchObject({ first: '2025-03-12', known: ['filled', 'prescribed'], prescriber: 'Dr. Jordan Sample', lastFill: { date: '2026-11-12', pharmacy: 'Example Pharmacy', daysSupply: 90 } });
    expect(names(past)).toEqual(['Cetirizine 10 mg tablet']);
    expect(past[0]!.latest.status).toBe('stopped');
  });

  it('leaves out a withdrawn record, even when it is the newest', () => {
    const idx = index('Robin Example');
    const lisinopril = idx.records.find((r) => r.display === 'Lisinopril 10 mg tablet')!;
    const withdrawn = withRecords(idx, [{ kind: 'medication', code: lisinopril.code, display: 'Lisinopril 20 mg tablet', date: '2026-11-20', status: 'entered-in-error', fields: { dosage: 'Take 2 tablets', source: 'request' } }]);
    const m = medicineList(withdrawn).active.find((x) => x.key === `${lisinopril.code!.system}|${lisinopril.code!.code}`)!;
    expect(m).toMatchObject({ name: 'Lisinopril 10 mg tablet', latest: { date: '2026-11-12' } });
    expect(m.records.map((r) => r.status)).not.toContain('entered-in-error');
  });

  it('says when a medicine is only reported', () => {
    const { active, past } = medicineList(index('Sam Example'));
    expect(names(active)).toEqual(['Vitamin D3 2,000 unit capsule']);
    expect(past[0]).toMatchObject({ name: 'Ibuprofen 200 mg tablet', known: ['reported'] });
  });

  it('lists the active medicines of a child', () => {
    expect(names(medicineList(index('Alex Example')).active)).toEqual(['Amoxicillin 400 mg/5 mL suspension']);
  });
});

describe('immunizations', () => {
  it('lists each vaccine once with its doses oldest first, the latest given first', () => {
    const { given } = vaccineList(index('Alex Example'));
    expect(given[0]!.name).toBe('Influenza, seasonal, injectable');
    expect(given[0]!.doses.map((d) => d.date)).toEqual(['2024-10-14', '2025-10-20']);
    expect(given.find((v) => v.name === 'Pneumococcal conjugate PCV 13')!.doses).toHaveLength(4);
  });

  it('keeps a dose not given apart', () => {
    const { given, notGiven } = vaccineList(index('Robin Example'));
    expect(names(given)).not.toContain('COVID-19 vaccine');
    expect(notGiven.map((r) => r.display)).toEqual(['COVID-19 vaccine']);
  });
});

describe('status words', () => {
  it('reads FHIR codes, and any unknown one plainly', () => {
    expect([statusText('active'), statusText('on-hold'), statusText('not-done'), statusText('remission')]).toEqual(['Active', 'On hold', 'Not given', 'In remission']);
    expect(statusText('suspended-by-lab')).toBe('Suspended by lab');
    expect(statusText(undefined)).toBeUndefined();
  });
});
