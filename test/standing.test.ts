import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FolderError } from '../src/model/parse';
import { groupOn, parseStanding, saidOnLine, sourceName, standingLists, type Line, type StandingKind } from '../src/model/standing';

// medrec's own fixture for readers, unmodified (tests/fixtures/standing/ in
// its repository), and the lists it says a reader makes of it.
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/standing/medrec/${name}`, import.meta.url), 'utf8'));
interface Case {
  why: string;
  kind: StandingKind;
  day: string;
  hidden: string[];
  lists: { current?: Shape[]; on_hold?: Shape[]; ended_by_date?: Shape[]; in_error?: number; without_problem_list?: number[] };
}
interface Shape {
  records: string[];
  against?: string[];
  differs?: boolean;
  filled?: { record: string; date: string };
  unheard?: number[];
}
const cases = read('lists.json') as { person: string; cases: Case[] };
const raw = read('standing.json') as Record<string, unknown>;
const person = raw.person as string;
const st = parseStanding(raw, person);

/** A line as the fixture writes it: what is empty or false is left out. */
const shape = (l: Line): Shape => ({
  records: l.records,
  ...(l.against.length ? { against: l.against } : {}),
  ...(l.differs ? { differs: true } : {}),
  ...(l.filled ? { filled: l.filled as Shape['filled'] } : {}),
  ...(l.unheard.length ? { unheard: l.unheard } : {}),
});

describe('medrec’s reader cases', () => {
  it('are all here', () => {
    expect(cases.cases).toHaveLength(11);
  });

  it.each(cases.cases.map((c) => [c.why, c] as const))('%s', (_, c) => {
    const l = standingLists(st, c.kind, c.day, (id) => !c.hidden.includes(id));
    expect({ current: l.current.map(shape), on_hold: l.onHold.map(shape), ended_by_date: l.endedByDate.map(shape), in_error: l.inError, without_problem_list: l.withoutProblemList }).toEqual({
      current: c.lists.current ?? [],
      on_hold: c.lists.on_hold ?? [],
      ended_by_date: c.lists.ended_by_date ?? [],
      in_error: c.lists.in_error ?? 0,
      without_problem_list: c.lists.without_problem_list ?? [],
    });
  });

  it('leave each record in one group, or in none when it is entered in error', () => {
    for (const kind of ['condition', 'allergy', 'medication'] as const) {
      const l = standingLists(st, kind, '2024-06-15', () => true);
      const ids = [...l.current, ...l.onHold, ...l.endedByDate, ...l.rest].flatMap((x) => x.records);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(st.order.get(kind)!.filter((id) => st.records.get(id)!.is !== 'error').sort());
    }
  });
});

describe('a person’s standing', () => {
  it('names a source, or says it has no name', () => {
    expect([0, 4, 9].map((n) => sourceName(st, n))).toEqual(['Example Health', 'a source with no name', 'a source with no name']);
  });

  it('gives what each source says on a line, each word once, and what says otherwise', () => {
    const current = standingLists(st, 'condition', '2024-06-15', () => true).current;
    const says = (first: string) => saidOnLine(st, current.find((l) => l.records[0] === first)!).map((w) => [sourceName(st, w.source), w.status, w.read]);
    expect(says('r_bothsayaaaaaaaaaaaaa')).toEqual([
      ['Example Health', 'active', '2024-05-02'],
      ['Sample Clinic East', 'resolved', '2024-05-03'],
    ]);
    expect(says('r_tworecordsaaaaaaaaaa')).toEqual([
      ['Example Health', 'active', '2024-05-02'],
      ['Sample Clinic East', 'resolved', '2024-05-03'],
    ]);
    const one = st.records.get('r_plainaaaaaaaaaaaaaaa')!;
    const twice = { ...st, records: new Map([...st.records, ['r_same', one]]) };
    expect(saidOnLine(twice, { records: ['r_plainaaaaaaaaaaaaaaa', 'r_same', 'r_gone'], against: [] })).toEqual(one.words);
  });

  it('is refused when it is not one, is another person’s or is a newer layout', () => {
    for (const x of [null, [], 'x', { ...raw, schema: 'medrec-standing/v2' }, { ...raw, person: 'p_other' }, { ...raw, records: [] }]) expect(() => parseStanding(x, person)).toThrow(FolderError);
  });

  it('keeps what it knows: a kind it does not is left out, an is it does not is current, and what is no word is none', () => {
    const odd = parseStanding(
      {
        schema: 'medrec-standing/v1',
        person,
        sources: ['Example Health', 7, '  '],
        order: { condition: ['r_b', 'r_gone', 'r_m', 'r_b'], other: ['r_x'] },
        records: {
          r_x: { kind: 'other', is: 'current', line: 'x', words: [] },
          r_a: { kind: 'condition', is: 'later', words: [{ source: 0, is: 'later', status: 'paused' }, { source: -1, is: 'ended' }, { source: 1.5 }, 'x', { is: 'ended' }], unheard: [1, 'x', -2] },
          r_b: { kind: 'condition', is: 'ended', line: 'x', words: 'x', filled: 'x' },
          r_m: { kind: 'medication', is: 'current', line: 'x', until: '2024-01-01', filled: [{ date: '2024-02-01' }, { record: 'r_f' }, 'x'] },
          r_n: null,
        },
        in_error: { document: ['d_a', 7] },
        no_problem_list: [{ source: 'x', records: ['r_a'] }, { source: 0 }],
      },
      person,
    );
    expect(odd.sources).toEqual(['Example Health', null, null]);
    expect([...odd.records.keys()]).toEqual(['r_a', 'r_b', 'r_m']);
    expect(odd.order.get('condition')).toEqual(['r_b', 'r_a']);
    expect(odd.records.get('r_a')).toEqual({ kind: 'condition', is: 'current', line: 'r_a', words: [{ source: 0, is: 'current', status: 'paused' }], unheard: [1], differs: false, filled: [] });
    expect([odd.records.get('r_b')!.words, odd.records.get('r_m')!.filled]).toEqual([[], [{ record: 'r_f' }]]);
    expect([odd.inError.get('document'), odd.noProblemList]).toEqual([['d_a'], [{ source: 0, records: [] }]]);
    expect(standingLists(odd, 'allergy', '2024-06-15', () => true)).toEqual({ current: [], onHold: [], endedByDate: [], rest: [], all: [], inError: 0, withoutProblemList: [] });
  });

  it('says what differs on a line by the sources that say otherwise, and names each not heard once', () => {
    const of = (is: string, source: number, more: object = {}) => ({ kind: 'condition', is, line: 'x', words: [{ source, is, status: is }], ...more });
    const made = parseStanding(
      {
        schema: 'medrec-standing/v1',
        person,
        sources: ['Example Health', 'Sample Clinic East'],
        order: { condition: ['r_a', 'r_b', 'r_c', 'r_d', 'r_e'] },
        records: { r_a: of('current', 0, { unheard: [2] }), r_b: of('current', 0, { unheard: [2, 3] }), r_c: of('ended', 1), r_d: of('visit', 1), r_e: of('error', 1) },
      },
      person,
    );
    expect(standingLists(made, 'condition', '2024-06-15', () => true).current).toEqual([{ records: ['r_a', 'r_b'], against: ['r_c'], differs: true, unheard: [2, 3] }]);
  });

  it('puts a medicine on its last day with the current, and the day after with those ended by their date', () => {
    const ends = st.records.get('r_endsaaaaaaaaaaaaaaaa')!;
    expect([groupOn(ends, '2024-03-31'), groupOn(ends, '2024-04-01'), groupOn({ ...ends, is: 'draft' }, '2024-04-01')]).toEqual(['current', 'endedByDate', 'rest']);
  });
});
