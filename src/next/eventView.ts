// The event page, the app's core screen: what happened, when
// and where, what it cost and whether it is settled, then the evidence. In
// order: the head with its sources, what happened, results with their
// prices, how the price came down, what the plan changed, who charged what,
// bills and payments, papers, how the event was put together, and details.

import { billList, standsFor, type Bill } from '../model/billing';
import { claimDiagnoses, claimLines } from '../model/claims';
import { conditionName, diagnosisNames, inDetails, nameList, nameSep } from '../model/codeNames';
import { leftOff, offInEach } from '../model/parts';
import { sameProvider } from '../model/providers';
import { AMOUNT_LABELS, docTypeLabel, documentTitle, formatMoney, fromCents, KIND_LABELS, portalCounts, resultPoint, resultReading, str, toCents } from '../model/records';
import { isOutOfRange, resultFlag } from '../model/flags';
import { isInError } from '../model/inError';
import { unitText } from '../model/result';
import { recordTitle, visitTitle } from '../model/titles';
import { areaText, knownArea, paperPrivate, recordPrivate } from '../model/private';
import type { MedDocument, MedRecord, PersonIndex } from '../model/types';
import { paperView } from '../paper/view';
import { card, chip, dotted, driveLink, empty, flagChip, link, row, type Ctx } from '../ui/components';
import { h, icon, type Child } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import { differChip, errorsNote } from '../ui/inError';
import { href, type Route } from '../ui/router';
import { eventConfidence, eventMoney, eventOf, kindText, paidAtCounter, eventPrivate, ruleText, type CareEvent, type EventMoney } from './event';
import { groupedByMedrec, personEvents } from './load';
import { paidControl } from './markPaid';
import { eventInError } from './medrecEvents';
import { billsShares, NO_CLAIM_EXPECTED, paidText, selfPay, unreadText } from './money';
import { labelLine, labelNote } from './labelView';
import { namedOn } from './providerNames';
import { placeLink, providerRoute } from './providerView';
import { called } from '../model/people';
import { plainWords } from '../model/words';

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
export function headline(e: CareEvent): { title: string; kind?: string } {
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
  const insurers = [...new Set(e.claims.map((c) => str(c.record.fields.insurer)).filter((x): x is string => !!x))];
  const portals = portalCounts([...e.visits.map((v) => v.record), ...e.recorded], ctx.store.household, idx.person);
  const part = (label: string, n: string) => h('span', { class: 'event-source' }, h('span', { class: 'event-source-label' }, label), ' ', h('strong', null, n));
  return h(
    'p',
    { class: 'event-sources small' },
    [...portals].map(([name, n]) => part(name, count(n, 'record'))),
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
    e.what ? h('p', { class: 'event-what' }, e.what) : null,
    h('p', { class: 'muted' }, dotted([eventWhen(e), placeLink(ctx, idx, e), person ? called(person) : null])),
    labelNote(idx, e.id, e.place),
    sourcesStrip(ctx, idx, e),
    number ? h('p', { class: 'result-value' }, m.share === 0 ? 'Nothing for you to pay' : `${m.shareAdded ? 'Your share' : 'You owe'} ${number}`) : null,
    settledLine(idx, e, m),
    errorsNote(e.inError ?? 0),
    privateNote(e, idx),
    partNote(e.shared?.says),
  );
}

const NOT_SHARED = 'Not on shared screens';

/** Beside each part of an open item that shared screens leave out, on its person's own pages: the words partNote begins with. */
export const notShared = (): HTMLElement => chip(NOT_SHARED, 'muted');

/** An open item with a private part says on its own page what shared screens leave out of it, by medrec's count ("1 service not shown"). */
export function partNote(says: string | undefined): HTMLElement | null {
  if (!says) return null;
  const what = says.endsWith(' not shown') ? says.slice(0, -' not shown'.length) : says;
  return h('p', { class: 'small muted part-note' }, notShared(), ` ${what}. Shared screens are Home and everyone’s Calendar, Money, Papers and search results.`);
}

