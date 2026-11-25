// Choosing the records folder: what is found in the account's own Drive and in
// what is shared with it, and the words for a folder it cannot open.
import { describe, expect, it } from 'vitest';
import { Drive, DriveError, FOLDER_MIME, householdInQuery, HOUSEHOLD_QUERY, SHARED_FOLDERS_QUERY, type DriveFile } from '../src/drive';
import { cannotOpen, findFolders, folderOfLink, whyNotOpened } from '../src/find-folder';
import { FolderError } from '../src/model/parse';
import { fixture, json } from './helpers';

const folder = (id: string, more: Partial<DriveFile> = {}): DriveFile => ({ id, name: `Records ${id}`, mimeType: FOLDER_MIME, ownedByMe: true, capabilities: { canAddChildren: true }, ...more });
const household = (parent: string, modifiedTime = '2026-11-20T10:00:00.000Z'): DriveFile => ({ id: `household-${parent}`, name: 'household.json', mimeType: 'application/json', modifiedTime, parents: [parent] });
const shared = (id: string, more: Partial<DriveFile> = {}): DriveFile => folder(id, { ownedByMe: false, owners: [{ displayName: 'Robin Example' }], capabilities: { canAddChildren: false }, ...more });

/** A Drive of some lists, by query, and files, by id; what it holds no answer for, it refuses. */
function driveOf(lists: Record<string, DriveFile[]>, files: DriveFile[] = []): { drive: Drive; asked: URL[] } {
  const asked: URL[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    asked.push(url);
    const q = url.searchParams.get('q');
    if (q !== null) return lists[q] ? json({ files: lists[q] }) : json({ error: { code: 503, message: 'Backend Error', errors: [{ reason: 'backendError' }] } }, 503);
    const f = files.find((x) => url.pathname.endsWith(`/files/${x.id}`));
    return f ? json(f) : json({ error: { code: 404, message: 'File not found: .', errors: [{ reason: 'notFound' }] } }, 404);
  }) as typeof fetch;
  return { drive: new Drive(() => 'tok', fetchImpl), asked };
}

