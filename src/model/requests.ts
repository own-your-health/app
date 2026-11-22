// Refresh requests: the only files the app writes (`_requests/`,
// medrec-request/v1 in medrec's data contract).

import { REQUEST_SCHEMA, type RefreshRequest, type RequestScope } from './types';

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

export function requestFileName(req: Pick<RefreshRequest, 'id' | 'requested_at'>): string {
  return `${compactTime(new Date(req.requested_at))}_${req.id}.json`;
}

export function buildRequest(opts: {
  scope: RequestScope;
  now: Date;
  by: { email?: string; name?: string };
  appVersion: string;
  id?: string;
}): RefreshRequest {
  const requestedAt = new Date(Math.floor(opts.now.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const by: { email?: string; name?: string } = {};
  if (opts.by.email) by.email = opts.by.email;
  if (opts.by.name) by.name = opts.by.name;
  return {
    schema: REQUEST_SCHEMA,
    id: opts.id ?? newRequestId(),
    requested_at: requestedAt,
    requested_by: by,
    scope: opts.scope,
    app: { name: 'own-your-health-app', version: opts.appVersion },
  };
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
