import { describe, expect, it } from 'vitest';
import { clientFromPaste, readSetupLink, setupLinkFor, withoutClient } from '../src/setup-link';

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
    expect(clientFromPaste(` ${ID} `)).toBe(ID);
    expect(clientFromPaste(`https://own-your-health.github.io/app/?client=${ID}`)).toBe(ID);
    expect(clientFromPaste(`https://own-your-health.github.io/app/?client=${encodeURIComponent(ID)}#/hh/hh-demo-robin`)).toBe(ID);
    for (const bad of ['', 'abc', 'https://own-your-health.github.io/app/', 'https://own-your-health.github.io/app/?client=abc', `${ID}x`]) {
      expect(clientFromPaste(bad)).toBeNull();
    }
  });

  it('builds the link another device opens', () => {
    const link = setupLinkFor(ID, 'https://own-your-health.github.io/app/');
    expect(link).toBe(`https://own-your-health.github.io/app/?client=${ID}`);
    expect(readSetupLink(new URL(link).search, null)).toEqual({ kind: 'new', clientId: ID });
  });
});
