// The only things the app keeps in browser storage: the Google OAuth client
// id the household registered, and which Drive folder holds its records.
// Neither is a secret. Everything read from the folder stays in memory.

const PREFIX = 'own-your-health-app.';
const CLIENT_ID = `${PREFIX}client_id`;
const FOLDER = `${PREFIX}folder`;

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

export function setClientId(id: string | null, kv: KV | null = store()): void {
  if (id) kv?.setItem(CLIENT_ID, id.trim());
  else kv?.removeItem(CLIENT_ID);
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

/** Every key this app may write, for the tests and the privacy page. */
export const STORAGE_KEYS = [CLIENT_ID, FOLDER];
