// The practice a record came through. All a record says of it is the sign-in:
// an organization id, a CLI and a FHIR base, which several practices can
// share, one person's or several people's. Only the person's own sources name
// it, and not where several of theirs could be meant.

import { nameKey } from './providers';
import type { Household, Provenance } from './types';

/** What a record says of the sign-in it came through. */
export type SignIn = Pick<Provenance['source'], 'organization_id' | 'cli' | 'fhir_base'>;

/** Whether two records came through one sign-in, as far as each says. */
export function sameSignIn(a: SignIn, b: SignIn): boolean {
  const agree = (x: string | undefined, y: string | undefined) => !x || !y || x.replace(/\/+$/, '') === y.replace(/\/+$/, '');
  return !!a.organization_id && a.organization_id === b.organization_id && agree(a.cli, b.cli) && agree(a.fhir_base, b.fhir_base);
}

/** Which practice a sign-in is to one person: one by name, one of several of theirs, or one nothing names. */
export type Practice = { kind: 'named'; name: string } | { kind: 'shared'; names: string[] } | { kind: 'unnamed' };

export function practiceOf(household: Household, person: string, from: SignIn): Practice {
  const own = new Map<string, string>();
  for (const s of household.sources) {
    const key = nameKey(s.organization_name);
    if (key && s.person === person && !own.has(key) && sameSignIn({ organization_id: s.organization, cli: s.cli, fhir_base: s.fhir_base }, from)) own.set(key, s.organization_name!.trim());
  }
  if (own.size > 1) return { kind: 'shared', names: [...own.values()] };
  const name = [...own.values()][0] ?? householdName(household, person, from.organization_id);
  return name ? { kind: 'named', name } : { kind: 'unnamed' };
}

/** The household's organization of an id, unless another person's source there has its name. */
function householdName(household: Household, person: string, id: string | undefined): string | undefined {
  const name = id ? household.organizations.find((o) => o.id === id || o.aliases?.includes(id))?.name : undefined;
  const theirs = household.sources.some((s) => s.person !== person && s.organization === id && nameKey(s.organization_name) === nameKey(name));
  return theirs ? undefined : name;
}

/**
 * The practice a record came through, as medrec names it: its own sign-in's
 * name, else the household's organization of that id. One FHIR base can
 * serve many practices, so the base alone names none. Undefined when nothing
 * names it, or several of this person's sources could: an id is not a name.
 */
export function practiceName(household: Household, person: string, from: SignIn): string | undefined {
  const p = practiceOf(household, person, from);
  return p.kind === 'named' ? p.name : undefined;
}

/** Its name, else its id when nothing names it: an id several practices share stands for none of them. */
export function practiceOrId(household: Household, person: string, from: SignIn): string | undefined {
  const p = practiceOf(household, person, from);
  return p.kind === 'named' ? p.name : p.kind === 'unnamed' ? from.organization_id : undefined;
}
