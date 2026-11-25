import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { demoFolderWith, demoJson, standingCase, type Overlay } from './helpers';
import { ALEX, ROBIN } from './sample';

interface Views {
  people: Record<string, { overrides: string | null; marks: string | null; provider_state?: string | null; linked: object; index: string; files: Record<string, string> }>;
  household: string;
}

const CASE = standingCase(ALEX);
const FILE = Object.keys(CASE).find((f) => f.startsWith(`views/${ALEX}/standing.`))!;

async function load(overlay: Overlay): Promise<Store> {
  const s = new Store(demoFolderWith(overlay));
  await s.load();
  return s;
}

/** The case with its views.json changed. */
function views(change: (v: Views) => void): Overlay {
  const v = JSON.parse(CASE['views/views.json']!) as Views;
  change(v);
  return { ...CASE, 'views/views.json': JSON.stringify(v) };
}

const has = (s: Store) => s.index(ALEX)!.standing !== undefined;

describe('a person’s standing.json', () => {
  it('is read beside the index it was written from, and of no one else', async () => {
    const s = await load(CASE);
    expect([has(s), s.index(ROBIN)!.standing, s.mayBring()]).toEqual([true, undefined, false]);
    expect(s.index(ALEX)!.standing!.order.get('allergy')!.length).toBeGreaterThan(0);
  });

  it('is read whatever the household said since, and whoever is linked: it is made from the records alone', async () => {
    const other = 'f'.repeat(32);
    const changed = await load(views((v) => Object.assign(v.people[ALEX]!, { overrides: other, marks: other, provider_state: other, linked: { [ROBIN]: { index: other, text: other } } })));
    expect(has(changed)).toBe(true);
  });

  it('is left out while it is stale or still to come, and read for again', async () => {
    for (const overlay of [
      views((v) => void (v.people[ALEX]!.index = 'f'.repeat(32))),
      views((v) => void (v.household = 'f'.repeat(32))),
      { ...CASE, [FILE]: null },
      { ...CASE, [FILE]: '{}' },
    ]) {
      const s = await load(overlay);
      expect([has(s), s.mayBring()]).toEqual([false, true]);
      expect(s.snapshot).not.toBe((await load(CASE)).snapshot);
    }
  });

  it('is not missed in a folder of an earlier medrec', async () => {
    const s = await load(standingCase(ALEX, { standing: false }));
    expect([has(s), s.mayBring()]).toEqual([false, false]);
    expect(demoJson<Views>('views/views.json').people[ALEX]!.files['standing.json']).toBeUndefined();
  });
});
