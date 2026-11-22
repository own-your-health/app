import { describe, expect, it } from 'vitest';
import { buildRequest, compactTime, covers, isRequestId, newRequestId, requestFileName, sameScope } from '../src/model/requests';

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
