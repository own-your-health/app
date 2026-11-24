// Events, the app's unit of care: claims, the portal's visits and papers
// grouped into what happened, by the rules the events stand-in follows until
// medrec writes events. Over an invented person whose records give each rule
// a case of its own.
import { describe, expect, it } from 'vitest';
import { eventConfidence, eventMoney, eventOf, kindText, type CareEvent } from '../src/next/event';
import { careEvents } from '../src/next/grouping';
import { parseIndex } from '../src/model/parse';
import type { Household } from '../src/model/types';
import { demo, personNamed } from './demo-data';
import { fixture } from './helpers';

const PERSON = 'p_fixtureeventsaaaaaaa';
const index = parseIndex(fixture('folder/index-events.json'), PERSON);
const household: Household = {
  schema: 'medrec-household/v1',
  format: 1,
  folder_id: 'folder',
  rev: 1,
  people: [{ id: PERSON, name: 'Casey Example', folder: 'Casey Example' }],
  organizations: [{ id: 'example-clinic', name: 'Example Clinic' }],
  sources: [],
};
const events = careEvents(index, household, '2026-07-01');
const on = (start: string) => events.filter((e) => e.start === start);
const providers = (e: CareEvent) => e.claims.map((c) => [c.provider, c.role, c.rule, c.confidence]);

describe('a hospital visit', () => {
  const [er] = on('2026-03-02');

  it('is the hospital’s claim and every doctor’s, lab’s and imaging claim within its days', () => {
    expect(on('2026-03-02')).toHaveLength(1);
    expect([er!.kind, er!.start, er!.end, kindText(er!), er!.place]).toEqual(['er', '2026-03-02', '2026-03-03', 'Emergency room · overnight', 'Example Hospital']);
    expect(providers(er!)).toEqual([
      ['Example Hospital', 'facility', 'C1', 'sure'],
      ['Example Emergency Doctors', 'hospital', 'C2', 'sure'],
      ['Example Lab', 'ancillary', 'C2', 'sure'],
      ['Example Imaging', 'ancillary', 'C2', 'sure'],
    ]);
  });

  it('costs what its claims’ totals say, never a line they leave out, and the steps add up', () => {
    const m = eventMoney(er!);
    expect([m.billed, m.discount, m.planPaid, m.share, m.adds]).toEqual([275000, 183000, 64000, 28000, true]);
    expect(m.reasons).toEqual([
      { name: 'copay', cents: 20000 },
      { name: 'deductible', cents: 8000 },
    ]);
    expect(m.charges.map((c) => [c.provider, c.role, c.share])).toEqual([
      ['Example Hospital', 'The hospital', 20000],
      ['Example Emergency Doctors', 'Emergency doctor', 8000],
      ['Example Lab', 'Lab', 0],
      ['Example Imaging', 'Imaging', 0],
    ]);
  });

  it('takes its hospital’s papers from its days, and a bill sent later for exactly its share', () => {
    expect(er!.papers.map((p) => [p.doc.title, p.rule, p.confidence])).toEqual([
      ['Statement from Example Hospital', 'D3s', 'sure'],
      ['Discharge instructions', 'D2', 'sure'],
    ]);
  });

  it('is a stay when only a hospital doctor’s claims show it, on days next to each other', () => {
    const [stay] = on('2026-06-01');
    expect([stay!.kind, stay!.end, stay!.noFacility, kindText(stay!)]).toEqual(['stay', '2026-06-02', true, 'Hospital stay · overnight']);
    expect(providers(stay!)).toEqual([
      ['Example Hospitalists', 'hospital', 'C4', 'sure'],
      ['Example Hospitalists', 'hospital', 'C4', 'sure'],
    ]);
  });
});

