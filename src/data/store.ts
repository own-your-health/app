// What the app has read from the records folder, in memory only. Nothing
// read from the folder is written to browser storage or sent anywhere but
// back to Drive.

import { readJson, REQUESTS_DIR, type RecordsFolder } from '../folder';
import { FolderError, parseAttempts, parseHousehold, parseIndex, parseRefused, parseRequest, parseStatus, parseText } from '../model/parse';
import { buildRequest, requestFileName, sameScope } from '../model/requests';
import { macState, sourceViews, type MacState, type SourceView } from '../model/sources';
import { parseMedrecEvents } from '../model/events';
import { held, isHeld, noList, parsePrivate, type HeldWhy, type Privacy } from '../model/private';
import { parseViews, viewOf, type PersonView } from '../model/views';
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

/** Why every person's private items are unknown when views.json itself can't be used. */
const NO_VIEWS = {
  newer_format: 'medrec’s views, which say which items are private, are written by a newer medrec. Update the app.',
  unreadable: 'medrec’s views could not be read, so nothing says which items are private.',
};

/** Holds that end once medrec has written, or the folder answers. */
const MAY_END = new Set<HeldWhy>(['behind', 'arriving', 'unchecked', 'unreadable']);

/** A read that has not ended by then is taken over by the next. */
const STALLED_MS = 120_000;

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
  /** views/views.json could not be read, and why: every person's visits are the app's own grouping, and their private items unknown. */
  viewsError: { kind: 'newer_format' | 'unreadable'; text: string } | null = null;
  /** Each person whose visits are the app's own grouping although medrec wrote events for them, and why. */
  eventsNotes = new Map<string, EventsNote>();
  pending: PendingRequest[] = [];
  done: RefreshRequest[] = [];
  /** Requests medrec refused as invalid, which keep no scope. */
  refused: RefusedRequest[] = [];
  /** Whether `_requests/` exists: the Mac set up refresh for this folder. */
  requestsReady = false;
  loadedAt = 0;
  /** What the records and medrec's views were when read: another read with the same has nothing new to show. */
  snapshot = '';
  /** How many requests this app saw waiting have finished, and how many of those the records were read after. */
  finished = 0;
  private readUpTo = 0;
  /** The files of the requests seen waiting whose finish has not been seen, and whether the last look found neither them nor their answer. */
  private watched = new Map<string, boolean>();
  private reading: Promise<void> | null = null;
  private readingSince = 0;
  private runs = 0;
  /** Whether views.json was there to read. */
  private hasViews = false;
  /** Who has no index.json: nothing is imported for them yet. */
  private absent = new Set<string>();
  private texts = new Map<string, Promise<PersonText | null>>();
  /** Handled requests of the app's own it has tried to remove once. */
  private tidied = new Set<string>();

  constructor(readonly folder: RecordsFolder) {}

  /** Reads household.json, every person's index, the status and the requests. */
  async load(): Promise<void> {
    await this.loadHousehold();
    await Promise.all([this.loadRecords(), this.loadRefreshState()]);
  }

  /** Whether a request this app saw waiting has finished since the records were last read. */
  get owed(): boolean {
    return this.finished > this.readUpTo;
  }

  /**
   * Reads the records again: every index, medrec's events and its private
   * lists, so each person's stay of one moment. Throws, with nothing changed,
   * when the read fails or leaves out something that is here. A read already
   * under way is joined, unless it has stalled; what finished since it began
   * stays owed.
   */
  reload(): Promise<void> {
    const now = Date.now();
    if (this.reading && now - this.readingSince < STALLED_MS) return this.reading;
    const run = this.readAgain((this.runs += 1));
    this.reading = run;
    this.readingSince = now;
    const ended = () => void (this.reading === run && (this.reading = null));
    run.then(ended, ended);
    return run;
  }

  private async readAgain(run: number): Promise<void> {
    const upTo = this.finished;
    this.folder.forget('');
    const next = new Store(this.folder);
    await next.loadHousehold();
    await next.loadRecords();
    // Another read took over from this one, which had stalled.
    if (run !== this.runs) return;
    for (const p of next.household.people) {
      // Someone the household no longer lists is gone; someone it does, with records here, is not without any.
      const error = next.indexErrors.get(p.id) ?? (next.absent.has(p.id) ? 'Their index is not in the folder.' : undefined);
      if (error && this.indexes.get(p.id)?.rev) throw new Error(`${p.name}’s records could not be read: ${error}`);
    }
    if (this.hasViews && !next.hasViews && !next.viewsError) throw new Error('medrec’s views are not in the folder.');
    this.household = next.household;
    this.indexes = next.indexes;
    this.absent = next.absent;
    this.indexErrors = next.indexErrors;
    this.hasViews = next.hasViews;
    this.viewsError = next.viewsError;
    this.eventsNotes = next.eventsNotes;
    this.texts = next.texts;
    this.loadedAt = next.loadedAt;
    this.snapshot = next.snapshot;
    this.readUpTo = upTo;
  }

  private async loadHousehold(): Promise<void> {
    const raw = await readJson(this.folder, 'household.json');
    if (raw === null) throw new FolderError('not_household', 'This folder has no household.json. Choose the records folder medrec writes.');
    this.household = parseHousehold(raw);
  }

  /** Reads every person's index, with medrec's events and private list for each. */
  private async loadRecords(): Promise<void> {
    const [views] = await Promise.all([this.readViews(), this.loadIndexes()]);
    const household = this.folder.md5('household.json');
    // Whoever compares with it says why it could not be read; with no view to compare, nobody does.
    household.catch(() => undefined);
    await Promise.all([this.loadEvents(views, household), this.loadPrivate(views, household)]);
    this.loadedAt = Date.now();
    this.snapshot = JSON.stringify([
      this.household,
      views,
      this.viewsError,
      ...this.household.people.map((p) => {
        const index = this.indexes.get(p.id);
        return [index?.rev, this.indexErrors.get(p.id), this.eventsNotes.get(p.id), index?.privacy?.kind === 'held' ? index.privacy.text : null];
      }),
    ]);
  }

  /** medrec's views.json (0.8.0 and later). A folder without it, or one where it cannot be read, still loads. */
  private async readViews(): Promise<Record<string, unknown> | null> {
    try {
      const raw = await readJson(this.folder, 'views/views.json');
      this.hasViews = raw !== null;
      return raw === null ? null : parseViews(raw);
    } catch (e) {
      const newer = e instanceof FolderError && e.kind === 'newer_format';
      this.viewsError = newer
        ? { kind: 'newer_format', text: 'medrec’s views are written by a newer medrec. Update the app. Until then it groups each person’s visits itself.' }
        : { kind: 'unreadable', text: `medrec’s views could not be read: ${e instanceof Error ? e.message : 'unknown error'} The app groups each person’s visits itself.` };
      return null;
    }
  }

  private async loadIndexes(): Promise<void> {
    await Promise.all(
      this.household.people.map(async (p) => {
        try {
          const raw = await readJson(this.folder, `${p.folder}/index.json`);
          if (raw === null) {
            this.absent.add(p.id);
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
  private async loadEvents(views: Record<string, unknown> | null, household: Promise<string | null | undefined>): Promise<void> {
    if (views === null) return;
    await Promise.all(
      this.household.people.map(async (p) => {
        const index = this.indexes.get(p.id);
        if (!index) return;
        try {
          const view = viewOf(views, p.id, 'events.json');
          if (!view) return;
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
  private async loadPrivate(views: Record<string, unknown> | null, household: Promise<string | null | undefined>): Promise<void> {
    await Promise.all(
      this.household.people.map(async (p) => {
        const index = this.indexes.get(p.id);
        if (index) index.privacy = await this.privacyOf(p, views, household);
      }),
    );
  }

  private async privacyOf(p: Person, views: Record<string, unknown> | null, household: Promise<string | null | undefined>): Promise<Privacy> {
    if (this.viewsError) return held(this.viewsError.kind, NO_VIEWS[this.viewsError.kind]);
    try {
      const view = viewOf(views, p.id, 'private.json');
      if (!view) return noList();
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
    const before = new Map(this.pending.map((p) => [p.file, p]));
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
    const read = await Promise.all(
      pendingFiles.map(async (e) => {
        try {
          const r = parseRequest(await readJson(this.folder, `${REQUESTS_DIR}/${e.name}`));
          return r ? { file: e.name, request: r, cancellable: e.deletable } : null;
        } catch {
          // Still listed, so still waiting, though it did not read this time.
          return before.get(e.name) ?? null;
        }
      }),
    );
    // What the person asked for or cancelled while this was read stands.
    const now = new Set(this.pending.map((p) => p.file));
    const waiting = read.filter((x): x is PendingRequest => x !== null && (now.has(x.file) || !before.has(x.file)));
    const names = new Set(waiting.map((p) => p.file));
    this.pending = [...waiting, ...this.pending.filter((p) => !before.has(p.file) && !names.has(p.file))];
    this.watch(new Set(listed.map((e) => e.name)), doneNames);
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

  /** Whether any of the household's items are off shared screens because no list says which are private. */
  anyHeld(): boolean {
    return [...this.indexes.values()].some(isHeld);
  }

  /** Whether a hold may end by itself soon: medrec is writing, or the read failed. */
  holdMayEnd(): boolean {
    return [...this.indexes.values()].some((i) => isHeld(i) && (i.privacy?.kind !== 'held' || MAY_END.has(i.privacy.why)));
  }

  /** Whether the Mac's answer to a request is still to come, or to be seen. */
  get waiting(): boolean {
    return this.pending.length > 0 || this.watched.size > 0;
  }

  /**
   * Counts the watched requests that finished: the folder has their answer.
   * One gone with no answer, at two looks, was cancelled; at one, its answer
   * may have come between the two listings.
   */
  private watch(listed: Set<string>, done: Set<string>): void {
    for (const [file, gone] of [...this.watched]) {
      if (done.has(file)) this.finished += 1;
      if (done.has(file) || (!listed.has(file) && gone)) this.watched.delete(file);
      else this.watched.set(file, !listed.has(file));
    }
    for (const p of this.pending) this.watched.set(p.file, false);
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
    // A look meanwhile may have listed it already.
    this.pending = [...this.pending.filter((x) => x.file !== file), p];
    this.watched.set(file, false);
    return p;
  }

  async cancel(p: PendingRequest): Promise<void> {
    await this.folder.deleteRequest(p.file);
    this.pending = this.pending.filter((x) => x.file !== p.file);
    this.watched.delete(p.file);
  }
}
