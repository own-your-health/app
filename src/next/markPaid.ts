// Mark paid: beside a bill, a way to say it was paid, for a payment no receipt
// in the folder shows. It writes a request, and the Mac records the payment on
// its next pass. Until then the bill is marked, not settled: medrec's list
// alone says what is paid. An account that may only view the folder has none
// of it.

import { billList, receiptDay, type Bill } from '../model/billing';
import { called } from '../model/people';
import { atLeast } from '../model/private';
import { formatMoney, fromCents, toCents, type Money } from '../model/records';
import { markedAmount, paidAmount, typedAmount } from '../model/requests';
import { requestWait } from '../model/sources';
import type { MarkRequest, PendingMark, PersonIndex } from '../model/types';
import { button, command, sheet, type Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { dateText, localDay } from '../ui/format';
import { billMarks, unmarkedCents } from './money';

const RECENT_MS = 14 * 86_400_000;

/**
 * Whether this account can ask for what a version of medrec added: of the one
 * that answers requests, and while the household's payments can be read, as
 * medrec then writes none.
 */
const canAsk = (ctx: Ctx, idx: PersonIndex, since: [number, number, number]): boolean => ctx.canWrite && ctx.store.requestsReady && ctx.store.mayRequest && atLeast(ctx.store.refresher, since) && idx.bills?.marksUnreadable === false;
const canMark = (ctx: Ctx, idx: PersonIndex): boolean => canAsk(ctx, idx, [0, 9, 1]);
const canUnmark = (ctx: Ctx, idx: PersonIndex): boolean => canAsk(ctx, idx, [0, 9, 7]);

/** Where a request stands with the Mac. */
function waitText(ctx: Ctx, m: PendingMark): string {
  if (m.taken) return m.late ? 'The Mac had read it before you took it back, and has recorded it.' : 'The Mac has recorded it.';
  const now = ctx.now();
  return requestWait(m.request, ctx.store.sources(now), ctx.store.mac(now), now).kind === 'late' ? 'The Mac has not taken it yet.' : 'Waiting for the Mac.';
}

/** A payment that waits for the Mac, with its undo while the request is still there. */
function waitingLine(ctx: Ctx, m: PendingMark): HTMLElement {
  const paid = m.request.paid!;
  const what = `${formatMoney(markedAmount(paid))} marked paid, ${dateText(paid.on)}`;
  const undo = button('Undo', () => void ctx.cancel(m), { small: true });
  undo.setAttribute('aria-label', `Undo: ${what}`);
  return h('div', { class: 'mark-line' }, h('span', { class: 'small' }, `${what}. ${waitText(ctx, m)}`), m.cancellable ? [undo, h('span', { class: 'small muted' }, 'You can undo this until it is filed.')] : null);
}

const requestedAt = (r: MarkRequest) => Date.parse(r.requested_at);

/** The last of some answered requests, when the Mac could not record it. */
function lastFailed(ctx: Ctx, of: (r: MarkRequest) => boolean): MarkRequest | undefined {
  const last = ctx.store.answeredMarks.filter(of).sort((a, b) => requestedAt(b) - requestedAt(a))[0];
  if (last?.handled?.outcome !== 'failed' && last?.handled?.outcome !== 'invalid') return undefined;
  return ctx.now().getTime() - requestedAt(last) < RECENT_MS ? last : undefined;
}

/** The last payment marked on a bill, when the Mac could not record it and nothing was marked since. */
function notRecorded(ctx: Ctx, idx: PersonIndex, bill: Bill): MarkRequest | undefined {
  if (billMarks(idx, bill, ctx.store.marks).length) return undefined;
  return lastFailed(ctx, (r) => billMarks(idx, bill, [{ file: '', request: r, cancellable: false }]).length > 0);
}

/** What Mark paid asks for on a bill: what is left that no payment is marked for, where medrec's list says what that is. */
const toMark = (ctx: Ctx, idx: PersonIndex, bill: Bill): number => (bill.medrec && !bill.replacedBy ? unmarkedCents(bill, billMarks(idx, bill, ctx.store.marks)) : 0);

const provider = (bill: Bill): string => bill.provider ?? 'the bill';

/** Whose bill it is and what it asks, for the form and for a screen reader's list of buttons. */
const billName = (bill: Bill): string => `${provider(bill)}${bill.date ? `, ${dateText(bill.date)}` : ''}`;

/**
 * What marks a bill paid: the payments that wait for the Mac, and the button
 * for what is left, where medrec's list says what that is. `named` puts the
 * provider on the button, where several bills share a row. Null when there is
 * neither.
 */
export function paidControl(ctx: Ctx, idx: PersonIndex, bill: Bill, named = false): HTMLElement | null {
  if (bill.settled || bill.replacedBy) return null;
  const marks = billMarks(idx, bill, ctx.store.marks);
  const cents = toMark(ctx, idx, bill);
  const failed = notRecorded(ctx, idx, bill);
  const mark = cents > 0 && canMark(ctx, idx) ? button(named ? `Mark paid: ${provider(bill)}` : 'Mark paid', (ev) => openForm(ctx, idx, bill, cents, ev.currentTarget as HTMLElement), { small: true }) : null;
  mark?.setAttribute('aria-label', `Mark paid: ${billName(bill)}, ${formatMoney(fromCents(cents, bill.left!.currency))}`);
  if (!marks.length && !failed && !mark) return null;
  return h(
    'div',
    { class: 'mark-paid', 'data-mark': bill.doc.id, tabindex: '-1' },
    marks.map((m) => waitingLine(ctx, m)),
    failed ? h('p', { class: 'small attention' }, `The payment marked for ${dateText(failed.paid!.on)} was not recorded. ${failed.handled?.message ?? ''}`.trim()) : null,
    mark,
  );
}

/** The payments the household marked on a bill, each with its undo, for the bill's own page. */
export function markedPayments(ctx: Ctx, idx: PersonIndex, bill: Bill): HTMLElement | null {
  const undoing = new Map(ctx.store.marks.flatMap((m) => (m.request.unpaid?.person === idx.person ? [[m.request.unpaid.payment, m] as const] : [])));
  const lines = bill.payments.flatMap((p): HTMLElement[] => {
    const id = p.from === 'household' ? p.id : undefined;
    if (!id) return [];
    const what = `${[formatMoney(p.amount), 'marked paid'].filter(Boolean).join(' ')}${p.on ? `, ${dateText(p.on)}` : ''}`;
    const asked = undoing.get(id);
    if (asked)
      return [h('div', { class: 'mark-line' }, h('span', { class: 'small' }, asked.taken ? `${what}. ${asked.late ? 'The Mac had read the undo before you took it back, and has undone it.' : 'The Mac has undone it.'}` : `${what}. Undo asked; ${waitText(ctx, asked).replace(/^./, (c) => c.toLowerCase())}`), asked.cancellable ? button('Keep the payment', () => void ctx.cancel(asked), { small: true }) : null)];
    const failed = lastFailed(ctx, (r) => r.unpaid?.person === idx.person && r.unpaid.payment === id);
    const why = failed ? [h('p', { class: 'small attention' }, `The undo was not recorded. ${failed.handled?.message ?? ''}`.trim())] : [];
    if (canUnmark(ctx, idx)) {
      const undo = button('Undo', () => void ctx.mark({ unpaid: { person: idx.person, payment: id } }), { small: true });
      undo.setAttribute('aria-label', `Undo: ${what}`);
      return [...why, h('div', { class: 'mark-line' }, h('span', { class: 'small' }, what), undo)];
    }
    return canMark(ctx, idx)
      ? [...why, h('details', { class: 'mark-undo' }, h('summary', null, `Undo: ${what}`), h('p', { class: 'small muted' }, 'It is filed, so it is undone on the Mac. Run this in a terminal, with your medrec profile’s name at the end:'), command(`medrec bills undo ${id} --profile `, ctx))]
      : why;
  });
  return lines.length ? h('div', { class: 'mark-paid' }, lines) : null;
}

/** How far a typed amount is from what is left, in a few words. */
function restText(left: number, currency: string, typed: string | null): string {
  const cents = typed === null ? undefined : toCents({ amount: typed, currency });
  if (cents === undefined) return `${formatMoney(fromCents(left, currency))} is left to pay.`;
  const text = (c: number) => formatMoney(fromCents(c, currency));
  return cents === left ? 'That is all that is left to pay.' : cents < left ? `${text(left - cents)} of ${text(left)} would be left to pay.` : `That is ${text(cents - left)} more than is left to pay.`;
}

function openForm(ctx: Ctx, idx: PersonIndex, bill: Bill, left: number, from: HTMLElement): void {
  const currency = bill.left!.currency;
  const person = ctx.store.person(idx.person);
  const today = localDay(ctx.now());
  // A receipt whose amount could not be read gives the day.
  const last = bill.unread[bill.unread.length - 1];
  const receipt = last && receiptDay(last);
  const on = h('input', { class: 'input', type: 'date', id: 'paid-on', max: today, value: receipt && receipt <= today ? receipt : today, 'aria-describedby': 'paid-problem' });
  const amount = h('input', { class: 'input', type: 'text', id: 'paid-amount', inputmode: 'decimal', autocomplete: 'off', value: fromCents(left).amount, 'aria-describedby': 'paid-rest paid-problem' });
  const rest = h('p', { class: 'small muted', id: 'paid-rest' }, restText(left, currency, fromCents(left).amount));
  const problem = h('p', { class: 'small attention', id: 'paid-problem', role: 'alert' });
  amount.addEventListener('input', () => (rest.textContent = restText(left, currency, typedAmount(amount.value))));
  const send = h('button', { type: 'submit', class: 'button button-primary' }, h('span', null, 'Mark paid'));
  const refuse = (field: HTMLInputElement, text: string) => {
    problem.textContent = text;
    for (const f of [on, amount]) f.setAttribute('aria-invalid', f === field ? 'true' : 'false');
    field.focus();
  };
  /** Whether that is still what is left, whoever marked or recorded a payment since. */
  const stands = () => {
    const now = ctx.store.index(idx.person);
    const b = now && billList(now).find((x) => x.doc.id === bill.doc.id);
    return !!now && !!b && toMark(ctx, now, b) === left;
  };
  const submit = async () => {
    const paid: Money | null = typedAmount(amount.value) === null ? null : { amount: typedAmount(amount.value)!, currency };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on.value)) return refuse(on, 'Choose the day it was paid.');
    if (on.value > today) return refuse(on, 'That day is still to come. Mark it once it is paid.');
    if (!paid) return refuse(amount, 'Enter the amount paid, like 120.00.');
    // Kept focusable while it is sent: a disabled button loses the keyboard's place.
    if (send.getAttribute('aria-disabled') === 'true') return;
    send.setAttribute('aria-disabled', 'true');
    problem.textContent = '';
    for (const f of [on, amount]) f.setAttribute('aria-invalid', 'false');
    const sent = await ctx.mark({ paid: { person: idx.person, document: bill.doc.id, on: on.value, amount: paidAmount(paid) } }, (text) => (problem.textContent = text), stands);
    send.removeAttribute('aria-disabled');
    if (!sent) return;
    close();
    document.querySelector<HTMLElement>(`[data-mark="${CSS.escape(bill.doc.id)}"]`)?.focus();
  };
  const form = h(
    'form',
    {
      class: 'paid-form',
      novalidate: true,
      on: {
        submit: (ev) => {
          ev.preventDefault();
          void submit();
        },
      },
    },
    h('p', null, [person ? called(person) : null, billName(bill), `${formatMoney(fromCents(left, currency))} left to pay`].filter(Boolean).join(' · ')),
    h('label', { class: 'label', for: 'paid-on' }, 'Paid on'),
    on,
    last ? h('p', { class: 'small muted' }, receipt && receipt <= today ? 'The day on the receipt in the folder. Its amount could not be read, so check it.' : 'A receipt for it is in the folder. Its amount could not be read, so check it.') : null,
    h('label', { class: 'label', for: 'paid-amount' }, currency === 'USD' ? 'Amount' : `Amount (${currency})`),
    amount,
    rest,
    problem,
    h('p', { class: 'small muted' }, 'A payment that is only scheduled, or set to be taken by itself, is not paid yet. Mark it once it goes through.'),
    h('p', { class: 'small muted' }, 'The Mac files it on its next pass. You can undo this until it is filed.'),
    h('div', { class: 'row-actions' }, send, button('Cancel', () => close(), { ghost: true })),
  );
  const panel = sheet('Mark paid', form, () => from.isConnected && from.focus());
  const close = () => panel.querySelector<HTMLElement>('.sheet-head .icon-button')?.click();
  document.body.appendChild(panel);
  on.focus();
}
