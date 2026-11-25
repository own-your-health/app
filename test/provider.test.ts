// A provider's page: which names are one provider, what it holds, and what
// everyone's leaves off.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { claimCents } from '../src/model/claims';
import { resultPoint } from '../src/model/records';
import type { Household, MedRecord, PersonIndex } from '../src/model/types';
import { personEvents } from '../src/next/load';
import { namedOn, placeNamed, providerPage, Providers, providersNamed, type Named, type ProviderPage } from '../src/next/provider';
import type { ProviderField } from '../src/model/providers';
import { demoFolderWith, privateCase, type Overlay } from './helpers';
import { ALEX, DREW, ROBIN, SAM } from './sample';

const TODAY = '2026-11-22';

async function load(overlay: Overlay = {}): Promise<Store> {
  const store = new Store(demoFolderWith(overlay));
  await store.load();
  return store;
}

const SAMPLE = await load();
const MARKED = await load(privateCase('marked'));
const UNREADABLE = await load(privateCase('unreadable'));

const index = (person: string, store = SAMPLE) => store.index(person)!;
/** The newest record that names a provider in a field. */
const anchor = (person: string, field: ProviderField, name: string, kind?: string, store = SAMPLE): Named => {
  const all = providersNamed(index(person, store), store.household).filter((n) => n.field === field && n.name === name && (!kind || n.kind === kind));
  return all.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!;
};
const pageOf = (n: { person: string; id: string; field: ProviderField }, everyone = false, store = SAMPLE, indexes = store.indexes) => providerPage({ household: store.household, indexes, today: TODAY, marks: store.marks }, n, everyone);
const withIndex = (person: string, change: (idx: PersonIndex) => PersonIndex, store = SAMPLE) => new Map([...store.indexes].map(([id, idx]) => [id, id === person ? change(idx) : idx]));
const days = (p: ProviderPage) => p.visits.map((v) => `${v.event.person.name.split(' ')[0]} ${v.event.event.start}`);
const names = (p: ProviderPage) => p.alike.map((a) => [a.names.join(', '), a.items.map((i) => `${i.n} ${i.kind}`).join(', ')]);

describe('which names are one provider', () => {
  let n = 0;
  const named = (inSource: string, npi?: string, over: Partial<Named> = {}): Named => ({ person: 'p_a', id: `r_${n++}`, kind: 'claim', field: 'provider', name: 'Example Name', inSource, provenance: [], ...(npi ? { npi } : {}), ...over });
  const same = (all: Named[]) => {
    const providers = new Providers(all);
    return all.map((x) => all.findIndex((y) => providers.idOf(y) === providers.idOf(x)));
  };

  it('are those with one NPI, in any source and by any name, and one name in one source', () => {
    expect(same([named('a|one', '1'), named('b|two', '1'), named('c|one', '2')])).toEqual([0, 0, 2]);
    expect(same([named('a|one'), named('a|one'), named('b|one'), named('a|two')])).toEqual([0, 0, 2, 3]);
  });

  it('put a name with no NPI with the one its source gives that name, and with none of several', () => {
    expect(same([named('a|one'), named('a|one', '1'), named('b|two', '1'), named('b|two')])).toEqual([0, 0, 0, 0]);
    expect(same([named('a|one'), named('a|one', '1'), named('a|one', '2'), named('a|one')])).toEqual([0, 1, 2, 0]);
  });

  it('give each provider’s names, and every other provider’s', () => {
    const all = [named('a|one'), named('b|one'), named('a|one')];
    const providers = new Providers(all);
    expect(providers.same(all[0]!)).toEqual([all[0], all[2]]);
    expect(providers.others(all[0]!)).toEqual([[all[1]]]);
    expect(providers.same(named('z|none'))).toEqual([]);
  });
});

