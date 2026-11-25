// What these records hold of one provider (providerNames.ts says which names
// are one): its visits, claims, bills, papers and tests, and what they add up
// to, for one person or for everyone. Everyone's is made of the items the
// shared screens show and of nothing else.

import { claimCents, claimLines } from '../model/claims';
import { billList, type Bill } from '../model/billing';
import { isHeld, knownArea, recordPrivate, recordsPrivate, studyPrivate } from '../model/private';
import { sameProvider, type ProviderField } from '../model/providers';
import { isWithdrawn, originNames } from '../model/records';
import type { Household, ImagingStudy, MedDocument, MedRecord, PendingMark, PersonIndex } from '../model/types';
import { householdEvents, type PersonEvent } from './calendar';
import type { CareEvent } from './event';
import { forShared, mayBePaid, openBills, unbilledShares, type OpenBill } from './money';
import { sharedPapers } from './papers';
import { Providers, providersNamed, sameName, type Named } from './providerNames';

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

/** An event's records. */
const recordsOf = (e: CareEvent): MedRecord[] => [...e.claims.map((c) => c.record), ...e.visits.map((v) => v.record), ...e.recorded];

// ---- What a page may show ---------------------------------------------------

/**
 * Which items stay off the screens the household shares. One rule says what
 * everyone's page leaves off and what a person's own page marks.
 */
class Quiet {
  private readonly visits = new Set<string>();
  private readonly papers: Set<string>;
  readonly events: PersonEvent[];

  constructor(private readonly of: Records) {
    this.events = householdEvents(of.household, (id) => of.indexes.get(id), of.today);
    // A record of a private visit stays off with it, whatever is said of the record alone.
    for (const x of this.events) if (x.private) for (const r of recordsOf(x.event)) this.visits.add(at(x.person.id, r.id));
    this.papers = new Set(sharedPapers(of.household, of.indexes, of.today).map((p) => at(p.person, p.doc.id)));
  }

  private index(person: string): PersonIndex {
    return this.of.indexes.get(person)!;
  }

  /** Whether an item is private, by itself or with its visit. One of a person whose items are all held back is not known to be. */
  item(kind: string, person: string, id: string): boolean {
    const idx = this.index(person);
    if (isHeld(idx)) return false;
    if (kind === 'document') return !this.papers.has(at(person, id));
    if (kind === 'study') return this.study(idx, id) !== undefined;
    return recordPrivate(idx, id) !== undefined || this.visits.has(at(person, id));
  }

  /** Why an event is private: its own area, or that of a record of it, as it goes by what its records say. */
  event(x: PersonEvent): string | undefined {
    return x.private ?? recordsPrivate(this.index(x.person.id), recordsOf(x.event).map((r) => r.id));
  }

  /** Whether everyone's page may hold an item. */
  shared(kind: string, person: string, id: string): boolean {
    return !isHeld(this.index(person)) && !this.item(kind, person, id);
  }

  private study(idx: PersonIndex, id: string): string | undefined {
    const study = idx.studies.find((s) => s.id === id);
    return study && studyPrivate(idx, study);
  }
}

/** What of it a page may show: one person's items, private ones too, or everyone's with none that is. */
interface Scope {
  people: string[];
  shared: boolean;
  named: Named[];
  events: PersonEvent[];
  may: (kind: string, person: string, id: string) => boolean;
}

function scopeOf(of: Records, quiet: Quiet, who: string | undefined): Scope {
  const people = of.household.people.map((p) => p.id).filter((id) => of.indexes.has(id) && (!who || id === who));
  const named = people.flatMap((id) => providersNamed(of.indexes.get(id)!, of.household));
  if (who) return { people, shared: false, named, events: quiet.events.filter((x) => x.person.id === who), may: () => true };
  const may = quiet.shared.bind(quiet);
  return { people, shared: true, named: named.filter((n) => may(n.kind, n.person, n.id)), events: quiet.events.filter((x) => !quiet.event(x)), may };
}

