import { describe, expect, it } from 'vitest';
import { FolderError, parseAttempts, parseHousehold, parseIndex, parseRefused, parseRequest, parseStatus, parseText } from '../src/model/parse';
import { demoJson, fixture, FIXTURES } from './helpers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('household.json', () => {
  it('reads the sample household', () => {
    const h = parseHousehold(demoJson('household.json'));
    expect(h.people.map((p) => p.name)).toEqual(['Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example']);
    expect(h.sources).toHaveLength(8);
    expect(h.people[0]!.links?.huishouden_health_person).toBe('hh-demo-robin');
  });

  it('refuses a newer layout with “Update the app”', () => {
    expect(() => parseHousehold(fixture('folder/household-newer.json'))).toThrow(/Update the app/);
    try {
      parseHousehold(fixture('folder/household-newer.json'));
    } catch (e) {
      expect(e).toBeInstanceOf(FolderError);
      expect((e as FolderError).kind).toBe('newer_format');
    }
  });

  it('refuses a folder that is not a household', () => {
    expect(() => parseHousehold({ schema: 'something-else' })).toThrow(FolderError);
    expect(() => parseHousehold(null)).toThrow(/no medrec household.json/);
    expect(() => parseHousehold({ schema: 'medrec-household/v1' })).toThrow(/no format number/);
  });

  it('drops people and sources missing what the views need', () => {
    const h = parseHousehold({
      schema: 'medrec-household/v1',
      format: 1,
      people: [{ id: 'p_aaaaaaaaaaaaaaaaaaaa', name: 'Robin Example', folder: 'Robin Example' }, { name: 'no id' }, 'junk'],
      sources: [{ id: 's_aaaaaaaaaaaaaaaaaaaa', person: 'p_aaaaaaaaaaaaaaaaaaaa', kind: 'portal' }, { id: 'no person' }],
    });
    expect(h.people).toHaveLength(1);
    expect(h.sources).toHaveLength(1);
    expect(h.organizations).toEqual([]);
  });
});

describe('index.json', () => {
  it('keeps what it can read and drops the rest', () => {
    const i = parseIndex(fixture('folder/index-partial.json'), 'p_aaaaaaaaaaaaaaaaaaaa');
    expect(i.documents.map((d) => d.id)).toEqual(['d_aaaaaaaaaaaaaaaaaaaa']);
    expect(i.records.map((r) => r.id)).toEqual(['r_aaaaaaaaaaaaaaaaaaaa', 'r_cccccccccccccccccccc']);
    expect(i.records[1]!.provenance).toEqual([]);
    expect(i.records[1]!.display).toBe('');
    expect(i.imports.map((x) => x.id)).toEqual(['i_aaaaaaaaaaaaaaaaaaaa']);
  });

  it('refuses a file that is not an index', () => {
    expect(() => parseIndex({ schema: 'medrec-household/v1' }, 'p')).toThrow(FolderError);
  });

  it('reads every entry of the sample indexes', () => {
    for (const folder of ['Robin Example', 'Sam Example', 'Alex Example']) {
      const raw = demoJson<{ documents: unknown[]; records: unknown[]; studies: unknown[]; imports: unknown[] }>(`${folder}/index.json`);
      const i = parseIndex(raw, 'p');
      expect([i.documents.length, i.records.length, i.studies.length, i.imports.length]).toEqual([raw.documents.length, raw.records.length, raw.studies.length, raw.imports.length]);
    }
  });
});

describe('text.json', () => {
  it('keeps string texts only', () => {
    expect(parseText({ schema: 'medrec-text/v1', person: 'p', texts: { d_1: 'hello', d_2: 3 } })).toEqual({ schema: 'medrec-text/v1', person: 'p', texts: { d_1: 'hello' } });
    expect(parseText({ schema: 'other' })).toBeNull();
  });
});

describe('status.json', () => {
  it('reads the sample status', () => {
    const r = parseStatus(demoJson('_status/status.json'));
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.status.sources.length).toBeGreaterThan(0);
  });

  it('says when the layout is newer', () => {
    expect(parseStatus(fixture('folder/status-newer.json'))).toEqual({ kind: 'newer_format', format: 2 });
  });

  it('fills the refresher’s defaults', () => {
    const r = parseStatus({ schema: 'medrec-status/v1', format: 1, sources: [] });
    expect(r).toMatchObject({ kind: 'ok', status: { refresher: { pass_every_secs: 300, heartbeat_every_secs: 3600 } } });
    expect(parseStatus({ schema: 'medrec-status/v1' })).toEqual({ kind: 'malformed' });
  });
});

describe('attempts', () => {
  it('skips blank, broken and other-schema lines', () => {
    const lines = parseAttempts(readFileSync(join(FIXTURES, 'folder/attempts-mixed.ndjson'), 'utf8'));
    expect(lines.map((l) => l.attempt)).toEqual(['t_aaaaaaaaaaaaaaaaaaaa', 't_cccccccccccccccccccc']);
  });
});

describe('requests', () => {
  it('reads a handled request from done/', () => {
    const done = demoJson<{ id: string }>(`_requests/done/${firstDone()}`);
    expect(parseRequest(done)?.id).toBe(done.id);
  });

  it('refuses a request without an id, a time or a scope', () => {
    const base = { schema: 'medrec-request/v1', id: 'x_aaaaaaaaaaaaaaaaaaaa', requested_at: '2026-11-22T20:00:00Z', scope: { all: true } };
    expect(parseRequest(base)).not.toBeNull();
    expect(parseRequest({ ...base, id: 3 })).toBeNull();
    expect(parseRequest({ ...base, requested_at: undefined })).toBeNull();
    expect(parseRequest({ ...base, scope: { all: false } })).toBeNull();
    expect(parseRequest({ ...base, scope: { everything: true } })).toBeNull();
  });

  it('reads a request medrec refused, which keeps no scope', () => {
    const r = parseRefused(fixture('folder/done-invalid.json'));
    expect(r).toMatchObject({ id: null, handled: { outcome: 'invalid', message: 'The request is larger than 4 KiB.' } });
    expect(parseRequest(fixture('folder/done-invalid.json'))).toBeNull();
  });
});

function firstDone(): string {
  const manifest = demoJson<{ files: string[] }>('manifest.json');
  const f = manifest.files.find((x) => x.startsWith('_requests/done/') && x.endsWith('.json'));
  if (!f) throw new Error('no done request in the sample');
  return f.slice('_requests/done/'.length);
}