describe('the names items print', () => {
  const read = (change: (idx: PersonIndex) => PersonIndex, household: Household = SAMPLE.household, person = ROBIN) => providersNamed(change(index(person)), household);
  const visit = index(ROBIN).records.find((r) => r.kind === 'encounter')!;
  const withVisit = (fields: MedRecord['fields'], over: Partial<MedRecord> = {}, household?: Household) =>
    read((idx) => ({ ...idx, documents: [], studies: [], records: [{ ...visit, fields: { ...fields }, ...over }] }), household);
  const fields = (all: Named[]) => all.map((n) => [n.field, n.name]);

  it('are each kind’s own fields, tidied, and a place is never a records connection', () => {
    expect(fields(withVisit({ location: 'Example Pharmacy #1234  1234', practitioner: 'Dr. Riley  Sample', performer: 'Example Other' }))).toEqual([
      ['location', 'Example Pharmacy #1234'],
      ['practitioner', 'Dr. Riley Sample'],
    ]);
    expect(fields(withVisit({ location: 'MyChart (Example Health)', service_provider: 'Example Records (all practices)' }))).toEqual([]);
    expect(new Set(read((idx) => idx).map((n) => `${n.kind} ${n.field}`))).toEqual(
      new Set(['claim provider', 'encounter location', 'encounter practitioner', 'medication prescriber', 'medication pharmacy', 'immunization performer', 'document organization']),
    );
    expect(withVisit({ location: 'Example Clinic' }, { status: 'entered-in-error' })).toEqual([]);
  });

  it('give the NPI its source states for that field, and none where it states two', () => {
    const npis = (providers: unknown) => withVisit({ location: 'Example Clinic', practitioner: 'Dr. Riley Sample' }, { providers: providers as MedRecord['providers'] }).map((n) => n.npi);
    expect(npis([{ field: 'practitioner', npi: '0000000097' }, { field: 'provider', npi: '0000000105' }])).toEqual([undefined, '0000000097']);
    expect(npis([{ field: 'practitioner', npi: '0000000097' }, { field: 'practitioner', npi: '0000000105' }])).toEqual([undefined, undefined]);
    for (const odd of [undefined, null, 'x', {}, [null, 'x', ['y'], { field: 'practitioner' }, { field: 'practitioner', npi: 1 }, { field: 'practitioner', npi: '' }]]) expect(npis(odd)).toEqual([undefined, undefined]);
  });

  it('take the practice of the visit’s sign-in where it names no place, and never one several share', () => {
    const practice = (change: (h: Household) => Household, extra = {}) => fields(withVisit(extra, {}, change(SAMPLE.household)));
    const own = (h: Household) => h;
    expect(practice(own)).toEqual([['practice', 'Example Health']]);
    expect(practice(own, { location: 'Example Clinic' })).toEqual([['location', 'Example Clinic']]);
    expect(practice(own, { service_provider: 'Example Clinic' })).toEqual([['service_provider', 'Example Clinic']]);
    const source = SAMPLE.household.sources.find((s) => s.person === ROBIN && s.organization_name === 'Example Health')!;
    expect(practice((h) => ({ ...h, sources: [...h.sources, { ...source, id: 's_other', organization_name: 'Example Second Practice' }] }))).toEqual([]);
    expect(practice((h) => ({ ...h, organizations: [], sources: h.sources.filter((s) => s.id !== source.id) }))).toEqual([]);
    expect(practice((h) => ({ ...h, sources: h.sources.map((s) => (s.id === source.id ? { ...s, organization_name: 'Example Records (all practices)' } : s)) }))).toEqual([]);
  });

  it('are in their record’s one source, and one several sources state in none but its own', () => {
    const [p] = visit.provenance;
    const source = (provenance: MedRecord['provenance']) => withVisit({ location: 'Example Clinic, LLC' }, { provenance })[0]!.inSource;
    const other = { ...p!, source: { ...p!.source, organization_id: 'example-other' } };
    expect(source([p!])).toBe(source([p!, { ...p!, source: { ...p!.source, fhir_base: `${p!.source.fhir_base}/` } }]));
    expect(source([p!])).not.toBe(source([other]));
    expect(source([p!, other])).toContain(visit.id);
    expect(source([p!])).toMatch(/\|example clinic$/);
    expect(source([p!])).not.toBe(source([{ ...p!, source: { ...p!.source, fhir_base: 'https://other.example.com/fhir' } }]));
    const papers = providersNamed(index(ROBIN), SAMPLE.household).filter((x) => x.kind === 'document' && x.name === 'Example Health');
    expect(new Set(papers.map((x) => x.inSource)).size).toBe(2);
  });

  it('are none of a paper or a record that prints none, and are read again for another household', () => {
    const paper = index(ROBIN).documents[0]!;
    const papers = (over: object) => read((idx) => ({ ...idx, records: [], studies: [], documents: [{ ...paper, ...over }] }));
    expect([fields(papers({})), papers({ organization: undefined }), papers({ organization: '  ' }), papers({ organization: 'MyChart (Example Health)' })]).toEqual([[['organization', 'Example Health']], [], [], []]);
    const one = { ...index(ROBIN), documents: [], studies: [], records: [{ ...visit, fields: {} }] };
    const unnamed: Household = { ...SAMPLE.household, organizations: [], sources: [] };
    expect([fields(providersNamed(one, SAMPLE.household)), providersNamed(one, unnamed), fields(providersNamed(one, SAMPLE.household))]).toEqual([[['practice', 'Example Health']], [], [['practice', 'Example Health']]]);
    expect(providersNamed(one, SAMPLE.household)).toBe(providersNamed(one, SAMPLE.household));
  });

  it('are an imaging study’s facility too', () => {
    const study = [...SAMPLE.indexes.values()].flatMap((idx) => idx.studies)[0]!;
    const put = (over: object) => read((idx) => ({ ...idx, records: [], documents: [], studies: [{ ...study, facility: 'Example Imaging', ...over }] }));
    expect(fields(put({}))).toEqual([['facility', 'Example Imaging']]);
    expect(put({ facility: undefined })).toEqual([]);
    expect(put({ provenance: [study.provenance[0]!, { ...study.provenance[0]!, source: { kind: 'media', cli: 'other' } }] })[0]!.inSource).toContain(study.id);
  });
});

