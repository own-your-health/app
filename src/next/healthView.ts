// Health. Everyone's view gives each person a card: what the
// records can know about them, what is due, what is current and what is
// worth a look. A person's page runs in a fixed order: Due, Current, Worth
// noticing, Recently, then Quiet, which counts what is not news and links to
// it. Hand to a doctor is a dense sheet in a clinician's terms. Private items
// show on their person's own page, marked; they stay off everyone's view,
// counted, and off the sheet unless turned on.

import { rangeWords, unitText, verdict } from '../model/result';
import { rangeFor } from '../model/flags';
import type { ConditionItem, MedicineItem, AllergyItem } from '../model/lists';
import type { LatestResult } from '../model/overview';
import { originNames } from '../model/records';
import type { Household, Person, PersonIndex, Provenance } from '../model/types';
import { button, card, chip, empty, link, row, type Ctx } from '../ui/components';
import { h, icon, type Child } from '../ui/dom';
import { count, dateText, localDay } from '../ui/format';
import { href, type Route } from '../ui/router';
import { eventsCard } from './eventView';
import { ageWords, refillRow, vaccinesDueRow, visitRow } from './homeView';
import { coverageOf, doctorSheet, healthOf, icdOf, privateOf, resultPrivate, trendOf, type HealthItems, type SheetSection } from './health';
import { privateChip } from './moneyParts';
import { refillsDue, vaccineNeeds } from './needs';
import { anyLeftOff, heldNotes } from './shared';
import { conditionName } from '../model/codeNames';
import { isHeld, whyHeld } from '../model/private';
import { called } from '../model/people';

type HealthRoute = Extract<Route, { name: 'health' }>;

// The doctor's sheet leaves private items off until someone includes them, for that one person's sheet.
// Any other page, another person's sheet included, leaves them off again.
let includedFor: string | null = null;

export function leaveOutPrivate(route: Route): void {
  if (route.name !== 'health' || route.view !== 'doctor' || route.who !== includedFor) includedFor = null;
}

const meta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const itemRoute = (person: string, id: string): Route => ({ name: 'item', person, id });

function head(ctx: Ctx, title: string, lead: string, who: string | undefined, view?: 'doctor'): HTMLElement[] {
  const whose = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Whose health' },
    [...(view ? [] : [{ id: '', name: 'Everyone' }]), ...ctx.store.household.people].map((p) => {
      const on = p.id ? who === p.id : !who;
      return h('a', { class: ['filter', on ? 'filter-on' : null], href: href({ name: 'health', ...(view ? { view } : {}), ...(p.id ? { who: p.id } : {}) }), 'aria-current': on ? 'page' : false }, called(p));
    }),
  );
  const back = view && who ? h('p', { class: 'sheet-back' }, link({ name: 'health', who }, icon('back', 16), ' Health')) : null;
  const out: (HTMLElement | null)[] = [back, h('h1', null, title), h('p', { class: 'lead' }, lead), whose];
  return out.filter((x): x is HTMLElement => x !== null);
}

/** Where an item's records came from: "from Example Health, Example Lab". */
type From = (prov: Provenance[]) => string | null;

function fromOf(household: Household, person: string): From {
  return (prov) => {
    const names = originNames(prov, household, person);
    return names.length ? `from ${names.join(', ')}` : null;
  };
}

/** A result's value with its unit in words. */
const reading = (x: LatestResult) => unitText(x.latest.text) ?? x.latest.text;

/** "Since Mar 2, 2024 · last recorded Oct 12, 2026". */
function recorded(item: { first?: string; latest: { date?: string } }): string | null {
  const last = item.latest.date ? `last recorded ${dateText(item.latest.date)}` : null;
  return meta(item.first && item.first !== item.latest.date ? `since ${dateText(item.first)}` : null, last) || null;
}

function conditionRow(p: Person, idx: PersonIndex, c: ConditionItem, from: From): HTMLElement {
  return row({
    route: itemRoute(p.id, c.latest.id),
    title: conditionName(idx, c.latest).name,
    meta: meta(recorded(c), from(c.provenance)),
    aside: [c.unconfirmed ? chip('Not confirmed', 'muted') : null, c.statusNote ? chip(c.statusNote, 'muted') : null, privateChip(privateOf(idx, c.records))],
  });
}

