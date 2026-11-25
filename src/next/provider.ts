// A provider, and what these records hold of it. Two of the names the items
// print are one provider only by one National Provider Identifier, or as the
// same name in one source (one sign-in, or the papers). Names that are only
// alike are said to be maybe the same, and never put together. A name nothing
// but a sign-in several practices share gives is none's (practiceOf).

import { claimCents, claimLines } from '../model/claims';
import { billList, type Bill } from '../model/billing';
import { isHeld, itemPrivate, knownArea, recordPrivate } from '../model/private';
import { practiceOf } from '../model/practices';
import { nameKey, sameProvider, type ProviderField } from '../model/providers';
import { isWithdrawn, originNames, str } from '../model/records';
import type { Household, ImagingStudy, MedDocument, MedRecord, PendingMark, PersonIndex, Provenance } from '../model/types';
import { placeName, tidyName } from '../model/words';
import { householdEvents, type PersonEvent } from './calendar';
import type { CareEvent } from './event';
import { forShared, mayBePaid, openBills, unbilledShares, type OpenBill } from './money';
import { sharedPapers } from './papers';

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
  /** This name in this source. */
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

/** A name as a key: in any script, and never the same for two that differ. */
const keyOf = (name: string): string => nameKey(name) ?? name;

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
  for (const r of idx.records) {
    if (isWithdrawn(r)) continue;
    const source = sourceOf(r);
    const put = (field: ProviderField, text: string | undefined) => {
      const name = PEOPLE.has(field) ? tidyName(text) : placeName(text);
      if (!name) return;
      const npi = npiOf(r, field);
      named.push({ person: idx.person, id: r.id, kind: r.kind, field, name, inSource: `${source}|${keyOf(name)}`, provenance: r.provenance, ...(r.date ? { date: r.date } : {}), ...(npi ? { npi } : {}) });
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
    if (name) named.push({ person: idx.person, id: s.id, kind: 'study', field: 'facility', name, inSource: `${from.size === 1 ? [...from][0]! : `study|${s.id}`}|${keyOf(name)}`, provenance: s.provenance, ...(s.date ? { date: s.date } : {}) });
  }
  for (const d of idx.documents) {
    const name = placeName(d.organization);
    if (!name) continue;
    // Papers filed by hand are one source: whoever files them reads the name off the page.
    const source = d.provenance.source.cli ? signIn(d.provenance) : 'papers';
    named.push({ person: idx.person, id: d.id, kind: 'document', field: 'organization', name, inSource: `${source}|${keyOf(name)}`, provenance: [d.provenance], ...(d.date ? { date: d.date } : {}) });
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
    }
  }

  /** The provider a name is of. */
  idOf(n: Named): string {
    const name = `name|${n.inSource}`;
    return n.npi ? `npi|${n.npi}` : (this.up.get(name) ?? name);
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

/** What the page reads: the household's items, everyone's for a shared page. */
export interface Records {
  household: Household;
  indexes: Map<string, PersonIndex>;
  today: string;
  /** Payments marked and waiting. */
  marks: readonly PendingMark[];
}

/** An item of a person's. */
const at = (person: string, id: string): string => `${person}|${id}`;
const atNamed = (n: Named): string => at(n.person, n.id);

/** What of it a page may show: one person's items, private ones too, or everyone's with none that is. */
interface Scope {
  people: string[];
  shared: boolean;
  named: Named[];
  events: PersonEvent[];
  /** Those it leaves off too: a bill is private with its visit. */
  allEvents: PersonEvent[];
  record: (person: string, id: string) => boolean;
  document: (person: string, id: string) => boolean;
}

function scopeOf(of: Records, who: string | undefined): Scope {
  const allEvents = householdEvents(of.household, (id) => of.indexes.get(id), of.today);
  const people = of.household.people.map((p) => p.id).filter((id) => of.indexes.has(id) && (!who || id === who));
  const all = people.flatMap((id) => providersNamed(of.indexes.get(id)!, of.household));
  if (who) return { people, shared: false, named: all, events: allEvents.filter((x) => x.person.id === who), allEvents, record: () => true, document: () => true };
  // A record of a private visit stays off with it, whatever is said of the record alone.
  const quiet = new Set(allEvents.flatMap((x) => (x.private ? membersOf(x) : [])));
  const papers = new Set(sharedPapers(of.household, of.indexes, of.today).map((p) => at(p.person, p.doc.id)));
  const record = (person: string, id: string) => {
    const idx = of.indexes.get(person);
    return !!idx && !isHeld(idx) && !recordPrivate(idx, id) && !quiet.has(at(person, id));
  };
  const document = (person: string, id: string) => {
    const idx = of.indexes.get(person);
    return !!idx && !isHeld(idx) && papers.has(at(person, id));
  };
  const study = (person: string, id: string) => {
    const idx = of.indexes.get(person);
    return !!idx && !isHeld(idx) && !itemPrivate(idx, 'study', id);
  };
  const may: Record<string, Scope['record']> = { document, study };
  const named = all.filter((n) => (may[n.kind] ?? record)(n.person, n.id));
  return { people, shared: true, named, events: allEvents.filter((x) => !x.private), allEvents, record, document };
}

/** Every item of an event, each with whose it is. */
const membersOf = ({ person, event: e }: Pick<PersonEvent, 'person' | 'event'>): string[] => [
  ...[...e.claims.map((c) => c.record), ...e.visits.map((v) => v.record), ...e.recorded].map((r) => at(person.id, r.id)),
  ...e.papers.map((p) => at(p.person ?? person.id, p.doc.id)),
];

export interface Mine<T> {
  person: string;
  item: T;
}

/** Another provider a page names, and where it opens. */
export interface Seen {
  named: Named;
  /** In how many of the visits. */
  visits: number;
}

/** Names that are only alike: how many of what they are on, and whose sources print them. */
export interface Alike {
  named: Named;
  names: string[];
  from: string[];
  items: { kind: string; n: number }[];
}

export interface ProviderPage {
  named: Named;
  /** The other ways the same provider is printed, and the sources that print it. */
  also: string[];
  from: string[];
  first?: string;
  last?: string;
  /** Any of its items is private, on a person's own page. */
  private: boolean;
  /** Its own claims' figures, in cents. */
  charged?: number;
  planPaid?: number;
  share?: number;
  open?: number;
  unbilled?: number;
  visits: { event: PersonEvent; share?: number }[];
  /** Other visits that only its papers are with. */
  paperVisits: PersonEvent[];
  /** The claims it billed, and those only made at it. */
  claims: Mine<MedRecord>[];
  placeOf: Mine<MedRecord>[];
  bills: Mine<{ bill: Bill; open?: OpenBill }>[];
  receipts: Mine<MedDocument>[];
  papers: Mine<MedDocument>[];
  tests: Mine<MedRecord>[];
  studies: Mine<ImagingStudy>[];
  medicines: Mine<MedRecord>[];
  vaccines: Mine<MedRecord>[];
  procedures: Mine<MedRecord>[];
  people: Seen[];
  places: Seen[];
  alike: Alike[];
  /** Each person with anything of it here, and the newest item that names it. */
  whose: Named[];
  /** Where everyone's page of it opens, from a person's: none when it is only on private items. */
  everyone?: Named;
}

const newest = <T>(date: (x: T) => string | undefined) => (a: T, b: T) => (date(b) ?? '').localeCompare(date(a) ?? '');
const newestNamed = (all: Named[]): Named => [...all].sort((a, b) => newest<Named>((n) => n.date)(a, b) || a.id.localeCompare(b.id))[0]!;
const add = (a: number | undefined, b: number | undefined) => (b === undefined ? a : (a ?? 0) + b);
const places = (n: Named) => !PEOPLE.has(n.field);

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
    .filter((n) => of.has(n.id) && places(n) && n.name === placeName(e.place))
    .sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * What these records hold of the provider an item names: undefined when the
 * item names none there, or is not one the page may show.
 */
export function providerPage(of: Records, anchor: { person: string; id: string; field: ProviderField }, everyone: boolean): ProviderPage | undefined {
  const scope = scopeOf(of, everyone ? undefined : anchor.person);
  const named = scope.named.find((n) => n.person === anchor.person && n.id === anchor.id && n.field === anchor.field);
  if (!named) return undefined;
  const providers = new Providers(scope.named);
  const same = providers.same(named);
  const ids = new Set(same.map(atNamed));
  // The claims it billed, not those another billed for care at it.
  const billed = new Set(same.filter((n) => n.field === 'provider').map(atNamed));
  const byDate = newest<Mine<{ date?: string }>>((x) => x.item.date);
  const records = scope.people.flatMap((person) => of.indexes.get(person)!.records.filter((r) => ids.has(at(person, r.id))).map((item) => ({ person, item }))).sort(byDate);
  const ofKind = (kind: string) => records.filter((x) => x.item.kind === kind);

  const page: ProviderPage = {
    named,
    also: [...new Set(same.map((n) => n.name))].filter((n) => n !== named.name),
    from: sourcesOf(same, of.household),
    private: !everyone && same.some((n) => isPrivate(of.indexes.get(n.person)!, n)),
    visits: [],
    paperVisits: [],
    claims: ofKind('claim').filter((x) => billed.has(at(x.person, x.item.id))),
    placeOf: ofKind('claim').filter((x) => !billed.has(at(x.person, x.item.id))),
    bills: [],
    receipts: [],
    papers: [],
    tests: [],
    studies: scope.people.flatMap((person) => of.indexes.get(person)!.studies.filter((s) => ids.has(at(person, s.id))).map((item) => ({ person, item }))).sort(byDate),
    medicines: ofKind('medication'),
    vaccines: ofKind('immunization'),
    procedures: ofKind('procedure'),
    people: [],
    places: [],
    alike: alikeTo(providers, named, same, of.household),
    whose: [...new Set(same.map((n) => n.person))].map((p) => newestNamed(same.filter((n) => n.person === p))),
  };
  for (const c of page.claims) {
    const cents = claimCents(c.item);
    page.charged = add(page.charged, cents.billed);
    page.planPaid = add(page.planPaid, cents.planPaid);
    page.share = add(page.share, cents.youOwe);
  }

  const tests = new Map<string, Mine<MedRecord>>();
  const test = (person: string, r: MedRecord | undefined) => {
    if (r && (r.kind === 'result' || r.kind === 'report') && !isWithdrawn(r) && scope.record(person, r.id)) tests.set(at(person, r.id), { person, item: r });
  };
  const namesOf = new Map<string, Named[]>();
  for (const n of scope.named) if (n.kind === 'encounter') namesOf.set(atNamed(n), [...(namesOf.get(atNamed(n)) ?? []), n]);
  const seen = new Map<string, Seen>();
  // A fill is no visit to who prescribed it, nor is a visit one to the pharmacy of a medicine on its list.
  const visited = (e: CareEvent) => new Set(same.filter((n) => n.kind !== 'document' && n.kind !== 'study' && n.field !== 'prescriber' && (n.field !== 'pharmacy' || !e.visits.length)).map(atNamed));
  for (const x of scope.events) {
    const { event: e, person } = x;
    const members = membersOf(x);
    if (!members.some((m) => ids.has(m))) continue;
    const there = e.visits.filter((v) => ids.has(at(person.id, v.record.id)));
    const its = visited(e);
    if (!members.some((m) => its.has(m))) {
      if (e.papers.some((p) => ids.has(at(p.person ?? person.id, p.doc.id)))) page.paperVisits.push(x);
      continue;
    }
    const share = e.claims.filter((c) => billed.has(at(person.id, c.record.id))).reduce((t: number | undefined, c) => add(t, claimCents(c.record).youOwe), undefined);
    page.visits.push({ event: x, ...(share !== undefined ? { share } : {}) });
    // What a visit of several providers recorded is not known to be this one's.
    if (there.length && there.length === e.visits.length) for (const r of e.recorded) test(person.id, r);
    // Who was seen there, or where they were seen: each once for the visit.
    const met = new Map<string, Named>();
    for (const n of there.flatMap((v) => namesOf.get(at(person.id, v.record.id)) ?? [])) if (places(n) !== places(named)) met.set(providers.idOf(n), n);
    for (const [id, n] of met) seen.set(id, { named: seen.get(id)?.named ?? n, visits: (seen.get(id)?.visits ?? 0) + 1 });
  }
  seen.delete(providers.idOf(named));
  const bySeen = (a: Seen, b: Seen) => b.visits - a.visits || a.named.name.localeCompare(b.named.name);
  page.people = [...seen.values()].filter((s) => !places(s.named)).sort(bySeen);
  page.places = [...seen.values()].filter((s) => places(s.named)).sort(bySeen);
  // Tests its claims paid for.
  for (const c of page.claims) {
    const paid = new Set(claimLines(c.item).flatMap((l) => l.records));
    if (paid.size) for (const r of of.indexes.get(c.person)!.records) if (paid.has(r.id)) test(c.person, r);
  }
  page.tests = [...tests.values()].sort(byDate);

  for (const person of scope.people) {
    const idx = of.indexes.get(person)!;
    const events = scope.events.filter((x) => x.person.id === person);
    const shown = <T extends { private?: string; event?: PersonEvent; bill?: Bill }>(xs: T[]): T[] => (scope.shared ? forShared(idx, xs) : xs);
    const open = new Map(shown(openBills(idx, scope.allEvents.filter((x) => x.person.id === person), of.today, of.marks)).map((b) => [b.bill.doc.id, b]));
    // Its own bills, and those medrec matched to a claim of its.
    const mine = billList(idx).filter((b) => scope.document(person, b.doc.id) && (ids.has(at(person, b.doc.id)) || (b.medrec?.claim !== undefined && billed.has(at(person, b.medrec.claim)))));
    for (const bill of mine) {
      const o = open.get(bill.doc.id);
      page.bills.push({ person, item: o ? { bill: o.bill, open: o } : { bill: shown([{ bill }])[0]!.bill } });
      if (o && !o.marked && !mayBePaid(o)) page.open = add(page.open, o.cents);
    }
    for (const u of unbilledShares(idx, events, scope.shared)) {
      if (scope.shared && u.private) continue;
      const charge = u.event.money.charges.find((c) => c.provider === u.provider);
      if (charge?.claims.some((r) => billed.has(at(person, r.id)))) page.unbilled = add(page.unbilled, u.cents);
    }
    const paying = new Set(mine.flatMap((b) => b.payments.flatMap((p) => p.receipt?.id ?? [])));
    for (const d of idx.documents) {
      if (!ids.has(at(person, d.id)) || d.doc_type === 'bill') continue;
      if (d.doc_type !== 'receipt') page.papers.push({ person, item: d });
      else if (!paying.has(d.id)) page.receipts.push({ person, item: d });
    }
  }
  page.bills.sort(newest((x) => x.item.bill.date));
  page.receipts.sort(byDate);
  page.papers.sort(byDate);

  const days = [...page.visits.flatMap((v) => [v.event.event.start, v.event.event.end]), ...same.flatMap((n) => n.date ?? [])].map((d) => d.slice(0, 10)).sort();
  if (days.length) [page.first, page.last] = [days[0], days.at(-1)];

  if (!everyone) {
    const own = new Set(same.map((n) => `${atNamed(n)}|${n.field}`));
    const shared = scopeOf(of, undefined).named.filter((n) => own.has(`${atNamed(n)}|${n.field}`));
    if (shared.length) page.everyone = shared.find((n) => n.id === named.id && n.field === named.field) ?? newestNamed(shared);
  }
  return page;
}

const isPrivate = (idx: PersonIndex, n: Named): boolean => !!knownArea(itemPrivate(idx, n.kind, n.id));

/** The sources that print some names. */
const sourcesOf = (all: Named[], household: Household): string[] => [...new Set(all.flatMap((n) => originNames(n.provenance, household, n.person)))].sort();

/** Providers with a name that is only alike: nothing here says they are the same. */
function alikeTo(providers: Providers, named: Named, same: Named[], household: Household): Alike[] {
  const names = [...new Set(same.map((n) => n.name))];
  const alike = (o: Named) => names.some((n) => keyOf(o.name) === keyOf(n) || sameProvider(o.name, n));
  return providers
    .others(named)
    .filter((all) => all.some(alike))
    .map((all): Alike => {
      const items = new Map<string, Set<string>>();
      for (const n of all) items.set(n.kind, (items.get(n.kind) ?? new Set()).add(atNamed(n)));
      return { named: newestNamed(all), names: [...new Set(all.map((n) => n.name))], from: sourcesOf(all, household), items: [...items].map(([kind, of]) => ({ kind, n: of.size })) };
    })
    .sort((a, b) => total(b) - total(a) || a.named.name.localeCompare(b.named.name));
}

const total = (a: Alike): number => a.items.reduce((t, x) => t + x.n, 0);