describe('a portal visit', () => {
  it('joins the claims of its day, surely when a claim names its clinic, and takes what it recorded', () => {
    const [visit] = on('2026-04-10');
    expect(on('2026-04-10')).toHaveLength(1);
    expect([visit!.title, visit!.what, visit!.visits.map((v) => [v.rule, v.confidence])]).toEqual(['Office visit', 'Annual physical', [['E3n', 'sure']]]);
    expect(providers(visit!)).toEqual([
      ['Example Clinic', 'office', 'C5', 'sure'],
      ['Example Lab', 'ancillary', 'C5j', 'likely'],
    ]);
    expect(visit!.recorded.map((r) => r.display)).toEqual(['Glucose']);
    expect(eventConfidence(visit!)).toBe('likely');
  });

  it('joins as likely when only the day ties it to a claim', () => {
    const [visit] = on('2026-04-20');
    expect([visit!.title, visit!.what, visit!.visits[0]!.rule, visit!.visits[0]!.confidence, visit!.claims[0]!.provider]).toEqual(['Office visit', 'Follow-up', 'E3', 'likely', 'A Sample']);
  });

  it('stands alone when no claim is for it', () => {
    const [visit] = on('2026-04-25');
    expect([visit!.title, visit!.what, visit!.kind, visit!.claims.length, visit!.visits[0]!.rule]).toEqual(['Office visit', 'Video visit', 'office', 0, 'E0']);
    expect(eventMoney(visit!).share).toBeUndefined();
  });
});

describe('a day of claims', () => {
  it('is one tests event when only labs and imaging billed, with a paper from a practice on no claim, as likely', () => {
    const [tests] = on('2026-05-05');
    expect([tests!.kind, tests!.title, providers(tests!).map((p) => p[0])]).toEqual(['tests', 'Tests', ['Example Lab', 'Example Imaging']]);
    expect(tests!.papers.map((p) => [p.doc.title, p.rule, p.confidence])).toEqual([['Receipt', 'D3', 'likely']]);
  });

  it('keeps a lab apart, unsure, when two office visits that day could have ordered it', () => {
    const day = on('2026-05-12');
    expect(day.map((e) => [e.kind, e.claims.map((c) => c.provider)]).sort()).toEqual([
      ['office', ['Example Clinic']],
      ['office', ['Example Skin Care']],
      ['tests', ['Example Lab']],
    ]);
    const tests = day.find((e) => e.kind === 'tests')!;
    expect([tests.doubt, eventConfidence(tests)]).toEqual(['2 office visits that day could have ordered these', 'unsure']);
  });

  it('is a vaccine when only shots were billed', () => {
    const [shot] = on('2026-06-20');
    expect([shot!.kind, shot!.title, kindText(shot!), eventMoney(shot!).share]).toEqual(['vaccine', 'Flu vaccine and vaccine given', 'Vaccine', 0]);
  });

  it('is a fill at a pharmacy', () => {
    const [fill] = on('2026-06-10');
    expect([fill!.kind, fill!.title, eventMoney(fill!).share]).toEqual(['fill', 'Amoxicillin 500 mg capsule', 1000]);
  });
});

describe('every event', () => {
  it('holds each claim once, newest first', () => {
    const claims = events.flatMap((e) => e.claims.map((c) => c.record.id));
    expect(new Set(claims).size).toBe(claims.length);
    expect(claims.sort()).toEqual(index.records.filter((r) => r.kind === 'claim').map((r) => r.id).sort());
    expect(events.map((e) => e.start)).toEqual([...events.map((e) => e.start)].sort().reverse());
  });

  it('is found from any record or paper in it', () => {
    const er = on('2026-03-02')[0]!;
    expect(eventOf(events, er.claims[2]!.record.id)).toBe(er);
    expect(eventOf(events, er.papers[0]!.doc.id)).toBe(er);
    expect(eventOf(events, on('2026-04-10')[0]!.recorded[0]!.id)).toBe(on('2026-04-10')[0]);
  });
});

describe('the sample', () => {
  const { household: hh, indexes } = demo();
  const sam = personNamed(hh, 'Sam Example');
  const samEvents = careEvents(indexes.get(sam.id)!, hh, '2026-11-22');

  it('makes Sam’s night in the emergency room one event from four billers, whose steps add up to what Sam owes', () => {
    const er = samEvents.find((e) => e.kind === 'er')!;
    expect([kindText(er), er.start, er.end, er.claims.length, new Set(er.claims.map((c) => c.provider)).size]).toEqual(['Emergency room · overnight', '2026-09-12', '2026-09-13', 5, 4]);
    const m = eventMoney(er);
    expect([m.billed, m.discount, m.planPaid, m.share, m.adds]).toEqual([477900, 339580, 103680, 34640, true]);
    expect(er.papers.map((p) => p.doc.doc_type).sort()).toEqual(['bill', 'discharge_summary']);
  });
});
