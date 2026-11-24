// Where the redesign's events come from: today the app's own grouping
// (grouping.ts), until medrec writes `views/<person>/events.json`. Swapping
// the source changes the one call below; every screen reads events here.
// An event's id is the record that leads it, and any record or paper in it
// opens it too (eventOf), so a saved address survives regrouping. Events read
// from medrec keep that: their id is their anchor member's record id.

import type { Household, PersonIndex } from '../model/types';
import type { CareEvent } from './event';
import { careEvents } from './grouping';

const cache = new WeakMap<PersonIndex, { today: string; household: Household; events: CareEvent[] }>();

/** A person's events, newest first, grouped once per loaded index and day. */
export function personEvents(index: PersonIndex, household: Household, today: string): CareEvent[] {
  const hit = cache.get(index);
  if (hit && hit.today === today && hit.household === household) return hit.events;
  const events = careEvents(index, household, today);
  cache.set(index, { today, household, events });
  return events;
}