/** Names in one sentence, each that shared screens leave out marked so. */
export function markedList(items: { text: string; off: boolean }[], sep = nameSep(items.map((x) => x.text))): Child {
  if (!items.some((x) => x.off)) return items.map((x) => x.text).join(sep);
  return items.map((x, i) => h('span', { class: 'marked-name' }, x.text, x.off ? [' ', notShared()] : null, i < items.length - 1 ? sep : null));
}


/** A private event says so on its page: where it stays off, and that this is discretion, not security. */
function privateNote(e: CareEvent, idx: PersonIndex, off = 'Kept off Home and everyone’s Calendar, Money, Papers and search results.'): HTMLElement | null {
  const area = knownArea(eventPrivate(e, idx));
  if (!area) return null;
  return h(
    'p',
    { class: 'event-private small' },
    chip('Private', 'muted'),
    ` ${areaText(area)}. ${off} This is discretion, not security: everyone the Drive folder is shared with can still read its files.`,
  );
}

/** A pharmacy's share is paid at pickup, with no bill to follow. */
/** A billing company's bill among an event's papers: one whose sender has no claim here, for what its providers are owed. */
const billerOf = <T,>(m: EventMoney, bills: T[], sender: (b: T) => string | undefined): T | undefined => bills.find((b) => !m.charges.some((c) => sameProvider(c.provider, sender(b))));

/** Each provider this event's claims say you owe, with its bill from the event's papers, else a billing company's, and the statement that stands for it now. */
function owedBills(idx: PersonIndex, e: CareEvent, m: EventMoney): { provider: string; share: number; bill?: Bill; now?: Bill }[] {
  const all = billList(idx);
  const bills = all.filter((b) => e.papers.some((p) => p.doc.id === b.doc.id) && billsShares(idx, b.doc));
  return m.charges
    .filter((c) => (c.share ?? 0) > 0)
    .map((c) => {
      const bill = bills.find((b) => sameProvider(c.provider, b.provider)) ?? billerOf(m, bills, (b) => b.provider);
      return { provider: c.provider, share: c.share!, ...(bill ? { bill, now: bill.settled || bill.unread.length ? bill : standsFor(bill, all) } : {}) };
    });
}

