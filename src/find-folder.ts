// The records folders an account can open, and what Drive says of a folder
// link it cannot.

import { Drive, DriveError, folderIdFrom, FOLDER_MIME, householdInQuery, HOUSEHOLD_QUERY, SHARED_FOLDERS_QUERY, type DriveFile } from './drive';
import { FolderError } from './model/parse';

/** How many shared folders are looked in, those shared last first. */
const SHARED_MAX = 40;

/** Whether Drive says the account may not see it: not there for it, or refused for its role, and not for a limit of Drive's or a setting of the household's client. */
const noAccess = (e: unknown): boolean => e instanceof DriveError && (e.status === 404 || (e.status === 403 && e.reason === 'insufficientFilePermissions'));

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

export interface Found {
  folders: Candidate[];
  /** A search or a folder did not answer, so there may be more. */
  incomplete: boolean;
}

/** How many folders are asked about at once, so that Drive does not slow them all down. */
const AT_ONCE = 4;

/** What `ask` answers for each, in order: undefined for one it gives nothing for. */
async function each<T, R>(items: T[], ask: (x: T) => Promise<R | undefined>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await ask(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return out;
}

/**
 * The folders holding a household.json: those Drive's search finds, then those
 * among the folders shared with the account. Throws when it finds none and
 * Drive did not answer all it was asked: there may be one all the same.
 */
export async function findFolders(drive: Drive): Promise<Found> {
  const failures: unknown[] = [];
  // What the account may not see is not there for it; anything else that fails is.
  const or = async <T>(asked: Promise<T>): Promise<T | undefined> => {
    try {
      return await asked;
    } catch (e) {
      if (!noAccess(e)) failures.push(e);
      return undefined;
    }
  };
  const named = async () => {
    const files = (await or(drive.list(HOUSEHOLD_QUERY, { pageSize: 50 }))) ?? [];
    const parents = [...new Set(files.flatMap((f) => f.parents ?? []))].slice(0, 20);
    const folders = await each(parents, (id) => or(drive.folder(id)));
    return folders.flatMap((f) => (f?.mimeType === FOLDER_MIME ? [candidate(f, files.find((x) => x.parents?.includes(f.id))?.modifiedTime)] : []));
  };
  const shared = async () => {
    const folders = (await or(drive.list(SHARED_FOLDERS_QUERY, { max: SHARED_MAX, orderBy: 'sharedWithMeTime desc', folders: true }))) ?? [];
    const held = await each(folders, (f) => or(drive.list(householdInQuery(f.id), { max: 1 })));
    return folders.flatMap((f, i) => (held[i]?.[0] ? [candidate(f, held[i][0].modifiedTime)] : []));
  };
  const all = (await Promise.all([named(), shared()])).flat();
  if (!all.length && failures.length) throw failures[0];
  return { folders: all.filter((c, i) => all.findIndex((x) => x.id === c.id) === i), incomplete: failures.length > 0 };
}

/** Why the account cannot open a folder, and what makes it able to. */
export function cannotOpen(account: string | undefined): string {
  return account
    ? `${account} cannot open that folder. If it is someone else’s, ask them to share it with ${account} in Google Drive, then open it again.`
    : 'This account cannot open that folder. If it is someone else’s, ask them to share it with the account you are signed in with, then open it again.';
}

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
