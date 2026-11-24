// Where the redesign's events come from: medrec's own (views/<person>/
// events.json, medrec 0.9.0 and later, read by the store), else the app's own
// grouping (grouping.ts) for a folder whose medrec has not written them yet.
// grouping.ts goes once every folder has them. Every screen reads events
// here. medrec's event id is its own (`e_…`); any record or paper in an
// event opens it too (eventOf), so an address saved from the app's own
// grouping still finds its visit.

import type { Household, PersonIndex } from '../model/types';
import type { CareEvent } from './event';
import { careEvents } from './grouping';
import { fromMedrec, type MedrecEvents } from './medrecEvents';

const cache = new WeakMap<PersonIndex, { today: string; household: Household; events: CareEvent[] }>();
const medrec = new WeakMap<PersonIndex, MedrecEvents>();

/** Reads a person's events from medrec's events.json from now on. */
export function useMedrecEvents(index: PersonIndex, file: MedrecEvents): void {
  medrec.set(index, file);
  cache.delete(index);
}

/** Whose events medrec grouped: false while the app groups a person's records itself. */
export const groupedByMedrec = (index: PersonIndex): boolean => medrec.has(index);

/** A person's events, newest first, made once per loaded index and day. */
export function personEvents(index: PersonIndex, household: Household, today: string): CareEvent[] {
  const hit = cache.get(index);
  if (hit && hit.today === today && hit.household === household) return hit.events;
  const file = medrec.get(index);
  const events = file ? fromMedrec(file, index, household) : careEvents(index, household, today);
  cache.set(index, { today, household, events });
  return events;
}