describe('the queries', () => {
  it('are the exact strings Drive receives', () => {
    expect(householdInQuery('abc')).toBe("'abc' in parents and name = 'household.json' and trashed = false");
    expect(SHARED_FOLDERS_QUERY).toBe("sharedWithMe = true and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  });
});

describe('the folders an account can open', () => {
  it('are those with a household.json, in its Drive and among those shared with it, each once', async () => {
    const { drive, asked } = driveOf(
      {
        [HOUSEHOLD_QUERY]: [household('mine'), household('both')],
        [SHARED_FOLDERS_QUERY]: [shared('both'), shared('view'), shared('photos')],
        [householdInQuery('both')]: [household('both')],
        [householdInQuery('view')]: [household('view', '2026-11-21T10:00:00.000Z')],
        [householdInQuery('photos')]: [],
      },
      [folder('mine'), shared('both', { capabilities: { canAddChildren: true } })],
    );
    expect(await findFolders(drive)).toEqual({ incomplete: false, folders: [
      { id: 'mine', name: 'Records mine', modified: '2026-11-20T10:00:00.000Z', viewOnly: false },
      { id: 'both', name: 'Records both', modified: '2026-11-20T10:00:00.000Z', owner: 'Robin Example', viewOnly: false },
      { id: 'view', name: 'Records view', modified: '2026-11-21T10:00:00.000Z', owner: 'Robin Example', viewOnly: true },
    ] });
    // Newest shared first, no more than it looks in, with whose each is.
    const list = asked.find((u) => u.searchParams.get('q') === SHARED_FOLDERS_QUERY)!.searchParams;
    expect([list.get('orderBy'), list.get('pageSize'), list.get('fields')!.includes('ownedByMe,owners(displayName)')]).toEqual(['sharedWithMeTime desc', '40', true]);
  });

  it('leave out a file’s parent that is not a folder or that the account cannot open', async () => {
    const { drive } = driveOf({ [HOUSEHOLD_QUERY]: [household('gone'), household('odd'), { ...household('x'), parents: undefined }], [SHARED_FOLDERS_QUERY]: [] }, [folder('odd', { mimeType: 'application/zip' })]);
    expect(await findFolders(drive)).toEqual({ folders: [], incomplete: false });
  });

  it('are what was found when something did not answer, which says that there may be more', async () => {
    const ids = async (d: { drive: Drive }) => {
      const { folders, incomplete } = await findFolders(d.drive);
      return [folders.map((c) => c.id), incomplete];
    };
    const own = { [HOUSEHOLD_QUERY]: [household('mine')] };
    expect(await ids(driveOf(own, [folder('mine')]))).toEqual([['mine'], true]);
    const through = { [SHARED_FOLDERS_QUERY]: [shared('view'), shared('closed')], [householdInQuery('view')]: [household('view')] };
    expect(await ids(driveOf(through))).toEqual([['view'], true]);
    // Each shared folder looked in, and none that it does not answer for.
    expect(await ids(driveOf({ [HOUSEHOLD_QUERY]: [], ...through }))).toEqual([['view'], true]);
    expect(await ids(driveOf({ [HOUSEHOLD_QUERY]: [], ...through, [householdInQuery('closed')]: [] }))).toEqual([['view'], false]);
  });

  it('are none only when Drive answered all it was asked', async () => {
    const down = { status: 503, message: 'Drive: Backend Error' };
    await expect(findFolders(driveOf({}).drive)).rejects.toMatchObject(down);
    await expect(findFolders(driveOf({ [HOUSEHOLD_QUERY]: [] }).drive)).rejects.toMatchObject(down);
    await expect(findFolders(driveOf({ [SHARED_FOLDERS_QUERY]: [] }).drive)).rejects.toMatchObject(down);
    await expect(findFolders(driveOf({ [HOUSEHOLD_QUERY]: [], [SHARED_FOLDERS_QUERY]: [shared('a'), shared('b')], [householdInQuery('a')]: [] }).drive)).rejects.toMatchObject(down);
    expect(await findFolders(driveOf({ [HOUSEHOLD_QUERY]: [], [SHARED_FOLDERS_QUERY]: [shared('a')], [householdInQuery('a')]: [] }).drive)).toEqual({ folders: [], incomplete: false });
  });

  it('are looked for in a few shared folders at a time', async () => {
    const many = Array.from({ length: 11 }, (_, i) => shared(`s${i}`));
    let [now, most] = [0, 0];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get('q')!;
      if (q === HOUSEHOLD_QUERY) return json({ files: [] });
      if (q === SHARED_FOLDERS_QUERY) return json({ files: many });
      most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 1));
      now -= 1;
      const at = many.findIndex((f) => q === householdInQuery(f.id));
      return json({ files: at === 3 || at === 10 ? [household(`s${at}`)] : [] });
    }) as typeof fetch;
    expect((await findFolders(new Drive(() => 'tok', fetchImpl))).folders.map((c) => c.id)).toEqual(['s3', 's10']);
    expect(most).toBe(4);
  });

  it('say nothing of an owner in a shared drive, and name none where Drive gives none', async () => {
    const { drive } = driveOf({ [HOUSEHOLD_QUERY]: [household('team'), household('unnamed')], [SHARED_FOLDERS_QUERY]: [] }, [folder('team', { ownedByMe: undefined, capabilities: { canAddChildren: false } }), shared('unnamed', { owners: undefined })]);
    expect((await findFolders(drive)).folders.map((c) => [c.id, c.owner, c.viewOnly])).toEqual([
      ['team', undefined, false],
      ['unnamed', '', true],
    ]);
  });
});

