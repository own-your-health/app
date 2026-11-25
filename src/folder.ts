// The records folder by path, the same for Drive and for the demo's
// synthetic folder. Paths are relative to the folder, `/`-separated, as
// medrec writes them in the index (`Robin Example/index.json`).

import { Drive, DriveError, FOLDER_MIME, readBody, viewUrl, type DriveFile, type ReadOptions } from './drive';

export interface Entry {
  name: string;
  folder: boolean;
  modifiedTime?: string;
  /** Whether this app may delete it: true only for files the app created. */
  deletable: boolean;
}

export interface RecordsFolder {
  readonly kind: 'drive' | 'demo';
  readonly id: string;
  readonly name: string;
  readText(path: string): Promise<string | null>;
  /** A file's bytes, as they are, kept nowhere here; null when it is not there. Only for a paper someone asked to see. */
  readBytes(path: string, opts?: ReadOptions): Promise<Uint8Array<ArrayBuffer> | null>;
  /**
   * The file's MD5 as the folder holds it (Drive's `md5Checksum`), which
   * medrec's views.json records: null when there is no such file, undefined
   * when the folder cannot say.
   */
  md5(path: string): Promise<string | null | undefined>;
  list(path: string): Promise<Entry[] | null>;
  /** A link that opens the file or folder in Drive's own viewer. */
  link(path: string): Promise<string | null>;
  /**
   * Whether this account may add a file to `_requests/`: false for one the
   * folder is shared with to view only, undefined when the folder does not say.
   * The owner of the folder always may.
   */
  mayRequest(): Promise<boolean | undefined>;
  /** Writes `_requests/<name>`; the only write the app makes. */
  createRequest(name: string, body: unknown): Promise<void>;
  /** Deletes one of the app's own pending requests (a cancel); false when it is already gone. */
  deleteRequest(name: string): Promise<boolean>;
  /** Forgets what was read under a path, so the next read goes to Drive. */
  forget(prefix: string): void;
  /** The same folder with nothing read of it yet, sharing nothing with what is being read of this one. */
  fresh(): RecordsFolder;
}

export async function readJson(folder: RecordsFolder, path: string): Promise<unknown | null> {
  const text = await folder.readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
}

export function splitPath(path: string): string[] {
  return path.split('/').filter((p) => p !== '' && p !== '.');
}

export const REQUESTS_DIR = '_requests';

/** Drive did not answer whether it wrote a request: it may be there all the same. */
export class Unanswered extends Error {}

/** A refusal stored nothing. With no answer, or a fault of Drive's, it may have. */
const mayBeStored = (e: unknown): boolean => !(e instanceof DriveError) || e.status >= 500;

/** What a fresh folder keeps. */
interface Kept {
  /** Drive's ids for the requests written, by name: the same one sent again is the same file. */
  ids: Map<string, string>;
  /** Whether the account owns `_requests/`, asked once where Drive says it may not add to it. */
  own?: boolean;
}

export class DriveFolder implements RecordsFolder {
  readonly kind = 'drive' as const;
  private listings = new Map<string, Promise<Map<string, DriveFile>>>();
  /** Files read since they were listed, and Drive's MD5 of each, asked again after the read. */
  private served = new Set<string>();
  private reread = new Map<string, Promise<string | undefined>>();
  constructor(
    private readonly drive: Drive,
    readonly id: string,
    readonly name: string,
    private readonly kept: Kept = { ids: new Map() },
  ) {}

  private listing(dirPath: string, dirId: string): Promise<Map<string, DriveFile>> {
    let p = this.listings.get(dirPath);
    if (!p) {
      p = this.drive.children(dirId).then((files) => {
        const m = new Map<string, DriveFile>();
        for (const f of files) {
          const held = m.get(f.name);
          // Drive allows two files of one name; medrec never writes them, so
          // take the newer one.
          if (!held || (f.modifiedTime ?? '') > (held.modifiedTime ?? '')) m.set(f.name, f);
        }
        return m;
      });
      p.catch(() => this.listings.delete(dirPath));
      this.listings.set(dirPath, p);
    }
    return p;
  }

  /** The Drive file at a path, or null when any part of it is missing. */
  async resolve(path: string): Promise<DriveFile | null> {
    const parts = splitPath(path);
    let dir: DriveFile = { id: this.id, name: this.name, mimeType: FOLDER_MIME };
    let dirPath = '';
    for (const part of parts) {
      if (dir.mimeType !== FOLDER_MIME) return null;
      const next = (await this.listing(dirPath, dir.id)).get(part);
      if (!next) return null;
      dir = next;
      dirPath = dirPath ? `${dirPath}/${part}` : part;
    }
    return dir;
  }

  async readText(path: string): Promise<string | null> {
    const f = await this.resolve(path);
    if (!f || f.mimeType === FOLDER_MIME) return null;
    try {
      const text = await this.drive.text(f.id);
      this.served.add(splitPath(path).join('/'));
      return text;
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return null;
      throw e;
    }
  }

