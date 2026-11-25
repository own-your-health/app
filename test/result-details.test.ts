import { describe, expect, it } from 'vitest';
import { withoutAbout } from '../src/model/aboutAnother';
import { isOutOfRange, resultFlag } from '../src/model/flags';
import { resultGroups } from '../src/model/panels';
import { isHeading, isQuantity, memberIds, partSeries, readingOf, recordDetail, resultParts, resultPoint, resultReading, resultSeries } from '../src/model/records';
import { resultContext, verdict } from '../src/model/result';
import { find } from '../src/model/search';
import type { Json, JsonObject, MedRecord, PersonIndex } from '../src/model/types';
import { entriesByKind } from '../src/ui/search';
import { demo } from './demo-data';
import { ROBIN } from './sample';

// What medrec 0.9.10 and later keeps of a result: a bound, its parts, and the
// results a panel lists. Over invented results.

const { household, indexes } = demo();
const robin = indexes.get(ROBIN)!;
const ID = (n: number) => `r_${'abcdefghijklmnopqrst'.slice(0, 19)}${'abcdefgh'[n]}`;
function result(n: number, display: string, date: string, fields: Record<string, Json>, code?: string): MedRecord {
  return { id: ID(n), kind: 'result', key: `result|${display}|${date}`, date, ...(code ? { code: { system: 'http://loinc.org', code, display } } : {}), display, status: 'final', fields, documents: [], provenance: robin.records[0]!.provenance };
}
const idx = (...records: MedRecord[]): PersonIndex => ({ ...robin, records });

describe('a quantity with a comparator', () => {
  const read = (comparator: Json, value: Json = 0.5) => resultReading({ value: { value, unit: 'ng/mL', comparator } });

  it('is a bound: shown with its sign, and never a number to plot', () => {
    expect(read('<')).toEqual({ bound: { op: '<', n: 0.5 }, unit: 'ng/mL', text: '<0.5 ng/mL' });
    expect(read(' < ')).toEqual(read('<'));
    expect(['<=', '>', '>='].map((c) => [read(c).bound?.op, read(c).text])).toEqual([
      ['<=', '<=0.5 ng/mL'],
      ['>', '>0.5 ng/mL'],
      ['>=', '>=0.5 ng/mL'],
    ]);
  });

  it('is only text where the comparator is none the app knows, and a number where it has none', () => {
    expect(read('ad')).toEqual({ unit: 'ng/mL', text: 'ad 0.5 ng/mL' });
    expect([read(null), read(' ')]).toEqual([
      { value: 0.5, unit: 'ng/mL', text: '0.5 ng/mL' },
      { value: 0.5, unit: 'ng/mL', text: '0.5 ng/mL' },
    ]);
    expect(read('<', '1/2')).toEqual({ unit: 'ng/mL', text: '<1/2 ng/mL' });
  });

  it('reads against the range only where every value it allows is on one side', () => {
    const flag = (reference_range: string) => resultFlag(resultPoint(result(0, 'A', '2026-01-02', { value: { value: 0.5, unit: 'ng/mL', comparator: '<' }, reference_range })))?.label;
    expect([flag('0-4 ng/mL'), flag('<4 ng/mL'), flag('1-4 ng/mL')]).toEqual([undefined, 'In range', 'Below range']);
  });

  it('is a quantity, as one with no unit or no number is, and a part of a result is none', () => {
    const none: JsonObject[] = [{}, { unit: 'mg' }, { value: 4, other: 1 }, part('0-0', 'Sample', 'Pale'), part('0-0', 'Sample', { value: 4 })];
    const some: JsonObject[] = [{ value: 4, unit: 'mg', comparator: '<' }, { value: '4' }, { value: null, unit: 'mg' }];
    expect([some.every(isQuantity), none.map(isQuantity)]).toEqual([true, [false, false, false, false, false]]);
  });

  it('is in the words a search reads', () => {
    const r = result(0, 'A', '2026-01-02', { amount: { value: 0.5, unit: 'ng/mL', comparator: '<' } });
    expect(find([{ person: ROBIN, index: idx(r), text: null }], '<0.5').hits.map((x) => x.id)).toEqual([r.id]);
  });
});

