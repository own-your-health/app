// The names the items print, and which of them are one provider: those with
// one National Provider Identifier, and one name in one source (one person's
// sign-in, or their papers), and those with one label of the household's, or
// one medrec is sure of where the records give them no two identifiers
// (model/providerLabels.ts). So the same name in two people's records is one
// provider only by its identifier or such a label. Names the household said
// are not one provider are apart, whatever else they share. Names that are
// only alike, or share a likely label, are never put together; alike ones are
// said to be maybe the same. A name nothing but a sign-in several practices
// share gives is none's (practiceOf).

import { practiceOf } from '../model/practices';
import { labelOn, type OnItem, type ProviderLabels } from '../model/providerLabels';
import type { Privacy } from '../model/private';
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
  /** The exact text, where the item itself prints it. */
  printed?: string;
  /** Its label there. */
  label?: OnItem;
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

const namedCache = new WeakMap<PersonIndex, { household: Household; labels: ProviderLabels | undefined; privacy: Privacy | undefined; named: Named[] }>();

/** Every provider a person's records and papers print. */
export function providersNamed(idx: PersonIndex, household: Household): Named[] {
  const hit = namedCache.get(idx);
  if (hit && hit.household === household && hit.labels === idx.providerLabels && hit.privacy === idx.privacy) return hit.named;
  const named: Named[] = [];
  const inSource = (source: string, name: string) => `${idx.person}|${source}|${keyOf(name)}`;
  /** The text as the item prints it, and its label. */
  const print = (item: string, printed: unknown): Pick<Named, 'printed' | 'label'> => {
    if (typeof printed !== 'string') return {};
    const label = labelOn(idx, item, printed);
    return { printed, ...(label ? { label } : {}) };
  };
  for (const r of idx.records) {
    if (isWithdrawn(r)) continue;
    const source = sourceOf(r);
    const put = (field: ProviderField, text: string | undefined) => {
      const name = PEOPLE.has(field) ? tidyName(text) : placeName(text);
      if (!name) return;
      const npi = npiOf(r, field);
      named.push({ person: idx.person, id: r.id, kind: r.kind, field, name, ...print(r.id, r.fields[field]), inSource: inSource(source, name), provenance: r.provenance, ...(r.date ? { date: r.date } : {}), ...(npi ? { npi } : {}) });
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
    named.push({ person: idx.person, id: d.id, kind: 'document', field: 'organization', name, ...print(d.id, d.organization), inSource: inSource(source, name), provenance: [d.provenance], ...(d.date ? { date: d.date } : {}) });
  }
  namedCache.set(idx, { household, labels: idx.providerLabels, privacy: idx.privacy, named });
  return named;
}

function practiceNamed(household: Household, person: string, p: Provenance): string[] {
  const { organization_id, cli, fhir_base } = p.source;
  const of = organization_id ? practiceOf(household, person, { organization_id, cli, fhir_base }) : undefined;
  return of?.kind === 'named' ? [of.name] : [];
}

/** Names one person's records print that the household said are not one provider. */
export interface Apart {
  person: string;
  printed: readonly string[];
}

/** What the household said of a person's names that keeps them apart; with `closed`, what is private of it too. */
export function saidApart(idx: PersonIndex, closed: boolean): Apart[] {
  const of = idx.providerLabels;
  return [...(of?.open.said ?? []), ...(closed ? (of?.closed.said ?? []) : [])].filter((s) => s.kind === 'different').map((s) => ({ person: idx.person, printed: s.printed }));
}

/** The label that says which provider a name is: the household's, or one medrec is sure of. */
const sureLabel = (n: Named): string | undefined => (n.label && n.label.label.confidence !== 'likely' ? n.label.label.id : undefined);
/** Whether it is the household's. */
const theirs = (n: Named): boolean => n.label?.label.confidence === 'household';

/** The values of each key. */
function byKey<T>(all: readonly T[], key: (x: T) => string, value: (x: T) => string | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const x of all) {
    const v = value(x);
    if (v !== undefined) out.set(key(x), (out.get(key(x)) ?? new Set()).add(v));
  }
  return out;
}

/** Which names are one provider. */
export class Providers {
  /** What each name in a source is of, by the one NPI its records give. */
  private readonly up = new Map<string, string>();
  /** The names in a source that several labels go by. */
  private readonly several = new Set<string>();
  /** The names of a provider the household said are apart. */
  private readonly split = new Set<string>();
  /** A provider put with another by a label. */
  private readonly into = new Map<string, string>();
  private readonly members = new Map<string, Named[]>();
  private readonly people = new Set<string>();

