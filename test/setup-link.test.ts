import { describe, expect, it } from 'vitest';
import { readPaste, readSetupLink, setupLinkFor, withoutClient } from '../src/setup-link';

const ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const OTHER = '999999999999-zyxwvutsrqponmlkjihgfedcba543210.apps.googleusercontent.com';

const BASE = 'https://own-your-health.github.io/app/';

/** Both forms of the link: the one the app gives, and the one it gave before. */
const FORMS: [string, (id: string, route?: string) => string][] = [
  ['after the #', (id, route = '') => `${BASE}#/setup/${id}${route}`],
  ['before the #, as older links have it', (id, route = '') => `${BASE}?client=${id}${route && `#${route}`}`],
];
const read = (link: string, current: string | null) => readSetupLink(new URL(link), current);

describe.each(FORMS)('a setup link with its client %s', (_, link) => {
  it('sets up a browser that has no client', () => {
    for (const route of ['', '/hh/hh-demo-robin', '/search?q=a']) expect(read(link(ID, route), null)).toEqual({ kind: 'new', clientId: ID });
  });

  it('changes nothing when it names the client already in use', () => {
    expect(read(link(ID), ID)).toEqual({ kind: 'same', clientId: ID });
  });

  it('asks before replacing another client', () => {
    expect(read(link(OTHER), ID)).toEqual({ kind: 'different', clientId: OTHER, current: ID });
  });

  it('refuses anything that is not a Google client id', () => {
    for (const bad of ['', 'abc', `${ID}.evil.example.com`, 'javascript:alert(1)', `123-${ID}`.replace('123456789012', 'x'), `${ID}/`, `${ID}?`]) {
      expect(read(link(encodeURIComponent(bad)), null)).toEqual({ kind: 'invalid' });
    }
    expect(read(link('%'), null)).toEqual({ kind: 'invalid' });
  });

  it('leaves the address without the client, keeping the route and any other parameter', () => {
    expect(withoutClient(new URL(link(ID)))).toBe('/app/');
    expect(withoutClient(new URL(link(ID, '/hh/hh-demo-robin')))).toBe('/app/#/hh/hh-demo-robin');
    expect(withoutClient(new URL(link(ID, '/search?q=a/b')))).toBe('/app/#/search?q=a/b');
    const url = new URL(link(ID, '/hh/hh-demo-robin'));
    url.searchParams.append('x', '1');
    expect(withoutClient(url)).toBe('/app/?x=1#/hh/hh-demo-robin');
    expect(withoutClient(new URL(link('abc')))).toBe('/app/');
  });

  it('can be pasted instead of opened', () => {
    const { origin } = new URL(BASE);
    expect(readPaste(` ${link(ID)} `, origin)).toEqual({ kind: 'client', clientId: ID });
    expect(readPaste(link(encodeURIComponent(ID), '/hh/hh-demo-robin'), origin)).toEqual({ kind: 'client', clientId: ID });
    for (const cut of ['', 'abc', ID.slice(0, 40)]) expect(readPaste(link(cut), origin)).toEqual({ kind: 'bad_link' });
    expect(readPaste(link(ID).replace(origin, 'https://elsewhere.example'), origin)).toEqual({ kind: 'other_site' });
  });
});

describe('a setup link', () => {
  it('is absent from an ordinary address', () => {
    for (const at of ['', '?demo', '#/', '#/settings', '#/setups/a', `#/hh/setup/${ID}`, `#client=${ID}`, `#/?client=${ID}`, '#state=a&access_token=b']) {
      expect(read(BASE + at, ID)).toEqual({ kind: 'none' });
      expect(withoutClient(new URL(BASE + at))).toBe(`/app/${at.replace('?demo', '?demo=')}`);
    }
  });

  it('names one client, the one after the #, and leaves neither in the address', () => {
    const both = `${BASE}?client=${OTHER}#/setup/${ID}/settings`;
    expect(read(both, null)).toEqual({ kind: 'new', clientId: ID });
    expect(withoutClient(new URL(both))).toBe('/app/#/settings');
  });

  it('cut short before its client is one all the same', () => {
    for (const cut of ['#/setup', '#/setup/', '#/setup?x']) {
      expect(read(BASE + cut, null)).toEqual({ kind: 'invalid' });
      expect(withoutClient(new URL(BASE + cut))).not.toContain('setup');
    }
  });

  it('is not a client id, and a client id is no link', () => {
    const { origin } = new URL(BASE);
    expect(readPaste(` ${ID} `, origin)).toEqual({ kind: 'client', clientId: ID });
    expect(readPaste(BASE, origin)).toEqual({ kind: 'bad_link' });
    for (const bad of ['', 'abc', `${ID}x`]) expect(readPaste(bad, origin)).toEqual({ kind: 'bad' });
  });

  it('for another device has its client where no server receives it', () => {
    const link = setupLinkFor(ID, BASE);
    expect(link).toBe(`${BASE}#/setup/${ID}`);
    expect(read(link, null)).toEqual({ kind: 'new', clientId: ID });
    expect(`${new URL(link).pathname}${new URL(link).search}`).toBe('/app/');
  });
});
