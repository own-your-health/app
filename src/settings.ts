// The only things the app keeps in browser storage: the Google OAuth client
// id the household registered, which Drive folder holds its records, and the
// Google account that last signed in. None is a secret. Everything read from
// the folder stays in memory.

const PREFIX = 'own-your-health-app.';
const CLIENT_ID = `${PREFIX}client_id`;
const FOLDER = `${PREFIX}folder`;
const ACCOUNT = `${PREFIX}account`;
const THEME = `${PREFIX}theme`;

export interface FolderSetting {
  id: string;
  name: string;
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getClientId(kv: KV | null = store()): string | null {
  return kv?.getItem(CLIENT_ID)?.trim() || null;
}

/** Sets or clears the client. Another client may be another household's, so it forgets the account. */
export function setClientId(id: string | null, kv: KV | null = store()): void {
  const next = id?.trim() || null;
  if (next !== getClientId(kv)) setAccount(null, kv);
  if (next) kv?.setItem(CLIENT_ID, next);
  else kv?.removeItem(CLIENT_ID);
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/**
 * The Google account that last signed in, from Drive's about. The app gives
 * it to Google as login_hint, so a browser holding several Google accounts
 * signs in without an account chooser, and renews silently.
 */
export function getAccount(kv: KV | null = store()): string | null {
  const v = kv?.getItem(ACCOUNT)?.trim();
  return v && EMAIL_RE.test(v) ? v : null;
}

export function setAccount(email: string | null | undefined, kv: KV | null = store()): void {
  const v = email?.trim();
  if (v && EMAIL_RE.test(v)) kv?.setItem(ACCOUNT, v);
  else kv?.removeItem(ACCOUNT);
}

export function getFolder(kv: KV | null = store()): FolderSetting | null {
  const raw = kv?.getItem(FOLDER);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FolderSetting>;
    return typeof v.id === 'string' && typeof v.name === 'string' ? { id: v.id, name: v.name } : null;
  } catch {
    return null;
  }
}

export function setFolder(f: FolderSetting | null, kv: KV | null = store()): void {
  if (f) kv?.setItem(FOLDER, JSON.stringify({ id: f.id, name: f.name }));
  else kv?.removeItem(FOLDER);
}

export type Theme = 'system' | 'light' | 'dark';

/** The colour theme chosen in Settings; `system` follows the device. */
export function getTheme(kv: KV | null = store()): Theme {
  const v = kv?.getItem(THEME);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function setTheme(theme: Theme, kv: KV | null = store()): void {
  if (theme === 'system') kv?.removeItem(THEME);
  else kv?.setItem(THEME, theme);
}

/** Every key this app may write, for the tests and the privacy page. */
export const STORAGE_KEYS = [CLIENT_ID, FOLDER, ACCOUNT, THEME];
