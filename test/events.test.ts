// Events, the app's unit of care: claims, the portal's visits and papers
// grouped into what happened, by the rules the events stand-in follows until
// medrec writes events. Over an invented person whose records give each rule
// a case of its own.
import { describe, expect, it } from 'vitest';
import { eventConfidence, eventMoney, eventOf, kindText, type CareEvent } from '../src/next/event';
import { careEvents } from '../src/next/grouping';
import { documentTitle } from '../src/model/records';
import { demo, personNamed } from './demo-data';
import { recordsOf, RULES } from './rules';

const index = recordsOf('Noor');
const events = careEvents(index, RULES, '2026-07-01');
const on = (start: string) => events.filter((e) => e.start === start);
/** The same without medrec's own links from a claim to its visit, as before 0.5.0. */
const unlinked = careEvents({ ...index, records: index.records.map((r) => ({ ...r, fields: Object.fromEntries(Object.entries(r.fields).filter(([k]) => k !== 'visit')) })) }, RULES, '2026-07-01');
const providers = (e: CareEvent) => e.claims.map((c) => [c.provider, c.role, c.rule, c.confidence]);

describe('a hospital visit', () => {
  const [stay] = on('2026-01-19');

  it('is the hospital’s claim and every doctor’s and lab’s claim within its days', () => {
    expect(on('2026-01-19')).toHaveLength(1);
    expect([stay!.kind, stay!.start, stay!.end, kindText(stay!), stay!.place]).toEqual(['stay', '2026-01-19', '2026-01-21', 'Hospital stay · 2 nights', 'Example Hospital']);
    expect(providers(stay!)).toEqual([
      ['Example Hospital', 'facility', 'C1', 'sure'],
      ['Sample Ward Doctors', 'hospital', 'C2', 'sure'],
      ['Example Lab', 'ancillary', 'C2', 'sure'],
      ['Sample Ward Doctors', 'hospital', 'C2', 'sure'],
    ]);
  });

  it('costs what its claims’ totals say, never a line they leave out, and the steps add up', () => {
    const m = eventMoney(stay!);
    expect([m.billed, m.discount, m.planPaid, m.share, m.adds]).toEqual([583500, 326850, 165950, 90700, true]);
    expect(m.reasons).toEqual([
      { name: 'deductible', cents: 50000 },
      { name: 'coinsurance', cents: 40700 },
    ]);
    expect(m.charges.map((c) => [c.provider, c.role, c.share])).toEqual([
      ['Example Hospital', 'The hospital', 84000],
      ['Sample Ward Doctors', 'Hospital doctor', 6700],
      ['Example Lab', 'Lab', 0],
    ]);
  });

  it('takes its hospital’s papers from its days, and a bill sent later for exactly its share', () => {
    expect(stay!.papers.map((p) => [documentTitle(p.doc), p.rule, p.confidence])).toEqual([
      ['Statement from Example Hospital.pdf', 'D3s', 'sure'],
      ['Leaving the hospital.pdf', 'D2', 'sure'],
    ]);
  });

  it('is a trip to the emergency room by its hospital’s codes, with the reading of its X-ray', () => {
    const [er] = on('2026-06-14');
    expect([er!.kind, er!.end, kindText(er!)]).toEqual(['er', '2026-06-14', 'Emergency room']);
    expect(providers(er!)).toEqual([
      ['Example Hospital', 'facility', 'C1', 'sure'],
      ['Example Imaging', 'ancillary', 'C2', 'sure'],
    ]);
  });

  it('is a stay when only a hospital doctor’s claims show it, on days next to each other', () => {
    const [rounds] = on('2026-05-03');
    expect([rounds!.kind, rounds!.end, rounds!.noFacility, kindText(rounds!)]).toEqual(['stay', '2026-05-04', true, 'Hospital stay · overnight']);
    expect(providers(rounds!)).toEqual([
      ['Sample Lung Group', 'hospital', 'C4', 'sure'],
      ['Sample Lung Group', 'hospital', 'C4', 'sure'],
    ]);
  });
});

