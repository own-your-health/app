import { describe, expect, it } from 'vitest';
import {
  buildAuthUrl,
  completeSignIn,
  decodeState,
  encodeState,
  isClientId,
  NONCE_KEY,
  parseRedirect,
  SCOPE_READ,
  SCOPE_WRITE,
  startSignIn,
  verifyToken,
} from '../src/auth';
import { fixture, json } from './helpers';

const CLIENT = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function answer(params: Record<string, string>): string {
  return `#${new URLSearchParams(params).toString()}`;
}

describe('client id', () => {
  it('accepts a Google web client id and refuses anything else', () => {
    expect(isClientId(CLIENT)).toBe(true);
    expect(isClientId(`  ${CLIENT} `)).toBe(true);
    expect(isClientId('123-abc.apps.googleusercontent.com')).toBe(false);
    expect(isClientId(`${CLIENT}.evil.example`)).toBe(false);
    expect(isClientId('')).toBe(false);
  });
});

describe('state', () => {
  it('round-trips the nonce, the route and the silent flag', () => {
    const raw = encodeState({ n: 'abc', r: '#/p/p_aaaaaaaaaaaaaaaaaaaa/results', s: 1 });
    expect(raw).not.toMatch(/[+/=]/);
    expect(decodeState(raw)).toEqual({ n: 'abc', r: '#/p/p_aaaaaaaaaaaaaaaaaaaa/results', s: 1 });
    expect(decodeState(encodeState({ n: 'abc', r: '#/', s: 2 }))).toEqual({ n: 'abc', r: '#/', s: 2 });
  });

  it('carries what a renewal interrupted as one word, and drops anything else', () => {
    expect(decodeState(encodeState({ n: 'abc', r: '#/', s: 2, w: 'refresh' }))).toEqual({ n: 'abc', r: '#/', s: 2, w: 'refresh' });
    const forged = btoa(JSON.stringify({ n: 'abc', r: '#/', w: 's_aaaaaaaaaaaaaaaaaaaa' })).replace(/=+$/, '');
    expect(decodeState(forged)).toEqual({ n: 'abc', r: '#/' });
  });

  it('sends a route that is not the app’s own home', () => {
    expect(decodeState(encodeState({ n: 'abc', r: 'https://elsewhere.example/' }))).toEqual({ n: 'abc', r: '#/' });
  });

  it('ignores a state it did not make', () => {
    expect(decodeState('not base64 json')).toBeNull();
    expect(decodeState(null)).toBeNull();
    expect(decodeState(btoa('{"r":"#/"}'))).toBeNull();
  });
});

describe('the sign-in URL', () => {
  it('asks for a token with both scopes and the earlier grants', () => {
    const u = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: 'https://own-your-health.github.io/app/', state: 'st' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('response_type')).toBe('token');
    expect(u.searchParams.get('scope')).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
    expect(u.searchParams.get('include_granted_scopes')).toBe('true');
    expect(u.searchParams.get('redirect_uri')).toBe('https://own-your-health.github.io/app/');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.has('prompt')).toBe(false);
    expect(u.searchParams.has('client_secret')).toBe(false);
  });

  it('can ask for one scope without earlier grants', () => {
    const u = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: 'x', state: 's', scopes: [SCOPE_WRITE], includeGranted: false, prompt: 'none' }));
    expect(u.searchParams.get('scope')).toBe(SCOPE_WRITE);
    expect(u.searchParams.get('include_granted_scopes')).toBe('false');
    expect(u.searchParams.get('prompt')).toBe('none');
  });

  it('stores a nonce and puts it in the state', () => {
    const storage = memoryStorage();
    let went = '';
    startSignIn({ clientId: CLIENT, redirectUri: 'https://own-your-health.github.io/app/', route: '#/settings', silent: true, storage, go: (u) => (went = u) });
    const nonce = storage.getItem(NONCE_KEY);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    const u = new URL(went);
    expect(decodeState(u.searchParams.get('state'))).toEqual({ n: nonce, r: '#/settings', s: 1 });
    expect(u.searchParams.get('prompt')).toBe('none');
  });
});

describe('the account hint', () => {
  const HINT = 'robin@example.com';
  function signInUrl(opts: { silent?: boolean; renewal?: boolean; chooseAccount?: boolean; loginHint?: string | null }): URL {
    let went = '';
    startSignIn({ clientId: CLIENT, redirectUri: 'https://own-your-health.github.io/app/', route: '#/', storage: memoryStorage(), go: (u) => (went = u), ...opts });
    return new URL(went);
  }

  it('goes on the silent sign-in when one is stored, with no account chooser', () => {
    const u = signInUrl({ silent: true, loginHint: HINT });
    expect(u.searchParams.get('login_hint')).toBe(HINT);
    expect(u.searchParams.get('prompt')).toBe('none');
  });

  it('replaces the account chooser on an interactive sign-in', () => {
    const u = signInUrl({ chooseAccount: true, loginHint: HINT });
    expect(u.searchParams.get('login_hint')).toBe(HINT);
    expect(u.searchParams.has('prompt')).toBe(false);
  });

  it('is absent when no account is stored, so Google shows its chooser', () => {
    const u = signInUrl({ chooseAccount: true, loginHint: null });
    expect(u.searchParams.has('login_hint')).toBe(false);
    expect(u.searchParams.get('prompt')).toBe('select_account');
    expect(signInUrl({ silent: true }).searchParams.has('login_hint')).toBe(false);
  });

  it('marks a renewal, so its failure can say the sign-in ended', () => {
    const u = signInUrl({ silent: true, renewal: true, loginHint: HINT });
    expect(decodeState(u.searchParams.get('state'))).toMatchObject({ s: 2 });
  });

  it('brings back what the renewal interrupted, signed in or not', () => {
    const storage = memoryStorage();
    let went = '';
    startSignIn({ clientId: CLIENT, redirectUri: 'x', route: '#/', silent: true, renewal: true, unsent: 'cancel', loginHint: HINT, storage, go: (u) => (went = u) });
    const state = new URL(went).searchParams.get('state')!;
    const n = storage.getItem(NONCE_KEY)!;
    expect(completeSignIn(answer({ access_token: 'tok', expires_in: '3599', state }), storage, 0)).toMatchObject({ kind: 'signed_in', unsent: 'cancel' });
    storage.setItem(NONCE_KEY, n);
    expect(completeSignIn(answer({ error: 'login_required', state }), storage, 0)).toMatchObject({ kind: 'failed', renewal: true, unsent: 'cancel' });
  });
});