function medicineRow(p: Person, idx: PersonIndex, m: MedicineItem, from: From): HTMLElement {
  const dosage = typeof m.latest.fields.dosage === 'string' ? m.latest.fields.dosage : null;
  const fill = m.lastFill?.date ? `filled ${dateText(m.lastFill.date)}${m.lastFill.pharmacy ? ` at ${m.lastFill.pharmacy}` : ''}` : null;
  return row({ route: itemRoute(p.id, m.latest.id), title: m.name, meta: meta(dosage, m.prescriber ? `prescribed by ${m.prescriber}` : null, fill ?? recorded(m), from(m.provenance)), aside: privateChip(privateOf(idx, m.records)) });
}

function allergyRow(p: Person, idx: PersonIndex, a: AllergyItem, from: From): HTMLElement {
  return row({ route: itemRoute(p.id, a.latest.id), title: a.name, meta: meta(a.reactions.length ? a.reactions.join(', ') : null, recorded(a), from(a.provenance)), aside: privateChip(privateOf(idx, a.records)) });
}

const TREND: Record<'up' | 'down' | 'same', string> = { up: 'up from the result before', down: 'down from the result before', same: 'the same as the result before' };

function resultRow(p: Person, idx: PersonIndex, x: LatestResult, from: From): HTMLElement {
  const v = verdict(x.latest);
  const t = trendOf(x);
  const prov = idx.records.find((r) => r.id === x.latest.id)?.provenance ?? [];
  return row({
    route: itemRoute(p.id, x.latest.id),
    title: x.series.name,
    meta: meta(reading(x), x.latest.date ? dateText(x.latest.date) : null, t ? TREND[t] : null, from(prov), v.text),
    aside: [x.flag ? chip(x.flag.critical ? 'Critical' : x.flag.label, x.flag.critical ? 'error' : 'attention') : null, privateChip(resultPrivate(idx, x))],
  });
}

/** Due: vaccine doses the schedule places by now, refills, and the doses coming up. */
function dueCard(p: Person, idx: PersonIndex, today: string): HTMLElement {
  const v = vaccineNeeds(p.birth_date, idx, today);
  const rows = [v ? vaccinesDueRow(p, v, true) : null, ...refillsDue(idx, today).map((r) => refillRow(p, r, true)), ...(v?.visits ?? []).map((x) => visitRow(p, x, true))].filter((x): x is HTMLElement => !!x);
  return card({ title: 'Due' }, rows.length ? rows : empty('Nothing due: no vaccine doses or refills in these records.'));
}

/** Current: conditions, medicines and allergies, each with when it was last recorded. */
function currentCard(p: Person, idx: PersonIndex, h0: HealthItems, words: string, from: From): HTMLElement {
  const group = (title: string, rows: HTMLElement[], none: string) => [h('h3', { class: 'health-group' }, title), rows.length ? rows : h('p', { class: 'small muted' }, none)];
  return card(
    { title: 'Current' },
    group('Conditions', h0.conditions.map((c) => conditionRow(p, idx, c, from)), `No active conditions ${words}.`),
    group('Medicines', h0.medicines.map((m) => medicineRow(p, idx, m, from)), `No current medicines ${words}.`),
    group('Allergies', h0.allergies.map((a) => allergyRow(p, idx, a, from)), `No allergies ${words}.`),
  );
}

