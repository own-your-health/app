// What medrec says of each bill: what was paid against it and what is left,
// whether it is settled, and what is worth a call
// (views/<person id>/bills.json, `medrec-bills/v1`, medrec 0.9.1 and later).
// A payment is a receipt's, or the household's own mark. Without a file that
// reads and matches the folder, the receipts alone say what is paid.

import { FolderError, isObject } from './parse';
import { toCents, type Money } from './records';

export interface Payment {
  /** A receipt in the folder, or a mark the household made. */
  from: 'receipt' | 'household';
  /** The household's mark, by which it can be undone. */
  id?: string;
  /** The receipt. */
  document?: string;
  on?: string;
  amount?: Money;
  /** In another currency than the bill's: listed, and not taken off what is left. */
  apart?: boolean;
}

export interface BillState {
  payments: Payment[];
  /** What is left of the amount due; undefined when the bill gives none. */
  left?: Money;
  settled: boolean;
  /** A later statement from the same biller, whose balance includes this one's. */
  replacedBy?: string;
  /** The claim it bills, as medrec matched it, and that claim's share. */
  claim?: string;
  owed?: Money;
  /** It charges for what no insurer is billed for, whatever that is: no claim is to come. */
  selfPay?: true;
}

/** A bill none of whose papers stands: entered in error, all of them. */
export interface BillInError {
  document: string;
  /** The payments the household marked on it. */
  marked: number;
}

const REASONS = ['asks_more', 'asks_less', 'no_claim', 'desk_copay'] as const;
export type CallReason = (typeof REASONS)[number];

/** A bill, or for `desk_copay` a receipt, that asks something other than the claims say. */
export interface BillCall {
  reason: CallReason;
  document: string;
  asked?: Money;
  owed?: Money;
}

export interface MedrecBills {
  /** By the bill's document; a copy of a statement is under the first. */
  states: Map<string, BillState>;
  /** None of a settled bill, whatever medrec lists: before 0.9.6 it lists one no claim backs. */
  calls: BillCall[];
  /** The bills entered in error, which are in no list or total (medrec 0.9.9 and later). */
  errors: BillInError[];
  /** The household's marks could not be read, so no payment it marked is here. */
  marksUnreadable: boolean;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function moneyOf(amount: unknown, currency: unknown): Money | undefined {
  const m = text(amount) ? { amount: text(amount)!, currency: text(currency) ?? 'USD' } : undefined;
  return m && toCents(m) !== undefined ? m : undefined;
}

function payment(v: unknown): Payment {
  if (!isObject(v) || (v.from !== 'receipt' && v.from !== 'household')) throw new FolderError('malformed', 'a payment in it does not read.');
  const [id, document, on, amount] = [text(v.id), text(v.document), text(v.on), moneyOf(v.amount, v.currency)];
  return { from: v.from, ...(id ? { id } : {}), ...(document ? { document } : {}), ...(on ? { on } : {}), ...(amount ? { amount } : {}), ...(v.counted === false ? { apart: true } : {}) };
}

function state(v: unknown): BillState {
  if (!isObject(v) || typeof v.settled !== 'boolean' || !Array.isArray(v.paid)) throw new FolderError('malformed', 'a bill in it does not read.');
  const [left, claim, owed, replacedBy] = [moneyOf(v.left, v.currency), text(v.claim), moneyOf(v.claim_you_owe, v.currency), text(v.superseded_by)];
  return { payments: v.paid.map(payment), settled: v.settled, ...(left ? { left } : {}), ...(claim ? { claim } : {}), ...(owed ? { owed } : {}), ...(replacedBy ? { replacedBy } : {}), ...(text(v.self_pay) && !claim ? { selfPay: true } : {}) };
}

/** A person's bills.json. Refused when it is not one, is a newer format, or is another person's. */
export function parseBills(raw: unknown, person: string): MedrecBills {
  if (!isObject(raw) || typeof raw.schema !== 'string' || !raw.schema.startsWith('medrec-bills/')) throw new FolderError('malformed', 'it is not medrec’s list of bills.');
  if (raw.schema !== 'medrec-bills/v1') throw new FolderError('newer_format', 'it is written by a newer medrec. Update the app.');
  if (raw.person !== person) throw new FolderError('malformed', 'it is another person’s.');
  if (!isObject(raw.bills) || !Array.isArray(raw.worth_a_call)) throw new FolderError('malformed', 'a list in it is missing.');
  const states = new Map(Object.entries(raw.bills).map(([id, v]) => [id, state(v)]));
  const calls = raw.worth_a_call.flatMap((v): BillCall[] => {
    const [reason, document] = isObject(v) ? [REASONS.find((r) => r === v.reason), text(v.bill)] : [];
    // A reason of a later medrec's is none this app has words for.
    if (!isObject(v) || !reason || !document || states.get(document)?.settled) return [];
    const [asked, owed] = [moneyOf(v.asked, v.currency), moneyOf(v.owed, v.currency)];
    return [{ reason, document, ...(asked ? { asked } : {}), ...(owed ? { owed } : {}) }];
  });
  const errors = Object.entries(isObject(raw.in_error) ? raw.in_error : {}).flatMap(([document, v]): BillInError[] =>
    isObject(v) && v.as === 'bill' ? [{ document, marked: (Array.isArray(v.not_applied) ? v.not_applied : []).filter((x) => isObject(x) && x.from === 'household').length }] : [],
  );
  return { states, calls, errors, marksUnreadable: raw.marks_unreadable !== undefined && raw.marks_unreadable !== false };
}
