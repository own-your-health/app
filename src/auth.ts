// Google sign-in through OAuth 2.0 for client-side web apps: a full-page
// redirect to Google, which returns an access token in the URL fragment
// (response_type=token). No Google script is loaded. The token lives in
// memory only and is gone when the page closes; every page on
// own-your-health.github.io shares this origin, so nothing secret is kept
// in browser storage.

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';

/** Reads every file in the records folder. */
export const SCOPE_READ = 'https://www.googleapis.com/auth/drive.readonly';
/** Creates refresh requests; reaches only files this app created. */
export const SCOPE_WRITE = 'https://www.googleapis.com/auth/drive.file';
export const SCOPES = [SCOPE_READ, SCOPE_WRITE];

/**
 * The one value the sign-in keeps outside memory: a random nonce for the
 * round trip, in sessionStorage, removed as soon as Google answers. It
 * guards against a forged answer; it grants nothing.
 */
export const NONCE_KEY = 'own-your-health-app.oauth_nonce';

const CLIENT_ID_RE = /^[0-9]{6,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com$/;

export function isClientId(id: string): boolean {
  return CLIENT_ID_RE.test(id.trim());
}

/** A request the person asked for that a renewal interrupted before it reached Drive. */
export type Unsent = 'refresh' | 'cancel';

export interface AuthState {
  /** The nonce. */
  n: string;
  /** The route to return to (`#/…`). */
  r: string;
  /**
   * Set when this was a sign-in without a prompt, so a failure is not
   * retried: 1 on opening the app, 2 when renewing an ended sign-in.
   */
  s?: 1 | 2;
  /** What a renewal interrupted, so the app can say it was not sent. A word, never a file or an id. */
  w?: Unsent;
}

export interface Token {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

export function encodeState(s: AuthState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(raw: string | null): AuthState | null {
  if (!raw) return null;
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof v === 'object' && v !== null && typeof (v as AuthState).n === 'string' && typeof (v as AuthState).r === 'string') {
      const s = v as AuthState;
      return {
        n: s.n,
        r: s.r.startsWith('#/') ? s.r : '#/',
        ...(s.s === 1 || s.s === 2 ? { s: s.s } : {}),
        ...(s.w === 'refresh' || s.w === 'cancel' ? { w: s.w } : {}),
      };
    }
  } catch {
    // An answer we did not send.
  }
  return null;
}

export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  prompt?: 'none' | 'select_account' | 'consent';
  /** The account to sign in as, so Google shows no account chooser. */
  loginHint?: string;
  /** Defaults to SCOPES. */
  scopes?: string[];
  /** Whether the token also carries scopes granted earlier; defaults to true. */
  includeGranted?: boolean;
}): string {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'token',
    scope: (opts.scopes ?? SCOPES).join(' '),
    include_granted_scopes: opts.includeGranted === false ? 'false' : 'true',
    state: opts.state,
  });
  if (opts.prompt) p.set('prompt', opts.prompt);
  if (opts.loginHint) p.set('login_hint', opts.loginHint);
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

export type RedirectAnswer =
  | { kind: 'token'; accessToken: string; expiresIn: number; scopes: string[]; state: string | null }
  | { kind: 'error'; error: string; state: string | null };

/** Google's answer in the fragment, or null when the fragment is a route. */
export function parseRedirect(hash: string): RedirectAnswer | null {
  if (!hash.startsWith('#') || hash.startsWith('#/')) return null;
  const p = new URLSearchParams(hash.slice(1));
  const state = p.get('state');
  const error = p.get('error');
  if (error) return { kind: 'error', error, state };
  const accessToken = p.get('access_token');
  if (!accessToken) return null;
  return {
    kind: 'token',
    accessToken,
    expiresIn: Number(p.get('expires_in') ?? '0') || 0,
    scopes: (p.get('scope') ?? '').split(/\s+/).filter(Boolean),
    state,
  };
}

export type SignInResult =
  | { kind: 'signed_in'; token: Token; route: string; unsent?: Unsent }
  | { kind: 'failed'; error: string; route: string; silent: boolean; renewal: boolean; unsent?: Unsent }
  | { kind: 'none' };