describe('a portal visit', () => {
  it('joins the claims of its day, surely when a claim names its clinic, and takes what it recorded', () => {
    const found = unlinked.filter((e) => e.start === '2026-02-10');
    expect(found).toHaveLength(1);
    const [visit] = found;
    expect([visit!.title, visit!.what, visit!.visits.map((v) => [v.rule, v.confidence])]).toEqual(['Office visit', 'Travel advice', [['E3n', 'sure']]]);
    expect(providers(visit!)).toEqual([
      ['Example Clinic', 'office', 'C5', 'sure'],
      ['Example Lab', 'ancillary', 'C5j', 'likely'],
    ]);
    expect(visit!.recorded.map((r) => r.display)).toEqual(['Sodium']);
    expect(eventConfidence(visit!)).toBe('likely');
  });

  it('joins as likely when only the day ties it to a claim', () => {
    const [visit] = unlinked.filter((e) => e.start === '2026-02-24');
    expect([visit!.title, visit!.what, visit!.visits[0]!.rule, visit!.visits[0]!.confidence, visit!.claims[0]!.provider]).toEqual(['Office visit', 'Medicine review', 'E3', 'likely', 'B Sample']);
  });

  it('joins the claims medrec links to it, whatever their names', () => {
    for (const day of ['2026-02-10', '2026-02-24']) expect(on(day).map((e) => e.visits.map((v) => [v.rule, v.confidence]))).toEqual([[['M', 'sure']]]);
  });

  it('stands alone when no claim is for it', () => {
    const [visit] = on('2026-03-17');
    expect([visit!.title, visit!.what, visit!.kind, visit!.claims.length, visit!.visits[0]!.rule]).toEqual(['Office visit', 'Video visit', 'office', 0, 'E0']);
    expect(eventMoney(visit!).share).toBeUndefined();
  });
});

describe('a day of claims', () => {
  it('is one tests event when only labs and imaging billed, with a paper from a practice on no claim, as likely', () => {
    const [tests] = on('2026-04-02');
    expect([tests!.kind, tests!.title, providers(tests!).map((p) => p[0]).sort()]).toEqual(['tests', 'Tests', ['Example Imaging', 'Example Lab']]);
    expect(tests!.papers.map((p) => [documentTitle(p.doc), p.rule, p.confidence])).toEqual([['Receipt.pdf', 'D3', 'likely']]);
  });

  it('keeps a lab apart, unsure, when two office visits that day could have ordered it', () => {
    const day = on('2026-04-15');
    expect(day.map((e) => [e.kind, e.claims.map((c) => c.provider)]).sort()).toEqual([
      ['office', ['Example Clinic']],
      ['office', ['Example Eye Doctors']],
      ['tests', ['Example Lab']],
    ]);
    const tests = day.find((e) => e.kind === 'tests')!;
    expect([tests.doubt, eventConfidence(tests)]).toEqual(['2 office visits that day could have ordered these', 'unsure']);
  });

  it('is a vaccine when only shots were billed, named for the vaccine and not the line for giving it', () => {
    const [shot] = on('2026-05-20');
    expect([shot!.kind, shot!.title, kindText(shot!), eventMoney(shot!).share]).toEqual(['vaccine', 'Tdap vaccine', 'Vaccine', 0]);
  });

  it('is a fill at a pharmacy', () => {
    const [fill] = on('2026-06-02');
    expect([fill!.kind, fill!.title, eventMoney(fill!).share]).toEqual(['fill', 'Cephalexin 500 mg capsule', 800]);
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
    const stay = on('2026-01-19')[0]!;
    expect(eventOf(events, stay.claims[2]!.record.id)).toBe(stay);
    expect(eventOf(events, stay.papers[0]!.doc.id)).toBe(stay);
    expect(eventOf(events, on('2026-02-10')[0]!.recorded[0]!.id)).toBe(on('2026-02-10')[0]);
  });
});

describe('the sample', () => {
  const { household: hh, indexes } = demo();
  const sam = personNamed(hh, 'Sam Example');
  const samEvents = careEvents(indexes.get(sam.id)!, hh, '2026-11-22');

  it('makes Sam’s endoscopy one event from three billers, whose steps add up to what Sam owes', () => {
    const scope = samEvents.find((e) => e.kind === 'outpatient')!;
    expect([kindText(scope), scope.start, scope.end, scope.claims.length, new Set(scope.claims.map((c) => c.provider)).size]).toEqual(['Hospital visit', '2026-09-16', '2026-09-16', 3, 3]);
    const m = eventMoney(scope);
    expect([m.billed, m.discount, m.planPaid, m.share, m.adds]).toEqual([338000, 214100, 102510, 21390, true]);
    expect(scope.papers.map((p) => p.doc.doc_type).sort()).toEqual(['bill', 'discharge_summary']);
  });
});