  async readBytes(path: string, opts?: ReadOptions): Promise<Uint8Array<ArrayBuffer> | null> {
    const f = await this.resolve(path);
    if (!f || f.mimeType === FOLDER_MIME) return null;
    try {
      return await this.drive.bytes(f.id, opts);
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * A file read since it was listed may have changed in between, so its MD5
   * is asked of Drive again, after the read: that one is of what was read or
   * of a newer file, so a check against it never passes the wrong content.
   */
  async md5(path: string): Promise<string | null | undefined> {
    const p = splitPath(path).join('/');
    const f = await this.resolve(p);
    if (!f || f.mimeType === FOLDER_MIME) return null;
    if (!this.served.has(p)) return f.md5Checksum?.toLowerCase();
    let m = this.reread.get(p);
    if (!m) {
      m = this.drive.get(f.id).then(
        (x) => x.md5Checksum?.toLowerCase(),
        () => {
          this.reread.delete(p);
          return undefined;
        },
      );
      this.reread.set(p, m);
    }
    return m;
  }

  async list(path: string): Promise<Entry[] | null> {
    const f = await this.resolve(path);
    if (!f || f.mimeType !== FOLDER_MIME) return null;
    const m = await this.listing(splitPath(path).join('/'), f.id);
    return [...m.values()].map((x) => ({
      name: x.name,
      folder: x.mimeType === FOLDER_MIME,
      modifiedTime: x.modifiedTime,
      deletable: x.capabilities?.canDelete === true,
    }));
  }

  async link(path: string): Promise<string | null> {
    const f = await this.resolve(path);
    return f ? viewUrl(f) : null;
  }

  async mayRequest(): Promise<boolean | undefined> {
    const dir = await this.resolve(REQUESTS_DIR);
    const may = dir?.capabilities?.canAddChildren;
    if (!dir || may !== false) return may;
    try {
      this.kept.own ??= (await this.drive.folder(dir.id)).ownedByMe === true;
    } catch {
      return undefined;
    }
    return this.kept.own ? undefined : false;
  }

  async createRequest(name: string, body: unknown): Promise<void> {
    const dir = await this.resolve(REQUESTS_DIR);
    if (!dir || dir.mimeType !== FOLDER_MIME) throw new Error('The records folder has no _requests folder.');
    const id = this.kept.ids.get(name) ?? (await this.drive.newId());
    this.kept.ids.set(name, id);
    try {
      await this.create(dir.id, name, body, id);
    } catch (e) {
      if (!mayBeStored(e)) throw e;
      await this.create(dir.id, name, body, id).catch(() => {
        throw new Unanswered('Google Drive did not answer, so this may or may not have been sent. The app is looking for it. Sending the same again counts once.');
      });
    } finally {
      this.forget(REQUESTS_DIR);
    }
  }

  /** Writes one request; where Drive has it already, under its id, it is written. */
  private async create(dir: string, name: string, body: unknown, id: string): Promise<void> {
    try {
      await this.drive.createJson(dir, name, body, id);
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 409)) throw e;
    }
  }

  async deleteRequest(name: string): Promise<boolean> {
    const f = await this.resolve(`${REQUESTS_DIR}/${name}`);
    if (!f) return false;
    try {
      await this.drive.remove(f.id);
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return false;
      throw e;
    } finally {
      this.forget(REQUESTS_DIR);
    }
    return true;
  }

  forget(prefix: string): void {
    const p = splitPath(prefix).join('/');
    const under = (k: string) => p === '' || k === p || k.startsWith(`${p}/`);
    for (const k of [...this.listings.keys()]) if (under(k)) this.listings.delete(k);
    for (const k of [...this.served]) if (under(k)) this.served.delete(k);
    for (const k of [...this.reread.keys()]) if (under(k)) this.reread.delete(k);
  }

  fresh(): DriveFolder {
    return new DriveFolder(this.drive, this.id, this.name, this.kept);
  }
}

/**
 * The sample's keys for when something was loaded, filed, asked for or
 * checked: the times the demo moves to now. Times of care (a visit's period,
 * when a result was issued) and a source's own times stay as written, so a
 * visit keeps its day however long ago the sample was made.
 */
export const LOAD_TIMES = new Set([
  'created_at',
  'last_pull',
  'filed_at',
  'fetched_at',
  'imported_at',
  'pulled_at',
  'started_at',
  'finished_at',
  'last_pass_at',
  'next_pass_at',
  'since',
  'next_run_at',
  'checked_at',
  'expires_at',
  'updated_at',
  'requested_at',
  'picked_up_at',
  'next_allowed_at',
  // views.json: a person's last import.
  'last_import',
]);

/** The sample's keys for times that stay as written: times of care (an event's `times` among them), and a source's own. */
export const KEPT_TIMES = new Set(['start', 'end', 'date', 'when', 'issued', 'lastUpdated', 'last_updated', 'times[]']);

/**
 * The synthetic records folder shipped with the app (public/demo/), read
 * over the page's own origin. Writes stay in memory, and a simulated Mac
 * answers refresh requests, so the whole flow can be tried without a Drive.
 */
