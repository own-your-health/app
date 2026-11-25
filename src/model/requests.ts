// Requests: the only files the app writes (`_requests/`, medrec-request/v1 in
// medrec's data contract). One asks the Mac to refresh, or to mark a bill paid.

import { toCents, type Money } from './records';
import { REQUEST_SCHEMA, type MarkRequest, type PaidMark, type PendingMark, type RefreshRequest, type RequestHead, type RequestScope, type UnpaidMark } from './types';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ID_RE = /^x_[a-z2-7]{20}$/;

/** `x_` and 20 RFC 4648 base32 characters (100 random bits), as medrec's ids. */
export function newRequestId(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = defaultRandom): string {
  const bytes = random(new Uint8Array(20));
  let out = '';
  // One base32 character per byte, from its low 5 bits: 20 × 5 = 100 bits.
  for (const b of bytes) out += ALPHABET[b & 31];
  return `x_${out}`;
}

function defaultRandom(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  return crypto.getRandomValues(bytes);
}

export function isRequestId(id: string): boolean {
  return ID_RE.test(id);
}

/** `20261122T200312Z`, the file name's time. */
export function compactTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

export function requestFileName(req: Pick<RequestHead, 'id' | 'requested_at'>): string {
  return `${compactTime(new Date(req.requested_at))}_${req.id}.json`;
}

interface HeadOptions {
  now: Date;
  by: { email?: string; name?: string };
  appVersion: string;
  id?: string;
}

function requestHead(opts: HeadOptions): RequestHead {
  const requestedAt = new Date(Math.floor(opts.now.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const by: { email?: string; name?: string } = {};
  if (opts.by.email) by.email = opts.by.email;
  if (opts.by.name) by.name = opts.by.name;
  return {
    schema: REQUEST_SCHEMA,
    id: opts.id ?? newRequestId(),
    requested_at: requestedAt,
    requested_by: by,
    app: { name: 'own-your-health-app', version: opts.appVersion },
  };
}

export function buildRequest(opts: HeadOptions & { scope: RequestScope }): RefreshRequest {
  return { ...requestHead(opts), scope: opts.scope };
}

/** A request to mark a bill paid, or to drop a payment marked before. */
export function buildMark(opts: HeadOptions & { mark: { paid: PaidMark } | { unpaid: UnpaidMark } }): MarkRequest {
  return { ...requestHead(opts), ...opts.mark };
}

/** An amount as a paid request gives it: a decimal string in US dollars, else with its currency. */
export const paidAmount = (m: Money): PaidMark['amount'] => (m.currency === 'USD' ? m.amount : { amount: m.amount, currency: m.currency });

/** What a paid request says was paid. */
export const markedAmount = (p: PaidMark): Money => (typeof p.amount === 'string' ? { amount: p.amount, currency: 'USD' } : p.amount);

/** A typed amount ("$1,204.5") as medrec takes it ("1204.50"): above zero with at most two places. Null when it is not one. */
export function typedAmount(text: string): string | null {
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,9})?(?:\.(\d{1,2})?)?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const whole = (m[1] ?? '0').replace(/,/g, '').replace(/^0+(?=\d)/, '');
  const amount = `${whole}.${(m[2] ?? '').padEnd(2, '0')}`;
  return Number(amount) > 0 ? amount : null;
}

/** The waiting marks that pay a bill or one of its copies. */
export function marksOn(marks: readonly PendingMark[], person: string, documents: ReadonlySet<string>): PendingMark[] {
  return marks.filter((m) => m.request.paid?.person === person && documents.has(m.request.paid.document));
}

/** What some waiting marks come to in one currency. */
export function marksTotal(marks: readonly PendingMark[], currency: string): number {
  return marks.reduce((t, m) => {
    const a = m.request.paid && markedAmount(m.request.paid);
    return a?.currency === currency ? t + (toCents(a) ?? 0) : t;
  }, 0);
}

/** Whether a request's scope covers one source of one person. */
export function covers(scope: RequestScope, source: { id: string; person: string }): boolean {
  if ('all' in scope) return scope.all === true;
  if ('person' in scope) return scope.person === source.person;
  return scope.source === source.id;
}

export function sameScope(a: RequestScope, b: RequestScope): boolean {
  if ('all' in a) return 'all' in b;
  if ('person' in a) return 'person' in b && a.person === b.person;
  return 'source' in b && a.source === b.source;
}
