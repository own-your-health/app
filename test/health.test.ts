// Health: what the records can know about each person, their
// current picture, what is worth noticing and what is quiet, and the doctor's
// sheet with private items off unless included.
import { describe, expect, it } from 'vitest';
import type { PersonIndex } from '../src/model/types';
import { careTeam, coverageOf, doctorSheet, healthOf, icdOf, privateOf, trendOf } from '../src/next/health';
import { demo, personNamed } from './demo-data';

const TODAY = '2026-11-22';
const { household, indexes } = demo();
const index = (name: string) => indexes.get(personNamed(household, name).id)!;

describe('coverage', () => {
  it('says what the records can know about each person', () => {
    expect(['Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example'].map((n) => coverageOf(index(n)).kind)).toEqual(['records_and_claims', 'records_and_claims', 'records_and_claims', 'records_only']);
    const sam = index('Sam Example');
    const claimsOnly: PersonIndex = { ...sam, records: sam.records.filter((r) => r.kind === 'claim' || r.kind === 'medication') };
    expect(coverageOf(claimsOnly)).toMatchObject({ kind: 'claims_only', words: 'Claims and papers only' });
    expect(coverageOf({ ...sam, records: [], documents: [] }).kind).toBe('none');
  });
});

describe('a person’s health', () => {
  it('sorts what is current, worth noticing and quiet', () => {
    const h = healthOf(index('Sam Example'), TODAY);
    expect(h.conditions.map((c) => c.name)).toEqual(['Vitamin D deficiency']);
    expect(h.medicines.map((m) => [m.name, privateOf(index('Sam Example'), m.records) ?? null])).toEqual([
      ['Vitamin D3 2,000 unit capsule', null],
      ['Sertraline 50 mg tablet', 'mental_health'],
    ]);
    expect(h.allergies.map((a) => a.name)).toEqual(['Peanuts']);
    expect(h.noticing.map((x) => [x.series.name, x.flag?.level, trendOf(x)])).toEqual([['Hemoglobin', 'low', 'up']]);
    expect(h.quiet.conditions.map((c) => c.name)).toEqual(['Right ankle sprain']);
    expect(h.quiet.inRange.length).toBeGreaterThan(0);
    expect(icdOf(h.conditions[0]!)).toBe('E55.9');
  });

  it('keeps an out-of-range result more than two years old quiet', () => {
    const h = healthOf(index('Sam Example'), '2028-11-01');
    expect(h.noticing).toEqual([]);
    expect(h.quiet.olderFlags.map((x) => x.series.name)).toEqual(['Hemoglobin']);
  });
});

describe('the doctor’s sheet', () => {
  it('leaves private items off unless they are included, and counts them', () => {
    const off = doctorSheet(index('Sam Example'), TODAY, false);
    expect(off.medicines.map((m) => m.name)).toEqual(['Vitamin D3 2,000 unit capsule']);
    // The private medicine, and the doctor known only from it.
    expect(off.careTeam.map((m) => m.name)).not.toContain('Dr. Morgan Placeholder');
    expect(off.privateLeft).toBe(2);
    const on = doctorSheet(index('Sam Example'), TODAY, true);
    expect(on.medicines.map((m) => m.name)).toEqual(['Sertraline 50 mg tablet', 'Vitamin D3 2,000 unit capsule']);
    expect(on.careTeam.map((m) => m.name)).toContain('Dr. Morgan Placeholder');
    expect(on.privateLeft).toBe(0);
  });

  it('names the care team: who was seen in two years, newest first, and who prescribes current medicines', () => {
    const team = careTeam(index('Sam Example'), TODAY);
    expect(team.find((m) => m.name === 'Dr. Casey Placeholder')).toMatchObject({ last: '2026-05-20', place: 'Example Health Orthopedics', prescribes: ['Vitamin D3 2,000 unit capsule'] });
    expect(team.find((m) => m.name === 'Dr. Morgan Placeholder')).toMatchObject({ prescribes: ['Sertraline 50 mg tablet'] });
    const dated = team.filter((m) => m.last).map((m) => m.last!);
    expect(dated).toEqual([...dated].sort().reverse());
    // Two years on, nobody was seen: only the prescribers of current medicines remain.
    expect(careTeam(index('Sam Example'), '2028-11-01').every((m) => !m.last && m.prescribes.length)).toBe(true);
  });

  it('splits vital signs from lab tests, both from the last two years', () => {
    // Three weights are one test: the sheet gives its newest.
    const jamie = doctorSheet(index('Jamie Example'), TODAY, false);
    expect(jamie.vitals.map((x) => [x.series.name, x.latest.date?.slice(0, 10)])).toEqual([['Weight', '2026-11-19']]);
    expect(jamie.labs.map((x) => x.series.name)).toEqual(['Bilirubin']);
    // Alex's newest weight is from January, inside the two years.
    expect(doctorSheet(index('Alex Example'), TODAY, false).vitals.map((x) => x.series.name)).toEqual(['Weight']);
    expect(doctorSheet(index('Sam Example'), TODAY, false).labs.map((x) => x.series.name)).toContain('Hemoglobin');
  });
});
