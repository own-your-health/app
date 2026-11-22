import { describe, expect, it } from 'vitest';
import { getAccount, getClientId, getFolder, getTheme, setAccount, setClientId, setFolder, setTheme, STORAGE_KEYS } from '../src/settings';

function kv() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('settings', () => {
  it('keep only the client id, the folder, the account and the theme', () => {
    const s = kv();
    setClientId(' 123456789012-abcdefghijklmnop.apps.googleusercontent.com ', s);
    setFolder({ id: 'folder-1', name: 'Medical Records' }, s);
    setAccount('robin@example.com', s);
    setTheme('dark', s);
    expect([...s.m.keys()].sort()).toEqual([...STORAGE_KEYS].sort());
    expect(getClientId(s)).toBe('123456789012-abcdefghijklmnop.apps.googleusercontent.com');
    expect(getFolder(s)).toEqual({ id: 'folder-1', name: 'Medical Records' });
    expect(getAccount(s)).toBe('robin@example.com');
    setClientId(null, s);
    setFolder(null, s);
    setTheme('system', s);
    expect(s.m.size).toBe(0);
  });

  it('keep a theme only when one is chosen', () => {
    const s = kv();
    expect(getTheme(s)).toBe('system');
    setTheme('light', s);
    expect(getTheme(s)).toBe('light');
    setTheme('system', s);
    expect(s.m.size).toBe(0);
    s.setItem(STORAGE_KEYS[3]!, 'sepia');
    expect(getTheme(s)).toBe('system');
  });

  it('forget the account when the client changes or is cleared, and keep it otherwise', () => {
    const s = kv();
    const ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
    setClientId(ID, s);
    setAccount('robin@example.com', s);
    setClientId(` ${ID} `, s);
    expect(getAccount(s)).toBe('robin@example.com');
    setFolder(null, s);
    expect(getAccount(s)).toBe('robin@example.com');
    setClientId('999999999999-zyxwvutsrqponmlk.apps.googleusercontent.com', s);
    expect(getAccount(s)).toBeNull();
    setAccount('robin@example.com', s);
    setClientId(null, s);
    expect(getAccount(s)).toBeNull();
  });

  it('take only an email as the account', () => {
    const s = kv();
    setAccount('robin@example.com', s);
    setAccount('not an email', s);
    expect(getAccount(s)).toBeNull();
    setAccount('robin@example.com', s);
    setAccount(undefined, s);
    expect(getAccount(s)).toBeNull();
    s.setItem(STORAGE_KEYS[2]!, 'x y@z');
    expect(getAccount(s)).toBeNull();
  });

  it('ignore a folder setting they cannot read', () => {
    const s = kv();
    s.setItem(STORAGE_KEYS[1]!, '{"id":3}');
    expect(getFolder(s)).toBeNull();
    s.setItem(STORAGE_KEYS[1]!, 'not json');
    expect(getFolder(s)).toBeNull();
  });
});
