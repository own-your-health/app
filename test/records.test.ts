import { describe, expect, it } from 'vitest';
import { asMoney, bills, claimTotals, claimYourShare, findItem, formatMoney, importFor, medicines, resultSeries, timeline, valueText } from '../src/model/records';
import type { ImportRun, Provenance } from '../src/model/types';
import { demo, personNamed } from './demo-data';

const { household, indexes } = demo();
const robin = indexes.get(personNamed(household, 'Robin Example').id)!;

describe('results', () => {
  it('group one test over time under the source’s name for it', () => {
    const ldl = resultSeries(robin).find((s) => s.name === 'LDL cholesterol')!;
    expect(ldl.points).toHaveLength(4);
    expect(ldl.unit).toBe('mg/dL');
    // Oldest first, as the chart draws them; the latest is the newest.
    expect(ldl.points.map((p) => p.date)).toEqual([...ldl.points.map((p) => p.date)].sort());
    expect(ldl.latest?.date).toBe(ldl.points.at(-1)!.date);
  });

  it('write a quantity with its unit', () => {
    expect(valueText({ value: 104, unit: 'mg/dL' })).toBe('104 mg/dL');
    expect(valueText('positive')).toBe('positive');
    expect(valueText({ value: null })).toBeUndefined();
  });
});

describe('medicines', () => {
  it('list active ones first', () => {
    const groups = medicines(robin);
    expect(groups.length).toBeGreaterThan(0);
    const firstPast = groups.findIndex((g) => !g.active);
    if (firstPast >= 0) expect(groups.slice(firstPast).every((g) => !g.active)).toBe(true);
  });
});

describe('money', () => {
  it('stays a decimal string', () => {
    expect(formatMoney({ amount: '1234.5', currency: 'USD' })).toBe('$1,234.50');
    expect(formatMoney({ amount: '0.1', currency: 'USD' })).toBe('$0.10');
    expect(formatMoney({ amount: '-20', currency: 'USD' })).toBe('−$20.00');
    expect(formatMoney({ amount: '007.25', currency: 'EUR' })).toBe('EUR 7.25');
    expect(formatMoney({ amount: '1234567.891', currency: 'USD' })).toBe('$1,234,567.89');
    expect(asMoney({ amount: 12 })).toBeUndefined();
  });

  it('finds the member’s share among a claim’s totals', () => {
    const claim = robin.records.find((r) => r.kind === 'claim' && claimTotals(r).length > 0)!;
    expect(claimTotals(claim).length).toBeGreaterThan(1);
    expect(claimYourShare(claim)).toMatch(/^Your share \$\d/);
  });

  it('dates a bill by its statement', () => {
    const all = [...indexes.values()].flatMap((i) => bills(i));
    expect(all.length).toBeGreaterThan(0);
    for (const b of all) if (b.statement?.statement_date) expect(b.date).toBe(b.statement.statement_date);
  });
});

describe('items', () => {
  it('find a record, a document or a study by id', () => {
    const r = robin.records[0]!;
    expect(findItem(robin, r.id)).toEqual({ type: 'record', record: r });
    const d = robin.documents[0]!;
    expect(findItem(robin, d.id)).toMatchObject({ type: 'document', document: d });
    expect(findItem(robin, 'r_nothing')).toBeUndefined();
  });

  it('put the timeline newest first', () => {
    const t = timeline(robin).filter((e) => e.date);
    expect(t.map((e) => e.date)).toEqual([...t.map((e) => e.date)].sort().reverse());
  });
});

describe('the import that brought a record in', () => {
  const run = (id: string, at: string, dir: string): ImportRun => ({ id, cli: 'mychart', imported_at: at, source_dir: dir }) as ImportRun;
  const p = { raw_path: 'Robin Example/Records/mychart-example-health/Observation/o1.json', filed_at: '2026-11-10T00:00:00Z' } as Provenance;
  const runs = [
    run('i_1', '2026-11-01T00:00:00Z', 'Robin Example/Records/mychart-example-health'),
    run('i_2', '2026-11-10T00:00:00Z', 'Robin Example/Records/mychart-example-health/'),
    run('i_3', '2026-11-20T00:00:00Z', 'Robin Example/Records/mychart-example-health'),
    run('i_x', '2026-11-10T00:00:00Z', 'Robin Example/Records/mychart-example-health-2'),
  ];

  it('is the first one of that source folder at or after the filing', () => {
    expect(importFor(p, runs)?.id).toBe('i_2');
  });

  it('is the latest one when none came after', () => {
    expect(importFor({ ...p, filed_at: '2026-12-01T00:00:00Z' }, runs)?.id).toBe('i_3');
  });

  it('is unknown without a raw file', () => {
    expect(importFor({ ...p, raw_path: undefined }, runs)).toBeUndefined();
  });
});
