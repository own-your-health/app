// A household's setup link: the app's address with `#/setup/<client id>`, and
// any route after that. A browser sends no server the part after #. A link
// from before has `?client=<client id>` before the route, and opens the same.
// Opening it on a phone stores the client id as if it had been typed and goes
// straight to Google's sign-in. The id is not a secret: an account sees only
// what Drive shares with it, whoever may sign in through the client.

import { isClientId } from './auth';

const CLIENT_PARAM = 'client';
const SETUP = /^#\/setup(?:\/([^/?]*))?(?=[/?]|$)(.*)$/s;

export interface Address {
  search: string;
  hash: string;
}

export type SetupLink =
  | { kind: 'none' }
  | { kind: 'invalid' }
  /** The link names the client this browser already uses. */
  | { kind: 'same'; clientId: string }
  /** This browser had no client yet. */
  | { kind: 'new'; clientId: string }
  /** This browser uses another client: ask before replacing it. */
  | { kind: 'different'; clientId: string; current: string };

/** The client the address names, as written; null when it is no setup link. */
function named({ search, hash }: Address): string | null {
  const setup = SETUP.exec(hash);
  if (!setup) return new URLSearchParams(search).get(CLIENT_PARAM);
  try {
    return decodeURIComponent(setup[1] ?? '');
  } catch {
    return '';
  }
}

export function readSetupLink(address: Address, current: string | null): SetupLink {
  const id = named(address)?.trim();
  if (id === undefined) return { kind: 'none' };
  if (!isClientId(id)) return { kind: 'invalid' };
  if (!current) return { kind: 'new', clientId: id };
  return id === current ? { kind: 'same', clientId: id } : { kind: 'different', clientId: id, current };
}

export type Paste =
  | { kind: 'client'; clientId: string }
  /** This app's link, without a valid client id: cut short when copied. */
  | { kind: 'bad_link' }
  /** A link to another site. */
  | { kind: 'other_site' }
  | { kind: 'bad' };

/**
 * What a person pasted into the client field: the client id itself, or this
 * app's whole setup link (`origin` is the app's own). An app added to an
 * iPhone's Home Screen keeps its own storage and has no address bar, so the
 * link is pasted there instead of opened.
 */
export function readPaste(text: string, origin: string): Paste {
  const v = text.trim();
  if (isClientId(v)) return { kind: 'client', clientId: v };
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { kind: 'bad' };
  }
  if (url.origin !== origin) return { kind: 'other_site' };
  const link = readSetupLink(url, null);
  return link.kind === 'new' ? { kind: 'client', clientId: link.clientId } : { kind: 'bad_link' };
}

/** The address without the client, in either form, keeping any other parameter and the route. */
export function withoutClient(loc: Address & { pathname: string }): string {
  const params = new URLSearchParams(loc.search);
  params.delete(CLIENT_PARAM);
  const rest = params.toString();
  const setup = SETUP.exec(loc.hash);
  const route = setup?.[2] ?? '';
  return `${loc.pathname}${rest ? `?${rest}` : ''}${setup ? route && `#${route}` : loc.hash}`;
}

/** The setup link for another device: `base` is the app's own address. */
export function setupLinkFor(clientId: string, base: string): string {
  return `${base}#/setup/${encodeURIComponent(clientId)}`;
}