describe('a provider’s page', () => {
  const health = pageOf(anchor(ROBIN, 'provider', 'Example Health'))!;

  it('adds up what its own claims say, what its bills leave to pay, and the shares with no bill', () => {
    const claims = index(ROBIN).records.filter((r) => r.kind === 'claim' && r.fields.provider === 'Example Health');
    expect(health.claims.map((c) => c.item.id).sort()).toEqual(claims.map((r) => r.id).sort());
    const sum = (key: 'billed' | 'planPaid' | 'youOwe') => claims.reduce((t, r) => t + (claimCents(r)[key] ?? 0), 0);
    expect([health.charged, health.planPaid, health.share]).toEqual([sum('billed'), sum('planPaid'), sum('youOwe')]);
    expect([health.charged, health.planPaid, health.share, health.open, health.unbilled]).toEqual([117900, 62804, 12986, 5368, 2500]);
  });

  it('lists its visits newest first with its own share of each, and its first and last day', () => {
    expect(health.visits.map((v) => [v.event.event.start, v.share])).toEqual([
      ['2026-11-18', 2500],
      ['2026-10-01', 5368],
      ['2025-09-15', 0],
      ['2025-03-10', 5118],
    ]);
    expect([health.first, health.last, health.named.name, health.also]).toEqual(['2025-03-10', '2026-11-18', 'Example Health', []]);
    expect([health.private, health.whose.map((w) => w.person), health.everyone?.id]).toEqual([false, [ROBIN], health.named.id]);
  });

  it('lists the bills medrec matched to its claims, and the tests its claims paid for', () => {
    expect(health.bills.map((b) => [b.item.bill.amount?.amount, b.item.bill.settled, b.item.open?.cents])).toEqual([['53.68', false, 5368], ['51.18', true, undefined]]);
    expect(health.tests).toHaveLength(8);
    expect(new Set(health.tests.map((t) => t.item.date!.slice(0, 10)))).toEqual(new Set(['2025-03-10']));
    expect(resultPoint(health.tests[0]!.item)).toBeDefined();
    // A bill medrec ties to no claim of it, of another name, is not its.
    const states = new Map([...index(ROBIN).bills!.states].map(([id, s]) => [id, { ...s, claim: undefined }]));
    const loose = pageOf(anchor(ROBIN, 'provider', 'Example Health'), false, SAMPLE, withIndex(ROBIN, (idx) => ({ ...idx, bills: { ...idx.bills!, states } })))!;
    expect([loose.bills, loose.open, loose.share]).toEqual([[], undefined, 12986]);
  });

  it('keeps alike names apart, with how many items each is on and whose sources print them', () => {
    expect(names(health)).toEqual([
      ['Example Health Main Clinic', '4 encounter, 3 immunization'],
      ['Example Health', '4 document'],
      ['Example Health', '3 document'],
      ['Example Health Plan', '1 document'],
    ]);
    expect(health.alike.map((a) => a.from)).toEqual([['Example Health'], ['Scanned'], ['Example Health'], ['Example Health Plan']]);
    // Each of them is a page of its own, which names this one as alike.
    const clinic = pageOf(health.alike[0]!.named)!;
    expect([clinic.claims, clinic.charged, clinic.tests.length, clinic.vaccines.length]).toEqual([[], undefined, 27, 3]);
    expect(names(clinic)).toContainEqual(['Example Health', '4 claim']);
  });

  it('is of one provider in two sources by one NPI, and says the other ways it is printed', () => {
    const claim = health.claims[0]!.item;
    const npi = (claim.providers as { field: string; npi: string }[]).find((x) => x.field === 'provider')!.npi;
    const visit = index(ROBIN).records.find((r) => r.kind === 'encounter')!;
    const joined = withIndex(ROBIN, (idx) => ({ ...idx, records: idx.records.map((r) => (r.kind === 'encounter' ? { ...r, providers: [{ field: 'location', npi }] } : r)) }));
    const page = pageOf(anchor(ROBIN, 'provider', 'Example Health'), false, SAMPLE, joined)!;
    expect([page.also, page.claims.length, page.tests.length]).toEqual([['Example Health Main Clinic'], 4, 27]);
    expect(page.from).toEqual(['Example Health', 'Example Health Plan']);
    expect(pageOf({ person: ROBIN, id: visit.id, field: 'location' }, false, SAMPLE, joined)!.charged).toBe(117900);
    expect(page.alike.map((a) => a.names[0])).toEqual(['Example Health', 'Example Health', 'Example Health Plan']);
  });

  it('names who was seen at a place and where a person was seen, each visit once', () => {
    const place = pageOf(anchor(ROBIN, 'location', 'Example Health Main Clinic'))!;
    expect([place.people.map((s) => [s.named.name, s.visits]), place.places]).toEqual([[['Dr. Jordan Sample', 4]], []]);
    const doctor = pageOf(anchor(ROBIN, 'practitioner', 'Dr. Jordan Sample'))!;
    expect([doctor.places.map((s) => [s.named.name, s.visits]), doctor.people]).toEqual([[['Example Health Main Clinic', 4]], []]);
  });

  it('takes no fill as a visit to who prescribed it, nor a visit as one to a pharmacy on its list', () => {
    const doctor = pageOf(anchor(ROBIN, 'practitioner', 'Dr. Jordan Sample'))!;
    expect(doctor.visits.map((v) => v.event.event.kind)).toEqual(['office', 'office', 'office', 'office']);
    expect(doctor.medicines.length).toBeGreaterThan(4);
    const pharmacy = pageOf(anchor(ROBIN, 'pharmacy', 'Example Pharmacy'))!;
    expect(new Set(pharmacy.visits.map((v) => v.event.event.visits.length))).toEqual(new Set([0]));
    expect(pharmacy.visits.length).toBeGreaterThan(0);
  });

  it('takes what was recorded on a day at two places as neither’s', () => {
    const visit = index(ROBIN).records.find((r) => r.kind === 'encounter' && r.date!.startsWith('2026-11-18'))!;
    const second: MedRecord = { ...visit, id: 'r_second', fields: { ...visit.fields, location: 'Example Health Annex' } };
    const both = withIndex(ROBIN, (idx) => ({
      ...idx,
      records: [...idx.records, second],
      events: { ...idx.events!, events: idx.events!.events.map((e) => ({ ...e, members: e.members.flatMap((m) => (m.record === visit.id ? [m, { ...m, record: second.id }] : [m])) })) },
    }));
    const clinic = pageOf({ person: ROBIN, id: visit.id, field: 'location' }, false, SAMPLE, both)!;
    const annex = pageOf({ person: ROBIN, id: second.id, field: 'location' }, false, SAMPLE, both)!;
    expect([clinic.visits[0]!.event.event.visits.length, annex.visits.length]).toEqual([2, 1]);
    expect([clinic.tests.length, clinic.tests.some((t) => t.item.date!.startsWith('2026-11-18')), annex.tests]).toEqual([25, false, []]);
    // The doctor both name was seen once at each, and the day is one visit.
    expect(annex.people.map((s) => [s.named.name, s.visits])).toEqual([['Dr. Jordan Sample', 1]]);
    expect(clinic.people.map((s) => [s.named.name, s.visits])).toEqual([['Dr. Jordan Sample', 4]]);
  });

  it('lists a visit only its papers are with apart', () => {
    const billing = pageOf(anchor(SAM, 'organization', 'Example Billing'))!;
    expect([billing.visits, billing.paperVisits.map((x) => x.event.start), billing.claims, billing.bills.length, billing.open]).toEqual([[], ['2026-07-09'], [], 1, 12000]);
    // Its dates are its papers', as it has no visit.
    expect([billing.first, billing.last]).toEqual(['2026-07-09', '2026-07-09']);
    // Another provider's paper with the same visit changes nothing.
    const doc = billing.bills[0]!.item.bill.doc;
    const letter = { ...doc, id: 'd_letter', doc_type: 'letter', organization: 'Example Other' };
    const both = withIndex(SAM, (idx) => ({
      ...idx,
      documents: [...idx.documents, letter],
      events: { ...idx.events!, events: idx.events!.events.map((e) => ({ ...e, members: e.members.flatMap((m) => (m.document === doc.id ? [m, { ...m, document: letter.id }] : [m])) })) },
    }));
    expect(pageOf(anchor(SAM, 'organization', 'Example Billing'), false, SAMPLE, both)!.paperVisits.map((x) => [x.event.start, x.event.papers.length])).toEqual([['2026-07-09', 2]]);
  });

  it('lists its papers newest first, its bills and receipts with the payments, and a receipt of no bill there by itself', () => {
    const byHand = anchor(ROBIN, 'organization', 'Example Health', 'document');
    const filed = index(ROBIN).documents.filter((d) => d.organization === 'Example Health' && !d.provenance.source.cli);
    const hand = pageOf({ person: ROBIN, id: filed[0]!.id, field: 'organization' })!;
    const type = (xs: { item: { doc_type?: string; date?: string } }[]) => xs.map((x) => `${x.item.doc_type} ${x.item.date}`);
    expect([type(hand.papers), hand.bills.map((b) => b.item.bill.doc.date), type(hand.receipts)]).toEqual([['immunization_record 2024-02-11'], ['2026-10-01', '2025-04-02'], []]);
    expect(hand.open).toBe(5368);
    const portal = pageOf(byHand.provenance[0]!.source.cli ? byHand : { person: ROBIN, id: index(ROBIN).documents.find((d) => d.doc_type === 'lab_report' && d.organization === 'Example Health')!.id, field: 'organization' })!;
    expect([type(portal.papers), portal.bills, portal.receipts]).toEqual([['lab_report 2026-11-18', 'visit_summary 2026-10-01', 'lab_report 2026-10-01'], [], []]);
    // With its bill's payments gone, the receipt is listed by itself.
    const states = new Map([...index(ROBIN).bills!.states].map(([id, s]) => [id, { ...s, payments: [] }]));
    const loose = pageOf({ person: ROBIN, id: filed[0]!.id, field: 'organization' }, false, SAMPLE, withIndex(ROBIN, (idx) => ({ ...idx, bills: { ...idx.bills!, states } })))!;
    expect([type(loose.receipts), type(loose.papers)]).toEqual([['receipt 2025-04-20'], ['immunization_record 2024-02-11']]);
  });

  it('names the newest item of each person’s, and everyone’s page by the item the link named', () => {
    for (const n of SAMPLE.household.people.flatMap((p) => providersNamed(index(p.id), SAMPLE.household))) {
      const page = pageOf(n)!;
      const all = new Providers(providersNamed(index(n.person), SAMPLE.household)).same(n);
      const newest = all.map((x) => x.date ?? '').sort().at(-1)!;
      expect(page.whose.map((w) => [w.date ?? '', w.id])).toEqual([[newest, all.filter((x) => (x.date ?? '') === newest).map((x) => x.id).sort()[0]]]);
      // A private item's link has everyone's page open by another, where there is one.
      const shared = pageOf(n, true);
      if (shared) expect([page.everyone?.id, page.everyone?.field]).toEqual([n.id, n.field]);
      else if (page.everyone) expect(pageOf(page.everyone, true)).toBeDefined();
    }
    // One with no date is older than any.
    const ids = index(ROBIN).records.filter((r) => r.kind === 'claim' && r.fields.provider === 'Example Health').map((r) => r.id);
    const undated = withIndex(ROBIN, (idx) => ({ ...idx, records: idx.records.map((r) => (r.id === health.named.id ? { ...r, date: undefined } : r)) }));
    const page = pageOf({ person: ROBIN, id: ids.find((id) => id !== health.named.id)!, field: 'provider' }, false, SAMPLE, undated)!;
    expect([page.whose[0]!.date?.slice(0, 10), page.claims.at(-1)!.item.id]).toEqual(['2026-10-01', health.named.id]);
  });

  it('lists who was seen most first, and then by name', () => {
    const visits = index(ROBIN).records.filter((r) => r.kind === 'encounter');
    const doctors = ['Dr. Zoe Sample', 'Dr. Blake Sample', 'Dr. Zoe Sample', 'Dr. Ari Sample'];
    const named = withIndex(ROBIN, (idx) => ({ ...idx, records: idx.records.map((r) => (r.kind === 'encounter' ? { ...r, providers: [], fields: { ...r.fields, practitioner: doctors[visits.findIndex((v) => v.id === r.id)]! } } : r)) }));
    const page = pageOf({ person: ROBIN, id: visits[0]!.id, field: 'location' }, false, SAMPLE, named)!;
    expect(page.people.map((s) => [s.named.name, s.visits])).toEqual([['Dr. Zoe Sample', 2], ['Dr. Ari Sample', 1], ['Dr. Blake Sample', 1]]);
  });

  it('lists the alike by how many items they are on, and one with any name alike', () => {
    const claims = index(ROBIN).records.filter((r) => r.kind === 'claim');
    const put = (id: string, name: string, npi: string): MedRecord => ({ ...claims[0]!, id, fields: { ...claims[0]!.fields, provider: name }, providers: [{ field: 'provider', npi }] });
    const added = withIndex(ROBIN, (idx) => ({ ...idx, records: [...idx.records, put('r_x1', 'Example Health West', '0000000001'), put('r_x2', 'Sample Physicians', '0000000001'), put('r_x3', 'Example Health East', '0000000002')] }));
    const page = pageOf(anchor(ROBIN, 'provider', 'Example Health'), false, SAMPLE, added)!;
    const counts = page.alike.map((a) => a.items.reduce((t, x) => t + x.n, 0));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(page.alike.map((a) => a.names.join(', '))).toEqual(['Example Health Main Clinic', 'Example Health', 'Example Health', 'Example Health West, Sample Physicians', 'Example Health East', 'Example Health Plan']);
  });

  it('counts a visit’s share with no bill where any of its claims there is the provider’s', () => {
    const claim = health.claims[0]!.item;
    const twin: MedRecord = { ...claim, id: 'r_twin', provenance: claim.provenance.map((p) => ({ ...p, source: { ...p.source, organization_id: 'example-other' } })), providers: [] };
    const two = withIndex(ROBIN, (idx) => ({
      ...idx,
      records: [...idx.records, twin],
      events: { ...idx.events!, events: idx.events!.events.map((e) => ({ ...e, members: e.members.flatMap((m) => (m.record === claim.id ? [m, { ...m, record: twin.id }] : [m])) })) },
    }));
    const page = pageOf(anchor(ROBIN, 'provider', 'Example Health'), false, SAMPLE, two)!;
    expect([page.claims.length, page.unbilled]).toEqual([4, 5000]);
  });

  it('lists a claim another billed for care there apart, and adds none of it', () => {
    const center = anchor(SAM, 'facility', 'Example Endoscopy Center');
    const page = pageOf(center)!;
    expect([page.claims.map((c) => c.item.fields.provider), page.placeOf.map((c) => c.item.fields.provider)]).toEqual([['Example Endoscopy Center'], page.placeOf.map(() => 'Example Digestive Health')]);
    expect(page.charged).toBe(claimCents(page.claims[0]!.item).billed);
  });

  it('is of nothing where the item names no provider there', () => {
    expect(pageOf({ person: ROBIN, id: health.named.id, field: 'pharmacy' })).toBeUndefined();
    expect(pageOf({ person: ROBIN, id: 'r_none', field: 'provider' })).toBeUndefined();
    expect(pageOf({ person: SAM, id: health.named.id, field: 'provider' })).toBeUndefined();
    expect(pageOf({ person: 'p_none', id: health.named.id, field: 'provider' })).toBeUndefined();
    expect(namedOn(index(ROBIN), SAMPLE.household, health.named.id, 'facility')).toBeUndefined();
    expect(namedOn(index(ROBIN), SAMPLE.household, health.named.id, 'provider')).toMatchObject({ id: health.named.id, name: 'Example Health' });
  });
});

