// The event page, the redesign's core screen (?next): what happened, when
// and where, what it cost and whether it is settled, then the evidence. In
// order: the head with its sources, what happened, results with their
// prices, how the price came down, what the plan changed, who charged what,
// bills and payments, papers, how the event was put together, and details.

import { billList, type Bill } from '../model/billing';
import { claimDiagnoses, claimLines, diagnosisText } from '../model/claims';
import { sameProvider } from '../model/providers';
import { AMOUNT_LABELS, docTypeLabel, documentTitle, formatMoney, fromCents, KIND_LABELS, organizationName, resultPoint, resultReading, str, toCents } from '../model/records';
import { isOutOfRange, resultFlag } from '../model/flags';
import { unitText } from '../model/result';
import { recordTitle } from '../model/titles';
import type { MedDocument, PersonIndex } from '../model/types';
import { card, chip, driveLink, empty, flagChip, link, row, type Ctx } from '../ui/components';
import { h, icon, type Child } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import type { Route } from '../ui/router';
import { careEvents, eventConfidence, eventMoney, eventOf, kindText, RULES, type CareEvent, type EventMoney } from './events';

const money = (c: number | undefined) => (c === undefined ? '' : formatMoney(fromCents(c)) ?? '');
const itemRoute = (person: string, id: string): Route => ({ name: 'item', person, id });
export const eventRoute = (person: string, id: string): Route => ({ name: 'event', person, id });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The days of an event: "Sep 12, 2026", "Sep 12–13, 2026" or "Sep 30 – Oct 2, 2026". */
export function eventWhen(e: CareEvent): string {
  if (e.end <= e.start) return dateText(e.start);
  const [y1, m1, d1] = e.start.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = e.end.split('-').map(Number) as [number, number, number];
  if (y1 !== y2) return `${dateText(e.start)} – ${dateText(e.end)}`;
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}, ${y1}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${y1}`;
}

/** What a card and the page's head call it: "Emergency room · overnight" for an event the portal did not name, else its own name. */
function headline(e: CareEvent): { title: string; kind?: string } {
  const kind = kindText(e);
  if (kind.startsWith(e.title)) return { title: kind };
  // "Lab tests" says "Tests" already.
  return e.title.toLowerCase().includes(kind.toLowerCase()) ? { title: e.title } : { title: e.title, kind };
}

/** The one number a card shows: what the event says you owe, else nothing to pay. */
export function eventNumber(m: EventMoney): string | undefined {
  if (m.share === undefined) return undefined;
  return m.share === 0 ? 'Nothing to pay' : money(m.share);
}

function sourcesStrip(ctx: Ctx, idx: PersonIndex, e: CareEvent): HTMLElement {
  const portal = e.visits.length + e.recorded.length;
  const insurers = [...new Set(e.claims.map((c) => str(c.record.fields.insurer)).filter((x): x is string => !!x))];
  const orgs = [...new Set(e.visits.flatMap((v) => v.record.provenance.map((p) => p.source.organization_id)).filter((x): x is string => !!x))];
  const orgName = orgs.length ? organizationName(ctx.store.household, idx.person, orgs[0]!) : 'The portal';
  const part = (label: string, n: string) => h('span', { class: 'event-source' }, h('span', { class: 'event-source-label' }, label), ' ', h('strong', null, n));
  return h(
    'p',
    { class: 'event-sources small' },
    portal ? part(orgName, count(portal, 'record')) : null,
    e.claims.length ? part(insurers.length === 1 ? insurers[0]! : 'Insurer', count(e.claims.length, 'claim')) : null,
    e.papers.length ? part('Drive', count(e.papers.length, 'paper')) : null,
  );
}

function headCard(ctx: Ctx, idx: PersonIndex, e: CareEvent, m: EventMoney): HTMLElement {
  const person = ctx.store.person(idx.person);
  const number = eventNumber(m);
  const confidence = eventConfidence(e);
  const { title, kind } = headline(e);
  return h(
    'section',
    { class: 'card' },
    kind ? h('p', { class: 'event-kind small muted' }, kind) : null,
    h('div', { class: 'card-head' }, h('h1', null, title), confidence !== 'sure' ? chip(confidence === 'likely' ? 'Likely' : 'Unsure', 'muted') : null),
    h('p', { class: 'muted' }, [eventWhen(e), e.place, person?.name].filter(Boolean).join(' · ')),
    sourcesStrip(ctx, idx, e),
    number ? h('p', { class: 'result-value' }, m.share === 0 ? 'Nothing for you to pay' : `${m.shareAdded ? 'Your share' : 'You owe'} ${number}`) : null,
    settledLine(idx, e, m),
  );
}

/** A pharmacy's share is paid at pickup, with no bill to follow. */
const atCounter = (e: CareEvent) => e.claims.length > 0 && e.claims.every((c) => c.role === 'pharmacy');

/** Each provider this event's claims say you owe, with its bill from the event's papers and that bill's receipt, if any. */
function owedBills(idx: PersonIndex, e: CareEvent, m: EventMoney): { provider: string; share: number; bill?: Bill }[] {
  const bills = billList(idx).filter((b) => b.doc.doc_type === 'bill' && e.papers.some((p) => p.doc.id === b.doc.id));
  return m.charges
    .filter((c) => (c.share ?? 0) > 0)
    .map((c) => ({ provider: c.provider, share: c.share!, bill: bills.find((b) => sameProvider(c.provider, b.provider)) }));
}

/** Whether it is paid, in one line: paid, billed and when due, or not billed yet. */
function settledLine(idx: PersonIndex, e: CareEvent, m: EventMoney): HTMLElement | null {
  const owed = owedBills(idx, e, m);
  if (!owed.length) return null;
  if (atCounter(e)) return h('p', { class: 'event-settled' }, 'A pharmacy takes your share when you pick up.');
  const sum = (xs: typeof owed) => xs.reduce((t, o) => t + o.share, 0);
  const paid = owed.filter((o) => o.bill?.receipt);
  const billed = owed.filter((o) => o.bill && !o.bill.receipt);
  const unbilled = owed.filter((o) => !o.bill);
  if (paid.length === owed.length) return h('p', { class: 'event-settled' }, 'Paid');
  const dues = [...new Set(billed.map((o) => o.bill!.due).filter((d): d is string => !!d))].sort();
  return h(
    'p',
    { class: 'event-settled' },
    [
      paid.length ? `${money(sum(paid))} paid` : null,
      billed.length ? `${money(sum(billed))} billed${dues.length === 1 ? `, due ${dateText(dues[0]!)}` : ''}` : null,
      unbilled.length ? `${money(sum(unbilled))} not billed yet` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
}

/** What happened: the portal's words when there are any, else the papers', else the claims'. */
function happenedCard(ctx: Ctx, idx: PersonIndex, e: CareEvent): HTMLElement {
  if (e.visits.length) {
    const conditions = e.recorded.filter((r) => r.kind === 'condition').map(recordTitle);
    const done = e.recorded.filter((r) => r.kind === 'procedure' || r.kind === 'immunization' || r.kind === 'medication');
    return card(
      { title: 'What happened' },
      e.visits.map(({ record: v }) =>
        row({
          route: itemRoute(idx.person, v.id),
          title: recordTitle(v),
          meta: [str(v.fields.reason), str(v.fields.practitioner) ? `with ${str(v.fields.practitioner)}` : null, str(v.fields.location)].filter(Boolean).join(' · '),
        }),
      ),
      conditions.length ? h('p', null, h('span', { class: 'muted' }, conditions.length === 1 ? 'Diagnosis: ' : 'Diagnoses: '), conditions.join(', ')) : null,
      done.length ? h('p', null, h('span', { class: 'muted' }, 'Also recorded: '), done.map((r) => `${recordTitle(r)} (${(KIND_LABELS[r.kind] ?? r.kind).toLowerCase()})`).join(', ')) : null,
      h('p', { class: 'small muted' }, 'From the provider’s own records.'),
    );
  }
  const summaries = e.papers.filter((p) => p.doc.doc_type === 'discharge_summary' || p.doc.doc_type === 'visit_summary');
  const services = [...new Set(e.claims.flatMap((c) => claimLines(c.record).filter((l) => l.counted).map((l) => l.label)))];
  const diagnoses = [...new Set(e.claims.flatMap((c) => claimDiagnoses(c.record).map(diagnosisText)))];
  return card(
    { title: 'What happened' },
    services.length ? h('p', null, h('span', { class: 'muted' }, 'Billed for: '), services.join(', ')) : null,
    diagnoses.length ? h('p', null, h('span', { class: 'muted' }, diagnoses.length === 1 ? 'Diagnosis: ' : 'Diagnoses: '), diagnoses.join(', ')) : null,
    summaries.length ? h('p', null, h('span', { class: 'muted' }, 'Read more in: '), ...summaries.flatMap((p, i) => [i ? ', ' : null, link(itemRoute(idx.person, p.doc.id), documentTitle(p.doc))])) : null,
    h('p', { class: 'small muted' }, e.claims.length ? 'From the claims: no portal record of this visit is in the folder.' : 'From the papers.'),
  );
}

/** Each result of the event, with what the plan priced its test at, where a claim line names it. */
function resultsCard(idx: PersonIndex, e: CareEvent): HTMLElement | null {
  const results = e.recorded.filter((r) => r.kind === 'result');
  if (!results.length) return null;
  const priceOf = new Map<string, number>();
  for (const c of e.claims) {
    for (const l of claimLines(c.record)) {
      if (!l.counted) continue;
      const price = toCents(l.amounts.allowed) ?? toCents(l.amounts.billed);
      // A line that paid for several results is one price for them all: it is shown once.
      if (price !== undefined && l.records.length) priceOf.set(l.records.find((id) => results.some((r) => r.id === id)) ?? '', price);
    }
  }
  const flagged = (r: (typeof results)[number]) => (isOutOfRange(resultFlag(resultPoint(r))) ? 0 : 1);
  return card(
    { title: 'Results' },
    h(
      'ul',
      { class: 'event-results' },
      [...results].sort((a, b) => flagged(a) - flagged(b)).map((r) => {
        const reading = resultReading(r.fields).text;
        const price = priceOf.get(r.id);
        return h(
          'li',
          null,
          link(itemRoute(idx.person, r.id), recordTitle(r)),
          h('span', { class: 'event-result-value' }, flagChip(resultFlag(resultPoint(r))), [reading ? (unitText(reading) ?? reading) : null, price !== undefined ? money(price) : null].filter(Boolean).join(' · ')),
        );
      }),
    ),
    priceOf.size ? h('p', { class: 'small muted' }, 'A price is what the plan allowed for the test’s claim line; one line can price several results.') : null,
  );
}

const REASON_WORDS: Record<EventMoney['reasons'][number]['name'], string> = { deductible: 'toward the deductible', copay: 'a copay', coinsurance: 'coinsurance', notCovered: 'not covered' };

function costCard(e: CareEvent, m: EventMoney): HTMLElement | null {
  if (!e.claims.length) return null;
  const insurer = str(e.claims[0]?.record.fields.insurer) ?? 'The plan';
  const step = (label: string, value: string, strong = false) => h('div', { class: ['event-step', strong ? 'event-step-total' : null] }, h('span', null, label), h('span', { class: 'num' }, value));
  return card(
    { title: 'How the price came down' },
    h(
      'div',
      { class: 'event-ladder' },
      m.billed !== undefined ? step('Providers charged', money(m.billed)) : null,
      m.discount !== undefined ? step('Network discount', m.discount ? `−${money(m.discount)}` : money(0)) : null,
      m.planPaid !== undefined ? step(`${insurer} paid`, m.planPaid ? `−${money(m.planPaid)}` : money(0)) : null,
      m.share !== undefined ? step(m.shareAdded ? 'Your share' : 'You owe', money(m.share), true) : null,
    ),
    m.reasons.length ? h('p', null, `Your share is ${m.reasons.map((r) => `${REASON_WORDS[r.name]} of ${money(r.cents)}`).join(', ')}.`) : null,
    m.adds ? null : h('p', { class: 'small muted' }, 'These amounts are each claim’s own and do not add up from one step to the next; each claim’s page has its figures.'),
  );
}

/** Lines a claim lists and its totals leave out, in plain words: none of it is owed. */
function changedCard(e: CareEvent): HTMLElement | null {
  const left = e.claims.flatMap((c) => claimLines(c.record).filter((l) => !l.counted).map((l) => ({ c, l })));
  if (!left.length) return null;
  const insurer = str(e.claims[0]?.record.fields.insurer) ?? 'The plan';
  return card(
    { title: `What ${insurer} changed` },
    left.map(({ c, l }) =>
      h(
        'div',
        { class: 'event-changed' },
        h('p', null, `${c.provider ?? 'The provider'} billed “${l.label}”${l.amounts.billed ? ` at ${formatMoney(l.amounts.billed)}` : ''}. ${insurer} left that line out of the claim’s totals, so none of it is owed: the amounts on this page are the ones it counted.`),
        l.payerNotes.length ? h('p', { class: 'small muted' }, `${insurer}’s ${l.payerNotes.length === 1 ? 'note' : 'notes'}: ${l.payerNotes.join(' · ')}`) : null,
      ),
    ),
  );
}

function chargesCard(e: CareEvent, m: EventMoney): HTMLElement | null {
  if (!m.charges.length) return null;
  // The hospital first, then who asks most of you.
  const order = [...m.charges].sort((a, b) => Number(b.role === 'The hospital') - Number(a.role === 'The hospital') || (b.share ?? 0) - (a.share ?? 0) || (b.billed ?? 0) - (a.billed ?? 0));
  return card(
    { title: 'Who charged what' },
    order.map((ch) =>
      row({
        title: ch.provider,
        meta: [ch.role, ch.claims.length > 1 ? count(ch.claims.length, 'claim') : null].filter(Boolean).join(' · '),
        aside: ch.share !== undefined ? h('span', { class: 'num' }, ch.share === 0 ? 'Nothing to pay' : money(ch.share)) : null,
        extra: h('p', { class: 'small muted' }, [ch.billed !== undefined ? `Charged ${money(ch.billed)}` : null, ch.price !== undefined ? `plan’s price ${money(ch.price)}` : null, ch.planPaid !== undefined ? `plan paid ${money(ch.planPaid)}` : null].filter(Boolean).join(' · ')),
      }),
    ),
  );
}

/** Each bill and receipt against what the claims say, and what has no bill yet. */
function billsCard(idx: PersonIndex, e: CareEvent, m: EventMoney): HTMLElement | null {
  const bills = e.papers.filter((p) => p.doc.doc_type === 'bill' || p.doc.doc_type === 'receipt').map((p) => p.doc);
  const owed = atCounter(e) ? [] : m.charges.filter((c) => (c.share ?? 0) > 0);
  if (!bills.length && !owed.length) return null;
  const receipts = new Map(billList(idx).map((b) => [b.doc.id, b.receipt]));
  const billRow = (d: MedDocument) => {
    const due = toCents(d.statement?.amount_due);
    const receipt = receipts.get(d.id);
    const ch = m.charges.find((c) => sameProvider(c.provider, d.organization));
    const says = ch?.share;
    const match = due === undefined || says === undefined ? null : due === says ? chip('Matches the claim', 'ok') : chip(`Claim says ${money(says)}`, 'attention');
    return row({
      route: itemRoute(idx.person, d.id),
      title: d.doc_type === 'receipt' ? `Receipt from ${d.organization ?? 'a provider'}` : `Bill from ${d.organization ?? 'a provider'}`,
      meta: [due !== undefined ? `${money(due)} due${d.statement?.due_date ? ` by ${dateText(d.statement.due_date)}` : ''}` : dateText(d.date), receipt ? `paid, receipt ${dateText(receipt.date)}` : null].filter(Boolean).join(' · '),
      aside: match,
    });
  };
  const unbilled = owed.filter((c) => !bills.some((d) => sameProvider(c.provider, d.organization)));
  return card(
    { title: 'Bills and payments' },
    bills.map(billRow),
    unbilled.map((c) => h('p', { class: 'event-gap' }, `No bill from ${c.provider} filed yet, for the ${money(c.share)} its claim says you owe.`)),
  );
}

function papersCard(ctx: Ctx, idx: PersonIndex, e: CareEvent): HTMLElement {
  return card(
    { title: 'Papers' },
    e.papers.length
      ? e.papers.map((p) =>
          row({
            route: itemRoute(idx.person, p.doc.id),
            title: documentTitle(p.doc),
            meta: [docTypeLabel(p.doc.doc_type), dateText(p.doc.date)].filter(Boolean).join(' · '),
            extra: driveLink(ctx, p.doc.path, 'Open in Drive'),
          }),
        )
      : empty('No papers in the folder for this visit.'),
  );
}

const sureWord = (c: string) => (c === 'sure' ? null : chip(c === 'likely' ? 'Likely' : 'Unsure', 'muted'));

function assemblyCard(idx: PersonIndex, e: CareEvent): HTMLElement {
  const items: Child[] = [
    ...e.visits.map((v) => row({ route: itemRoute(idx.person, v.record.id), title: recordTitle(v.record), meta: `Portal visit · ${RULES[v.rule]}`, aside: sureWord(v.confidence) })),
    ...e.claims.map((c) => row({ route: itemRoute(idx.person, c.record.id), title: c.provider ?? recordTitle(c.record), meta: `Claim · ${RULES[c.rule]}`, aside: sureWord(c.confidence) })),
    ...e.papers.map((p) => row({ route: itemRoute(idx.person, p.doc.id), title: documentTitle(p.doc), meta: `Paper · ${RULES[p.rule]}`, aside: sureWord(p.confidence) })),
  ];
  return h(
    'details',
    { class: 'tech' },
    h('summary', null, 'How this visit was put together'),
    card(
      {},
      e.doubt ? h('p', { class: 'event-gap' }, `${e.doubt}.`) : null,
      e.noFacility ? h('p', { class: 'event-gap' }, 'No claim from the hospital itself is in yet; this visit is known from its doctors’ claims.') : null,
      items,
      h('p', { class: 'small muted' }, 'The app groups these itself until medrec writes events. “Likely” means only the day and the kind of visit tie it in.'),
    ),
  );
}

function detailsCard(idx: PersonIndex, e: CareEvent): HTMLElement {
  const claimRows = e.claims.map((c) => row({ route: itemRoute(idx.person, c.record.id), title: recordTitle(c.record), meta: [c.provider, dateText(c.record.date)].filter(Boolean).join(' · ') }));
  const recorded = e.recorded.filter((r) => r.kind !== 'result').map((r) => row({ route: itemRoute(idx.person, r.id), title: recordTitle(r), meta: KIND_LABELS[r.kind] ?? r.kind }));
  return h(
    'details',
    { class: 'tech' },
    h('summary', null, 'Details'),
    card(
      {},
      claimRows.length ? h('h3', { class: 'card-sub' }, count(claimRows.length, 'claim')) : null,
      claimRows,
      recorded.length ? h('h3', { class: 'card-sub' }, 'Recorded at the visit') : null,
      recorded,
      h('p', { class: 'small muted' }, `Each claim’s page has its lines, codes, ${AMOUNT_LABELS.allowed.toLowerCase()} amounts and the raw data.`),
    ),
  );
}

export function eventView(ctx: Ctx, personId: string, id: string): HTMLElement {
  const person = ctx.store.person(personId);
  const idx = ctx.store.index(personId);
  const back = person ? h('p', null, link({ name: 'person', person: personId, section: 'overview' }, icon('back', 16), ` ${person.name}`)) : null;
  if (!person || !idx) return card({}, empty('This person is not in the records folder.'));
  const e = careEvents(idx, ctx.store.household, localDay(ctx.now())).find((x) => x.id === id);
  if (!e) return h('div', { class: 'stack' }, back, card({}, empty('This visit is not in these records. It may have been regrouped as records arrived.')));
  const m = eventMoney(e);
  return h(
    'div',
    { class: 'stack event' },
    back,
    headCard(ctx, idx, e, m),
    happenedCard(ctx, idx, e),
    resultsCard(idx, e),
    costCard(e, m),
    changedCard(e),
    chargesCard(e, m),
    billsCard(idx, e, m),
    papersCard(ctx, idx, e),
    assemblyCard(idx, e),
    detailsCard(idx, e),
  );
}

/** A person's events, newest first, as cards with one number each: the overview's list under ?next. */
export function eventsCard(ctx: Ctx, personId: string, idx: PersonIndex, shown = 8): HTMLElement {
  const events = careEvents(idx, ctx.store.household, localDay(ctx.now()));
  return card(
    { title: 'What happened', class: 'overview-wide' },
    events.length
      ? events.slice(0, shown).map((e) => {
          const n = eventNumber(eventMoney(e));
          const { title, kind } = headline(e);
          return row({ route: eventRoute(personId, e.id), title, meta: [kind, eventWhen(e), e.place].filter(Boolean).join(' · '), aside: n ? h('span', { class: 'num' }, n) : null });
        })
      : empty('No visits, claims or papers yet.'),
    events.length > shown ? h('p', { class: 'small muted' }, `${count(events.length - shown, 'earlier visit')} not shown yet; Calendar will list them all.`) : null,
  );
}

/** Under ?next, a record's page says which visit it is part of. */
export function partOfEvent(ctx: Ctx, personId: string, idx: PersonIndex, recordId: string): HTMLElement | null {
  const e = eventOf(careEvents(idx, ctx.store.household, localDay(ctx.now())), recordId);
  if (!e) return null;
  return h('p', { class: 'event-part' }, 'Part of ', link(eventRoute(personId, e.id), `${headline(e).title}, ${eventWhen(e)}`));
}

