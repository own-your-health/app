// Results grouped the way a lab report groups them. The index keeps each
// result as its own record, so the panel comes from the test's LOINC code, by
// a table of the common panels; else from the result's category, where it is
// one other than laboratory; else from the newest panel that lists a result of
// the test (medrec 0.9.10 and later); else Other tests.

import { isOutOfRange } from './flags';
import { latestResults, type LatestResult } from './overview';
import { recordPrivate } from './private';
import { isHeading, isWithdrawn, memberIds, seriesKey } from './records';
import { recordTitle } from './titles';
import type { MedRecord, PersonIndex } from './types';

interface Panel {
  id: string;
  name: string;
  /** LOINC codes, in the order a report lists them. */
  loinc: string[];
}

export const PANELS: Panel[] = [
  { id: 'metabolic', name: 'Metabolic panel', loinc: ['2345-7', '2339-0', '3094-0', '2160-0', '33914-3', '48642-3', '48643-1', '62238-1', '98979-8', '2951-2', '2823-3', '2075-0', '2028-9', '17861-6'] },
  { id: 'lipid', name: 'Cholesterol (lipid panel)', loinc: ['2093-3', '2571-8', '2085-9', '13457-7', '18262-6', '43396-1', '9830-1'] },
  { id: 'a1c', name: 'Blood sugar (A1c)', loinc: ['4548-4', '17856-6', '27353-2', '1558-6'] },
  { id: 'liver', name: 'Liver panel', loinc: ['1742-6', '1920-8', '6768-6', '1975-2', '42719-5', '2885-2', '1751-7'] },
  // A blood count, then its differential: each kind of white cell as a count, then as a share.
  { id: 'cbc', name: 'Blood count (CBC)', loinc: ['6690-2', '789-8', '718-7', '4544-3', '787-2', '785-6', '786-4', '788-0', '777-3', '26515-7', '32623-1', '751-8', '731-0', '742-7', '711-2', '704-7', '770-8', '736-9', '5905-5', '713-8', '706-2'] },
  { id: 'thyroid', name: 'Thyroid', loinc: ['3016-3', '11580-8', '3024-7', '3051-0'] },
  { id: 'vitamins', name: 'Vitamins and iron', loinc: ['62292-8', '1989-3', '14635-7', '2132-9', '2284-8', '2498-4', '2500-7', '2276-4'] },
  { id: 'urine', name: 'Urine and kidney', loinc: ['14959-1', '2888-6', '5811-5', '5803-2'] },
  { id: 'vitals', name: 'Vital signs', loinc: ['85354-9', '55284-4', '8480-6', '8462-4', '8867-4', '8310-5', '9279-1', '59408-5', '2708-6', '29463-7', '3141-9', '8302-2', '39156-5', '9843-4', '8287-5'] },
];

const BY_LOINC = new Map(PANELS.flatMap((p) => p.loinc.map((code, i) => [code, { panel: p, order: i }] as const)));

export interface ResultGroup {
  id: string;
  name: string;
  tests: LatestResult[];
  outOfRange: number;
}

function loincOf(key: string): string | undefined {
  const [system, code] = key.split('|');
  return system && /loinc/i.test(system) ? code : undefined;
}

type Listed = Map<string, { heading: MedRecord; order: number }>;
const headings = { own: new WeakMap<PersonIndex, Listed>(), shared: new WeakMap<PersonIndex, Listed>() };

/**
 * The panel each test is listed by, by its series key, and its place in it:
 * the newest panel that lists a result of it. On a screen the household
 * shares, a panel that is private, or not yet known not to be, names nothing:
 * its title would show there.
 */
function headingsOf(index: PersonIndex, shared: boolean): Listed {
  const cache = shared ? headings.shared : headings.own;
  let out = cache.get(index);
  if (!out) {
    cache.set(index, (out = new Map()));
    const byId = new Map(index.records.map((r) => [r.id, r]));
    const panels = index.records.filter((r) => isHeading(r) && !isWithdrawn(r) && !(shared && recordPrivate(index, r.id))).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    for (const heading of panels)
      for (const [order, id] of memberIds(heading.fields).entries()) {
        const x = byId.get(id);
        if (x?.kind === 'result' && !isHeading(x)) out.set(seriesKey(x), { heading, order });
      }
  }
  return out;
}

/** The group a test falls in, and its place there; on a screen the household shares where `shared`. */
export function panelOf(index: PersonIndex, key: string, category?: string, shared = false): { id: string; name: string; order: number } {
  const by = panelFor(key, category);
  const listed = by.id === 'other-lab' ? headingsOf(index, shared).get(key) : undefined;
  return listed ? { id: `panel:${seriesKey(listed.heading)}`, name: recordTitle(listed.heading), order: listed.order } : by;
}

/** The same, by a test's series key (records.ts's seriesKey). */
export function panelFor(key: string, category?: string): { id: string; name: string; order: number } {
  const code = loincOf(key);
  const hit = code ? BY_LOINC.get(code) : undefined;
  if (hit) return { id: hit.panel.id, name: hit.panel.name, order: hit.order };
  if (category && /vital/i.test(category)) return { id: 'vitals', name: 'Vital signs', order: 100 };
  if (!category || /^lab(oratory)?$/i.test(category)) return { id: 'other-lab', name: 'Other tests', order: 100 };
  return { id: `category:${category.toLowerCase()}`, name: category, order: 100 };
}

const rank = (t: LatestResult) => (t.flag?.critical ? 0 : isOutOfRange(t.flag) ? 1 : 2);

/**
 * Each test's newest result, by panel. A group with a critical result comes
 * first, then one with any out of range, then by its newest result; within a
 * group, out of range first, then the report's order.
 */
export function resultGroups(index: PersonIndex): ResultGroup[] {
  const category = new Map<string, string>();
  for (const r of index.records) if (r.kind === 'result' && typeof r.fields.category === 'string') category.set(seriesKey(r), r.fields.category);
  const groups = new Map<string, { group: ResultGroup; order: Map<LatestResult, number> }>();
  for (const t of latestResults(index)) {
    const p = panelOf(index, t.series.key, category.get(t.series.key));
    let g = groups.get(p.id);
    if (!g) groups.set(p.id, (g = { group: { id: p.id, name: p.name, tests: [], outOfRange: 0 }, order: new Map() }));
    g.group.tests.push(t);
    g.order.set(t, p.order);
    if (isOutOfRange(t.flag)) g.group.outOfRange += 1;
  }
  const out = [...groups.values()].map(({ group, order }) => {
    group.tests.sort((a, b) => rank(a) - rank(b) || order.get(a)! - order.get(b)! || a.series.name.localeCompare(b.series.name));
    return group;
  });
  const newest = (g: ResultGroup) => g.tests.map((t) => t.latest.date ?? '').sort().pop() ?? '';
  const panelOrder = (g: ResultGroup) => {
    const i = PANELS.findIndex((p) => p.id === g.id);
    return i < 0 ? PANELS.length : i;
  };
  return out.sort((a, b) => Math.min(...a.tests.map(rank)) - Math.min(...b.tests.map(rank)) || newest(b).localeCompare(newest(a)) || panelOrder(a) - panelOrder(b));
}