/** Quiet: what is not news, counted, each a link to all of it. */
function quietCard(p: Person, h0: HealthItems): HTMLElement | null {
  const q = h0.quiet;
  const line = (n: number, what: string, why: string, section: 'conditions' | 'medicines' | 'allergies' | 'results' | 'immunizations') =>
    n ? row({ route: { name: 'person', person: p.id, section }, title: `${n} ${what}`, meta: why }) : null;
  const rows = [
    line(q.conditions.length, q.conditions.length === 1 ? 'past or unconfirmed condition' : 'past or unconfirmed conditions', 'Ended, ruled out, or with no status.', 'conditions'),
    line(q.medicines.length, q.medicines.length === 1 ? 'past medicine' : 'past medicines', 'No record says they are taken now.', 'medicines'),
    line(q.allergies.length, q.allergies.length === 1 ? 'past allergy' : 'past allergies', 'Marked inactive or resolved.', 'allergies'),
    line(q.inRange.length, q.inRange.length === 1 ? 'test in range' : 'tests in range', 'The newest result of each is within the lab’s range, or has none.', 'results'),
    line(q.olderFlags.length, q.olderFlags.length === 1 ? 'older result out of range' : 'older results out of range', 'More than two years old, with nothing newer.', 'results'),
    line(q.vaccines.length, q.vaccines.length === 1 ? 'vaccine given' : 'vaccines given', 'Every dose, by date.', 'immunizations'),
  ].filter((x): x is HTMLElement => !!x);
  if (!rows.length) return null;
  const n = q.conditions.length + q.medicines.length + q.allergies.length + q.inRange.length + q.olderFlags.length + q.vaccines.length;
  return h('details', { class: 'card health-quiet' }, h('summary', null, `Quiet: ${count(n, 'item')} that are not news`), rows);
}

/** One person's page. */
function personPage(ctx: Ctx, p: Person, idx: PersonIndex): HTMLElement {
  const today = localDay(ctx.now());
  const h0 = healthOf(idx, today);
  const cov = coverageOf(idx);
  const from = fromOf(ctx.store.household, p.id);
  const words = cov.kind === 'claims_only' ? 'that claims and papers show' : 'in these records';
  return h(
    'div',
    { class: 'stack health' },
    ...head(ctx, 'Health', `Where ${called(p)} stands: what is due, what is current, and what is worth a look.`, p.id),
    card(
      { class: 'health-standing' },
      h('div', { class: 'chips' }, p.birth_date ? chip(ageWords(p.birth_date, today) ?? '', 'muted') : null, chip(cov.words, cov.kind === 'records_and_claims' ? 'ok' : 'attention')),
      h('p', { class: 'small muted' }, cov.detail),
      h('div', { class: 'health-actions' }, link({ name: 'health', view: 'doctor', who: p.id }, 'Hand to a doctor'), link({ name: 'papers', who: p.id }, 'Papers')),
    ),
    dueCard(p, idx, today),
    currentCard(p, idx, h0, words, from),
    card({ title: 'Worth noticing' }, h0.noticing.length ? h0.noticing.map((x) => resultRow(p, idx, x, from)) : empty(`No result out of range in the last two years ${words}.`)),
    eventsCard(ctx, p.id, idx, 3),
    quietCard(p, h0),
  );
}

