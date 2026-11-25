import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Drive, DriveError, type DriveFile, FOLDER_MIME } from '../src/drive';
import { DriveFolder, KEPT_TIMES, LOAD_TIMES, readJson, splitPath, Unanswered } from '../src/folder';
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
    if (id === 'generateIds') return json(fixture('drive/generated-ids.json'));
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

  it('read anew, shares no listing and no MD5 with the one it came from', async () => {
    const listed = { ...ROOT['folder-robin']![0]! };
    const tree = { ...ROOT, 'folder-robin': [listed] };
    const meta: Record<string, DriveFile> = { [listed.id]: listed };
    const { drive, calls } = driveWith(tree, { [listed.id]: '{}' }, meta);
    const folder = new DriveFolder(drive, 'root', 'x');
    await folder.readText('Robin Example/index.json');
    expect(await folder.md5('Robin Example/index.json')).toBe(listed.md5Checksum);
    const before = calls.length;
    const again = folder.fresh();
    expect([again.id, again.name, again.kind]).toEqual(['root', 'x', 'drive']);
    meta[listed.id] = { ...listed, md5Checksum: 'f'.repeat(32) };
    await again.readText('Robin Example/index.json');
    expect(await again.md5('Robin Example/index.json')).toBe('f'.repeat(32));
    expect(calls.length).toBeGreaterThan(before + 2);
    expect(await folder.md5('Robin Example/index.json')).toBe(listed.md5Checksum);
  });

  it('asks Drive for a read file’s MD5 again after the read, once, so an upload between the listing and the read is seen', async () => {
    const listed = ROOT['folder-robin']![0]!;
    const { drive, calls } = driveWith(ROOT, { 'file-robin-index': '{"rev":2}' }, { 'file-robin-index': { ...listed, md5Checksum: 'ABCDEF0123456789ABCDEF0123456789' } });
    const folder = new DriveFolder(drive, 'root', 'x');
    expect(await folder.readText('Robin Example/index.json')).toBe('{"rev":2}');
    expect(await folder.md5('Robin Example/index.json')).toBe('abcdef0123456789abcdef0123456789');
    expect(await folder.md5('Robin Example/index.json')).toBe('abcdef0123456789abcdef0123456789');
    expect(calls.filter((c) => c === 'GET /drive/v3/files/file-robin-index')).toHaveLength(1);
    // What Drive did not say is asked again.
    const other = new DriveFolder(drive, 'root', 'x');
    await other.readText('Robin Example/index.json');
    const get = drive.get.bind(drive);
    drive.get = () => Promise.reject(new Error('offline'));
    expect(await other.md5('Robin Example/index.json')).toBeUndefined();
    drive.get = get;
    calls.length = 0;
    expect([await other.md5('Robin Example/index.json'), await other.md5('Robin Example/index.json'), calls]).toEqual(['abcdef0123456789abcdef0123456789', 'abcdef0123456789abcdef0123456789', ['GET /drive/v3/files/file-robin-index']]);
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

  it('sends a request whose answer from Drive was lost once more, under the same id, and says when it cannot tell', async () => {
    const name = '20261122T201500Z_x_aaaaaaaaaaaaaaaaaaaa.json';
    /** A folder whose Drive answers each create in turn, and the ids the creates gave. */
    const answering = (...answers: (number | 'lost')[]) => {
      const [sent, calls]: [string[], string[]] = [[], []];
      const drive = new Drive(() => 'tok', (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(String(input));
        calls.push(`${init.method ?? 'GET'} ${url.pathname}`);
        if (url.pathname.endsWith('/generateIds')) return json({ ...fixture<object>('drive/generated-ids.json'), ids: [`id-${calls.length}`] });
        if (init.method !== 'POST') return json({ files: ROOT[url.searchParams.get('q')!.match(/^'([^']+)' in parents/)![1]!] ?? [] });
        sent.push((JSON.parse(String(init.body).split('\r\n\r\n')[1]!.split('\r\n')[0]!) as { id: string }).id);
        const status = answers.shift()!;
        if (status === 'lost') throw new TypeError('Failed to fetch');
        return status === 200 ? json(fixture('drive/created.json')) : json(fixture(status === 409 ? 'drive/error-409.json' : 'drive/error-403.json'), status);
      }) as typeof fetch);
      return { folder: new DriveFolder(drive, 'root', 'x'), sent, calls };
    };
    for (const first of [500, 503, 'lost'] as const)
      for (const then of [200, 409]) {
        const { folder, sent } = answering(first, then);
        await folder.createRequest(name, {});
        expect([sent.length, new Set(sent).size]).toEqual([2, 1]);
      }
    for (const then of ['lost', 503, 403, 429] as const) {
      const { folder, sent } = answering('lost', then, 409);
      await expect(folder.createRequest(name, {})).rejects.toThrow(Unanswered);
      // Sent again by the person, also once the records were read again, it is the same file.
      await folder.fresh().createRequest(name, {});
      expect([sent.length, new Set(sent).size]).toEqual([3, 1]);
    }
    // Drive has the file already.
    const had = answering(409);
    await had.folder.createRequest(name, {});
    expect(had.sent).toHaveLength(1);
    // A refusal is one, and is not sent again. Another request is another file.
    for (const status of [400, 403, 404, 429, 499]) {
      const { folder, sent } = answering(status, 200);
      await expect(folder.createRequest(name, {})).rejects.toThrow(DriveError);
      await folder.createRequest(name.replace('aaaa', 'bbbb'), {});
      expect(new Set(sent).size).toBe(2);
    }
  });

  it('writes no request without an id from Drive', async () => {
    const calls: string[] = [];
    const drive = new Drive(() => 'tok', (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push(init.method ?? 'GET');
      if (url.pathname.endsWith('/generateIds')) return json({ ...fixture<object>('drive/generated-ids.json'), ids: [] });
      return json({ files: ROOT[url.searchParams.get('q')!.match(/^'([^']+)' in parents/)![1]!] ?? [] });
    }) as typeof fetch);
    await expect(new DriveFolder(drive, 'root', 'x').createRequest('a.json', {})).rejects.toThrow('gave no id');
    expect(calls).not.toContain('POST');
  });

  it('deletes a pending request by name', async () => {
    const { drive, calls } = driveWith(ROOT);
    expect(await new DriveFolder(drive, 'root', 'x').deleteRequest('20261122T200312Z_x_abcdefghijklmnopqrst.json')).toBe(true);
    expect(calls).toContain('DELETE /drive/v3/files/file-mine');
  });

  it('says when a request to delete is already gone, and fails when Drive refuses', async () => {
    const name = '20261122T200312Z_x_abcdefghijklmnopqrst.json';
    expect(await new DriveFolder(driveWith(ROOT).drive, 'root', 'x').deleteRequest('20261122T200312Z_x_zzzzzzzzzzzzzzzzzzzz.json')).toBe(false);
    const answering = (status: number) =>
      new Drive(() => 'tok', (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const parent = new URL(String(input)).searchParams.get('q')?.match(/^'([^']+)' in parents/)?.[1];
        return init.method === 'DELETE' ? json({ error: { code: status, message: 'no', errors: [{ reason: 'no' }] } }, status) : json({ files: ROOT[parent!] ?? [] });
      }) as typeof fetch);
    expect(await new DriveFolder(answering(404), 'root', 'x').deleteRequest(name)).toBe(false);
    await expect(new DriveFolder(answering(403), 'root', 'x').deleteRequest(name)).rejects.toThrow('no');
  });

  it('says whether the account may add a request, as Drive’s listing has it', async () => {
    const requests = ROOT.root!.find((f) => f.name === '_requests')!;
    const may = async (capabilities?: DriveFile['capabilities']) => new DriveFolder(driveWith({ ...ROOT, root: ROOT.root!.map((f) => (f === requests ? { ...f, capabilities } : f)) }, {}, { [requests.id]: { ...requests, ownedByMe: false } }).drive, 'root', 'x').mayRequest();
    expect([await may({ canAddChildren: true }), await may({ canAddChildren: false }), await may()]).toEqual([true, false, undefined]);
    expect(await new DriveFolder(driveWith({ root: [] }).drive, 'root', 'x').mayRequest()).toBeUndefined();
  });

  it('may always be asked by the account that owns it, whatever Drive says of adding to it', async () => {
    let owned: boolean | undefined = true;
    let fails = false;
    let asks = 0;
    const drive = new Drive(() => 'tok', (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.has('q')) return json({ files: [{ id: 'req', name: '_requests', mimeType: FOLDER_MIME, capabilities: { canAddChildren: false } }] });
      asks += 1;
      return fails ? json(fixture('drive/error-403.json'), 403) : json({ id: 'req', name: '_requests', mimeType: FOLDER_MIME, ...(owned === undefined ? {} : { ownedByMe: owned }) });
    }) as typeof fetch);
    const mine = new DriveFolder(drive, 'root', 'x');
    expect([await mine.mayRequest(), await mine.mayRequest(), asks]).toEqual([undefined, undefined, 1]);
    owned = false;
    expect(await new DriveFolder(drive, 'root', 'x').mayRequest()).toBe(false);
    owned = undefined;
    expect(await new DriveFolder(drive, 'root', 'x').mayRequest()).toBe(false);
    // Not answered, the folder does not say, and it is asked again.
    fails = true;
    owned = false;
    const later = new DriveFolder(drive, 'root', 'x');
    expect(await later.mayRequest()).toBeUndefined();
    fails = false;
    expect(await later.mayRequest()).toBe(false);
    // Settled, a folder read again keeps it.
    asks = 0;
    expect([await later.fresh().mayRequest(), await mine.fresh().mayRequest(), asks]).toEqual([false, undefined, 0]);
  });

  it('links to Drive’s viewer', async () => {
    const { drive } = driveWith(ROOT);
    expect(await new DriveFolder(drive, 'root', 'x').link('Robin Example')).toBe('https://drive.google.com/drive/folders/folder-robin');
  });
});

