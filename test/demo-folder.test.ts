import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO, demoJson, filesUnder } from './helpers';

describe('the sample folder', () => {
  const manifest = demoJson<{ anchor: string; files: string[]; md5: Record<string, string> }>('manifest.json');

  it('lists exactly the files it ships', () => {
    expect([...manifest.files].sort()).toEqual(filesUnder(DEMO).filter((f) => f !== 'manifest.json'));
  });

  it('gives each file’s MD5 as Drive would, which medrec’s views.json records for the files it read', () => {
    expect(Object.keys(manifest.md5)).toEqual(manifest.files);
    for (const f of manifest.files) expect(manifest.md5[f], f).toBe(createHash('md5').update(readFileSync(join(DEMO, f))).digest('hex'));
    const views = demoJson<{ household: string; people: Record<string, { index: string; files: Record<string, string> }> }>('views/views.json');
    expect(views.household).toBe(manifest.md5['household.json']);
    for (const [pid, p] of Object.entries(views.people)) {
      const events = manifest.files.find((f) => f.startsWith(`views/${pid}/events.`))!;
      expect(manifest.md5[events]).toBe(p.files['events.json']);
    }
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