/** Everyone: a card per person, private items left off and counted. */
function everyonePage(ctx: Ctx): HTMLElement {
  const store = ctx.store;
  const today = localDay(ctx.now());
  // Each private item once, by person and item: a medicine and its refill are one.
  const kept = new Set<string>();
  const nothing = (words: string) => (anyLeftOff(store) ? 'Nothing listed here' : words);
  const cards = store.household.people.map((p) => {
    const idx = store.index(p.id);
    if (!idx) return card({ title: called(p) }, h('p', { class: 'small muted' }, store.indexErrors.has(p.id) ? 'Their records could not be read.' : 'Loading their records…'));
    if (isHeld(idx)) return card({ title: called(p) }, h('p', null, 'Left off this shared view'), h('p', { class: 'small' }, link({ name: 'health', who: p.id }, `${called(p)}’s health`)));
    const h0 = healthOf(idx, today);
    const cov = coverageOf(idx);
    const shared = <T>(xs: T[], priv: (x: T) => string | undefined, key: (x: T) => string) =>
      xs.filter((x) => {
        if (!priv(x)) return true;
        kept.add(`${p.id}|${key(x)}`);
        return false;
      });
    const conditions = shared(h0.conditions, (c) => privateOf(idx, c.records), (c) => c.key);
    const medicines = shared(h0.medicines, (m) => privateOf(idx, m.records), (m) => m.key);
    const allergies = shared(h0.allergies, (a) => privateOf(idx, a.records), (a) => a.key);
    const noticing = shared(h0.noticing, (x) => resultPrivate(idx, x), (x) => x.series.key);
    const v = vaccineNeeds(p.birth_date, idx, today);
    const refills = shared(refillsDue(idx, today), (r) => r.private, (r) => r.medicine.key);
    const dueNames = [...(v?.due ?? []).map((d) => d.name), ...(v?.flu ? ['Flu'] : []), ...refills.map((r) => `${r.medicine.name} refill`)];
    const next = v?.visits[0];
    // Named as on the person's own Due: one dose by name, several by the visit's age.
    const one = next?.doses.length === 1 ? next.doses[0] : undefined;
    const coming = next ? `${one ? `${one.name}, dose ${one.next.dose}` : next.months !== undefined ? `${next.months}-month vaccines` : count(next.doses.length, 'vaccine dose')} from ${dateText(next.from)}` : null;
    const lines: [string, Child][] = [
      ['Due', [dueNames.length ? `${count(dueNames.length, 'item')}: ${dueNames.join(', ')}` : nothing('Nothing now'), coming ? `. Next: ${coming}` : ''].join('')],
      ['Current', [conditions.length ? count(conditions.length, 'condition') : null, medicines.length ? count(medicines.length, 'medicine') : null, allergies.length ? count(allergies.length, 'allergy', 'allergies') : null].filter(Boolean).join(', ') || nothing('Nothing in these records')],
      ['Worth noticing', noticing.length ? noticing.map((x) => x.series.name).join(', ') : nothing('Nothing out of range')],
    ];
    return card(
      { title: called(p), actions: chip(cov.words, cov.kind === 'records_and_claims' ? 'ok' : 'attention') },
      h('dl', { class: 'kv health-kv' }, lines.map(([k, val]) => h('div', { class: 'kv-row' }, h('dt', null, k), h('dd', null, val)))),
      h('p', { class: 'small' }, link({ name: 'health', who: p.id }, `${called(p)}’s health`)),
    );
  });
  return h(
    'div',
    { class: 'stack health' },
    ...head(ctx, 'Health', 'Where each person stands: what is due, what is current, and what is worth a look.', undefined),
    ...cards,
    kept.size ? h('p', { class: 'small muted' }, `${count(kept.size, 'private item')} ${kept.size === 1 ? 'is' : 'are'} kept off this shared view. Each shows on its person’s own Health.`) : null,
    ...heldNotes(ctx, 'this shared view'),
  );
}

