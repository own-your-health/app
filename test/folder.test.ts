import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Drive, type DriveFile } from '../src/drive';
import { DriveFolder, KEPT_TIMES, LOAD_TIMES, readJson, splitPath } from '../src/folder';
import { DEMO, demoFolder, fixture, json } from './helpers';

function driveWith(tree: Record<string, DriveFile[]>, contents: Record<string, string> = {}, meta: Record<string, DriveFile> = {}) {
  const calls: string[] = [];
  const fields: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.searchParams.has('fields')) fields.push(url.searchParams.get('fields')!);
    calls.push(`${init.method ?? 'GET'} ${url.pathname}${url.searchParams.get('alt') ? '?alt=media' : ''}`);
    const parent = url.searchParams.get('q')?.match(/^'([^']+)' in parents/)?.[1];
    if (parent) return json({ files: tree[parent] ?? [] });
    const id = url.pathname.split('/').pop()!;
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (init.method === 'POST') return json(fixture('drive/created.json'));
    if (!url.searchParams.get('alt') && id in meta) return json(meta[id]);
    if (id in contents) return new Response(contents[id]);
    return json({ error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } }, 404);
  }) as typeof fetch;
  return { drive: new Drive(() => 'tok', fetchImpl), calls, fields };
}

const ROOT: Record<string, DriveFile[]> = {
  root: [...fixture<{ files: DriveFile[] }>('drive/children-page1.json').files, ...fixture<{ files: DriveFile[] }>('drive/children-page2.json').files],
  'folder-robin': fixture<{ files: DriveFile[] }>('drive/robin-children.json').files,
  'folder-requests': fixture<{ files: DriveFile[] }>('drive/requests-children.json').files,
};

describe('splitPath', () => {
  it('drops empty and dot parts', () => {
    expect(splitPath('/Robin Example//./index.json')).toEqual(['Robin Example', 'index.json']);
  });
});

describe('DriveFolder', () => {
  it('resolves a path one folder at a time and lists each folder once', async () => {
    const { drive, calls } = driveWith(ROOT, { 'file-robin-index': '{"ok":true}' });
    const folder = new DriveFolder(drive, 'root', 'Medical Records');
    expect(await readJson(folder, 'Robin Example/index.json')).toEqual({ ok: true });
    expect(await folder.readText('Robin Example/index.json')).toBe('{"ok":true}');
    expect(calls.filter((c) => c === 'GET /drive/v3/files')).toHaveLength(2);
  });

  it('gives a file’s MD5 from the listing it already read, null for a missing one, and nothing when Drive gave none', async () => {
    const { drive, calls, fields } = driveWith(ROOT);
    const folder = new DriveFolder(drive, 'root', 'x');
    expect(await folder.md5('Robin Example/index.json')).toBe('5f2b8c1e9a7d4b3c6e0f1a2b3c4d5e6f');
    expect(fields.every((f) => f.includes('md5Checksum'))).toBe(true);
    expect(await folder.md5('household.json')).toBeUndefined();
    expect(await folder.md5('Nobody/index.json')).toBeNull();
    expect(await folder.md5('Robin Example')).toBeNull();
    expect(calls.filter((c) => c === 'GET /drive/v3/files')).toHaveLength(2);
  });

  it('asks Drive for a read file’s MD5 again after the read, once, so an upload between the listing and the read is seen', async () => {
    const listed = ROOT['folder-robin']![0]!;
    const { drive, calls } = driveWith(ROOT, { 'file-robin-index': '{"rev":2}' }, { 'file-robin-index': { ...listed, md5Checksum: 'ABCDEF0123456789ABCDEF0123456789' } });
    const folder = new DriveFolder(drive, 'root', 'x');
    expect(await folder.readText('Robin Example/index.json')).toBe('{"rev":2}');
    expect(await folder.md5('Robin Example/index.json')).toBe('abcdef0123456789abcdef0123456789');
    expect(await folder.md5('Robin Example/index.json')).toBe('abcdef0123456789abcdef0123456789');
    expect(calls.filter((c) => c === 'GET /drive/v3/files/file-robin-index')).toHaveLength(1);
    // Forgotten, it is as listed again.
    folder.forget('Robin Example');
    expect(await folder.md5('Robin Example/index.json')).toBe('5f2b8c1e9a7d4b3c6e0f1a2b3c4d5e6f');
  });

  it('takes the newer of two files with one name', async () => {
    const { drive } = driveWith(ROOT);
    expect((await new DriveFolder(drive, 'root', 'x').resolve('household.json'))?.id).toBe('file-household');
  });

  it('answers null for a missing path and for a folder read as a file', async () => {
    const { drive } = driveWith(ROOT);
    const folder = new DriveFolder(drive, 'root', 'x');
    expect(await folder.readText('Nobody/index.json')).toBeNull();
    expect(await folder.readText('Robin Example')).toBeNull();
    expect(await folder.list('household.json')).toBeNull();
  });

  it('marks only the app’s own files deletable', async () => {
    const { drive } = driveWith(ROOT);
    const entries = await new DriveFolder(drive, 'root', 'x').list('_requests');
    expect(entries).toEqual([
      { name: '20261122T200312Z_x_abcdefghijklmnopqrst.json', folder: false, modifiedTime: '2026-11-22T20:03:12.000Z', deletable: true },
      { name: 'done', folder: true, modifiedTime: '2026-11-22T20:03:12.000Z', deletable: false },
    ]);
  });

  it('writes a request into _requests/ and lists it again afterwards', async () => {
    const { drive, calls } = driveWith(ROOT);
    const folder = new DriveFolder(drive, 'root', 'x');
    await folder.list('_requests');
    await folder.createRequest('20261122T200312Z_x_abcdefghijklmnopqrst.json', { a: 1 });
    await folder.list('_requests');
    expect(calls).toContain('POST /upload/drive/v3/files');
    expect(calls.filter((c) => c === 'GET /drive/v3/files')).toHaveLength(3);
  });

  it('refuses to write when there is no _requests/', async () => {
    const { drive } = driveWith({ root: ROOT.root!.filter((f) => f.name !== '_requests') });
    await expect(new DriveFolder(drive, 'root', 'x').createRequest('a.json', {})).rejects.toThrow('no _requests folder');
  });

  it('deletes a pending request by name', async () => {
    const { drive, calls } = driveWith(ROOT);
    await new DriveFolder(drive, 'root', 'x').deleteRequest('20261122T200312Z_x_abcdefghijklmnopqrst.json');
    expect(calls).toContain('DELETE /drive/v3/files/file-mine');
  });

  it('links to Drive’s viewer', async () => {
    const { drive } = driveWith(ROOT);
    expect(await new DriveFolder(drive, 'root', 'x').link('Robin Example')).toBe('https://drive.google.com/drive/folders/folder-robin');
  });
});