  constructor(
    readonly named: Named[],
    private readonly apart: readonly Apart[] = [],
  ) {
    // A name that several NPIs, or labels, go by in its source is none of theirs where none is given.
    for (const [name, of] of byKey(named, (n) => n.inSource, (n) => n.npi)) if (of.size === 1) this.up.set(`name|${name}`, `npi|${[...of][0]}`);
    for (const [name, of] of byKey(named, (n) => n.inSource, sureLabel)) if (of.size > 1) this.several.add(name);
    for (const a of apart) {
      const mine = named.filter((n) => this.isApart(a, n));
      for (const [id, of] of byKey(mine, (n) => this.byRecords(n), (n) => n.printed)) if (of.size > 1) for (const printed of of) this.split.add(this.splitKey(id, a.person, printed));
    }
    this.join();
    for (const n of named) {
      const id = this.idOf(n);
      const all = this.members.get(id);
      if (all) all.push(n);
      else this.members.set(id, [n]);
      if (PEOPLE.has(n.field)) this.people.add(id);
    }
  }

  /**
   * Puts together the names of one label: the household's, then a sure one
   * that brings no two NPIs together, as a label says no NPI and two
   * providers' can read the same. Never two that hold names the household said
   * are apart.
   */
  private join(): void {
    const labelled = this.named.filter(sureLabel);
    if (!labelled.length) return;
    const names = new Map<string, Named[]>();
    for (const n of this.named) {
      const id = this.ownId(n);
      const all = names.get(id);
      if (all) all.push(n);
      else names.set(id, [n]);
    }
    for (const [sure, of] of [[false, labelled.filter(theirs)], [true, labelled.filter((n) => !theirs(n))]] as const) {
      for (const ids of byKey(of, (n) => sureLabel(n)!, (n) => this.ownId(n)).values()) {
        const all = [...new Set([...ids].map((id) => this.joined(id)))];
        const npis = all.map((id) => new Set(names.get(id)!.flatMap((n) => this.npiOf(n))));
        const both = new Set(npis.flatMap((x) => [...x]));
        if (sure && !npis.some((x) => x.size === both.size)) continue;
        const first = all.find((id) => id.startsWith('npi|')) ?? all[0]!;
        for (const id of all) {
          if (id === first || this.holdApart(names.get(first)!, names.get(id)!)) continue;
          this.into.set(id, first);
          names.set(first, names.get(first)!.concat(names.get(id)!));
        }
      }
    }
  }

  /** Whether two providers, put together, would hold names the household said are apart. */
  private holdApart(a: Named[], b: Named[]): boolean {
    return this.apart.some((x) => new Set([...a, ...b].filter((n) => this.isApart(x, n)).map((n) => n.printed)).size > 1);
  }

  private joined(id: string): string {
    let at = id;
    while (this.into.has(at)) at = this.into.get(at)!;
    return at;
  }

  private isApart(a: Apart, n: Named): boolean {
    return n.person === a.person && n.printed !== undefined && a.printed.includes(n.printed);
  }

  private splitKey(id: string, person: string, printed: string): string {
    return `${id}|${person}|${printed}`;
  }

  /** The provider a name is of by the records alone: its NPI, else its source's. */
  private byRecords(n: Named): string {
    const name = `name|${n.inSource}`;
    if (n.npi) return `npi|${n.npi}`;
    const label = this.several.has(n.inSource) ? sureLabel(n) : undefined;
    return label ? `label|${label}` : (this.up.get(name) ?? name);
  }

  /** The NPI a name goes by, where it has one. */
  private npiOf(n: Named): string[] {
    const id = this.byRecords(n);
    return id.startsWith('npi|') ? [id] : [];
  }

  /** The same, but for names the household said are apart. */
  private ownId(n: Named): string {
    const id = this.byRecords(n);
    const key = n.printed === undefined ? undefined : this.splitKey(id, n.person, n.printed);
    return key !== undefined && this.split.has(key) ? key : id;
  }

  /** The provider a name is of. */
  idOf(n: Named): string {
    return this.joined(this.ownId(n));
  }

  /** Whether the household said that two names are not one provider. */
  saidApart(a: Named, b: Named): boolean {
    return this.apart.some((x) => this.isApart(x, a) && this.isApart(x, b) && a.printed !== b.printed);
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
