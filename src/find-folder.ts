// The records folders an account can open, and what Drive says of a folder
// link it cannot.

import { Drive, DriveError, folderIdFrom, FOLDER_MIME, householdInQuery, HOUSEHOLD_QUERY, SHARED_FOLDERS_QUERY, type DriveFile } from './drive';
import { FolderError } from './model/parse';

/** How many shared folders are looked in, those shared last first. */
const SHARED_MAX = 40;

export interface Candidate {
  id: string;
  name: string;
  /** When its household.json last changed. */
  modified?: string;
  /** Who owns it, when the account does not: a name, or empty where Drive gives none. */
  owner?: string;
  /** Shared with the account to view only. */
  viewOnly: boolean;
}

function candidate(f: DriveFile, modified: string | undefined): Candidate {
  return {
    id: f.id,
    name: f.name,
    modified,
    ...(f.ownedByMe === false ? { owner: f.owners?.[0]?.displayName ?? '' } : {}),
    viewOnly: f.ownedByMe === false && f.capabilities?.canAddChildren === false,
  };
}

/** The folders holding a household.json: those Drive's search finds, then those among the folders shared with the account. */
export async function findFolders(drive: Drive): Promise<Candidate[]> {
  const found = async () => {
    const files = await drive.list(HOUSEHOLD_QUERY, { pageSize: 50 });
    const parents = [...new Set(files.flatMap((f) => f.parents ?? []))].slice(0, 20);
    const folders = await Promise.all(parents.map((id) => drive.folder(id).catch(() => null)));
    return folders.flatMap((f) => (f && f.mimeType === FOLDER_MIME ? [candidate(f, files.find((x) => x.parents?.includes(f.id))?.modifiedTime)] : []));
  };
  const shared = async () => {
    const folders = await drive.list(SHARED_FOLDERS_QUERY, { max: SHARED_MAX, orderBy: 'sharedWithMeTime desc', folders: true });
    const held = await Promise.all(folders.map((f) => drive.list(householdInQuery(f.id), { max: 1 }).catch(() => [])));
    return folders.flatMap((f, i) => (held[i]![0] ? [candidate(f, held[i]![0].modifiedTime)] : []));
  };
  // A search that fails leaves what the other found; with both failed, the first says why.
  const [a, b] = await Promise.allSettled([found(), shared()]);
  if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
  const all = [...(a.status === 'fulfilled' ? a.value : []), ...(b.status === 'fulfilled' ? b.value : [])];
  return all.filter((c, i) => all.findIndex((x) => x.id === c.id) === i);
}

/** Why the account cannot open a folder, and what makes it able to. */
export function cannotOpen(account: string | undefined): string {
  return account
    ? `${account} cannot open that folder. If it is someone else’s, ask them to share it with ${account} in Google Drive, then open it again.`
    : 'This account cannot open that folder. If it is someone else’s, ask them to share it with the account you are signed in with, then open it again.';
}

const noAccess = (e: unknown): boolean => e instanceof DriveError && (e.status === 404 || e.status === 403);

/**
 * Why a folder chosen before did not open. Drive lists nothing in a folder the
 * account may no longer see, as it does in an empty one: the folder itself
 * tells them apart.
 */
export async function whyNotOpened(drive: Drive, id: string, e: unknown, account: string | undefined): Promise<string> {
  const unseen = noAccess(e) || (e instanceof FolderError && e.kind === 'not_household' && (await drive.folder(id).then(() => false, noAccess)));
  if (unseen) return cannotOpen(account);
  return e instanceof Error ? e.message : 'The folder could not be read.';
}

/** The folder a pasted link names, or the words for why it is none. */
export async function folderOfLink(drive: Drive, link: string, account: string | undefined): Promise<{ id: string; name: string } | string> {
  const id = folderIdFrom(link);
  if (!id) return 'Paste a Drive folder link, like https://drive.google.com/drive/folders/….';
  try {
    const f = await drive.folder(id);
    return f.mimeType === FOLDER_MIME ? { id: f.id, name: f.name } : 'That link is a file, not a folder.';
  } catch (e) {
    if (noAccess(e)) return cannotOpen(account);
    return e instanceof DriveError ? e.message : 'Google Drive did not answer. Try again.';
  }
}
