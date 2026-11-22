import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO, demoJson, filesUnder } from './helpers';

describe('the sample folder', () => {
  const manifest = demoJson<{ anchor: string; files: string[] }>('manifest.json');

  it('lists exactly the files it ships', () => {
    expect([...manifest.files].sort()).toEqual(filesUnder(DEMO).filter((f) => f !== 'manifest.json'));
  });

  it('holds well-formed JSON and NDJSON', () => {
    for (const f of manifest.files) {
      const text = readFileSync(join(DEMO, f), 'utf8');
      if (f.endsWith('.json')) expect(() => JSON.parse(text), f).not.toThrow();
      if (f.endsWith('.ndjson')) for (const line of text.split('\n').filter(Boolean)) expect(() => JSON.parse(line), f).not.toThrow();
    }
  });

  it('has an anchor its times are shifted from', () => {
    expect(Number.isNaN(Date.parse(manifest.anchor))).toBe(false);
  });

  it('names only invented people and example domains', () => {
    const h = demoJson<{ people: { name: string }[] }>('household.json');
    expect(h.people.every((p) => / Example$/.test(p.name))).toBe(true);
  });
});
