import { Store } from '../src/data/store';
import type { Household, PersonIndex, RefreshStatus, Source } from '../src/model/types';
import { demoFolder, demoJson } from './helpers';

// The synthetic sample folder in public/demo/, loaded by the store as the app
// loads it (medrec's events checked against the folder and attached), at the
// time it was written, so no time in it moves.
const store = new Store(demoFolder(new Date(demoJson<{ anchor: string }>('manifest.json').anchor)));
await store.load();
if (store.status.kind !== 'ok') throw new Error('demo status.json does not parse');
const loaded = { household: store.household, indexes: store.indexes, status: store.status.status, eventsNotes: store.eventsNotes };

/** The sample, as the store read it; each call gets its own copy, so a test may change it. */
export function demo(): { household: Household; indexes: Map<string, PersonIndex>; status: RefreshStatus } {
  return structuredClone({ household: loaded.household, indexes: loaded.indexes, status: loaded.status });
}

/** Why the store left a person's events out, by person: empty for the sample. */
export const demoEventsNotes = loaded.eventsNotes;

export function personNamed(h: Household, name: string) {
  const p = h.people.find((x) => x.name === name);
  if (!p) throw new Error(`no ${name}`);
  return p;
}

export function sourceOf(h: Household, person: string, cli: string): Source {
  const p = personNamed(h, person);
  const s = h.sources.find((x) => x.person === p.id && x.cli === cli);
  if (!s) throw new Error(`no ${cli} for ${person}`);
  return s;
}
