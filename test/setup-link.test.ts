import { describe, expect, it } from 'vitest';
import { readPaste, readSetupLink, setupLinkFor, withoutClient } from '../src/setup-link';

const ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const OTHER = '999999999999-zyxwvutsrqponmlkjihgfedcba543210.apps.googleusercontent.com';

describe('a setup link', () => {
  it('is absent from an ordinary address', () => {
    expect(readSetupLink('', null)).toEqual({ kind: 'none' });
    expect(readSetupLink('?demo', ID)).toEqual({ kind: 'none' });
  });

  it('sets up a browser that has no client', () => {
    expect(readSetupLink(`?client=${ID}`, null)).toEqual({ kind: 'new', clientId: ID });
  });

  it('changes nothing when it names the client already in use', () => {
    expect(readSetupLink(`?client=${ID}`, ID)).toEqual({ kind: 'same', clientId: ID });
  });

  it('asks before replacing another client', () => {
    expect(readSetupLink(`?client=${OTHER}`, ID)).toEqual({ kind: 'different', clientId: OTHER, current: ID });
  });

  it('refuses anything that is not a Google client id', () => {
    for (const bad of ['', 'abc', `${ID}.evil.example.com`, 'javascript:alert(1)', `123-${ID}`.replace('123456789012', 'x')]) {
      expect(readSetupLink(`?client=${encodeURIComponent(bad)}`, null)).toEqual({ kind: 'invalid' });
    }
  });

  it('leaves the address without the client, keeping the route', () => {
    expect(withoutClient({ pathname: '/app/', search: `?client=${ID}`, hash: '#/hh/hh-demo-robin' })).toBe('/app/#/hh/hh-demo-robin');
    expect(withoutClient({ pathname: '/app/', search: `?x=1&client=${ID}`, hash: '' })).toBe('/app/?x=1');
  });

  it('can be pasted instead of opened, as the client id itself can', () => {
    const APP = 'https://own-your-health.github.io';
    expect(readPaste(` ${ID} `, APP)).toEqual({ kind: 'client', clientId: ID });
    expect(readPaste(`${APP}/app/?client=${ID}`, APP)).toEqual({ kind: 'client', clientId: ID });
    expect(readPaste(`${APP}/app/?client=${encodeURIComponent(ID)}#/hh/hh-demo-robin`, APP)).toEqual({ kind: 'client', clientId: ID });
    for (const cut of [`${APP}/app/`, `${APP}/app/?client=abc`, `${APP}/app/?client=${ID.slice(0, 40)}`]) {
      expect(readPaste(cut, APP)).toEqual({ kind: 'bad_link' });
    }
    expect(readPaste(`https://elsewhere.example/app/?client=${ID}`, APP)).toEqual({ kind: 'other_site' });
    for (const bad of ['', 'abc', `${ID}x`]) expect(readPaste(bad, APP)).toEqual({ kind: 'bad' });
  });

  it('builds the link another device opens', () => {
    const link = setupLinkFor(ID, 'https://own-your-health.github.io/app/');
    expect(link).toBe(`https://own-your-health.github.io/app/?client=${ID}`);
    expect(readSetupLink(new URL(link).search, null)).toEqual({ kind: 'new', clientId: ID });
  });
});
