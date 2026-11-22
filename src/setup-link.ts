// A household's setup link: the app's address with `?client=<client id>`.
// Opening it on a phone stores the client id as if it had been typed and goes
// straight to Google's sign-in. The id is not a secret: only the test users
// the household listed can sign in through it.

import { isClientId } from './auth';

export const CLIENT_PARAM = 'client';

export type SetupLink =
  | { kind: 'none' }
  | { kind: 'invalid' }
  /** The link names the client this browser already uses. */
  | { kind: 'same'; clientId: string }
  /** This browser had no client yet. */
  | { kind: 'new'; clientId: string }
  /** This browser uses another client: ask before replacing it. */
  | { kind: 'different'; clientId: string; current: string };

export function readSetupLink(search: string, current: string | null): SetupLink {
  const params = new URLSearchParams(search);
  if (!params.has(CLIENT_PARAM)) return { kind: 'none' };
  const id = (params.get(CLIENT_PARAM) ?? '').trim();
  if (!isClientId(id)) return { kind: 'invalid' };
  if (!current) return { kind: 'new', clientId: id };
  return id === current ? { kind: 'same', clientId: id } : { kind: 'different', clientId: id, current };
}

/**
 * The client id in what a person pasted: the id itself, or a whole setup
 * link. An app installed on an iPhone keeps its own storage and has no
 * address bar, so the link is pasted there instead of opened.
 */
export function clientFromPaste(text: string): string | null {
  const v = text.trim();
  if (isClientId(v)) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  const link = readSetupLink(url.search, null);
  return link.kind === 'new' ? link.clientId : null;
}

/** The address without `?client=`, keeping any other parameter and the route. */
export function withoutClient(loc: { pathname: string; search: string; hash: string }): string {
  const params = new URLSearchParams(loc.search);
  params.delete(CLIENT_PARAM);
  const rest = params.toString();
  return `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`;
}

/** The setup link for another device: `base` is the app's own address. */
export function setupLinkFor(clientId: string, base: string): string {
  return `${base}?${CLIENT_PARAM}=${encodeURIComponent(clientId)}`;
}