const part = (code: string | null, display: string | null, value: Json, more: Record<string, Json> = {}) => ({ code: { ...(code ? { system: 'http://loinc.org', code } : {}), ...(display ? { display } : {}) }, value, ...more });
const pressure = (n: number, date: string, top: number, low: number, more: Record<string, Json> = {}) =>
  result(n, 'Blood pressure', date, { value: { value: `${top}/${low}`, unit: 'mmHg' }, components: [part('8480-6', 'Systolic', { value: top, unit: 'mmHg' }, more), part('8462-4', 'Diastolic', { value: low, unit: 'mmHg' })], category: 'Vital signs' }, '85354-9');

describe('a result of several parts', () => {
  const [first, second] = [pressure(0, '2026-01-02', 118, 76), pressure(1, '2026-03-04', 124, 80)];

  it('is its text, and no number', () => {
    const p = resultPoint(second!);
    expect([p.text, p.value, p.bound, p.unit]).toEqual(['124/80 mmHg', undefined, undefined, 'mmHg']);
    expect(recordDetail(second!)).toBe('124/80 mmHg');
    expect(resultPoint(result(0, 'A', '2026-01-02', { value: { value: 4 } })).parts).toBeUndefined();
  });

  it('has each part in its source’s order, and leaves out one with no name and one that is none', () => {
    const r = { ...first!, fields: { ...first!.fields, components: [...(first!.fields.components as Json[]), part('0-0', null, 'Sample'), part(null, 'Named', 'Word'), part(null, null, 'x'), 'x', { value: 1 }] } };
    expect(resultParts(r).map((x) => [x.key, x.name, x.point.text])).toEqual([
      ['http://loinc.org|8480-6', 'Blood pressure, top number', '118 mmHg'],
      ['http://loinc.org|8462-4', 'Blood pressure, bottom number', '76 mmHg'],
      ['http://loinc.org|0-0', '0-0', 'Sample'],
      ['display|named', 'Named', 'Word'],
    ]);
    expect(resultParts({ ...first!, fields: { components: 'x' } })).toEqual([]);
    expect(resultParts({ ...first!, kind: 'procedure' })).toEqual([]);
  });

  it('is searched by its parts’ names and values', () => {
    const search = (q: string) => find([{ person: ROBIN, index: idx(first!), text: null }], q).hits.length;
    expect([search('diastolic'), search('8462-4'), search('mean')]).toEqual([1, 1, 0]);
    const words = { ...first!, fields: { components: [part('0-0', 'Sample color', 'Pale amber')] } };
    expect(find([{ person: ROBIN, index: idx(words), text: null }], 'color amber').hits).toHaveLength(1);
  });

  it('has a line for each part over time, oldest first, of the results of its own test', () => {
    const other = { ...pressure(2, '2026-02-03', 99, 66), code: undefined, display: 'Another reading' };
    expect(partSeries(idx(second!, other, first!), second!).map((s) => [s.name, s.unit, s.points.map((p) => [p.date, p.value])])).toEqual([
      ['Blood pressure, top number', 'mmHg', [['2026-01-02', 118], ['2026-03-04', 124]]],
      ['Blood pressure, bottom number', 'mmHg', [['2026-01-02', 76], ['2026-03-04', 80]]],
    ]);
  });

  it('has no line of a part it names twice, and no point of a result that does', () => {
    const twice = { ...second!, fields: { ...second!.fields, components: [...(second!.fields.components as Json[]), part('8480-6', 'Systolic', { value: 130, unit: 'mmHg' })] } };
    expect(partSeries(idx(first!, twice), twice).map((s) => s.name)).toEqual(['Blood pressure, bottom number']);
    expect(partSeries(idx(first!, twice), first!).map((s) => [s.name, s.points.length])).toEqual([
      ['Blood pressure, top number', 1],
      ['Blood pressure, bottom number', 2],
    ]);
  });

  it('is out of range where a part is and nothing is said of the whole, a critical part first', () => {
    const high = pressure(0, '2026-01-02', 150, 76, { interpretation: 'High', reference_range: '90-120 mmHg' });
    expect(resultFlag(resultPoint(high))).toMatchObject({ level: 'high', label: 'High' });
    expect(verdict(resultPoint(high))).toEqual({ text: 'Blood pressure, top number: Above the lab’s range of 90–120 mmHg.', outOfRange: true, flag: resultFlag(resultPoint(high)) });
    const [top, low] = high.fields.components as Record<string, Json>[];
    const critical = { ...high, fields: { ...high.fields, components: [top!, { ...low!, interpretation: 'LL' }] as Json } };
    expect(resultFlag(resultPoint(critical))).toMatchObject({ level: 'low', critical: true });
    expect(verdict(resultPoint(critical)).text).toBe('Blood pressure, top number: Above the lab’s range of 90–120 mmHg. Blood pressure, bottom number: The lab marked it critical low.');
    // What the source says of the whole stands.
    const said = { ...high, fields: { ...high.fields, interpretation: 'Normal' } };
    expect([isOutOfRange(resultFlag(resultPoint(said))), verdict(resultPoint(said)).outOfRange]).toEqual([false, false]);
  });

  it('says the range of the whole where it has one and no part is outside its own', () => {
    const of = (top: number) => {
      const r = pressure(0, '2026-01-02', top, 76, { reference_range: '90-120 mmHg' });
      return verdict(resultPoint({ ...r, fields: { ...r.fields, reference_range: '<120/80 mmHg' } })).text;
    };
    expect([of(110), of(150)]).toEqual(['The lab’s range is <120/80 mmHg.', 'Blood pressure, top number: Above the lab’s range of 90–120 mmHg.']);
  });

  it('says where no part is outside a range, and where none has one', () => {
    expect(verdict(resultPoint(pressure(0, '2026-01-02', 110, 76, { reference_range: '90-120 mmHg' }))).text).toBe('No part that has a range is outside it.');
    expect(verdict(resultPoint(first!)).text).toBe('The lab gave no range for this result.');
  });

  it('is a vital sign by the code of its pair', () => {
    const r = pressure(0, '2026-01-02', 110, 76);
    expect(resultGroups(idx({ ...r, fields: { ...r.fields, category: 'Laboratory' } })).map((g) => g.name)).toEqual(['Vital signs']);
  });
});

