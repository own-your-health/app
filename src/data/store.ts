// What the app has read from the records folder, in memory only. Nothing
// read from the folder is written to browser storage or sent anywhere but
// back to Drive.

import { readJson, REQUESTS_DIR, type RecordsFolder } from '../folder';
import { FolderError, parseAttempts, parseHousehold, parseIndex, parseRefused, parseRequest, parseStatus, parseText } from '../model/parse';
import { buildRequest, requestFileName, sameScope } from '../model/requests';
import { macState, sourceViews, type MacState, type SourceView } from '../model/sources';
import type { AttemptLine, Household, Person, PersonIndex, PersonText, RefreshRequest, RefreshStatus, RefusedRequest, RequestScope } from '../model/types';

export type StatusRead =
  | { kind: 'missing' }
  | { kind: 'newer_format'; format: number }
  | { kind: 'malformed' }
  | { kind: 'ok'; status: RefreshStatus };

export interface PendingRequest {
  file: string;
  request: RefreshRequest;
  /** True when this app may cancel it (it made the file). */
  cancellable: boolean;
}

export class Store {
  household!: Household;
  status: StatusRead = { kind: 'missing' };
  indexes = new Map<string, PersonIndex>();
  indexErrors = new Map<string, string>();
  pending: PendingRequest[] = [];
  done: RefreshRequest[] = [];
  /** Requests medrec refused as invalid, which keep no scope. */
  refused: RefusedRequest[] = [];
  /** Whether `_requests/` exists: the Mac set up refresh for this folder. */
  requestsReady = false;
  loadedAt = 0;
  private texts = new Map<string, Promise<PersonText | null>>();
  /** Handled requests of the app's own it has tried to remove once. */
  private tidied = new Set<string>();

  constructor(readonly folder: RecordsFolder) {}

  /** Reads household.json, every person's index, the status and the requests. */
  async load(): Promise<void> {
    const raw = await readJson(this.folder, 'household.json');
    if (raw === null) throw new FolderError('not_household', 'This folder has no household.json. Choose the records folder medrec writes.');
    this.household = parseHousehold(raw);
    await Promise.all([this.loadIndexes(), this.loadRefreshState()]);
    this.loadedAt = Date.now();
  }

  private async loadIndexes(): Promise<void> {
    await Promise.all(
      this.household.people.map(async (p) => {
        try {
          const raw = await readJson(this.folder, `${p.folder}/index.json`);
          if (raw === null) {
            this.indexes.set(p.id, { schema: 'medrec-index/v1', person: p.id, rev: 0, documents: [], records: [], studies: [], imports: [] });
            return;
          }
          this.indexes.set(p.id, parseIndex(raw, p.id));
          this.indexErrors.delete(p.id);
        } catch (e) {
          this.indexErrors.set(p.id, e instanceof Error ? e.message : 'The index could not be read.');
        }
      }),
    );
  }

  /** Reads `_status/status.json` and `_requests/` again. */
  async loadRefreshState(): Promise<void> {
    this.folder.forget('_status');
    this.folder.forget(REQUESTS_DIR);
    const [statusRaw, entries, doneEntries] = await Promise.all([
      readJson(this.folder, '_status/status.json').catch(() => undefined),
      this.folder.list(REQUESTS_DIR),
      this.folder.list(`${REQUESTS_DIR}/done`),
    ]);
    if (statusRaw === null) this.status = { kind: 'missing' };
    else if (statusRaw === undefined) this.status = { kind: 'malformed' };
    else this.status = parseStatus(statusRaw);
    this.requestsReady = entries !== null;
    // A request whose done/ file exists is handled, even when medrec could
    // not remove it (a file another account owns). The app removes its own.
    const doneNames = new Set((doneEntries ?? []).filter((e) => !e.folder).map((e) => e.name));
    const listed = (entries ?? []).filter((e) => !e.folder && e.name.endsWith('.json'));
    for (const e of listed) {
      if (doneNames.has(e.name) && e.deletable && !this.tidied.has(e.name)) {
        this.tidied.add(e.name);
        await this.folder.deleteRequest(e.name).catch(() => undefined);
      }
    }
    const pendingFiles = listed.filter((e) => !doneNames.has(e.name));
    const pending = await Promise.all(
      pendingFiles.map(async (e) => {
        const r = parseRequest(await readJson(this.folder, `${REQUESTS_DIR}/${e.name}`).catch(() => null));
        return r ? { file: e.name, request: r, cancellable: e.deletable } : null;
      }),
    );
    this.pending = pending.filter((x): x is PendingRequest => x !== null);
    // Only the latest outcomes matter on screen; the names sort by time.
    const doneFiles = (doneEntries ?? [])
      .filter((e) => !e.folder && e.name.endsWith('.json'))
      .map((e) => e.name)
      .sort()
      .slice(-50);
    const done = await Promise.all(doneFiles.map((n) => readJson(this.folder, `${REQUESTS_DIR}/done/${n}`).catch(() => null)));
    this.done = done.map(parseRequest).filter((x): x is RefreshRequest => x !== null);
    this.refused = done.map(parseRefused).filter((x): x is RefusedRequest => x !== null);
  }

  person(id: string): Person | undefined {
    return this.household.people.find((p) => p.id === id);
  }

  /** The person a Huishouden Health person is paired with. */
  personForHuishouden(hhId: string): Person | undefined {
    return this.household.people.find((p) => p.links?.huishouden_health_person === hhId);
  }

  index(personId: string): PersonIndex | undefined {
    return this.indexes.get(personId);
  }

  text(personId: string): Promise<PersonText | null> {
    let t = this.texts.get(personId);
    if (!t) {
      const p = this.person(personId);
      t = p ? readJson(this.folder, `${p.folder}/text.json`).then(parseText) : Promise.resolve(null);
      t.catch(() => this.texts.delete(personId));
      this.texts.set(personId, t);
    }
    return t;
  }

  sources(now: Date): SourceView[] {
    return sourceViews({
      now,
      household: this.household,
      indexes: this.indexes,
      status: this.status.kind === 'ok' ? this.status.status : undefined,
      pending: this.pending.map((p) => p.request),
      done: this.done,
    });
  }

  mac(now = new Date()): MacState {
    if (this.status.kind === 'ok' || this.status.kind === 'missing' || this.status.kind === 'newer_format') {
      return macState(this.status, now);
    }
    return { kind: 'offline', passEverySecs: 300 };
  }

  /** The attempts of one month (`YYYY-MM`), newest first. */
  async attempts(month: string): Promise<AttemptLine[]> {
    const text = await this.folder.readText(`_status/attempts/${month}.ndjson`);
    return text ? parseAttempts(text).reverse() : [];
  }

  /** A pending request already covering this scope, if any. */
  pendingFor(scope: RequestScope): PendingRequest | undefined {
    return this.pending.find((p) => sameScope(p.request.scope, scope) || 'all' in p.request.scope);
  }

  async requestRefresh(scope: RequestScope, by: { email?: string; name?: string }, appVersion: string): Promise<PendingRequest> {
    const held = this.pendingFor(scope);
    if (held) return held;
    const request = buildRequest({ scope, now: new Date(), by, appVersion });
    const file = requestFileName(request);
    await this.folder.createRequest(file, request);
    const p = { file, request, cancellable: true };
    this.pending.push(p);
    return p;
  }

  async cancel(p: PendingRequest): Promise<void> {
    await this.folder.deleteRequest(p.file);
    this.pending = this.pending.filter((x) => x.file !== p.file);
  }
}
