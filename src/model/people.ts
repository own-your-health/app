// What the app calls a person outside Settings and the doctor sheet: their
// first name, as a household says it, unless someone else in the household
// shares it, then their full name.

import type { Person } from './types';

/** The first name of each person, or the full name where two share a first name. */
export function firstNames(people: Pick<Person, 'name'>[]): string[] {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
  return people.map((p) => {
    const mine = first(p.name).toLowerCase();
    return people.some((o) => o !== p && first(o.name).toLowerCase() === mine) ? p.name : first(p.name);
  });
}

/** A person as the app's screens name them; one built without a short name keeps their full name. */
export function called(p: { name: string; short?: string }): string {
  return p.short ?? p.name;
}