describe('DemoFolder', () => {
  it('moves the sample’s times from its anchor to now', async () => {
    const folder = demoFolder(new Date('2026-11-23T20:00:00Z'));
    const status = JSON.parse((await folder.readText('_status/status.json'))!) as { updated_at: string };
    const original = JSON.parse((await demoFolder().readText('_status/status.json'))!) as { updated_at: string };
    expect(Date.parse(status.updated_at) - Date.parse(original.updated_at)).toBe(86_400_000);
  });

  it('says of every time in the sample whether it moves to now or stays as written', () => {
    const { files } = JSON.parse(readFileSync(join(DEMO, 'manifest.json'), 'utf8')) as { files: string[] };
    const keys = new Set<string>();
    const walk = (v: unknown, key?: string): void => {
      // The shift moves only a time that directly follows its key; one in an array is named so no set holds it.
      if (Array.isArray(v)) v.forEach((x) => walk(x, `${key}[]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
      else if (key && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) keys.add(key);
    };
    for (const f of files) {
      const text = readFileSync(join(DEMO, f), 'utf8');
      if (f.endsWith('.json')) walk(JSON.parse(text));
      else if (f.endsWith('.ndjson')) text.split('\n').filter(Boolean).forEach((l) => walk(JSON.parse(l)));
    }
    expect([...keys].filter((k) => !LOAD_TIMES.has(k) && !KEPT_TIMES.has(k))).toEqual([]);
    expect([...LOAD_TIMES].filter((k) => KEPT_TIMES.has(k))).toEqual([]);
    expect(keys.size).toBeGreaterThan(10);
  });

  it('keeps times of care as written, however long ago the sample was made', async () => {
    type Index = { imports: { imported_at: string }[]; records: { fields: { period?: { start?: string }; issued?: string } }[] };
    const read = async (now?: Date) => JSON.parse((await demoFolder(now).readText('Robin Example/index.json'))!) as Index;
    const [later, original] = [await read(new Date('2026-11-29T20:00:00Z')), await read()];
    expect(Date.parse(later.imports[0]!.imported_at) - Date.parse(original.imports[0]!.imported_at)).toBe(7 * 86_400_000);
    const visit = (i: Index) => i.records.find((r) => r.fields.period?.start?.includes('T'))!.fields.period!.start;
    const issued = (i: Index) => i.records.find((r) => r.fields.issued)!.fields.issued;
    expect(visit(later)).toBe(visit(original));
    expect(issued(later)).toBe(issued(original));
  });

  it('lists folders, including ones kept only by a placeholder', async () => {
    const folder = demoFolder();
    const root = (await folder.list(''))!.map((e) => e.name);
    expect(root).toEqual(expect.arrayContaining(['household.json', '_status', '_requests', 'Robin Example']));
    const requests = await folder.list('_requests');
    expect(requests?.map((e) => e.name)).toEqual(['done']);
    expect(await folder.list('Nobody')).toBeNull();
  });

  it('keeps the app’s requests in memory and cancels only its own', async () => {
    const folder = demoFolder();
    await folder.createRequest('a.json', { x: 1 });
    expect((await folder.list('_requests'))?.find((e) => e.name === 'a.json')?.deletable).toBe(true);
    await folder.deleteRequest('a.json');
    expect(await folder.readText('_requests/a.json')).toBeNull();
    const done = (await folder.list('_requests/done'))!;
    expect(done.length).toBeGreaterThan(0);
    await expect(folder.deleteRequest(`done/${done[0]!.name}`)).rejects.toThrow('Only a request this app made');
  });

  it('lets the simulated Mac move a request', async () => {
    const folder = demoFolder();
    await folder.createRequest('b.json', { x: 1 });
    folder.writeAsMac('_requests/done/b.json', '{"handled":{}}');
    folder.removeAsMac('_requests/b.json');
    expect(await folder.readText('_requests/b.json')).toBeNull();
    expect(await folder.readText('_requests/done/b.json')).toBe('{"handled":{}}');
  });
});