/** Whether it is paid, in one line: paid, billed and when due, or not billed yet. */
function settledLine(idx: PersonIndex, e: CareEvent, m: EventMoney): HTMLElement | null {
  const owed = owedBills(idx, e, m);
  if (!owed.length) return null;
  if (paidAtCounter(e)) return h('p', { class: 'event-settled' }, 'A pharmacy takes your share when you pick up.');
  const sum = (xs: typeof owed) => xs.reduce((t, o) => t + o.share, 0);
  const paid = owed.filter((o) => o.now?.settled);
  const billed = owed.filter((o) => o.now && !o.now.settled && !o.now.unread.length);
  const maybe = owed.filter((o) => o.now?.unread.length);
  const unbilled = owed.filter((o) => !o.bill);
  if (paid.length === owed.length) return h('p', { class: 'event-settled' }, paid.some((o) => o.now!.payments.some((p) => p.from === 'receipt')) ? 'Paid' : 'Marked paid');
  const dues = [...new Set(billed.map((o) => o.now!.due).filter((d): d is string => !!d))].sort();
  // What is left of those partly paid, each once however many providers it bills for.
  const part = [...new Set(billed.map((o) => o.now!))].flatMap((b) => (b.payments.length && b.left ? [toCents(b.left) ?? 0] : []));
  return h(
    'p',
    { class: 'event-settled' },
    [
      paid.length ? `${money(sum(paid))} paid` : null,
      billed.length ? `${money(sum(billed))} billed${part.length ? `, ${money(part.reduce((t, c) => t + c, 0))} left to pay` : ''}${dues.length === 1 ? `, due ${dateText(dues[0]!)}` : ''}` : null,
      maybe.length ? `${money(sum(maybe))} billed` : null,
      ...new Set(maybe.map((o) => unreadText(o.now!.unread))),
      unbilled.length ? `${money(sum(unbilled))} not billed yet` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
}

/**
 * On a visit's own page, whether shared screens leave out a part of one of its
 * claims while they show the visit: the claim is private, or that part of it.
 * Of a private visit, whose page says it stays off, nothing is marked.
 */
function offOpen(idx: PersonIndex, e: CareEvent): (c: { record: MedRecord }, list: 'lines' | 'diagnoses', at: number | undefined) => boolean {
  const open = !eventPrivate(e, idx);
  return (c, list, at) => open && (!!recordPrivate(idx, c.record.id) || leftOff(idx, c.record, list, at));
}

/** What happened: the portal's visits when there are any, else its doses, medicines and procedures with what the claims billed, else the papers'. */
function happenedCard(ctx: Ctx, idx: PersonIndex, e: CareEvent): HTMLElement {
  if (e.visits.length) {
    const conditions = e.recorded.filter((r) => r.kind === 'condition').map((r) => conditionName(idx, r).name);
    const done = e.recorded.filter((r) => (r.kind === 'procedure' || r.kind === 'immunization' || r.kind === 'medication') && plainWords(recordTitle(r)));
    return card(
      { title: 'What happened' },
      e.visits.map(({ record: v }) =>
        row({
          route: itemRoute(idx.person, v.id),
          title: visitTitle(v),
          // The reason, unless it already names the row.
          meta: [plainWords(str(v.fields.reason)) === visitTitle(v) ? null : plainWords(str(v.fields.reason)), str(v.fields.practitioner) ? `with ${str(v.fields.practitioner)}` : null, str(v.fields.location)].filter(Boolean).join(' · '),
          extra: labelLines([labelLine(idx, v.id, v.fields.practitioner)]),
        }),
      ),
      conditions.length ? h('p', null, h('span', { class: 'muted' }, conditions.length === 1 ? 'Diagnosis: ' : 'Diagnoses: '), nameList(conditions)) : null,
      done.length ? h('p', null, h('span', { class: 'muted' }, 'Also recorded: '), done.map((r) => `${recordTitle(r)} (${(KIND_LABELS[r.kind] ?? r.kind).toLowerCase()})`).join(', ')) : null,
      h('p', { class: 'small muted' }, 'From the provider’s own records.'),
    );
  }
  // A fill or a vaccine the portal knows with no visit (medrec makes one of each, and of a day's doses).
  const recorded = e.recorded.filter((r) => r.kind === 'procedure' || r.kind === 'immunization' || r.kind === 'medication');
  const summaries = e.papers.filter((p) => p.doc.doc_type === 'discharge_summary' || p.doc.doc_type === 'visit_summary');
  const off = offOpen(idx, e);
  const services = offInEach(e.claims.flatMap((c) => claimLines(c.record).filter((l) => l.counted && plainWords(l.label)).map((l): [string, boolean] => [l.label, off(c, 'lines', l.at)])));
  const diagnoses = offInEach(
    e.claims.flatMap((c) => {
      const placed = claimDiagnoses(c.record);
      return diagnosisNames(idx, c.record).map((d, i): [string, boolean] => [d.name, off(c, 'diagnoses', placed[i]?.at)]);
    }),
  );
  const from = recorded.length
    ? e.claims.length
      ? 'From the provider’s own records and the claims.'
      : 'From the provider’s own records.'
    : e.claims.length
      ? 'From the claims: no portal record of this visit is in the folder.'
      : 'From the papers.';
  return card(
    { title: 'What happened' },
    recorded.map((r) => row({ route: itemRoute(idx.person, r.id), title: plainWords(recordTitle(r)) ?? (KIND_LABELS[r.kind] ?? r.kind), meta: [KIND_LABELS[r.kind] ?? r.kind, str(r.fields.dosage)].filter(Boolean).join(' · ') })),
    services.length ? h('p', null, h('span', { class: 'muted' }, 'Billed for: '), markedList(services, ', ')) : null,
    diagnoses.length ? h('p', null, h('span', { class: 'muted' }, diagnoses.length === 1 ? 'Diagnosis: ' : 'Diagnoses: '), markedList(diagnoses)) : null,
    summaries.length ? h('p', null, h('span', { class: 'muted' }, 'Read more in: '), ...summaries.flatMap((p, i) => [i ? ', ' : null, link(itemRoute(p.person ?? idx.person, p.doc.id), documentTitle(p.doc))])) : null,
    h('p', { class: 'small muted' }, from),
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

/** What labels say, a line each. */
const labelLines = (lines: (string | null)[]): HTMLElement[] => [...new Set(lines.filter((x): x is string => !!x))].map((x) => h('p', { class: 'small label-line' }, x));

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
function changedCard(idx: PersonIndex, e: CareEvent): HTMLElement | null {
  const left = e.claims.flatMap((c) => claimLines(c.record).filter((l) => !l.counted).map((l) => ({ c, l })));
  if (!left.length) return null;
  const insurer = str(e.claims[0]?.record.fields.insurer) ?? 'The plan';
  const off = offOpen(idx, e);
  return card(
    { title: `What ${insurer} changed` },
    left.map(({ c, l }) =>
      h(
        'div',
        { class: 'event-changed' },
        off(c, 'lines', l.at) ? h('p', { class: 'part-mark' }, notShared()) : null,
        h('p', null, `${c.provider ?? 'The provider'} billed “${l.label}”${l.amounts.billed ? ` at ${formatMoney(l.amounts.billed)}` : ''}. ${insurer} left that line out of the claim’s totals, so none of it is owed: the amounts on this page are the ones it counted.`),
        l.payerNotes.length ? h('p', { class: 'small muted' }, `${insurer}’s ${l.payerNotes.length === 1 ? 'note' : 'notes'}: ${l.payerNotes.join(' · ')}`) : null,
      ),
    ),
  );
}

function chargesCard(ctx: Ctx, idx: PersonIndex, e: CareEvent, m: EventMoney): HTMLElement | null {
  if (!m.charges.length) return null;
  // The hospital first, then who asks most of you.
  const order = [...m.charges].sort((a, b) => Number(b.role === 'The hospital') - Number(a.role === 'The hospital') || (b.share ?? 0) - (a.share ?? 0) || (b.billed ?? 0) - (a.billed ?? 0));
  return card(
    { title: 'Who charged what' },
    order.map((ch) => {
      const named = namedOn(idx, ctx.store.household, ch.claims[0]!.id, 'provider');
      return row({
        ...(named ? { route: providerRoute(named) } : {}),
        title: ch.provider,
        meta: [ch.role, ch.claims.length > 1 ? count(ch.claims.length, 'claim') : null].filter(Boolean).join(' · '),
        aside: ch.share !== undefined ? h('span', { class: 'num' }, ch.share === 0 ? 'Nothing to pay' : money(ch.share)) : null,
        extra: [
          labelLines(ch.claims.map((c) => labelLine(idx, c.id, c.fields.provider))),
          h('p', { class: 'small muted' }, [ch.billed !== undefined ? `Charged ${money(ch.billed)}` : null, ch.price !== undefined ? `plan’s price ${money(ch.price)}` : null, ch.planPaid !== undefined ? `plan paid ${money(ch.planPaid)}` : null].filter(Boolean).join(' · ')),
        ],
      });
    }),
  );
}

/** Each bill and receipt against what the claims say, and what has no bill yet. */
function billsCard(ctx: Ctx, idx: PersonIndex, e: CareEvent, m: EventMoney): HTMLElement | null {
  const bills = e.papers.filter((p) => p.doc.doc_type === 'bill' || p.doc.doc_type === 'receipt').map((p) => p.doc);
  const owed = paidAtCounter(e) ? [] : m.charges.filter((c) => (c.share ?? 0) > 0);
  if (!bills.length && !owed.length) return null;
  const all = new Map(billList(idx).map((b) => [b.doc.id, b]));
  const billRow = (d: MedDocument) => {
    const bill = all.get(d.same_statement_as ?? d.id) ?? all.get(d.id);
    const due = toCents(d.statement?.amount_due);
    const part = bill && !bill.settled && bill.payments.length > 0;
    const ch = m.charges.find((c) => sameProvider(c.provider, d.organization));
    const says = ch?.share;
    const match = selfPay(idx, d) ? chip(NO_CLAIM_EXPECTED, 'muted') : due === undefined || says === undefined ? null : due === says ? chip('Matches the claim', 'ok') : chip(`Claim says ${money(says)}`, bill?.settled ? 'muted' : 'attention');
    return row({
      route: itemRoute(idx.person, d.id),
      title: d.doc_type === 'receipt' ? `Receipt from ${d.organization ?? 'a provider'}` : `Bill from ${d.organization ?? 'a provider'}`,
      meta: [due !== undefined ? `${money(due)} due${d.statement?.due_date ? ` by ${dateText(d.statement.due_date)}` : ''}` : null, d.statement?.amount_paid ? `${formatMoney(d.statement.amount_paid)} paid` : null, due === undefined ? dateText(d.statement?.paid_on ?? d.date) : null, bill?.settled ? paidText(bill) : null, part && bill.left ? `${formatMoney(bill.left)} left to pay` : null, bill ? unreadText(bill.unread) : null, bill && !bill.settled && bill.replacedBy ? 'a later statement has its balance' : null].filter(Boolean).join(' · '),
      aside: match,
      // Two copies of one statement have one Mark paid.
      extra: bill && (d.id === bill.doc.id || !bills.some((x) => x.id === bill.doc.id)) ? paidControl(ctx, idx, bill) : null,
    });
  };
  const billed = bills.filter((d) => billsShares(idx, d));
  const unbilled = billerOf(m, billed.filter((d) => d.doc_type === 'bill'), (d) => d.organization) ? [] : owed.filter((c) => !billed.some((d) => sameProvider(c.provider, d.organization)));
  return card(
    { title: 'Bills and payments' },
    bills.map(billRow),
    unbilled.map((c) => h('p', { class: 'event-gap' }, `No bill from ${c.provider} filed yet, for the ${money(c.share)} its claim says you owe.`)),
    h('p', { class: 'small' }, link({ name: 'money', view: 'bills', who: idx.person }, 'All bills, beside their claims')),
  );
}

function papersCard(ctx: Ctx, idx: PersonIndex, e: CareEvent): HTMLElement {
  return card(
    { title: 'Papers' },
    e.papers.length
      ? e.papers.map((p) => {
          // One filed under someone else is here only while it is not private (medrecEvents.ts): marked so since, its View opens nothing.
          const other = p.person && p.person !== idx.person ? p.person : undefined;
          const allowed = () => {
            const theirs = other ? ctx.store.index(other) : idx;
            return !!theirs && !(other && paperPrivate(theirs, p.doc.id));
          };
          const paper = paperView(ctx, p.doc, allowed);
          return row({
            route: itemRoute(p.person ?? idx.person, p.doc.id),
            title: documentTitle(p.doc),
            meta: [docTypeLabel(p.doc.doc_type), dateText(p.doc.date), p.person ? `filed under ${ctx.store.person(p.person) ? called(ctx.store.person(p.person)!) : 'someone else'}` : null].filter(Boolean).join(' · '),
            extra: h('div', null, h('div', { class: 'row-actions' }, paper.button, driveLink(ctx, p.doc.path, 'Open in Drive')), paper.panel),
          });
        })
      : empty('No papers in the folder for this visit.'),
  );
}

const sureWord = (c: string) => (c === 'sure' ? null : chip(c === 'likely' ? 'Likely' : 'Unsure', 'muted'));

/** Who grouped this person's visits, and why the app did when medrec wrote events for them. */
function grouping(ctx: Ctx, idx: PersonIndex): string {
  if (groupedByMedrec(idx)) return 'medrec grouped these by its matching rules.';
  const why = ctx.store.eventsNotes.get(idx.person)?.text ?? ctx.store.viewsError?.text;
  return why ? `The app grouped these by medrec’s matching rules. ${why}` : 'The app groups these itself until medrec writes events.';
}

function assemblyCard(ctx: Ctx, idx: PersonIndex, e: CareEvent): HTMLElement {
  const items: Child[] = [
    ...e.visits.map((v) => row({ route: itemRoute(idx.person, v.record.id), title: visitTitle(v.record), meta: `Portal visit · ${ruleText(v.rule)}`, aside: [differChip({ type: 'record', record: v.record }), sureWord(v.confidence)] })),
    ...e.claims.map((c) => row({ route: itemRoute(idx.person, c.record.id), title: c.provider ?? recordTitle(c.record), meta: `Claim · ${ruleText(c.rule)}`, aside: [differChip({ type: 'record', record: c.record }), sureWord(c.confidence)] })),
    ...e.papers.map((p) => row({ route: itemRoute(p.person ?? idx.person, p.doc.id), title: documentTitle(p.doc), meta: `Paper · ${ruleText(p.rule)}`, aside: [differChip({ type: 'document', document: p.doc }), sureWord(p.confidence)] })),
  ];
  return h(
    'details',
    { class: 'tech' },
    h('summary', null, 'How this visit was put together'),
    card(
      {},
      e.doubt ? h('p', { class: 'event-gap' }, `${e.doubt}.`) : null,
      e.noFacility ? h('p', { class: 'event-gap' }, 'No claim from the hospital itself is in yet; this visit is known from its doctors’ claims.') : null,
      // What medrec still expects, in its words. A missing bill is said under Bills, and a hospital's own claim just above.
      (e.expected ?? []).filter((x) => x.what !== 'bill' && !(x.what === 'facility_claim' && e.noFacility) && x.why).map((x) => h('p', { class: 'event-gap' }, x.why)),
      items,
      h('p', { class: 'small muted' }, grouping(ctx, idx), ' “Likely” means only the day and the kind of visit tie it in.'),
    ),
  );
}

function detailsCard(idx: PersonIndex, e: CareEvent): HTMLElement {
  const claimRows = e.claims.map((c) => row({ route: itemRoute(idx.person, c.record.id), title: recordTitle(c.record), meta: [c.provider, dateText(c.record.date)].filter(Boolean).join(' · ') }));
  const recorded = e.recorded.filter((r) => r.kind !== 'result').map((r) => {
    const { words, title } = inDetails(conditionName(idx, r));
    return row({ route: itemRoute(idx.person, r.id), title: words, meta: [KIND_LABELS[r.kind] ?? r.kind, title].filter(Boolean).join(' · ') });
  });
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
      e.descriptors ? h('h3', { class: 'card-sub' }, 'In the records’ billing words') : null,
      e.descriptors ? h('ul', { class: 'event-descriptors small' }, e.descriptors.map((d) => h('li', null, d))) : null,
      h('p', { class: 'small muted' }, `Each claim’s page has its lines, codes, ${AMOUNT_LABELS.allowed.toLowerCase()} amounts and the raw data.`),
    ),
  );
}

/** An event of which nothing stands, opened by its id: that it is entered in error, and what is in it. */
function errorEvent(ctx: Ctx, idx: PersonIndex, id: string): HTMLElement | null {
  const e = eventInError(idx, ctx.store.household, id);
  if (!e) return null;
  const { title, kind } = headline(e);
  const part = (item: { id: string; title: string; kind: string }) => row({ route: itemRoute(idx.person, item.id), title: item.title, meta: item.kind, aside: isInError(idx, item.id) ? chip('Entered in error', 'attention') : null });
  return card(
    {},
    kind ? h('p', { class: 'event-kind small muted' }, kind) : null,
    h('div', { class: 'card-head' }, h('h1', null, title), chip('Entered in error', 'attention')),
    h('p', { class: 'muted' }, dotted([eventWhen(e), e.place])),
    h('p', null, 'What makes it a visit is entered in error, so it is in no list or total.'),
    privateNote(e, idx, 'Everyone’s Calendar does not count it.'),
    ...[...e.visits.map((v) => v.record), ...e.claims.map((c) => c.record), ...e.recorded].map((r) => part({ id: r.id, title: recordTitle(r), kind: KIND_LABELS[r.kind] ?? r.kind })),
    ...e.papers.filter((p) => !p.person).map((p) => part({ id: p.doc.id, title: documentTitle(p.doc), kind: docTypeLabel(p.doc.doc_type) })),
  );
}

export function eventView(ctx: Ctx, personId: string, id: string): HTMLElement {
  const person = ctx.store.person(personId);
  const idx = ctx.store.index(personId);
  const back = person ? h('p', null, link({ name: 'health', who: personId }, icon('back', 16), ` ${called(person)}`)) : null;
  if (!person || !idx) return card({}, empty('This person is not in the records folder.'));
  // Any record or paper of the visit opens it, so a saved address still works
  // after the visit is regrouped and led by another record.
  const e = eventOf(personEvents(idx, ctx.store.household, localDay(ctx.now())), id);
  if (!e) return h('div', { class: 'stack' }, back, errorEvent(ctx, idx, id) ?? card({}, empty('This visit is not in these records.')));
  if (e.id !== id) history.replaceState(null, '', `${location.pathname}${location.search}${href(eventRoute(personId, e.id))}`);
  const m = eventMoney(e);
  return h(
    'div',
    { class: 'stack event' },
    back,
    headCard(ctx, idx, e, m),
    happenedCard(ctx, idx, e),
    resultsCard(idx, e),
    costCard(e, m),
    changedCard(idx, e),
    chargesCard(ctx, idx, e, m),
    billsCard(ctx, idx, e, m),
    papersCard(ctx, idx, e),
    assemblyCard(ctx, idx, e),
    detailsCard(idx, e),
  );
}

/** A person's events, newest first, as cards with one number each: their Health's list. */
export function eventsCard(ctx: Ctx, personId: string, idx: PersonIndex, shown = 8): HTMLElement {
  const events = personEvents(idx, ctx.store.household, localDay(ctx.now()));
  return card(
    { title: 'What happened' },
    events.length
      ? events.slice(0, shown).map((e) => {
          const n = eventNumber(eventMoney(e));
          const { title, kind } = headline(e);
          return row({ route: eventRoute(personId, e.id), title: [title, e.place].filter(Boolean).join(' · '), meta: [kind, eventWhen(e), e.what].filter(Boolean).join(' · '), aside: [knownArea(eventPrivate(e, idx)) ? chip('Private', 'muted') : null, n ? h('span', { class: 'num' }, n) : null] });
        })
      : empty('No visits, claims or papers yet.'),
    events.length ? h('p', { class: 'small' }, link({ name: 'calendar', view: 'list', who: personId }, events.length > shown ? `All ${events.length} in the calendar` : 'In the calendar')) : null,
  );
}

/** A record's page says which visit it is part of. */
export function partOfEvent(ctx: Ctx, personId: string, idx: PersonIndex, recordId: string): HTMLElement | null {
  const e = eventOf(personEvents(idx, ctx.store.household, localDay(ctx.now())), recordId);
  if (!e) return null;
  return h('p', { class: 'event-part' }, 'Part of ', link(eventRoute(personId, e.id), `${headline(e).title}, ${eventWhen(e)}`));
}