describe('a folder chosen before that does not open', () => {
  const none = new FolderError('not_household', 'This folder has no household.json.');
  const refused = (status: number, reason = 'x') => new DriveError(status, reason, 'Drive: x');

  it('is one the account can no longer see, when Drive says so of its files or of itself', async () => {
    const { drive, asked } = driveOf({}, [folder('empty')]);
    expect(await whyNotOpened(drive, 'gone', refused(404), 'sam@example.com')).toBe(cannotOpen('sam@example.com'));
    expect(await whyNotOpened(drive, 'gone', refused(403, 'insufficientFilePermissions'), 'sam@example.com')).toBe(cannotOpen('sam@example.com'));
    expect(asked).toEqual([]);
    expect(await whyNotOpened(drive, 'gone', none, 'sam@example.com')).toBe(cannotOpen('sam@example.com'));
    expect(await whyNotOpened(drive, 'empty', none, 'sam@example.com')).toBe('This folder has no household.json.');
  });

  it('says what failed when that is something else', async () => {
    const down = new Drive(() => 'tok', (async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch);
    expect(await whyNotOpened(down, 'mine', none, 'sam@example.com')).toBe('This folder has no household.json.');
    const { drive, asked } = driveOf({});
    expect(await whyNotOpened(drive, 'mine', refused(503), 'sam@example.com')).toBe('Drive: x');
    // A limit of Drive's, and a Drive API the household's project has off, are no matter of sharing.
    for (const reason of ['userRateLimitExceeded', 'rateLimitExceeded', 'accessNotConfigured']) expect(await whyNotOpened(drive, 'mine', refused(403, reason), 'sam@example.com')).toBe('Drive: x');
    expect(await whyNotOpened(drive, 'mine', new FolderError('malformed', 'household.json has no format number.'), 'sam@example.com')).toBe('household.json has no format number.');
    expect(await whyNotOpened(drive, 'mine', 'x', 'sam@example.com')).toBe('The folder could not be read.');
    expect(asked).toEqual([]);
  });
});

describe('a pasted link', () => {
  const at = (id: string) => `https://drive.google.com/drive/folders/${id}`;

  it('is its folder, or says it is a file or no link', async () => {
    const { drive } = driveOf({}, [folder('abcdefghijkl'), folder('mnopqrstuvwx', { mimeType: 'application/pdf' })]);
    expect(await folderOfLink(drive, at('abcdefghijkl'), 'sam@example.com')).toEqual({ id: 'abcdefghijkl', name: 'Records abcdefghijkl' });
    expect(await folderOfLink(drive, at('mnopqrstuvwx'), 'sam@example.com')).toBe('That link is a file, not a folder.');
    expect(await folderOfLink(drive, 'records', 'sam@example.com')).toBe('Paste a Drive folder link, like https://drive.google.com/drive/folders/….');
  });

  it('names the account that cannot open it and the owner’s share', async () => {
    const { drive } = driveOf({});
    const text = 'sam@example.com cannot open that folder. If it is someone else’s, ask them to share it with sam@example.com in Google Drive, then open it again.';
    expect([await folderOfLink(drive, at('notsharedxxx'), 'sam@example.com'), cannotOpen('sam@example.com')]).toEqual([text, text]);
    expect(await folderOfLink(drive, at('notsharedxxx'), undefined)).toBe('This account cannot open that folder. If it is someone else’s, ask them to share it with the account you are signed in with, then open it again.');
    const refused = new Drive(() => 'tok', (async () => json(fixture('drive/error-403.json'), 403)) as typeof fetch);
    expect(await folderOfLink(refused, at('notsharedxxx'), 'sam@example.com')).toBe(text);
  });

  it('says when Drive did not answer, which is no fault of the account', async () => {
    const down = new Drive(() => 'tok', (async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch);
    expect(await folderOfLink(down, at('abcdefghijkl'), 'sam@example.com')).toBe('Google Drive did not answer. Try again.');
    const fault = new Drive(() => 'tok', (async () => json({ error: { code: 503, message: 'Backend Error' } }, 503)) as typeof fetch);
    expect(await folderOfLink(fault, at('abcdefghijkl'), 'sam@example.com')).toBe('Drive: Backend Error');
    const off = new Drive(() => 'tok', (async () => json({ error: { code: 403, message: 'The Drive API is off.', errors: [{ reason: 'accessNotConfigured' }] } }, 403)) as typeof fetch);
    expect(await folderOfLink(off, at('abcdefghijkl'), 'sam@example.com')).toBe('Drive: The Drive API is off.');
  });
});
