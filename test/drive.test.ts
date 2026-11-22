import { describe, expect, it } from 'vitest';
import { childrenQuery, Drive, DriveError, folderIdFrom, folderNamedQuery, HOUSEHOLD_QUERY, q, viewUrl } from '../src/drive';
import { fixture, json } from './helpers';

interface Call {
  url: URL;
  init: RequestInit;
}

function fakeFetch(answers: Response[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    const next = answers.shift();
    if (!next) throw new Error('unexpected call');
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('queries', () => {
  it('quote and escape a string once', () => {
    expect(q("Robin's \\ folder")).toBe("'Robin\\'s \\\\ folder'");
  });

  it('are the exact strings Drive receives', () => {
    expect(childrenQuery('abc')).toBe("'abc' in parents and trashed = false");
    expect(folderNamedQuery('oyh-app-scope-test')).toBe("name = 'oyh-app-scope-test' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    expect(folderNamedQuery('_requests', 'abc')).toBe("'abc' in parents and name = '_requests' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    expect(HOUSEHOLD_QUERY).toBe("name = 'household.json' and trashed = false");
  });

  it('reach Drive unchanged', async () => {
    const { fetchImpl, calls } = fakeFetch([json({ files: [] })]);
    await new Drive(() => 'tok', fetchImpl).list(folderNamedQuery("Robin's records"));
    expect(calls[0]!.url.searchParams.get('q')).toBe("name = 'Robin\\'s records' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  });
});

describe('Drive', () => {
  it('lists every page with the token, no cache and no referrer', async () => {
    const { fetchImpl, calls } = fakeFetch([json(fixture('drive/children-page1.json')), json(fixture('drive/children-page2.json'))]);
    const files = await new Drive(() => 'tok', fetchImpl).children('root-folder');
    expect(files.map((f) => f.id)).toEqual(['file-household', 'folder-robin', 'folder-requests', 'file-household-old']);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get('q')).toBe("'root-folder' in parents and trashed = false");
    expect(calls[0]!.url.searchParams.has('pageToken')).toBe(false);
    expect(calls[1]!.url.searchParams.get('pageToken')).toBe('page-2');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok');
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.referrerPolicy).toBe('no-referrer');
  });

  it('turns an error into a DriveError with Drive’s reason', async () => {
    const { fetchImpl } = fakeFetch([json(fixture('drive/error-403.json'), 403)]);
    const err = await new Drive(() => 'tok', fetchImpl).get('folder-requests').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err).toMatchObject({ status: 403, reason: 'insufficientFilePermissions' });
  });

  it('tells the app when the token is no longer good', async () => {
    let told = 0;
    const { fetchImpl } = fakeFetch([new Response('nope', { status: 401 })]);
    const err = await new Drive(() => 'tok', fetchImpl, () => told++).text('f').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401, reason: 'error' });
    expect(told).toBe(1);
  });

  it('creates a JSON file in one multipart upload', async () => {
    const { fetchImpl, calls } = fakeFetch([json(fixture('drive/created.json'))]);
    const f = await new Drive(() => 'tok', fetchImpl).createJson('folder-requests', '20261122T200312Z_x_abcdefghijklmnopqrst.json', { schema: 'medrec-request/v1' });
    expect(f.id).toBe('file-new');
    const c = calls[0]!;
    expect(c.url.origin + c.url.pathname).toBe('https://www.googleapis.com/upload/drive/v3/files');
    expect(c.url.searchParams.get('uploadType')).toBe('multipart');
    expect(c.init.method).toBe('POST');
    const type = new Headers(c.init.headers).get('Content-Type') ?? '';
    const boundary = type.match(/boundary=(\S+)/)?.[1];
    expect(boundary).toBeTruthy();
    const parts = String(c.init.body).split(`--${boundary}`);
    expect(parts).toHaveLength(4);
    expect(JSON.parse(parts[1]!.split('\r\n\r\n')[1]!)).toEqual({ name: '20261122T200312Z_x_abcdefghijklmnopqrst.json', parents: ['folder-requests'], mimeType: 'application/json' });
    expect(JSON.parse(parts[2]!.split('\r\n\r\n')[1]!)).toEqual({ schema: 'medrec-request/v1' });
    expect(parts[3]).toBe('--\r\n');
  });

  it('deletes with DELETE', async () => {
    const { fetchImpl, calls } = fakeFetch([new Response(null, { status: 204 })]);
    await new Drive(() => 'tok', fetchImpl).remove('file-mine');
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url.pathname).toBe('/drive/v3/files/file-mine');
  });

  it('reads the signed-in account', async () => {
    const { fetchImpl } = fakeFetch([json(fixture('drive/about.json'))]);
    expect(await new Drive(() => 'tok', fetchImpl).about()).toEqual({ email: 'robin@example.com', name: 'Robin Example' });
  });
});

describe('links', () => {
  it('opens folders and files in Drive’s viewer', () => {
    expect(viewUrl({ id: 'abc', mimeType: 'application/vnd.google-apps.folder' })).toBe('https://drive.google.com/drive/folders/abc');
    expect(viewUrl({ id: 'abc', mimeType: 'application/pdf' })).toBe('https://drive.google.com/file/d/abc/view');
  });

  it('takes a folder id from a link or as itself', () => {
    expect(folderIdFrom('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderIdFrom('https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderIdFrom('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderIdFrom(' 1AbCdEfGhIjKlMnOp ')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderIdFrom('Medical Records')).toBeNull();
    expect(folderIdFrom('short')).toBeNull();
  });
});