describe('a panel', () => {
  const a = result(0, 'Birch', '2026-01-02', { value: 'Negative' });
  const b = result(1, 'Maple', '2026-01-02', { value: 'Positive' });
  const apart = result(2, 'Oat', '2026-01-02', { value: 'Negative' });
  const panel = result(3, 'Sample pollen panel', '2026-01-02', { members: [b.id, 'r_gone', a.id] });

  it('is a heading where its source lists results for it, filed or not, and it has no value', () => {
    const lists = { 'Robin Example/Records/clinic/Observation/panel.json': ['Robin Example/Records/clinic/Observation/b.json'] };
    const bare: MedRecord = { ...panel, fields: {} };
    expect([{ ...bare, lists }, panel, { ...bare, fields: { members: [] } }, { ...panel, fields: { ...panel.fields, value: null } }, { ...panel, fields: { ...panel.fields, value: '' } }].map(isHeading)).toEqual([true, true, true, true, true]);
    expect([bare, { ...bare, lists: {} }, { ...bare, lists: 'x' }, { ...panel, fields: { ...panel.fields, value: 'Negative' } }, { ...bare, lists, fields: { value: { value: 0, unit: 'U/mL' } } }, { ...panel, kind: 'report', lists }].map(isHeading)).toEqual([false, false, false, false, false, false]);
  });

  it('is never a test', () => {
    expect(resultSeries(idx(a, panel, b)).map((s) => s.name).sort()).toEqual(['Birch', 'Maple']);
    expect([recordDetail(panel), readingOf(panel), resultPoint(panel).text, resultReading(panel.fields)]).toEqual(['Panel', { text: 'Panel' }, 'Panel', { value: undefined, unit: undefined, text: undefined }]);
    expect(recordDetail({ ...panel, fields: { ...panel.fields, interpretation: 'High' } })).toBe('Panel · High');
    expect([memberIds(panel.fields), memberIds({ members: [a.id, 7, null] })]).toEqual([[b.id, 'r_gone', a.id], [a.id]]);
  });

  it('names the group of the tests it lists that no common panel does, in its order', () => {
    const glucose = result(4, 'Glucose', '2026-01-02', { value: { value: 90, unit: 'mg/dL' } }, '2345-7');
    const listing = { ...panel, fields: { members: [b.id, a.id, glucose.id] } };
    const groups = resultGroups(idx(a, b, apart, glucose, listing)).map((g) => [g.name, g.tests.map((t) => t.series.name)]);
    expect(groups).toContainEqual(['Sample pollen panel', ['Maple', 'Birch']]);
    expect(groups).toContainEqual(['Other tests', ['Oat']]);
    expect(groups).toContainEqual(['Metabolic panel', ['Glucose']]);
    expect(groups).toHaveLength(3);
  });

  it('is the newest one that lists a test, and never one entered in error', () => {
    const later = { ...result(5, 'Later panel', '2026-02-03', { members: [a.id] }) };
    const gone = { ...result(6, 'Withdrawn panel', '2026-03-04', { members: [a.id] }), status: 'entered-in-error' };
    expect(resultGroups(idx(later, a, panel, gone)).map((g) => g.name)).toEqual(['Later panel']);
  });

  it('is not among what was tested that day, nor are the results it lists on its own page', () => {
    const drawn = (r: MedRecord) => resultContext(idx(a, b, apart, panel), household, ROBIN, '2026-11-22', r).sameDraw.flatMap((g) => g.records.map((x) => x.display)).sort();
    expect([drawn(a), drawn(panel)]).toEqual([['Maple', 'Oat'], ['Oat']]);
  });

  it('is found by itself, and stands for no result of a test it shares a code with', () => {
    const panels = [0, 1].map((i) => ({ ...panel, id: `r_${'pq'[i]!.repeat(20)}`, date: `2026-02-0${i + 1}`, display: 'Birch' }));
    const hits = find([{ person: ROBIN, index: idx(a, ...panels), text: null }], 'birch').hits;
    expect(entriesByKind(hits).map((g) => g.entries.map((e) => [e.hit.id, e.count, e.hit.test!.value]))).toEqual([expect.arrayContaining([[a.id, 1, 'Negative'], [panels[0]!.id, 1, 'Panel'], [panels[1]!.id, 1, 'Panel']])]);
  });

  it('is searched by no id, and links to nothing about somebody else', () => {
    const search = (q: string) => find([{ person: ROBIN, index: idx(panel), text: null }], q).hits.length;
    expect([search(b.id), search('gone'), search('pollen')]).toEqual([0, 0, 1]);
    // Nor by one another field has.
    const linked = { ...panel, fields: { ...panel.fields, visit: apart.id, note: 'Sample note' } };
    expect([apart.id, 'Sample note'].map((q) => find([{ person: ROBIN, index: idx(linked), text: null }], q).hits.length)).toEqual([0, 1]);
    const left = withoutAbout(idx(a, b, panel), { ids: new Set([b.id]) });
    expect([left.records.map((r) => r.display), memberIds(left.records[1]!.fields)]).toEqual([['Birch', 'Sample pollen panel'], ['r_gone', a.id]]);
    const none = withoutAbout(idx(a, b, { ...panel, fields: { members: [b.id] } }), { ids: new Set([b.id]) }).records[1]!;
    expect([none.fields.members, isHeading(none)]).toEqual([[], true]);
  });
});
