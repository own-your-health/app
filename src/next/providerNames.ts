// The names the items print, and which of them are one provider: those with
// one National Provider Identifier, and one name in one source (one person's
// sign-in, or their papers). So the same name in two people's records is one
// provider only by its identifier. Names that are only alike are said to be
// maybe the same, and never put together. A name nothing but a sign-in
// several practices share gives is none's (practiceOf).

import { practiceOf } from '../model/practices';
import type { ProviderField } from '../model/providers';
import { isWithdrawn, str } from '../model/records';
import type { Household, MedRecord, PersonIndex, Provenance } from '../model/types';
import { placeName, tidyName } from '../model/words';
import type { CareEvent } from './event';

/** The fields of a record that name a provider. A paper's is `organization`, and `practice` is the sign-in a visit came through, where it names no place. */
const FIELDS: Record<string, readonly ProviderField[]> = {
  claim: ['provider', 'facility'],
  encounter: ['location', 'service_provider', 'practitioner'],
  medication: ['pharmacy', 'prescriber'],
  immunization: ['performer'],
  procedure: ['location', 'performer'],
};
/** The fields that name a person, not a place. */
const PEOPLE: ReadonlySet<ProviderField> = new Set(['practitioner', 'prescriber']);

/** A provider as one item prints it. */
export interface Named {
  person: string;
  /** The record or paper. */
  id: string;
  kind: string;
  field: ProviderField;
  name: string;
  date?: string;
  npi?: string;
  /** This name in this source of this person's. */
  inSource: string;
  provenance: Provenance[];
}

const cleanBase = (base: string | undefined) => base?.replace(/\/+$/, '') ?? '';
const signIn = ({ source: s }: Provenance) => [s.kind, s.cli ?? '', s.organization_id ?? '', cleanBase(s.fhir_base)].join('|');

/** The one source a record is from; one two sources state is in none but its own, as either may have given the name. */
function sourceOf(r: MedRecord): string {
  const from = new Set(r.provenance.map(signIn));
  return from.size === 1 ? [...from][0]! : `record|${r.id}`;
}

/** A name as a key: the same only for names that differ in case, spaces and punctuation alone, so "MD" and "PA" stay apart. */
const keyOf = (name: string): string =>
  name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim() || name;

/** Whether two names are printed the same, case, spaces and punctuation aside. */
export const sameName = (a: string, b: string): boolean => keyOf(a) === keyOf(b);

/** The NPI a record gives for a field (medrec 0.9.6 and later). */
function npiOf(r: MedRecord, field: string): string | undefined {
  const all = Array.isArray(r.providers) ? r.providers : [];
  const found = all.flatMap((p) => (p && typeof p === 'object' && !Array.isArray(p) && p.field === field && typeof p.npi === 'string' && p.npi ? [p.npi] : []));
  return found.length === 1 ? found[0] : undefined;
}

const namedCache = new WeakMap<PersonIndex, { household: Household; named: Named[] }>();

