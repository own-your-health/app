// What the app has read from the records folder, in memory only. Nothing
// read from the folder is written to browser storage or sent anywhere but
// back to Drive.

import { readJson, REQUESTS_DIR, type RecordsFolder } from '../folder';
import { FolderError, parseAttempts, parseHousehold, parseIndex, parseRefused, parseRequest, parseStatus, parseText } from '../model/parse';
import { buildRequest, requestFileName, sameScope } from '../model/requests';
import { macState, sourceViews, type MacState, type SourceView } from '../model/sources';
import { parseMedrecEvents } from '../model/events';
import { held, noList, parsePrivate, type HeldWhy, type Privacy } from '../model/private';
import { viewOf, type PersonView } from '../model/views';
import type { AttemptLine, Household, Person, PersonIndex, PersonText, RefreshRequest, RefreshStatus, RefusedRequest, RequestScope } from '../model/types';

export type StatusRead =
  | { kind: 'missing' }
  | { kind: 'newer_format'; format: number }
  | { kind: 'malformed' }
  | { kind: 'ok'; status: RefreshStatus };

/**
 * Why a person's visits are the app's own grouping although medrec's views
 * name events for them. `behind`: written from other files than the folder
 * holds now; `arriving`: the pass that wrote views.json is still uploading;
 * `unchecked`: the folder gave no MD5 to compare.
 */
export interface EventsNote {
  kind: 'behind' | 'arriving' | 'unchecked' | 'newer_format' | 'unreadable';
  text: string;
}

const OWN = 'The app groups them itself.';

/** Why a view medrec wrote for a person is not one to read now; null when it is. */
type ViewState = { kind: 'behind'; than: 'the household' | 'their records' } | { kind: 'arriving' } | { kind: 'unchecked' } | null;

function eventsNote(s: NonNullable<ViewState>): EventsNote {
  if (s.kind === 'unchecked') return { kind: 'unchecked', text: `medrec’s grouping of these visits could not be checked against their records. ${OWN}` };
  if (s.kind === 'arriving') return { kind: 'arriving', text: `medrec is still writing the grouping of these visits. ${OWN}` };
  return { kind: 'behind', text: `medrec’s grouping of these visits is older than ${s.than}. ${OWN}${s.than === 'their records' ? ' medrec writes it again after its next import or refresh.' : ''}` };
}

