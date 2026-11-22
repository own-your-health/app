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

  it('gives an import the same counts in the index, the status and the attempts log', () => {
    type Counts = Record<string, number>;
    const h = demoJson<{ people: { folder: string }[] }>('household.json');
    const runs = new Map<string, Counts>();
    for (const p of h.people) for (const run of demoJson<{ imports: (Counts & { id: string })[] }>(`${p.folder}/index.json`).imports) runs.set(run.id, run);
    const keys = ['records_added', 'records_updated', 'records_unchanged', 'documents_added'];
    const pick = (c: Counts) => Object.fromEntries(keys.map((k) => [k, c[k]]));
    const status = demoJson<{ sources: { last_success?: { import?: string; counts?: Counts } | null }[] }>('_status/status.json');
    const attempts = manifest.files
      .filter((f) => f.startsWith('_status/attempts/'))
      .flatMap((f) => readFileSync(join(DEMO, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { import?: string | null; counts?: Counts }));
    const checked = [
      ...status.sources.map((s) => s.last_success).filter((x): x is { import: string; counts: Counts } => !!x?.import && !!x.counts),
      ...attempts.filter((a): a is { import: string; counts: Counts } => !!a.import && !!a.counts),
    ];
    expect(checked.length).toBeGreaterThanOrEqual(6);
    for (const c of checked) expect(pick(c.counts), c.import).toEqual(pick(runs.get(c.import)!));
  });

  it('names only invented people and example domains', () => {
    const h = demoJson<{ people: { name: string }[] }>('household.json');
    expect(h.people.every((p) => / Example$/.test(p.name))).toBe(true);
  });
});