// ---- The page ---------------------------------------------------------------

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
  /** Whose records print it. */
  people: string[];
  names: string[];
  from: string[];
  items: { kind: string; n: number }[];
}

export interface Visit {
  event: PersonEvent;
  /** What its own claims there say you owe. */
  share?: number;
  /** Why everyone's page leaves it off. */
  private?: string;
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
  visits: Visit[];
  /** Other visits that only its papers are with. */
  paperVisits: Visit[];
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
const byDate = newest<Mine<{ date?: string }>>((x) => x.item.date);
const add = (a: number | undefined, b: number | undefined) => (b === undefined ? a : (a ?? 0) + b);
/** The sum of what the claims that say it say; undefined when none does. */
const sum = (cents: (number | undefined)[]): number | undefined => cents.reduce<number | undefined>(add, undefined);

/** A provider's items in a scope. */
interface Its {
  of: Records;
  quiet: Quiet;
  scope: Scope;
  providers: Providers;
  named: Named;
  /** Every name of it. */
  same: Named[];
  /** The items that name it, and the claims it billed: not those another billed for care at it. */
  ids: Set<string>;
  billed: Set<string>;
}

/**
 * What these records hold of the provider an item names: undefined when the
 * item names none there, or is not one the page may show.
 */
export function providerPage(of: Records, anchor: { person: string; id: string; field: ProviderField }, everyone: boolean): ProviderPage | undefined {
  const quiet = new Quiet(of);
  const scope = scopeOf(of, quiet, everyone ? undefined : anchor.person);
  const named = scope.named.find((n) => n.person === anchor.person && n.id === anchor.id && n.field === anchor.field);
  if (!named) return undefined;
  const providers = new Providers(scope.named);
  const same = providers.same(named);
  const its: Its = { of, quiet, scope, providers, named, same, ids: new Set(same.map(atNamed)), billed: new Set(same.filter((n) => n.field === 'provider').map(atNamed)) };

  const records = scope.people.flatMap((person) => of.indexes.get(person)!.records.filter((r) => its.ids.has(at(person, r.id))).map((item) => ({ person, item }))).sort(byDate);
  const ofKind = (kind: string) => records.filter((x) => x.item.kind === kind);
  const claims = ofKind('claim').filter((x) => its.billed.has(at(x.person, x.item.id)));
  const cents = claims.map((c) => claimCents(c.item));
  const been = visitsOf(its);
  const money = moneyOf(its);
  const days = [...been.visits.flatMap((v) => [v.event.event.start, v.event.event.end]), ...same.flatMap((n) => n.date ?? [])].map((d) => d.slice(0, 10)).sort();
  const shared = everyone ? [] : everyonesNames(its);
  const isPrivate = same.some((n) => quiet.item(n.kind, n.person, n.id)) || [...been.visits, ...been.paperVisits].some((v) => knownArea(v.private)) || money.bills.some((b) => quiet.item('document', b.person, b.item.bill.doc.id));

  return {
    named,
    also: [...new Set(same.map((n) => n.name))].filter((n) => n !== named.name),
    from: sourcesOf(same, of.household),
    ...(days.length ? { first: days[0], last: days.at(-1) } : {}),
    private: !everyone && isPrivate,
    charged: sum(cents.map((c) => c.billed)),
    planPaid: sum(cents.map((c) => c.planPaid)),
    share: sum(cents.map((c) => c.youOwe)),
    ...money,
    visits: been.visits,
    paperVisits: been.paperVisits,
    claims,
    placeOf: ofKind('claim').filter((x) => !its.billed.has(at(x.person, x.item.id))),
    tests: [...new Map([...been.tests, ...testsPaid(its, claims)].map((t) => [at(t.person, t.item.id), t])).values()].sort(byDate),
    studies: scope.people.flatMap((person) => of.indexes.get(person)!.studies.filter((s) => its.ids.has(at(person, s.id))).map((item) => ({ person, item }))).sort(byDate),
    medicines: ofKind('medication'),
    vaccines: ofKind('immunization'),
    procedures: ofKind('procedure'),
    people: been.met.filter((s) => providers.isPerson(s.named)),
    places: been.met.filter((s) => !providers.isPerson(s.named)),
    alike: alikeTo(its),
    whose: [...new Set(same.map((n) => n.person))].map((p) => newestNamed(same.filter((n) => n.person === p))),
    ...(shared.length ? { everyone: shared.find((n) => n.id === named.id && n.field === named.field) ?? newestNamed(shared) } : {}),
  };
}

/** Its visits, newest first, the visits only its papers are with, the tests that are surely its, and who else was there. */
function visitsOf({ quiet, scope, providers, named, same, ids, billed }: Its): { visits: Visit[]; paperVisits: Visit[]; tests: Mine<MedRecord>[]; met: Seen[] } {
  const visits: Visit[] = [];
  const paperVisits: Visit[] = [];
  const tests: Mine<MedRecord>[] = [];
  const seen = new Map<string, Seen>();
  const namesOf = new Map<string, Named[]>();
  for (const n of scope.named) if (n.kind === 'encounter') namesOf.set(atNamed(n), [...(namesOf.get(atNamed(n)) ?? []), n]);
  // A fill is no visit to who prescribed it, nor is a visit one to the pharmacy of a medicine on its list.
  const visited = (portal: boolean) => new Set(same.filter((n) => n.kind !== 'document' && n.kind !== 'study' && n.field !== 'prescriber' && !(n.field === 'pharmacy' && portal)).map(atNamed));
  const [withPortal, without] = [visited(true), visited(false)];
  for (const x of scope.events) {
    const { event: e, person } = x;
    const area = quiet.event(x);
    const visit: Visit = { event: x, ...(area ? { private: area } : {}) };
    const its = e.visits.length ? withPortal : without;
    if (!recordsOf(e).some((r) => its.has(at(person.id, r.id)))) {
      if (e.papers.some((p) => ids.has(at(p.person ?? person.id, p.doc.id)))) paperVisits.push(visit);
      continue;
    }
    const share = sum(e.claims.filter((c) => billed.has(at(person.id, c.record.id))).map((c) => claimCents(c.record).youOwe));
    visits.push({ ...visit, ...(share !== undefined ? { share } : {}) });
    const there = e.visits.filter((v) => ids.has(at(person.id, v.record.id)));
    // What a visit of several providers recorded is not known to be this one's.
    if (there.length && there.length === e.visits.length) tests.push(...e.recorded.filter((r) => isTest(scope, person.id, r)).map((item) => ({ person: person.id, item })));
    // Who was seen there, or where they were seen: each once for the visit.
    const met = new Map<string, Named>();
    for (const n of there.flatMap((v) => namesOf.get(at(person.id, v.record.id)) ?? [])) if (providers.isPerson(n) !== providers.isPerson(named)) met.set(providers.idOf(n), n);
    for (const [id, n] of met) seen.set(id, { named: seen.get(id)?.named ?? n, visits: (seen.get(id)?.visits ?? 0) + 1 });
  }
  return { visits, paperVisits, tests, met: [...seen.values()].sort((a, b) => b.visits - a.visits || a.named.name.localeCompare(b.named.name)) };
}

const isTest = (scope: Scope, person: string, r: MedRecord): boolean => (r.kind === 'result' || r.kind === 'report') && !isWithdrawn(r) && scope.may(r.kind, person, r.id);

/** The tests its claims paid for. */
function testsPaid({ of, scope }: Its, claims: Mine<MedRecord>[]): Mine<MedRecord>[] {
  return claims.flatMap((c) => {
    const paid = new Set(claimLines(c.item).flatMap((l) => l.records));
    return of.indexes.get(c.person)!.records.filter((r) => paid.has(r.id) && isTest(scope, c.person, r)).map((item) => ({ person: c.person, item }));
  });
}

/** Its bills and what they leave to pay, the shares no bill has asked for, and its other papers. */
function moneyOf({ of, quiet, scope, ids, billed }: Its): Pick<ProviderPage, 'bills' | 'receipts' | 'papers' | 'open' | 'unbilled'> {
  const bills: ProviderPage['bills'] = [];
  const receipts: ProviderPage['receipts'] = [];
  const papers: ProviderPage['papers'] = [];
  let open: number | undefined;
  let unbilled: number | undefined;
  for (const person of scope.people) {
    const idx = of.indexes.get(person)!;
    // As Money lists them: on everyone's, no bill says a private receipt paid it.
    const shown = <T extends { private?: string; event?: PersonEvent; bill?: Bill }>(xs: T[]): T[] => (scope.shared ? forShared(idx, xs) : xs);
    const asking = new Map(shown(openBills(idx, quiet.events.filter((x) => x.person.id === person), of.today, of.marks)).map((b) => [b.bill.doc.id, b]));
    // Its own bills, and those medrec matched to a claim of its.
    const mine = billList(idx).filter((b) => scope.may('document', person, b.doc.id) && (ids.has(at(person, b.doc.id)) || (b.medrec?.claim !== undefined && billed.has(at(person, b.medrec.claim)))));
    for (const bill of mine) {
      const o = asking.get(bill.doc.id);
      bills.push({ person, item: o ? { bill: o.bill, open: o } : { bill: shown([{ bill }])[0]!.bill } });
      if (o && !o.marked && !mayBePaid(o)) open = add(open, o.cents);
    }
    // A visit's charge holds the claims of every name like its own: only this provider's count.
    for (const u of unbilledShares(idx, scope.events.filter((x) => x.person.id === person), scope.shared)) {
      const own = u.event.money.charges.find((c) => c.provider === u.provider)?.claims.filter((r) => billed.has(at(person, r.id))) ?? [];
      unbilled = add(unbilled, sum(own.map((r) => claimCents(r).youOwe)));
    }
    const paying = new Set(mine.flatMap((b) => b.payments.flatMap((p) => p.receipt?.id ?? [])));
    for (const d of idx.documents) {
      if (!ids.has(at(person, d.id)) || d.doc_type === 'bill') continue;
      if (d.doc_type !== 'receipt') papers.push({ person, item: d });
      else if (!paying.has(d.id)) receipts.push({ person, item: d });
    }
  }
  return { bills: bills.sort(newest((x) => x.item.bill.date)), receipts: receipts.sort(byDate), papers: papers.sort(byDate), ...(open !== undefined ? { open } : {}), ...(unbilled ? { unbilled } : {}) };
}

/** Those of its names everyone's page holds too. */
function everyonesNames({ quiet, same }: Its): Named[] {
  return same.filter((n) => quiet.shared(n.kind, n.person, n.id));
}

/** The sources that print some names. */
const sourcesOf = (all: Named[], household: Household): string[] => [...new Set(all.flatMap((n) => originNames(n.provenance, household, n.person)))].sort();

/** Providers with a name that is only alike: nothing here says they are the same. */
function alikeTo({ of, providers, named, same }: Its): Alike[] {
  const names = [...new Set(same.map((n) => n.name))];
  const alike = (o: Named) => names.some((n) => sameName(o.name, n) || sameProvider(o.name, n));
  return providers
    .others(named)
    .filter((all) => all.some(alike))
    .map((all): Alike => {
      const items = new Map<string, Set<string>>();
      for (const n of all) items.set(n.kind, (items.get(n.kind) ?? new Set()).add(atNamed(n)));
      return { named: newestNamed(all), people: [...new Set(all.map((n) => n.person))], names: [...new Set(all.map((n) => n.name))], from: sourcesOf(all, of.household), items: [...items].map(([kind, all]) => ({ kind, n: all.size })) };
    })
    .sort((a, b) => total(b) - total(a) || a.named.name.localeCompare(b.named.name));
}

const total = (a: Alike): number => a.items.reduce((t, x) => t + x.n, 0);
