// The stand-in Mac's part for a payment marked on the sample: it records it in
// the person's marks.json and writes their bills.json again, in memory, as
// medrec does. MD5s are invented, and the folder then says the same ones.

import type { DemoFolder } from '../folder';
import { isObject } from '../model/parse';
import { fromCents, toCents, type Money } from '../model/records';
import { markedAmount } from '../model/requests';
import type { MarkRequest } from '../model/types';

interface Paid {
  from: string;
  id?: string;
  on?: string;
  amount: string;
  currency: string;
  counted?: boolean;
}

interface Bill {
  currency: string;
  amount_due?: string;
  paid: Paid[];
  paid_total: string;
  left?: string;
  settled: boolean;
}

interface Marks {
  schema: string;
  person: string;
  payments: { id: string; document: string; on: string; amount: Money; at: string; by: string | null; request: string }[];
}

const random = (alphabet: string, length: number) => Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => alphabet[b % alphabet.length]).join('');

/** What is left of a bill once its payments in its own currency are taken off. */
function settle(b: Bill): void {
  const total = b.paid.reduce((t, p) => t + (p.counted === false ? 0 : (toCents(p) ?? 0)), 0);
  b.paid.sort((x, y) => (x.on ?? '').localeCompare(y.on ?? ''));
  b.paid_total = fromCents(total).amount;
  const due = b.amount_due === undefined ? undefined : toCents({ amount: b.amount_due, currency: b.currency });
  if (due === undefined) return;
  b.left = fromCents(Math.max(0, due - total)).amount;
  b.settled = due <= total;
}

/** Records a marked payment, or drops one, and says how that went; `writeViews` then writes the list that shows it. */
export async function applyMark(folder: DemoFolder, req: MarkRequest, now: Date): Promise<{ outcome: 'ok' | 'invalid' | 'failed'; message: string; writeViews?: () => void }> {
  const read = async (path: string): Promise<unknown> => {
    const text = await folder.readText(path);
    return text === null ? null : (JSON.parse(text) as unknown);
  };
  const person = (req.paid ?? req.unpaid)!.person;
  const household = (await read('household.json')) as { people: { id: string; folder: string }[] } | null;
  const home = household?.people.find((p) => p.id === person)?.folder;
  const views = (await read('views/views.json')) as { people: Record<string, { marks: string | null; files: Record<string, string> }> } | null;
  const entry = views?.people[person];
  if (!home || !entry) return { outcome: 'invalid', message: 'It names no person in household.json.' };
  const bills = (await read(`views/${person}/bills.${entry.files['bills.json']!.slice(0, 12)}.json`)) as { bills: Record<string, Bill>; copy_of: Record<string, string> } | null;
  if (!isObject(bills)) return { outcome: 'failed', message: 'The folder could not be read.' };
  const held = (await read(`${home}/marks.json`)) as Marks | null;
  const marks: Marks = held ?? { schema: 'medrec-marks/v1', person, payments: [] };
  if (req.paid) {
    const { document, on } = req.paid;
    const amount = fromMark(req.paid);
    const bill = bills.bills[bills.copy_of[document] ?? document];
    if (!bill) return { outcome: 'invalid', message: 'The document is not one of their bills.' };
    if (marks.payments.some((p) => p.document === document && p.on === on && p.amount.amount === amount.amount && p.amount.currency === amount.currency)) return { outcome: 'ok', message: 'It was marked already.' };
    const id = `o_${random('abcdefghijklmnopqrstuvwxyz234567', 20)}`;
    marks.payments.push({ id, document, on, amount, at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), by: req.requested_by.name ?? null, request: req.id });
    bill.paid.push({ from: 'household', id, on, ...amount, ...(amount.currency === bill.currency ? {} : { counted: false }) });
    settle(bill);
  } else {
    const { payment } = req.unpaid!;
    if (!marks.payments.some((p) => p.id === payment)) return { outcome: 'ok', message: 'There was nothing to undo.' };
    marks.payments = marks.payments.filter((p) => p.id !== payment);
    for (const b of Object.values(bills.bills)) {
      b.paid = b.paid.filter((p) => p.id !== payment);
      settle(b);
    }
  }
  const [marksMd5, billsMd5] = [random('0123456789abcdef', 32), random('0123456789abcdef', 32)];
  entry.marks = marksMd5;
  entry.files['bills.json'] = billsMd5;
  folder.writeAsMac(`${home}/marks.json`, JSON.stringify(marks, null, 2), marksMd5);
  const writeViews = () => {
    folder.writeAsMac(`views/${person}/bills.${billsMd5.slice(0, 12)}.json`, JSON.stringify(bills), billsMd5);
    folder.writeAsMac('views/views.json', JSON.stringify(views));
  };
  return { outcome: 'ok', message: req.paid ? 'Marked paid.' : 'Undone.', writeViews };
}

/** A marked amount with two places, as medrec keeps it. */
function fromMark(paid: NonNullable<MarkRequest['paid']>): Money {
  const m = markedAmount(paid);
  return fromCents(toCents(m) ?? 0, m.currency);
}