/** medrec's list of private items, held back with: "medrec’s list of which items are private is older than their records." */
function heldFor(s: NonNullable<ViewState>): Privacy {
  if (s.kind === 'unchecked') return held('unchecked', 'medrec’s list of which items are private could not be checked against their records.');
  if (s.kind === 'arriving') return held('arriving', 'medrec is still writing its list of which items are private.');
  return held('behind', `medrec’s list of which items are private is older than ${s.than}. medrec writes it again after its next import or refresh.`);
}

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
  /** views/views.json could not be read: every person's visits are the app's own grouping. */
  viewsError: string | null = null;
  /** Each person whose visits are the app's own grouping although medrec wrote events for them, and why. */
  eventsNotes = new Map<string, EventsNote>();
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
    const [views] = await Promise.all([this.readViews(), this.loadIndexes(), this.loadRefreshState()]);
    const household = this.folder.md5('household.json');
    // Whoever compares with it says why it could not be read; with no view to compare, nobody does.
    household.catch(() => undefined);
    await Promise.all([this.loadEvents(views, household), this.loadPrivate(views, household)]);
    this.loadedAt = Date.now();
  }

  /** medrec's views.json (0.8.0 and later). A folder without it, or one where it cannot be read, still loads. */
  private async readViews(): Promise<unknown> {
    try {
      return await readJson(this.folder, 'views/views.json');
    } catch (e) {
      this.viewsError = `medrec’s views could not be read (${e instanceof Error ? e.message : 'unknown error'}). The app groups each person’s visits itself.`;
      return null;
    }
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

  /**
   * medrec's events (0.9.0 and later), attached to each index they were
   * written from. Events written from other files than the folder holds now
   * (an import whose views have not reached Drive yet, say) would leave the
   * newer records out, so that person's visits stay the app's own grouping,
   * and eventsNotes says why.
   */
  private async loadEvents(views: unknown, household: Promise<string | null | undefined>): Promise<void> {
    if (views === null) return;
    await Promise.all(
      this.household.people.map(async (p) => {
        const index = this.indexes.get(p.id);
        const view = viewOf(views, p.id, 'events.json');
        if (!index || !view) return;
        try {
          const state = await this.viewState(p, view, household);
          if (state) return void this.eventsNotes.set(p.id, eventsNote(state));
          const raw = await readJson(this.folder, `views/${p.id}/${view.name}`);
          if (raw === null) return void this.eventsNotes.set(p.id, eventsNote({ kind: 'arriving' }));
          index.events = parseMedrecEvents(raw, p.id);
          this.eventsNotes.delete(p.id);
        } catch (e) {
          const newer = e instanceof FolderError && e.kind === 'newer_format';
          this.eventsNotes.set(p.id, { kind: newer ? 'newer_format' : 'unreadable', text: `medrec’s grouping of these visits could not be read: ${e instanceof Error ? e.message : 'unknown error'} ${OWN}` });
        }
      }),
    );
    // Another person's paper in someone's events (X2) comes from that person's index.
    for (const index of this.indexes.values()) {
      for (const m of index.events?.events.flatMap((e) => e.members) ?? []) {
        const doc = m.person && m.document ? this.indexes.get(m.person)?.documents.find((d) => d.id === m.document) : undefined;
        if (doc) index.events!.papers.set(doc.id, { person: m.person!, doc });
      }
    }
  }

  /**
   * medrec's list of each person's private items (0.9.1 and later), attached
   * to the index it was written from. Every index gets an answer: without a
   * list that reads and matches the folder, all of that person's items are
   * held back from shared screens, and it says why.
   */
  private async loadPrivate(views: unknown, household: Promise<string | null | undefined>): Promise<void> {
    await Promise.all(
      this.household.people.map(async (p) => {
        const index = this.indexes.get(p.id);
        if (index) index.privacy = await this.privacyOf(p, views, household);
      }),
    );
  }

  private async privacyOf(p: Person, views: unknown, household: Promise<string | null | undefined>): Promise<Privacy> {
    if (views === null && this.viewsError) return held('unreadable', 'medrec’s views could not be read, so nothing says which items are private.');
    const view = viewOf(views, p.id, 'private.json');
    if (!view) return noList();
    try {
      const state = await this.viewState(p, view, household);
      if (state) return heldFor(state);
      const raw = await readJson(this.folder, `views/${p.id}/${view.name}`);
      return raw === null ? heldFor({ kind: 'arriving' }) : parsePrivate(raw, p.id);
    } catch (e) {
      const why: HeldWhy = e instanceof FolderError && e.kind === 'newer_format' ? 'newer_format' : 'unreadable';
      return held(why, `medrec’s list of which items are private could not be read: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  /** Null when the folder holds the files medrec wrote a person's view from, and the view file it names; else why not. */
  private async viewState(p: Person, view: PersonView, household: Promise<string | null | undefined>): Promise<ViewState> {
    const folderOf = (id: string) => this.household.people.find((x) => x.id === id)?.folder;
    if ([...view.linked.keys()].some((id) => !folderOf(id))) return { kind: 'behind', than: 'the household' };
    const read: [Promise<string | null | undefined>, string | null][] = [
      [household, view.household],
      [this.folder.md5(`${p.folder}/index.json`), view.index],
      [this.folder.md5(`${p.folder}/text.json`), view.text],
      [this.folder.md5(`${p.folder}/overrides.json`), view.overrides],
    ];
    if (view.marks !== undefined) read.push([this.folder.md5(`${p.folder}/marks.json`), view.marks]);
    for (const [id, l] of view.linked) {
      const f = folderOf(id)!;
      read.push([this.folder.md5(`${f}/index.json`), l.index], [this.folder.md5(`${f}/text.json`), l.text]);
    }
    const [file, ...now] = await Promise.all([this.folder.md5(`views/${p.id}/${view.name}`), ...read.map(([m]) => m)]);
    if (now.some((m) => m === undefined) || file === undefined) return { kind: 'unchecked' };
    if (now.some((m, i) => m !== read[i]![1])) return { kind: 'behind', than: 'their records' };
    return file === view.md5 ? null : { kind: 'arriving' };
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
