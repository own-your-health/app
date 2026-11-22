import { describe, expect, it } from 'vitest';
import { getClientId, getFolder, setClientId, setFolder, STORAGE_KEYS } from '../src/settings';

function kv() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('settings', () => {
  it('keep only the client id and the folder', () => {
    const s = kv();
    setClientId(' 123456789012-abcdefghijklmnop.apps.googleusercontent.com ', s);
    setFolder({ id: 'folder-1', name: 'Medical Records' }, s);
    expect([...s.m.keys()].sort()).toEqual([...STORAGE_KEYS].sort());
    expect(getClientId(s)).toBe('123456789012-abcdefghijklmnop.apps.googleusercontent.com');
    expect(getFolder(s)).toEqual({ id: 'folder-1', name: 'Medical Records' });
    setClientId(null, s);
    setFolder(null, s);
    expect(s.m.size).toBe(0);
  });

  it('ignore a folder setting they cannot read', () => {
    const s = kv();
    s.setItem(STORAGE_KEYS[1]!, '{"id":3}');
    expect(getFolder(s)).toBeNull();
    s.setItem(STORAGE_KEYS[1]!, 'not json');
    expect(getFolder(s)).toBeNull();
  });
});
