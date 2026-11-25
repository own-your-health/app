import { describe, expect, it } from 'vitest';
import { buildMark, buildRequest, compactTime, covers, isRequestId, markedAmount, marksOn, marksTotal, newRequestId, paidAmount, requestFileName, sameScope, typedAmount } from '../src/model/requests';
import type { MarkRequest, PendingMark } from '../src/model/types';
import { fixture } from './helpers';

describe('request ids', () => {
  it('are x_ and 20 base32 characters', () => {
    for (let i = 0; i < 50; i++) expect(isRequestId(newRequestId())).toBe(true);
    expect(newRequestId((b) => b.fill(0))).toBe('x_aaaaaaaaaaaaaaaaaaaa');
    expect(newRequestId((b) => b.fill(255))).toBe('x_77777777777777777777');
    expect(isRequestId('x_AAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isRequestId('x_aaaa')).toBe(false);
  });
});

describe('request files', () => {
  it('are named by time, then id', () => {
    expect(compactTime(new Date('2026-11-22T20:03:12.456Z'))).toBe('20261122T200312Z');
    expect(requestFileName({ id: 'x_abcdefghijklmnopqrst', requested_at: '2026-11-22T20:03:12Z' })).toBe('20261122T200312Z_x_abcdefghijklmnopqrst.json');
  });

  it('carry the contract’s fields and nothing else', () => {
    const r = buildRequest({ scope: { person: 'p_aaaaaaaaaaaaaaaaaaaa' }, now: new Date('2026-11-22T20:03:12.789Z'), by: { email: 'robin@example.com' }, appVersion: '0.1.0', id: 'x_abcdefghijklmnopqrst' });
    expect(r).toEqual({
      schema: 'medrec-request/v1',
      id: 'x_abcdefghijklmnopqrst',
      requested_at: '2026-11-22T20:03:12Z',
      requested_by: { email: 'robin@example.com' },
      scope: { person: 'p_aaaaaaaaaaaaaaaaaaaa' },
      app: { name: 'own-your-health-app', version: '0.1.0' },
    });
  });
});

describe('payments marked', () => {
  const paid = fixture<MarkRequest>('requests/paid.json');
  const unpaid = fixture<MarkRequest>('requests/unpaid.json');

  it('are asked for with the contract’s fields and nothing else', () => {
    const head = { now: new Date('2026-11-22T20:03:12.789Z'), by: { email: 'robin@example.com' }, appVersion: '0.1.0', id: 'x_abcdefghijklmnopqrst' };
    expect(buildMark({ ...head, mark: { paid: paid.paid! } })).toEqual(paid);
    expect(buildMark({ ...head, now: new Date('2026-11-23T08:00:00Z'), id: unpaid.id, mark: { unpaid: unpaid.unpaid! } })).toEqual(unpaid);
  });

  it('give US dollars as a plain amount, and any other currency by name', () => {
    expect(paidAmount({ amount: '120.00', currency: 'USD' })).toBe('120.00');
    expect(paidAmount({ amount: '120.00', currency: 'EUR' })).toEqual({ amount: '120.00', currency: 'EUR' });
    expect(markedAmount(paid.paid!)).toEqual({ amount: '120.00', currency: 'USD' });
    expect(markedAmount(fixture<MarkRequest>('requests/paid-done.json').paid!)).toEqual({ amount: '120.00', currency: 'EUR' });
  });

  it('take an amount as a person types it, above zero with at most two places', () => {
    expect(['120', '120.', '120.5', '120.50', ' $1,204.50 ', '$ 7', '.5', '0.01', '007', '1,234,567.8'].map(typedAmount)).toEqual(['120.00', '120.00', '120.50', '120.50', '1204.50', '7.00', '0.50', '0.01', '7.00', '1234567.80']);
    expect(['', '$', '.', '0', '0.00', '-5', '+5', '5.001', '1,20', '12,34.00', '1,2345', 'abc', '5 USD', '1e3', '12 34', '1234567890123'].map(typedAmount)).toEqual(Array(16).fill(null));
  });

  it('are found by the person and the bill, and add up in the bill’s currency', () => {
    const mark = (request: MarkRequest): PendingMark => ({ file: `${request.id}.json`, request, cancellable: true });
    const other = { ...paid, paid: { ...paid.paid!, document: 'd_other' } };
    const euros = { ...paid, paid: { ...paid.paid!, amount: { amount: '5.00', currency: 'EUR' } } };
    const all = [paid, other, euros, unpaid].map(mark);
    const { person, document } = paid.paid!;
    expect(marksOn(all, person, new Set([document])).map((m) => m.request)).toEqual([paid, euros]);
    expect(marksOn(all, person, new Set([document, 'd_other']))).toHaveLength(3);
    expect(marksOn(all, 'p_other', new Set([document]))).toEqual([]);
    expect([marksTotal(all, 'USD'), marksTotal(all, 'EUR'), marksTotal([], 'USD')]).toEqual([24000, 500, 0]);
  });
});

describe('scopes', () => {
  const src = { id: 's_aaaaaaaaaaaaaaaaaaaa', person: 'p_aaaaaaaaaaaaaaaaaaaa' };
  it('cover everything, a person’s sources, or one source', () => {
    expect(covers({ all: true }, src)).toBe(true);
    expect(covers({ person: src.person }, src)).toBe(true);
    expect(covers({ person: 'p_bbbbbbbbbbbbbbbbbbbb' }, src)).toBe(false);
    expect(covers({ source: src.id }, src)).toBe(true);
    expect(covers({ source: 's_bbbbbbbbbbbbbbbbbbbb' }, src)).toBe(false);
  });

  it('compare by kind and target', () => {
    expect(sameScope({ all: true }, { all: true })).toBe(true);
    expect(sameScope({ person: 'a' }, { person: 'a' })).toBe(true);
    expect(sameScope({ person: 'a' }, { source: 'a' })).toBe(false);
  });
});