/** Hand to a doctor: the person's current picture in a clinician's terms, private items off unless included. */
function doctorPage(ctx: Ctx, p: Person, idx: PersonIndex): HTMLElement {
  const today = localDay(ctx.now());
  // How many private items the sheet leaves off when they are not included.
  const hidden = doctorSheet(idx, today, false).privateLeft;
  const included = () => includedFor === p.id;
  // Nothing says which items are private: there is no sheet until all of them are included.
  const why = whyHeld(idx);
  const NOT_LISTED = 'None listed here.';
  const section = (title: string, body: Child) => h('section', { class: 'sheet-section' }, h('h2', null, title), body);
  const list = (items: Child[], none: string) => (items.length ? h('ul', { class: 'sheet-list' }, items.map((x) => h('li', null, x))) : h('p', { class: 'muted' }, none));
  const table = (rows: LatestResult[], none: string) =>
    rows.length
      ? h(
          'table',
          { class: 'table sheet-table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Test'), h('th', { scope: 'col' }, 'Result'), h('th', { scope: 'col' }, 'Range'), h('th', { scope: 'col' }, 'Date'))),
          h(
            'tbody',
            null,
            rows.map((x) => {
              const r = rangeFor(x.latest.range, x.latest.unit);
              const flag = x.flag && x.flag.level !== 'normal' ? ` (${x.flag.critical ? 'critical' : x.flag.label.toLowerCase()})` : '';
              return h('tr', null, h('td', null, x.series.name), h('td', null, `${reading(x)}${flag}`), h('td', null, r ? rangeWords(r, x.latest.unit) : (x.latest.range ?? '')), h('td', null, x.latest.date ? dateText(x.latest.date) : ''));
            }),
          ),
        )
      : h('p', { class: 'muted' }, none);
  const sheetCard = () => {
    const sheet = doctorSheet(idx, today, included());
    if (why && !included()) return h('div');
    const none = (s: SheetSection, words: string) => (sheet.leftFrom.has(s) ? NOT_LISTED : words);
    return card(
      { class: 'sheet' },
      section('Allergies', list(sheet.allergies.map((a) => meta(a.name, a.reactions.join(', ') || null, a.criticality ? `criticality ${a.criticality}` : null)), none('allergies', 'No known allergies in these records.'))),
      section('Medicines', list(sheet.medicines.map((m) => meta(m.name, typeof m.latest.fields.dosage === 'string' ? m.latest.fields.dosage : null, m.prescriber ?? null, m.lastFill?.date ? `last filled ${dateText(m.lastFill.date)}` : null)), none('medicines', 'No current medicines in these records.'))),
      section('Problems', list(sheet.problems.map((c) => [c, conditionName(idx, c.latest)] as const).map(([c, n]) => meta(n.name, icdOf(c) ? `ICD-10 ${icdOf(c)}${n.title ? `, ${n.title}` : ''}` : null, c.first ? `since ${dateText(c.first)}` : null)), none('problems', 'No active problems in these records.'))),
      section('Vaccines', list(sheet.vaccines.map((v) => meta(v.name, v.doses.map((d) => (d.date ? dateText(d.date) : 'undated')).join(', '))), none('vaccines', 'No vaccines in these records.'))),
      section('Labs, last two years', table(sheet.labs, none('labs', 'No lab results in the last two years.'))),
      section('Vital signs, last two years', table(sheet.vitals, none('vitals', 'No vital signs in the last two years.'))),
      section('Care team', list(sheet.careTeam.map((m) => meta(m.name, m.last ? `last seen ${dateText(m.last)}${m.place ? ` at ${m.place}` : ''}` : null, m.prescribes.length ? `prescribes ${m.prescribes.join(', ')}` : null)), none('careTeam', 'No doctors named in the last two years.'))),
    );
  };
  // The status and the button stay in place and change their words, so the change is announced; only the sheet is rebuilt.
  const said = () =>
    why
      ? included()
        ? `All ${called(p)}’s items are included, private ones too.`
        : `${called(p)}’s items are left off this sheet until you include them, private ones too. ${why}`
      : `${count(hidden, 'private item')} ${hidden === 1 ? 'is' : 'are'} ${included() ? 'included' : 'left off'}.`;
  const label = () => (why ? (included() ? 'Leave them off' : 'Include them all') : included() ? 'Leave private items off' : `Include ${count(hidden, 'private item')}`);
  let shown = sheetCard();
  const status = h('span', null, said());
  const toggle = button(label(), () => {
    includedFor = included() ? null : p.id;
    status.textContent = said();
    toggle.textContent = label();
    const next = sheetCard();
    shown.replaceWith(next);
    shown = next;
  });
  return h(
    'div',
    { class: 'stack health doctor' },
    ...head(ctx, `${p.name}’s health summary`, 'Hand this to a doctor: the current picture in a clinician’s terms.', p.id, 'doctor'),
    h('p', { class: 'small' }, meta(p.birth_date ? `Born ${dateText(p.birth_date)} (${ageWords(p.birth_date, today)})` : null, `From ${coverageOf(idx).words.toLowerCase()}, as of ${dateText(today)}`)),
    hidden ? h('div', { class: 'sheet-private' }, h('p', { class: 'small muted' }, h('span', { role: 'status' }, status), ' This is discretion, not security: the files stay readable in the shared Drive folder.'), toggle) : null,
    h('p', { class: 'sheet-print' }, button('Print', () => window.print(), { small: true })),
    shown,
  );
}

export function healthView(ctx: Ctx, route: HealthRoute): HTMLElement {
  const store = ctx.store;
  const p = route.who ? store.household.people.find((x) => x.id === route.who) : undefined;
  if (!p) {
    if (route.view === 'doctor') return h('div', { class: 'stack health' }, ...head(ctx, 'Hand to a doctor', 'Whose sheet?', undefined, 'doctor'));
    return everyonePage(ctx);
  }
  const idx = store.index(p.id);
  if (!idx) return h('div', { class: 'stack health' }, ...head(ctx, 'Health', store.indexErrors.has(p.id) ? 'Their records could not be read.' : 'Loading their records…', p.id, route.view));
  return route.view === 'doctor' ? doctorPage(ctx, p, idx) : personPage(ctx, p, idx);
}