/** Every provider a person's records and papers print. */
export function providersNamed(idx: PersonIndex, household: Household): Named[] {
  const hit = namedCache.get(idx);
  if (hit && hit.household === household) return hit.named;
  const named: Named[] = [];
  const inSource = (source: string, name: string) => `${idx.person}|${source}|${keyOf(name)}`;
  for (const r of idx.records) {
    if (isWithdrawn(r)) continue;
    const source = sourceOf(r);
    const put = (field: ProviderField, text: string | undefined) => {
      const name = PEOPLE.has(field) ? tidyName(text) : placeName(text);
      if (!name) return;
      const npi = npiOf(r, field);
      named.push({ person: idx.person, id: r.id, kind: r.kind, field, name, inSource: inSource(source, name), provenance: r.provenance, ...(r.date ? { date: r.date } : {}), ...(npi ? { npi } : {}) });
    };
    for (const f of FIELDS[r.kind] ?? []) put(f, str(r.fields[f]));
    if (r.kind === 'encounter' && !str(r.fields.location) && !str(r.fields.service_provider)) {
      const practices = new Set(r.provenance.flatMap((p) => practiceNamed(household, idx.person, p)));
      if (practices.size === 1) put('practice', [...practices][0]);
    }
  }
  for (const s of idx.studies) {
    const name = placeName(s.facility);
    const from = new Set(s.provenance.map(signIn));
    if (name) named.push({ person: idx.person, id: s.id, kind: 'study', field: 'facility', name, inSource: inSource(from.size === 1 ? [...from][0]! : `study|${s.id}`, name), provenance: s.provenance, ...(s.date ? { date: s.date } : {}) });
  }
  for (const d of idx.documents) {
    const name = placeName(d.organization);
    if (!name) continue;
    // Papers filed by hand are one source: whoever files them reads the name off the page.
    const source = d.provenance.source.cli ? signIn(d.provenance) : 'papers';
    named.push({ person: idx.person, id: d.id, kind: 'document', field: 'organization', name, inSource: inSource(source, name), provenance: [d.provenance], ...(d.date ? { date: d.date } : {}) });
  }
  namedCache.set(idx, { household, named });
  return named;
}

function practiceNamed(household: Household, person: string, p: Provenance): string[] {
  const { organization_id, cli, fhir_base } = p.source;
  const of = organization_id ? practiceOf(household, person, { organization_id, cli, fhir_base }) : undefined;
  return of?.kind === 'named' ? [of.name] : [];
}

/** Which names are one provider. */
export class Providers {
  private readonly up = new Map<string, string>();
  private readonly members = new Map<string, Named[]>();
  private readonly people = new Set<string>();

  constructor(readonly named: Named[]) {
    // A name that several NPIs go by in its source is none of theirs where no NPI is given.
    const npis = new Map<string, Set<string>>();
    for (const n of named) if (n.npi) npis.set(n.inSource, (npis.get(n.inSource) ?? new Set()).add(n.npi));
    for (const [name, of] of npis) if (of.size === 1) this.up.set(`name|${name}`, `npi|${[...of][0]}`);
    for (const n of named) {
      const id = this.idOf(n);
      const all = this.members.get(id);
      if (all) all.push(n);
      else this.members.set(id, [n]);
      if (PEOPLE.has(n.field)) this.people.add(id);
    }
  }

  /** The provider a name is of. */
  idOf(n: Named): string {
    const name = `name|${n.inSource}`;
    return n.npi ? `npi|${n.npi}` : (this.up.get(name) ?? name);
  }

  /** Whether a name's provider is a person: any item names it as one. A claim may name a person too, as it may a place. */
  isPerson(n: Named): boolean {
    return this.people.has(this.idOf(n));
  }

  /** Every name of the same provider. */
  same(n: Named): Named[] {
    return this.members.get(this.idOf(n)) ?? [];
  }

  /** The others, each as its names. */
  others(n: Named): Named[][] {
    const id = this.idOf(n);
    return [...this.members].flatMap(([of, all]) => (of === id ? [] : [all]));
  }
}

/** The name an item prints in a field, when it names a provider there. */
export function namedOn(idx: PersonIndex, household: Household, id: string, field: ProviderField): Named | undefined {
  return providersNamed(idx, household).find((n) => n.id === id && n.field === field);
}

/** The name behind an event's place: what one of its visits, claims, records or papers prints, and nothing else. */
export function placeNamed(idx: PersonIndex, household: Household, e: CareEvent): Named | undefined {
  if (!e.place) return undefined;
  const of = new Set([...e.visits.map((v) => v.record.id), ...e.claims.map((c) => c.record.id), ...e.recorded.map((r) => r.id), ...e.papers.flatMap((p) => (p.person && p.person !== idx.person ? [] : [p.doc.id]))]);
  const rank = (n: Named) => ['encounter', 'claim'].indexOf(n.kind) + 1 || 3;
  return providersNamed(idx, household)
    .filter((n) => of.has(n.id) && !PEOPLE.has(n.field) && n.name === placeName(e.place))
    .sort((a, b) => rank(a) - rank(b))[0];
}