describe('Google’s answer', () => {
  it('reads a token and leaves app routes alone', () => {
    expect(parseRedirect('#/p/p_aaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(parseRedirect('')).toBeNull();
    expect(parseRedirect(answer({ access_token: 'tok', expires_in: '3599', scope: `${SCOPE_READ} ${SCOPE_WRITE}`, state: 's' }))).toEqual({
      kind: 'token',
      accessToken: 'tok',
      expiresIn: 3599,
      scopes: [SCOPE_READ, SCOPE_WRITE],
      state: 's',
    });
    expect(parseRedirect(answer({ error: 'access_denied', state: 's' }))).toEqual({ kind: 'error', error: 'access_denied', state: 's' });
  });

  it('accepts a token only with this tab’s nonce, and removes the nonce', () => {
    const storage = memoryStorage();
    storage.setItem(NONCE_KEY, 'n1');
    const state = encodeState({ n: 'n1', r: '#/s/s_aaaaaaaaaaaaaaaaaaaa' });
    const now = Date.parse('2026-11-22T20:00:00Z');
    const r = completeSignIn(answer({ access_token: 'tok', expires_in: '3600', scope: SCOPE_READ, state }), storage, now);
    expect(r).toEqual({ kind: 'signed_in', route: '#/s/s_aaaaaaaaaaaaaaaaaaaa', token: { accessToken: 'tok', expiresAt: now + 3540_000, scopes: [SCOPE_READ] } });
    expect(storage.getItem(NONCE_KEY)).toBeNull();
  });

  it('refuses an answer with another nonce', () => {
    const storage = memoryStorage();
    storage.setItem(NONCE_KEY, 'mine');
    const state = encodeState({ n: 'theirs', r: '#/' });
    expect(completeSignIn(answer({ access_token: 'tok', expires_in: '3600', state }), storage, 0)).toMatchObject({ kind: 'failed', error: 'state_mismatch' });
    expect(storage.getItem(NONCE_KEY)).toBeNull();
  });

  it('refuses an answer when no sign-in was started', () => {
    const state = encodeState({ n: 'x', r: '#/' });
    expect(completeSignIn(answer({ access_token: 'tok', state }), memoryStorage(), 0)).toMatchObject({ kind: 'failed', error: 'state_mismatch' });
  });

  it('says whether a failed sign-in was silent', () => {
    const storage = memoryStorage();
    storage.setItem(NONCE_KEY, 'n');
    const state = encodeState({ n: 'n', r: '#/', s: 1 });
    expect(completeSignIn(answer({ error: 'interaction_required', state }), storage, 0)).toEqual({ kind: 'failed', error: 'interaction_required', route: '#/', silent: true, renewal: false });
    storage.setItem(NONCE_KEY, 'n');
    const renewal = encodeState({ n: 'n', r: '#/', s: 2 });
    expect(completeSignIn(answer({ error: 'login_required', state: renewal }), storage, 0)).toEqual({ kind: 'failed', error: 'login_required', route: '#/', silent: true, renewal: true });
  });
});

describe('token check', () => {
  it('accepts a token issued to this client, posted in the body', async () => {
    let sent: RequestInit | undefined;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = init;
      return json(fixture('drive/tokeninfo.json'));
    }) as typeof fetch;
    const r = await verifyToken(fetchImpl, 'tok', CLIENT);
    expect(r.ok).toBe(true);
    expect(r.scopes).toEqual([SCOPE_READ, SCOPE_WRITE]);
    expect(sent?.method).toBe('POST');
    expect(String(sent?.body)).toBe('access_token=tok');
  });

  it('refuses a token issued to another client', async () => {
    const fetchImpl = (async () => json(fixture('drive/tokeninfo.json'))) as typeof fetch;
    expect((await verifyToken(fetchImpl, 'tok', '999999999999-zzzzzzzzzzzzzzzzzzzz.apps.googleusercontent.com')).ok).toBe(false);
  });

  it('refuses when Google does not know the token', async () => {
    const fetchImpl = (async () => json({ error: 'invalid_token' }, 400)) as typeof fetch;
    expect((await verifyToken(fetchImpl, 'tok', CLIENT)).ok).toBe(false);
  });
});