/**
 * Takes Google's answer from the fragment. The answer is accepted only
 * with the nonce this tab stored before leaving; the nonce is removed
 * either way.
 */
export function completeSignIn(hash: string, storage: Pick<Storage, 'getItem' | 'removeItem'>, now: number): SignInResult {
  const answer = parseRedirect(hash);
  if (!answer) return { kind: 'none' };
  const expected = storage.getItem(NONCE_KEY);
  storage.removeItem(NONCE_KEY);
  const state = decodeState(answer.state);
  const route = state?.r ?? '#/';
  if (!state || !expected || state.n !== expected) {
    return { kind: 'failed', error: 'state_mismatch', route, silent: false, renewal: false };
  }
  const unsent = state.w ? { unsent: state.w } : {};
  if (answer.kind === 'error') return { kind: 'failed', error: answer.error, route, silent: state.s !== undefined, renewal: state.s === 2, ...unsent };
  return {
    kind: 'signed_in',
    route,
    ...unsent,
    token: {
      accessToken: answer.accessToken,
      // A minute early, so a request never goes out with a token about to end.
      expiresAt: now + Math.max(0, answer.expiresIn - 60) * 1000,
      scopes: answer.scopes,
    },
  };
}

export function randomNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Leaves for Google's sign-in page. */
export function startSignIn(opts: {
  clientId: string;
  redirectUri: string;
  route: string;
  silent?: boolean;
  /** A silent sign-in that renews one that ended. */
  renewal?: boolean;
  /** What the renewal interrupted. */
  unsent?: Unsent;
  /** Show Google's account chooser; ignored when `loginHint` names the account. */
  chooseAccount?: boolean;
  loginHint?: string | null;
  scopes?: string[];
  includeGranted?: boolean;
  storage: Pick<Storage, 'setItem'>;
  go: (url: string) => void;
}): void {
  const n = randomNonce();
  opts.storage.setItem(NONCE_KEY, n);
  const state = encodeState({ n, r: opts.route, ...(opts.silent ? { s: opts.renewal ? (2 as const) : (1 as const) } : {}), ...(opts.unsent ? { w: opts.unsent } : {}) });
  const hint = opts.loginHint || undefined;
  opts.go(
    buildAuthUrl({
      clientId: opts.clientId,
      redirectUri: opts.redirectUri,
      state,
      prompt: opts.silent ? 'none' : opts.chooseAccount && !hint ? 'select_account' : undefined,
      ...(hint ? { loginHint: hint } : {}),
      ...(opts.scopes ? { scopes: opts.scopes } : {}),
      ...(opts.includeGranted === false ? { includeGranted: false } : {}),
    }),
  );
}

/**
 * Checks with Google that the token was issued to this app's client: a
 * token for another app, pasted into the fragment, is refused.
 */
export async function verifyToken(fetchImpl: typeof fetch, token: string, clientId: string): Promise<{ ok: boolean; scopes: string[] }> {
  const res = await fetchImpl(TOKENINFO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }).toString(),
  });
  if (!res.ok) return { ok: false, scopes: [] };
  const info = (await res.json()) as { aud?: string; azp?: string; scope?: string };
  const ok = info.aud === clientId || info.azp === clientId;
  return { ok, scopes: (info.scope ?? '').split(/\s+/).filter(Boolean) };
}

/** Google's error codes, in words for a person. */
export function signInErrorText(error: string): string {
  switch (error) {
    case 'access_denied':
      return 'Google sign-in was cancelled, or the account is not a test user of this Google client.';
    case 'state_mismatch':
      return 'That sign-in answer did not come from this page. Sign in again.';
    case 'interaction_required':
    case 'login_required':
    case 'consent_required':
    case 'account_selection_required':
      return 'Google needs you to choose an account or approve access.';
    case 'redirect_uri_mismatch':
      return "This page's address is not an authorized redirect URI on the Google client.";
    default:
      return `Google sign-in did not finish (${error.replace(/[^a-z_]/gi, '').slice(0, 40)}).`;
  }
}