describe('readBytes', () => {
  const bytes = async (folder: { readBytes: DriveFolder['readBytes'] }, at: string) => {
    const b = await folder.readBytes(at);
    return b && new TextDecoder().decode(b);
  };

  it('gives a file’s bytes from Drive each time it is asked, and keeps none', async () => {
    const { drive, calls } = driveWith(ROOT, { 'file-robin-index': '{"ok":true}' });
    const folder = new DriveFolder(drive, 'root', 'x');
    for (let i = 0; i < 2; i++) expect(await bytes(folder, 'Robin Example/index.json')).toBe('{"ok":true}');
    expect(calls.filter((c) => c.endsWith('?alt=media'))).toHaveLength(2);
  });

  it('gives nothing for a folder, a missing path or a file gone since it was listed, and fails on any other answer', async () => {
    const { drive } = driveWith(ROOT);
    const folder = new DriveFolder(drive, 'root', 'x');
    for (const at of ['Robin Example', 'Nobody/a.pdf', 'Robin Example/none.pdf', 'Robin Example/index.json']) expect(await bytes(folder, at), at).toBeNull();
    const refusing = new Drive(
      () => 'tok',
      (async (input: RequestInfo | URL) => (new URL(String(input)).searchParams.get('alt') ? json({ error: { code: 403, message: 'no', errors: [{ reason: 'cannotDownloadFile' }] } }, 403) : json({ files: ROOT['folder-robin'] }))) as typeof fetch,
    );
    await expect(bytes(new DriveFolder(refusing, 'folder-robin', 'x'), 'index.json')).rejects.toMatchObject({ status: 403 });
  });

  it('gives a sample file’s bytes as they are, only one its list has', async () => {
    const folder = demoFolder();
    const { files } = JSON.parse(readFileSync(join(DEMO, 'manifest.json'), 'utf8')) as { files: string[] };
    const picture = files.find((f) => f.endsWith('.png'))!;
    expect(Buffer.from((await folder.readBytes(picture))!).equals(readFileSync(join(DEMO, picture)))).toBe(true);
    expect(await folder.readBytes('Robin Example/none.pdf')).toBeNull();
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
    expect([await folder.deleteRequest('a.json'), await folder.deleteRequest('a.json'), await folder.mayRequest()]).toEqual([true, false, true]);
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
