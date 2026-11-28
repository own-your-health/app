import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { demoFolderWith, demoJson, standingCase, type Overlay } from './helpers';
import { ALEX, ROBIN } from './sample';

interface Views {
  people: Record<string, { overrides: string | null; marks: string | null; provider_state?: string | null; linked: object; index: string; files: Record<string, string> }>;
  household: string;
}

const CASE = standingCase(ALEX);
// The case's own, not the sample's it leaves out.
const FILE = Object.keys(CASE).find((f) => f.startsWith(`views/${ALEX}/standing.`) && CASE[f] !== null)!;

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
const why = (s: Store) => s.standingNotes.get(ALEX);

describe('a person’s standing.json', () => {
  it('is read beside the index it was written from, and of no one else', async () => {
    const s = await load(CASE);
    expect([has(s), s.index(ROBIN)!.standing === s.index(ALEX)!.standing, s.mayBring(), s.standingNotes.size]).toEqual([true, false, false, 0]);
    expect(s.index(ALEX)!.standing!.order.get('allergy')).not.toEqual(s.index(ROBIN)!.standing!.order.get('allergy'));
    expect(s.index(ALEX)!.standing!.order.get('allergy')!.length).toBeGreaterThan(0);
  });

  it('is read whatever the household said since, and whoever is linked: it is made from the records alone', async () => {
    const other = 'f'.repeat(32);
    const changed = await load(views((v) => Object.assign(v.people[ALEX]!, { overrides: other, marks: other, provider_state: other, linked: { [ROBIN]: { index: other, text: other } } })));
    expect(has(changed)).toBe(true);
  });

  it('is left out while it is stale or still to come, and read for again', async () => {
    const arriving = 'medrec is still writing its list of what is current.';
    for (const [overlay, said] of [
      [views((v) => void (v.people[ALEX]!.index = 'f'.repeat(32))), 'medrec’s list of what is current is older than their records.'],
      [views((v) => void (v.household = 'f'.repeat(32))), 'medrec’s list of what is current is older than their records.'],
      [{ ...CASE, [FILE]: null }, arriving],
      [{ ...CASE, [FILE]: '{}' }, arriving],
    ] as const) {
      const s = await load(overlay);
      expect([has(s), s.mayBring(), why(s)]).toEqual([false, true, said]);
      expect(s.snapshot).not.toBe((await load(CASE)).snapshot);
    }
  });

  it('is not missed in a folder of an earlier medrec', async () => {
    const s = await load(standingCase(ALEX, { standing: false }));
    expect([has(s), s.mayBring(), s.standingNotes.size]).toEqual([false, false, 0]);
    expect(JSON.parse(standingCase(ALEX, { standing: false })['views/views.json']!).people[ALEX].files['standing.json']).toBeUndefined();
  });

  it('is refused and said to be where a newer medrec wrote it, or it is none, and is not read for again', async () => {
    const newer = await load(standingCase(ALEX, { schema: 'medrec-standing/v2' }));
    expect([has(newer), newer.mayBring(), why(newer)]).toEqual([false, false, 'medrec’s list of what is current could not be read: it is written by a newer medrec. Update the app.']);
    const none = await load(standingCase(ALEX, { schema: 'medrec-events/v1' }));
    expect(why(none)).toBe('medrec’s list of what is current could not be read: it is not medrec’s standing of a person’s records.');
    expect(newer.standingNotes.has(ROBIN)).toBe(false);
  });

  it('is another reading of the folder where its reason is another', async () => {
    const at = async (unchecked: boolean) => {
      const folder = demoFolderWith({ ...CASE, [FILE]: '{}' });
      const md5 = folder.md5.bind(folder);
      if (unchecked) folder.md5 = (file) => (file === FILE ? Promise.resolve(undefined) : md5(file));
      const s = new Store(folder);
      await s.load();
      return s;
    };
    const [arriving, unchecked] = [await at(false), await at(true)];
    expect([why(arriving), why(unchecked)]).toEqual(['medrec is still writing its list of what is current.', 'medrec’s list of what is current could not be checked against their records.']);
    expect(arriving.snapshot).not.toBe(unchecked.snapshot);
  });

  it('is nobody’s where the views do not read, and everybody’s lists say why', async () => {
    const newer = await load({ 'views/views.json': JSON.stringify({ ...demoJson<object>('views/views.json'), schema: 'medrec-views/v3' }) });
    expect([why(newer), newer.standingNotes.get(ROBIN), newer.billsNotes.get(ROBIN)]).toEqual([
      'medrec’s views, which say what is current, are written by a newer medrec. Update the app.',
      'medrec’s views, which say what is current, are written by a newer medrec. Update the app.',
      'medrec’s views, which say what is paid, are written by a newer medrec. Update the app.',
    ]);
    expect(why(await load({ 'views/views.json': '{' }))).toBe('medrec’s views, which say what is current, could not be read.');
  });

  it('brings its reason along when the folder is read again', async () => {
    const s = await load(CASE);
    s.folder = demoFolderWith(standingCase(ALEX, { schema: 'medrec-standing/v2' }));
    await s.reload();
    expect([has(s), why(s)?.includes('newer medrec')]).toEqual([false, true]);
  });
});