describe('everyone’s page', () => {
  it('holds each person’s of the provider, and opens each one’s own', () => {
    const page = pageOf(anchor(ROBIN, 'provider', 'Example Health'), true)!;
    expect([page.claims.length, page.charged, page.unbilled, page.whose.map((w) => w.person)]).toEqual([5, 158400, 8140, [ROBIN, SAM]]);
    expect(days(page)).toEqual(['Robin 2026-11-18', 'Robin 2026-10-01', 'Sam 2026-05-20', 'Robin 2025-09-15', 'Robin 2025-03-10']);
    expect([page.private, page.everyone]).toEqual([false, undefined]);
    const pediatrics = pageOf(anchor(ALEX, 'location', 'Example Pediatrics'), true)!;
    expect(pediatrics.whose.map((w) => w.person)).toEqual([ALEX, DREW]);
  });

  it('holds nothing of a provider named only by private items, and its own person’s marks them', () => {
    const clinic = anchor(SAM, 'provider', 'Example Sexual Health Clinic');
    const own = pageOf(clinic)!;
    expect([own.private, own.everyone, own.charged, own.unbilled, own.visits.length]).toEqual([true, undefined, 23400, 2000, 1]);
    expect(pageOf(clinic, true)).toBeUndefined();
    for (const everyone of SAMPLE.household.people.flatMap((p) => providersNamed(index(p.id), SAMPLE.household)).map((n) => pageOf(n, true))) {
      const all = JSON.stringify([everyone?.named, everyone?.alike, everyone?.people, everyone?.places, everyone?.also]);
      expect(all).not.toContain('Sexual Health');
      expect(all).not.toContain('Dr. Avery Sample');
    }
  });

  it('holds no private record, nor a record of a private visit, of a provider it shows', () => {
    const lab = anchor(SAM, 'provider', 'Example Lab');
    const whole = pageOf(lab, true)!;
    const id = whole.claims.find((c) => c.person === SAM)!.item.id;
    const held = (change: (p: Extract<NonNullable<PersonIndex['privacy']>, { kind: 'known' }>) => object) =>
      withIndex(SAM, (idx) => {
        if (idx.privacy?.kind !== 'known') throw new Error('not known');
        return { ...idx, privacy: { ...idx.privacy, ...change(idx.privacy) } };
      });
    const without = (p: ProviderPage) => [p.claims.some((c) => c.item.id === id), p.charged];
    const charged = whole.charged! - claimCents(whole.claims.find((c) => c.item.id === id)!.item).billed!;
    expect(without(pageOf(anchor(ROBIN, 'provider', 'Example Lab'), true, SAMPLE, held((p) => ({ records: new Map([...p.records, [id, 'household']]) })))!)).toEqual([false, charged]);
    const event = personEvents(index(SAM), SAMPLE.household, TODAY).find((e) => e.claims.some((c) => c.record.id === id))!;
    const visit = pageOf(anchor(ROBIN, 'provider', 'Example Lab'), true, SAMPLE, held((p) => ({ events: new Map([...p.events, [event.id, 'household']]) })))!;
    expect(without(visit)).toEqual([false, charged]);
    expect(days(visit)).not.toContain(`Sam ${event.start}`);
    // On Sam's own page it stays, marked.
    const own = pageOf({ person: SAM, id, field: 'provider' }, false, SAMPLE, held((p) => ({ records: new Map([...p.records, [id, 'household']]) })))!;
    expect([own.private, own.claims.some((c) => c.item.id === id), own.everyone !== undefined && own.everyone.id !== id]).toEqual([true, true, true]);
  });

  it('holds no private paper, bill or study', () => {
    for (const n of providersNamed(index(SAM, MARKED), MARKED.household)) {
      const page = pageOf(n, true, MARKED);
      for (const x of [...(page?.papers ?? []), ...(page?.receipts ?? [])]) expect(MARKED.index(x.person)!.privacy).toMatchObject({ kind: 'known' });
      for (const x of page?.papers ?? []) expect((MARKED.index(x.person)!.privacy as { documents: Map<string, string> }).documents.has(x.item.id)).toBe(false);
    }
    const found = [...SAMPLE.indexes].flatMap(([person, idx]) => idx.studies.map((study) => ({ person, study })))[0]!;
    const at = { person: found.person, id: found.study.id, field: 'facility' as const };
    const report = index(found.person).records.find((r) => r.kind === 'result')!.id;
    const put = (unreported: Set<string>) =>
      withIndex(found.person, (idx) => {
        if (idx.privacy?.kind !== 'known') throw new Error('not known');
        return { ...idx, privacy: { ...idx.privacy, unreported }, studies: [{ ...found.study, report, facility: 'Example Imaging' }] };
      });
    const ids = (everyone: boolean, unreported = new Set<string>()) => pageOf(at, everyone, SAMPLE, put(unreported))?.studies.map((s) => s.item.id);
    expect([ids(false), ids(true)]).toEqual([[at.id], [at.id]]);
    // One with no report is held back, as on every shared screen.
    expect([ids(false, new Set([at.id])), ids(true, new Set([at.id]))]).toEqual([[at.id], undefined]);
  });

  it('holds no private paper, and no bill’s payment by a private receipt', () => {
    const known = (documents: string[]) =>
      withIndex(ROBIN, (idx) => {
        if (idx.privacy?.kind !== 'known') throw new Error('not known');
        return { ...idx, privacy: { ...idx.privacy, documents: new Map([...idx.privacy.documents, ...documents.map((id): [string, string] => [id, 'household'])]) } };
      });
    const filed = index(ROBIN).documents.filter((d) => d.organization === 'Example Health' && !d.provenance.source.cli);
    const [card, bill, receipt] = ['immunization_record', 'bill', 'receipt'].map((t) => filed.find((d) => d.doc_type === t)!);
    const at = { person: ROBIN, id: filed.find((d) => d.date === '2026-10-01')!.id, field: 'organization' as const };
    const all = (p: ProviderPage) => [p.papers.map((x) => x.item.id), p.bills.map((b) => [b.item.bill.doc.id, b.item.bill.payments.map((x) => x.receipt?.id)]), p.receipts];
    const whole = pageOf(at, true, SAMPLE, known([]))!;
    expect(all(whole)).toEqual([[card!.id], [[at.id, []], [bill!.id, [receipt!.id]]], []]);
    expect(all(pageOf(at, true, SAMPLE, known([card!.id]))!)).toEqual([[], [[at.id, []], [bill!.id, [receipt!.id]]], []]);
    expect(all(pageOf(at, true, SAMPLE, known([bill!.id]))!)[1]).toEqual([[at.id, []]]);
    expect(all(pageOf(at, true, SAMPLE, known([receipt!.id]))!)[1]).toEqual([[at.id, []], [bill!.id, [undefined]]]);
    expect(pageOf(at, true, SAMPLE, known([at.id]))).toBeUndefined();
    // On Robin's own page they stay, marked.
    const own = pageOf(at, false, SAMPLE, known([card!.id, receipt!.id]))!;
    expect([own.private, all(own)]).toEqual([true, all(whole)]);
  });

  it('counts no share of a visit with a private claim', () => {
    const health = pageOf(anchor(ROBIN, 'provider', 'Example Health'), true)!;
    const claim = health.claims.find((c) => c.person === ROBIN)!.item;
    const twin: MedRecord = { ...claim, id: 'r_twin' };
    const two = withIndex(ROBIN, (idx) => {
      if (idx.privacy?.kind !== 'known') throw new Error('not known');
      return {
        ...idx,
        records: [...idx.records, twin],
        privacy: { ...idx.privacy, records: new Map([...idx.privacy.records, [twin.id, 'household']]) },
        events: { ...idx.events!, events: idx.events!.events.map((e) => ({ ...e, members: e.members.flatMap((m) => (m.record === claim.id ? [m, { ...m, record: twin.id }] : [m])) })) },
      };
    });
    const page = pageOf(anchor(ROBIN, 'provider', 'Example Health'), true, SAMPLE, two)!;
    expect([health.unbilled, page.unbilled, page.claims.length]).toEqual([8140, 5640, 5]);
    expect(pageOf(anchor(ROBIN, 'provider', 'Example Health'), false, SAMPLE, two)!.unbilled).toBe(5000);
  });

  it('holds nothing of a person whose items are held back', () => {
    expect(pageOf(anchor(SAM, 'provider', 'Example Lab'), true, UNREADABLE)).toBeUndefined();
    const page = pageOf(anchor(ROBIN, 'provider', 'Example Lab'), true, UNREADABLE)!;
    expect([page.whose.map((w) => w.person), days(page).some((d) => d.startsWith('Sam'))]).toEqual([[ROBIN], false]);
    const own = pageOf(anchor(SAM, 'provider', 'Example Lab'), false, UNREADABLE)!;
    expect([own.claims.length, own.private, own.everyone]).toEqual([3, false, undefined]);
  });
});

