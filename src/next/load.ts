// Where the redesign's events come from: medrec's own (views/<person>/
// events.json, medrec 0.9.0 and later), which the store attaches to the
// index they were written from, else the app's own grouping (grouping.ts)
// for a folder whose medrec has not written them, or whose events are
// behind its records. grouping.ts goes once every folder has them. Every
// screen reads events here. medrec's event id is its own (`e_…`); any
// record or paper in an event opens it too (eventOf), so an address saved
// from the app's own grouping still finds its visit.

import type { MedrecEvents } from '../model/events';
import type { Household, PersonIndex } from '../model/types';
import type { CareEvent } from './event';
import { careEvents } from './grouping';
import { fromMedrec } from './medrecEvents';

const cache = new WeakMap<PersonIndex, { today: string; household: Household; file: MedrecEvents | undefined; events: CareEvent[] }>();

/** Whose events medrec grouped: false while the app groups a person's records itself. */
export const groupedByMedrec = (index: PersonIndex): boolean => !!index.events;

/** A person's events, newest first, made once per loaded index and day. */
export function personEvents(index: PersonIndex, household: Household, today: string): CareEvent[] {
  const hit = cache.get(index);
  if (hit && hit.today === today && hit.household === household && hit.file === index.events) return hit.events;
  const events = index.events ? fromMedrec(index.events, index, household) : careEvents(index, household, today);
  cache.set(index, { today, household, file: index.events, events });
  return events;
}
