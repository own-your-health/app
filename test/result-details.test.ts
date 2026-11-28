import { describe, expect, it } from 'vitest';
import { withoutAbout } from '../src/model/aboutAnother';
import { isOutOfRange, resultFlag } from '../src/model/flags';
import { panelFor, panelOf, resultGroups } from '../src/model/panels';
import { itemPrivate } from '../src/model/private';
import { isHeading, isQuantity, isWithdrawn, memberIds, partSeries, readingOf, recordDetail, resultParts, resultPoint, resultReading, resultSeries, seriesKey, str, testPartSeries } from '../src/model/records';
import { rangeLine, rangeText, resultContext, verdict } from '../src/model/result';
import { parseHousehold, parseIndex } from '../src/model/parse';
import { find } from '../src/model/search';
import type { Json, JsonObject, MedRecord, PersonIndex } from '../src/model/types';
import { drawable } from '../src/ui/chart';
import { entriesByKind } from '../src/ui/search';
import { demo } from './demo-data';
import { fixture } from './helpers';
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

describe('a blood pressure’s one form', () => {
  const of = (...parts: ReturnType<typeof part>[]) => readingOf(result(0, 'Blood pressure', '2026-01-02', { value: 'As its source wrote it', components: parts }, '85354-9')).text;
  const [top, bottom] = [(value: Json) => part('8480-6', 'Systolic', value), (value: Json) => part('8462-4', 'Diastolic', value)];
  const mmHg = (value: number) => ({ value, unit: 'mmHg' });

  it('is the bottom number alone where there is no top one, and two bottom numbers are both said', () => {
    expect([of(bottom(mmHg(80))), of(top(mmHg(120)), bottom(mmHg(80)), bottom(mmHg(82)))]).toEqual(['80 mmHg, bottom number only', '120/80 and 82 mmHg']);
  });

  it('gives a part in another unit than the numbers its own unit, and one with no unit none', () => {
    expect(of(top(mmHg(120)), bottom(mmHg(80)), part('8867-4', 'Heart rate', { value: 64, unit: '/min' }), part(null, 'Mean Blood Pressure', mmHg(93)))).toBe('120/80 mmHg, heart rate 64 /min, mean 93');
    expect(of(top({ value: 120 }), bottom({ value: 80 }))).toBe('120/80');
  });

  it('keeps a name of capitals as it is, and the words of a name that is only “blood pressure”', () => {
    expect(of(top(mmHg(120)), bottom(mmHg(80)), part(null, 'MAP', mmHg(93)), part(null, 'Blood pressure', mmHg(95)))).toBe('120/80 mmHg, MAP 93, blood pressure 95');
  });

  it('is the source’s own words where no part is a top or a bottom number', () => {
    expect([of(part(null, 'Upper', mmHg(120))), of()]).toEqual(['As its source wrote it', 'As its source wrote it']);
  });

  it('reads a part by name only where it has no code, so another test’s coded “Systolic” or “Diastolic” part is none', () => {
    expect([of(part('00000-4', 'Systolic function', mmHg(60)), part('00000-5', 'Diastolic function', { value: 2 })), of(part(null, 'Systolic', mmHg(120)), part(null, 'Diastolic', mmHg(80)))]).toEqual(['As its source wrote it', '120/80 mmHg']);
  });

  it('knows LOINC’s codes however a source writes LOINC’s system', () => {
    const coded = (system: string, code: string, value: number) => ({ code: { system, code }, value: mmHg(value) });
    expect(of(coded('LOINC', '8480-6', 120), coded('https://loinc.org', '8462-4', 80))).toBe('120/80 mmHg');
  });

  it('leaves out a part with no value, and keeps the source’s words where no number is left', () => {
    expect([of(top(null), bottom(mmHg(80))), of(top(null), bottom(null)), of(top(mmHg(120)), bottom(mmHg(80)), part(null, 'Mean blood pressure', null))]).toEqual(['80 mmHg, bottom number only', 'As its source wrote it', '120/80 mmHg']);
  });
});