export class DemoFolder implements RecordsFolder {
  readonly kind = 'demo' as const;
  readonly id = 'demo';
  readonly name = 'Sample records';
  private files: Promise<Set<string>>;
  private md5s: Promise<Map<string, string>>;
  private written = new Map<string, string>();
  /** The MD5s the simulated Mac gave the files it wrote. */
  private writtenMd5s = new Map<string, string>();
  private deleted = new Set<string>();
  private mine = new Set<string>();

  private shiftMs = 0;

  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    now: Date = new Date(),
  ) {
    const manifest = this.fetchImpl(`${base}manifest.json`).then((r) => r.json() as Promise<{ files: string[]; md5?: Record<string, string>; anchor?: string }>);
    this.files = manifest.then((m) => {
      // The sample was written at its anchor time; move its timestamps to
      // now, so its loads look as recent as when it was written.
      if (m.anchor) this.shiftMs = now.getTime() - Date.parse(m.anchor);
      return new Set(m.files);
    });
    // Each file's MD5 as written, before the shift, as Drive would report it.
    this.md5s = manifest.then((m) => new Map(Object.entries(m.md5 ?? {})));
  }

  private shift(text: string): string {
    if (!this.shiftMs) return text;
    return text.replace(/"([a-z_]+)"(\s*:\s*)"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z"/g, (all, key: string, sep: string, t: string) =>
      LOAD_TIMES.has(key) ? `"${key}"${sep}"${new Date(Date.parse(`${t}Z`) + this.shiftMs).toISOString().replace(/\.\d{3}Z$/, 'Z')}"` : all,
    );
  }

  private url(path: string): string {
    return this.base + splitPath(path).map(encodeURIComponent).join('/');
  }

  private async exists(path: string): Promise<boolean> {
    const p = splitPath(path).join('/');
    if (this.deleted.has(p)) return false;
    return this.written.has(p) || (await this.files).has(p);
  }

  async readText(path: string): Promise<string | null> {
    const p = splitPath(path).join('/');
    if (this.deleted.has(p)) return null;
    const w = this.written.get(p);
    if (w !== undefined) return w;
    if (!(await this.exists(p))) return null;
    const res = await this.fetchImpl(this.url(p));
    return res.ok ? this.shift(await res.text()) : null;
  }

  async readBytes(path: string, opts: ReadOptions = {}): Promise<Uint8Array<ArrayBuffer> | null> {
    const p = splitPath(path).join('/');
    if (!(await this.exists(p))) return null;
    const res = await this.fetchImpl(this.url(p), { signal: opts.signal ?? null });
    return res.ok ? readBody(res, opts) : null;
  }

  async md5(path: string): Promise<string | null | undefined> {
    const p = splitPath(path).join('/');
    if (!(await this.exists(p))) return null;
    return this.written.has(p) ? this.writtenMd5s.get(p) : (await this.md5s).get(p);
  }

  async list(path: string): Promise<Entry[] | null> {
    const dir = splitPath(path).join('/');
    const prefix = dir ? `${dir}/` : '';
    const all = new Set([...(await this.files), ...this.written.keys()]);
    const names = new Map<string, boolean>();
    let any = dir === '';
    for (const f of all) {
      if (this.deleted.has(f) || !f.startsWith(prefix)) continue;
      any = true;
      const rest = f.slice(prefix.length);
      const [head, ...tail] = rest.split('/');
      if (head) names.set(head, (names.get(head) ?? false) || tail.length > 0);
    }
    // A folder that only holds folders still exists; `_requests/` and
    // `_requests/done/` are kept by a placeholder in the manifest.
    for (const f of all) if (f === `${prefix}.keep`) any = true;
    if (!any) return null;
    return [...names]
      .filter(([n]) => n !== '.keep')
      .map(([name, folder]) => ({ name, folder, deletable: this.mine.has(`${prefix}${name}`) }));
  }

  async link(): Promise<string | null> {
    return null;
  }

  async mayRequest(): Promise<boolean | undefined> {
    return true;
  }

  async createRequest(name: string, body: unknown): Promise<void> {
    const p = `${REQUESTS_DIR}/${name}`;
    this.deleted.delete(p);
    this.written.set(p, JSON.stringify(body, null, 2));
    this.mine.add(p);
  }

  async deleteRequest(name: string): Promise<boolean> {
    const p = `${REQUESTS_DIR}/${name}`;
    if (!(await this.exists(p))) return false;
    if (!this.mine.has(p)) throw new Error('Only a request this app made can be cancelled.');
    this.written.delete(p);
    this.mine.delete(p);
    this.deleted.add(p);
    return true;
  }

  /** The simulated Mac's own write: it is medrec's, not the app's. `md5` is what the folder says of it from then on. */
  writeAsMac(path: string, text: string, md5?: string): void {
    const p = splitPath(path).join('/');
    this.deleted.delete(p);
    this.written.set(p, text);
    if (md5) this.writtenMd5s.set(p, md5);
  }

  removeAsMac(path: string): void {
    const p = splitPath(path).join('/');
    this.written.delete(p);
    this.mine.delete(p);
    this.deleted.add(p);
  }

  forget(): void {}

  /** Nothing of it is remembered but what was written to it. */
  fresh(): DemoFolder {
    return this;
  }
}