describe('an event’s place', () => {
  const events = (person: string) => personEvents(index(person), SAMPLE.household, TODAY);

  it('is the provider one of its own items prints: its visit’s first, then a claim’s', () => {
    const visit = events(ROBIN).find((e) => e.visits.length && e.place === 'Example Health Main Clinic')!;
    expect(placeNamed(index(ROBIN), SAMPLE.household, visit)).toMatchObject({ kind: 'encounter', field: 'location', id: visit.visits[0]!.record.id });
    const claim = events(SAM).find((e) => e.place === 'Example Endoscopy Center')!;
    expect(placeNamed(index(SAM), SAMPLE.household, claim)).toMatchObject({ kind: 'claim', name: 'Example Endoscopy Center' });
  });

  it('is a visit’s name for it before a claim’s, whichever the records hold first, and then a paper’s', () => {
    const visit = events(ROBIN).find((e) => e.visits.length && e.claims.length)!;
    const [claim, encounter] = [visit.claims[0]!.record, visit.visits[0]!.record];
    const named = (r: MedRecord, field: string): MedRecord => ({ ...r, fields: { ...r.fields, [field]: 'Example Place' } });
    const place = { ...visit, place: 'Example Place' };
    for (const records of [[named(claim, 'provider'), named(encounter, 'location')], [named(encounter, 'location'), named(claim, 'provider')]]) expect(placeNamed({ ...index(ROBIN), records }, SAMPLE.household, place)?.id).toBe(encounter.id);
    const doc = { ...index(ROBIN).documents[0]!, organization: 'Example Place' };
    const papers = { ...index(ROBIN), records: [named(claim, 'provider')], documents: [doc] };
    const withPaper = (over: object, claims = visit.claims) => placeNamed({ ...papers, documents: [{ ...doc, id: 'd_paper' }, doc] }, SAMPLE.household, { ...place, visits: [], claims, recorded: [], papers: [{ doc, ...over } as (typeof visit.papers)[number]] })?.id;
    expect([withPaper({}), withPaper({}, []), withPaper({ person: ROBIN }, []), withPaper({ person: SAM }, [])]).toEqual([claim.id, doc.id, doc.id, undefined]);
  });

  it('is none where nothing of the event prints it, or it has none', () => {
    const visit = events(ROBIN).find((e) => e.visits.length)!;
    expect(placeNamed(index(ROBIN), SAMPLE.household, { ...visit, place: 'Example Elsewhere' })).toBeUndefined();
    expect(placeNamed(index(ROBIN), SAMPLE.household, { ...visit, place: undefined })).toBeUndefined();
    // Nor is a person's name a place.
    expect(placeNamed(index(ROBIN), SAMPLE.household, { ...visit, place: 'Dr. Jordan Sample' })).toBeUndefined();
  });
});