describe('a test’s parts over time', () => {
  const reading = (n: number, date: string, parts: ReturnType<typeof part>[]) => result(n, 'Example reading', date, { value: 'Example', components: parts }, '00000-1');
  const lines = (...records: MedRecord[]) => testPartSeries(idx(...records), seriesKey(records[0]!)).map((s) => [s.name, s.points.map((x) => x.date)]);

  it('are named and placed as the newest result that names each', () => {
    const older = reading(0, '2026-01-02', [part('00000-2', 'Alpha, as first named', { value: 1, unit: 'U' }), part('00000-3', 'Beta', { value: 2, unit: 'U' })]);
    const newer = reading(1, '2026-03-04', [part('00000-3', 'Beta', { value: 3, unit: 'U' }), part('00000-2', 'Alpha', { value: 4, unit: 'U' })]);
    expect(lines(older, newer)).toEqual([
      ['Beta', ['2026-01-02', '2026-03-04']],
      ['Alpha', ['2026-01-02', '2026-03-04']],
    ]);
  });

  it('leave out a part that each result names twice', () => {
    const twice = reading(0, '2026-01-02', [part('00000-2', 'Alpha', { value: 1, unit: 'U' }), part('00000-2', 'Alpha', { value: 2, unit: 'U' }), part('00000-3', 'Beta', { value: 3, unit: 'U' })]);
    expect(lines(twice)).toEqual([['Beta', ['2026-01-02']]]);
  });
});

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

  it('is as its whole where the whole reads against its own range, whatever a part says', () => {
    const high = pressure(0, '2026-01-02', 150, 76, { reference_range: '90-120 mmHg' });
    const r = { ...high, fields: { value: { value: 7, unit: 'U' }, reference_range: '0-10 U', components: high.fields.components as Json } };
    expect([resultFlag(resultPoint(r))?.label, verdict(resultPoint(r)).text, verdict(resultPoint(r)).outOfRange]).toEqual(['In range', 'Within the lab’s range of 0–10 U.', false]);
  });

  it('says a part is outside no range only where each part that has one could be read against it', () => {
    const unread = pressure(0, '2026-01-02', 110, 76, { reference_range: '90-120 kPa' });
    expect(verdict(resultPoint(unread)).text).toBe('Its parts and their ranges are below.');
    const [top, low] = unread.fields.components as Record<string, Json>[];
    const oneRead = { ...unread, fields: { ...unread.fields, components: [top!, { ...low!, reference_range: '60-80 mmHg' }] as Json } };
    expect(verdict(resultPoint(oneRead)).text).toBe('Its parts and their ranges are below.');
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
    // What it lists, drawn that day with another, is named by it there too.
    expect(resultContext(idx(a, b, apart, panel), household, ROBIN, '2026-11-22', apart).sameDraw.map((g) => [g.panel, g.records.map((x) => x.display)])).toEqual([['Sample pollen panel', ['Maple', 'Birch']]]);
  });

  it('names no test by a panel that lists only another panel', () => {
    const inner = { ...result(4, 'Oat', '2026-01-02', { members: [a.id] }), id: `r_${'w'.repeat(20)}` };
    const outer = { ...result(5, 'Sample outer panel', '2026-01-02', { members: [inner.id] }), id: `r_${'v'.repeat(20)}` };
    expect(resultGroups(idx(apart, inner, outer)).map((g) => [g.name, g.tests.map((t) => t.series.name)])).toEqual([['Other tests', ['Oat']]]);
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

describe('as medrec 0.9.10 writes them', () => {
  // Its own fixture of a result's shapes, each on a day of its own, and a visit's results and headings (scripts/result-fixtures.mjs).
  const pat = parseIndex(fixture('results/views/Pat Example/index.json'), parseHousehold(fixture('results/views/household.json')).people[0]!.id);
  const on = (day: string, display?: string) => pat.records.filter((r) => r.date?.startsWith(day) && (!display || r.display === display));
  const one = (day: string, display?: string) => {
    const [r, ...more] = on(day, display);
    expect(more).toEqual([]);
    return r!;
  };
  const read = (r: MedRecord) => [readingOf(r).text, resultParts(r).map((x) => `${x.name}: ${x.point.text}`)];

  it('reads a blood pressure in one form whatever its source wrote, with its parts in the source’s order', () => {
    expect(['01', '02', '03', '04', '05', '06', '07', '11'].map((d) => read(one(`2024-04-${d}`)))).toEqual([
      ['128/76 mmHg', ['Blood pressure, top number: 128 mmHg', 'Blood pressure, bottom number: 76 mmHg']],
      ['110/70 mmHg', ['Blood pressure, bottom number: 70 mmHg', 'Blood pressure, top number: 110 mmHg']],
      ['120/80 mmHg', ['Systolic blood pressure: 120 mmHg', 'Diastolic blood pressure: 80 mmHg']],
      ['16 kPa/80 mmHg', ['Blood pressure, top number: 16 kPa', 'Blood pressure, bottom number: 80 mmHg']],
      ['122 mmHg, top number only', ['Blood pressure, top number: 122 mmHg']],
      ['122/78 mmHg, mean 93', ['Blood pressure, top number: 122 mmHg', 'Mean blood pressure: 93 mmHg', 'Blood pressure, bottom number: 78 mmHg']],
      ['122 and 124/78 mmHg', ['Blood pressure, top number: 122 mmHg', 'Blood pressure, top number: 124 mmHg', 'Blood pressure, bottom number: 78 mmHg']],
      ['>260/80 mmHg', ['Blood pressure, top number: >260 mmHg', 'Blood pressure, bottom number: 80 mmHg']],
    ]);
    // A reading of other parts is as its source wrote it.
    expect([read(one('2024-04-08')), read(one('2024-04-17'))]).toEqual([
      ['7', ['First part: 3', 'Second part: 4']],
      ['118/74 mmHg', ['Blood pressure, top number: 118 mmHg', 'Blood pressure, bottom number: 74 mmHg']],
    ]);
    expect(resultPoint(one('2024-04-01')).value).toBeUndefined();
  });

  it('flags one by the part out of its range, and gives that part’s range by its name', () => {
    const p = resultPoint(one('2024-04-01'));
    expect([resultFlag(p)?.label, verdict(p).text, rangeText(p, 'Blood pressure')]).toEqual(['High', 'Blood pressure, top number: Above the lab’s range of 90–120 mmHg.', 'top number: 90–120 mmHg']);
    expect([rangeText(resultPoint(one('2024-04-02')), 'Blood pressure'), rangeText(resultPoint(one('2024-05-14', 'Potassium')), 'Potassium')]).toEqual(['', '3.5-5.1 mmol/L']);
    // Under a value in a table over time.
    expect([rangeLine(p, 'Blood pressure'), rangeLine(resultPoint(one('2024-04-02')), 'Blood pressure'), rangeLine(resultPoint(one('2024-05-14', 'Potassium')), 'Potassium')]).toEqual([
      { words: 'Range: top number ', range: '90–120 mmHg' },
      undefined,
      { words: 'Range: ', range: '3.5-5.1 mmol/L' },
    ]);
    // Where the whole says of itself, no part flags it, and none's range is given.
    const said = one('2024-04-01');
    expect(rangeText(resultPoint({ ...said, fields: { ...said.fields, interpretation: 'Normal' } }), 'Blood pressure')).toBe('');
  });

  it('reads a bound, a ratio, a range and a time as medrec gives them', () => {
    const bound = resultPoint(one('2024-04-10'));
    expect([bound.text, bound.bound, bound.value]).toEqual(['<0.5 IU/mL', { op: '<', n: 0.5 }, undefined]);
    expect(resultParts(one('2024-04-11'))[0]!.point).toMatchObject({ text: '>260 mmHg', bound: { op: '>', n: 260 } });
    expect(['12', '13', '14', '15'].map((d) => [resultPoint(one(`2024-04-${d}`)).text, resultPoint(one(`2024-04-${d}`)).value])).toEqual([
      ['1:40', undefined],
      ['0 /HPF – 5 /HPF', undefined],
      ['1:>1280', undefined],
      ['07:30:00', undefined],
    ]);
  });

  it('draws each part its test names once, in one unit', () => {
    const lines = partSeries(pat, one('2024-04-01')).map((x) => [x.name, x.points.length, drawable(x.points, x.unit).points.length, drawable(x.points, x.unit).unit, drawable(x.points, x.unit).other]);
    expect(lines).toEqual([
      ['Blood pressure, top number', 7, 5, 'mmHg', 1],
      ['Blood pressure, bottom number', 7, 7, 'mmHg', 0],
    ]);
  });

  it('draws a test sent in two units in the newest one’s', () => {
    const s = resultSeries(pat).find((x) => x.name === 'Example glucose')!;
    const d = drawable(s.points, s.unit);
    expect([s.points.length, s.unit, d.points.map((p) => p.date), d.unit, d.other]).toEqual([3, undefined, ['2024-02-01', '2024-06-01'], 'mg/dL', 1]);
  });

  it('heads a group with a heading, and lists a report’s and a heading’s results in their order', () => {
    const [heading, report] = [one('2024-04-21'), one('2024-04-30')];
    const names = (r: MedRecord) => memberIds(r.fields).map((id) => pat.records.find((x) => x.id === id)!.display);
    expect([isHeading(heading), names(heading), isHeading(report), names(report)]).toEqual([true, ['Example antibody', 'Example cell count'], false, ['Example score']]);
    const [salts, metals, withdrawn] = ['Example salts panel', 'Example metals panel', 'Example withdrawn panel'].map((n) => one('2024-05-14', n));
    expect([salts, metals, withdrawn].map((r) => [isHeading(r!), names(r!), isWithdrawn(r!)])).toEqual([
      [true, ['Sodium', 'Potassium'], false],
      [true, [], false],
      [true, ['Sodium', 'Potassium'], true],
    ]);
    const groups = resultGroups(pat).map((g) => [g.name, g.tests.map((t) => t.series.name)]);
    expect(groups).toContainEqual(['Example heading', ['Example antibody', 'Example cell count']]);
    expect(groups.flatMap(([, tests]) => tests)).not.toContain('Example salts panel');
    expect(resultSeries(pat).filter((x) => x.points.some((p) => isHeading(pat.records.find((r) => r.id === p.id)!)))).toEqual([]);
  });

  it('gives a test’s parts over time from each of its results, also where its newest has none', () => {
    const lines = (index: PersonIndex) => testPartSeries(index, seriesKey(one('2024-04-01'))).map((s) => `${s.name}: ${s.points.length}`);
    const upTo = (day: string) => ({ ...pat, records: pat.records.filter((r) => seriesKey(r) !== seriesKey(one('2024-04-01')) || (r.date ?? '') < day) });
    expect(lines(upTo('2024-04-10'))).toEqual(lines(upTo('2024-04-09')));
    expect(lines(upTo('2024-04-10'))).toEqual(['Blood pressure, top number: 5', 'Blood pressure, bottom number: 5', 'Mean blood pressure: 1']);
    expect(partSeries(upTo('2024-04-10'), one('2024-04-09'))).toEqual([]);
  });

  it('is no test where it shares a code with one, and has none of its history', () => {
    const panel = one('2024-06-10', 'Blood pressure panel');
    const household = parseHousehold(fixture('results/views/household.json'));
    expect([isHeading(panel), memberIds(panel.fields).length, resultContext(pat, household, pat.person, '2026-11-22', panel).series]).toEqual([true, 2, undefined]);
    expect(resultSeries(pat).find((s) => s.name === 'Blood pressure' && s.points.length > 1)!.points.map((p) => p.id)).not.toContain(panel.id);
  });

  it('names no group by a panel on a shared screen where it is private, or not yet known not to be', () => {
    const [heading, antibody] = [one('2024-04-21'), one('2024-04-10')];
    const known = (ids: string[]) => ({ kind: 'known', records: new Map(ids.map((id) => [id, 'mental_health'])), documents: new Map(), events: new Map(), studies: new Map(), unreported: new Set(), ties: true }) as PersonIndex['privacy'];
    const panelIn = (index: PersonIndex, shared: boolean) =>
      find([{ person: pat.person, index, text: null, ...(shared ? { leave: (kind: string, id: string) => !!itemPrivate(index, kind, id) } : {}) }], 'antibody').hits.map((h) => h.test?.panel);
    const [marked, open] = [{ ...pat, privacy: known([heading.id]) }, { ...pat, privacy: known([]) }];
    const plain = panelFor(seriesKey(antibody), str(antibody.fields.category)).name;
    expect([panelIn(marked, false), panelIn(open, true), panelIn(marked, true)]).toEqual([['Example heading'], ['Example heading'], [plain]]);
    // Not yet known: the shared search shows none of the person's hits, and no panel would name one.
    expect([panelIn(pat, true), panelOf(pat, seriesKey(antibody), str(antibody.fields.category), true).name, panelOf(pat, seriesKey(antibody), str(antibody.fields.category)).name]).toEqual([[], plain, 'Example heading']);
    expect(plain).not.toBe('Example heading');
  });

  it('names a test by the heading that lists it, in the list, on its page and in search', () => {
    const household = parseHousehold(fixture('results/views/household.json'));
    const antibody = one('2024-04-10');
    expect(resultContext(pat, household, pat.person, '2026-11-22', antibody).panel).toBe('Example heading');
    expect(find([{ person: pat.person, index: pat, text: null }], 'antibody').hits.map((h) => h.test?.panel)).toEqual(['Example heading']);
  });

  it('leaves a heading and what it lists out of what was drawn with a result that day', () => {
    const drawnWith = (r: MedRecord) => resultContext(pat, parseHousehold(fixture('results/views/household.json')), pat.person, '2026-11-22', r).sameDraw.flatMap((g) => g.records.map((x) => x.display));
    const [sodium, salts] = [one('2024-05-14', 'Sodium'), one('2024-05-14', 'Example salts panel')];
    expect([drawnWith(sodium), drawnWith(salts)]).toEqual([['Potassium'], []]);
  });
});
