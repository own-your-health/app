// What the app has read from the records folder, in memory only. Nothing
// read from the folder is written to browser storage or sent anywhere but
// back to Drive.

import { readJson, REQUESTS_DIR, Unanswered, type Entry, type RecordsFolder } from '../folder';
import { FolderError, parseAttempts, parseHousehold, parseIndex, parseMark, parseRefused, parseRequest, parseStatus, parseText } from '../model/parse';
import { buildMark, buildRequest, markRecorded, requestFileName, sameScope } from '../model/requests';
import { macState, sourceViews, type MacState, type SourceView } from '../model/sources';
import { parseBills } from '../model/bills';
import { parseMedrecEvents } from '../model/events';
import { atLeast, held, isHeld, noList, parsePrivate, type HeldWhy, type Privacy } from '../model/private';
import { parseCodeNames } from '../model/codeNames';
import { aboutAnother, stillAbout, withoutAbout, type About } from '../model/aboutAnother';
import { parseStanding } from '../model/standing';
import { parseViews, viewOf, type PersonView, type ViewFile } from '../model/views';
import type { AttemptLine, Household, MarkRequest, PaidMark, PendingMark, Person, PersonIndex, PersonText, RefreshRequest, RefreshStatus, RefusedRequest, RequestScope, UnpaidMark } from '../model/types';

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
type ViewState = { kind: 'behind'; than: 'the household' | 'their records' | 'what a newer medrec found' } | { kind: 'arriving' } | { kind: 'unchecked' } | null;

function eventsNote(s: NonNullable<ViewState>): EventsNote {
  if (s.kind === 'unchecked') return { kind: 'unchecked', text: `medrec’s grouping of these visits could not be checked against their records. ${OWN}` };
  if (s.kind === 'arriving') return { kind: 'arriving', text: `medrec is still writing the grouping of these visits. ${OWN}` };
  return { kind: 'behind', text: `medrec’s grouping of these visits is older than ${s.than}. ${OWN}${s.than === 'their records' ? ' medrec writes it again after its next import or refresh.' : ''}` };
}

/** Why a person's bills go by the receipts alone, or their lists by each record's own status: "medrec’s list of what is paid is older than their records." */
function listNote(what: 'paid' | 'current', s: NonNullable<ViewState>): string {
  if (s.kind === 'unchecked') return `medrec’s list of what is ${what} could not be checked against their records.`;
  if (s.kind === 'arriving') return `medrec is still writing its list of what is ${what}.`;
  return `medrec’s list of what is ${what} is older than ${s.than}.`;
}

/** medrec's list of private items, held back with: "medrec’s list of which items are private is older than their records." */
function heldFor(s: NonNullable<ViewState>): Privacy {
  if (s.kind === 'unchecked') return held('unchecked', 'medrec’s list of which items are private could not be checked against their records.');
  if (s.kind === 'arriving') return held('arriving', 'medrec is still writing its list of which items are private.');
  if (s.than === 'what a newer medrec found') return held('older_medrec', 'medrec’s list of which items are private is from an older medrec, without what a newer one found of their providers. It is written again after the next import or refresh of an updated medrec. If this stays, update medrec on every computer that writes this folder.');
  return held('behind', `medrec’s list of which items are private is older than ${s.than}. medrec writes it again after its next import or refresh.`);
}

/** Why every person's private items are unknown when views.json itself can't be used. */
const NO_VIEWS = {
  newer_format: 'medrec’s views, which say which items are private, are written by a newer medrec. Update the app.',
  unreadable: 'medrec’s views could not be read, so nothing says which items are private.',
};

/** The same of everyone's, when views.json itself can't be used. */
const noLists = (what: 'paid' | 'current') => ({
  newer_format: `medrec’s views, which say what is ${what}, are written by a newer medrec. Update the app.`,
  unreadable: `medrec’s views, which say what is ${what}, could not be read.`,
});

/** Holds that end once medrec has written, or the folder answers. */
const MAY_END = new Set<HeldWhy>(['behind', 'older_medrec', 'arriving', 'unchecked', 'unreadable']);

const DONE_DIR = `${REQUESTS_DIR}/done`;

/** A read that has not ended by then is taken over by the next. */
const STALLED_MS = 120_000;

/** How long a payment the Mac recorded is kept for while medrec's list does not show it: what is gone by then was undone. */
const TAKEN_MS = 15 * 60_000;

/**
 * How long a payment taken back is looked for: a pass reads every request when
 * it begins, and records the payments once its imports are done. While an
 * import runs, and shortly after the last, it is looked for longer.
 */
const BACK_MS = 15 * 60_000;
const ENDING_MS = 2 * 60_000;

export interface PendingRequest {
  file: string;
  request: RefreshRequest;
  /** True when this app may cancel it (it made the file). */
  cancellable: boolean;
}

/** The paths of the requests and the answers listed. */
const requestPaths = (entries: Entry[] | null, done: Entry[] | null): string[] => [...(entries ?? []).map((e) => `${REQUESTS_DIR}/${e.name}`), ...(done ?? []).map((e) => `${DONE_DIR}/${e.name}`)];

const isRefresh = (p: PendingRequest | PendingMark): p is PendingRequest => 'scope' in p.request;
const isMark = (p: PendingRequest | PendingMark): p is PendingMark => !isRefresh(p);

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
  /** The payments marked, or undone, that wait for the Mac. */
  private waitingMarks: PendingMark[] = [];
  /** Those the Mac has recorded since the records were read, and when that was seen: each until medrec's list shows it. */
  private taken: { mark: PendingMark; seen: number }[] = [];
  /** Those taken back, when, and whether here: the Mac may have read one before. */
  private back = new Map<string, { mark: PendingMark; at: number; here: boolean }>();
  /** Those the Mac has answered. */
  answeredMarks: MarkRequest[] = [];
  /** Those it refused while the app was open: the answer names only the request. */
  private refusedMarks: MarkRequest[] = [];
  /** Those Drive did not answer and no look has found, by what each asks. */
  private unanswered = new Map<string, MarkRequest>();
  /** The answers the records were read after, or a look has taken in. */
  private answers = new Set<string>();
  /** The requests and answers of the last look. */
  private looked = new Set<string>();
  /** False when this account may only view the folder. */
  mayRequest = true;
  /** The medrec that wrote the views, when views.json reads. */
  medrec: string | undefined;
  /** The medrec that answers requests, when the status reads. */
  get refresher(): string | undefined {
    return this.status.kind === 'ok' ? this.status.status.refresher.medrec_version : undefined;
  }
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
  /** Whether views.json was there to read, in this read or one before. */
  private hasViews = false;
  /** Views, by person and file, that views.json lists and the folder does not give yet. */
  private late = new Set<string>();
  /** Why a person's bills go by the receipts alone although medrec's views list them, by person. */
  billsNotes = new Map<string, string>();
  /** Why a person's conditions, allergies and medicines go by each record's own status although medrec's views list what their sources say, by person. */
  standingNotes = new Map<string, string>();
  /** Who has no index.json: nothing is imported for them yet. */
  private absent = new Set<string>();
  /** The items named as about somebody else, by person: they stay out until a list of the folder's files reads. */
  private named = new Map<string, ReadonlySet<string>>();
  private texts = new Map<string, Promise<PersonText | null>>();
  /** Handled requests of the app's own it has tried to remove once. */
  private tidied = new Set<string>();

  constructor(public folder: RecordsFolder) {}

  /** Reads household.json, every person's index, the status and the requests. */
  async load(): Promise<void> {
    await this.loadStart();
    await Promise.all([this.loadRecords(), this.loadRefreshState()]);
  }

  /** Reads the household, and lists the answers the records are read after: what those did, the records show. */
  private async loadStart(): Promise<void> {
    const [done] = await Promise.all([this.folder.list(DONE_DIR), this.loadHousehold()]);
    this.answers = new Set((done ?? []).map((e) => e.name));
  }

  /** Whether a request this app saw waiting has finished since the records were last read, or they do not show what it did. */
  get owed(): boolean {
    return this.finished > this.readUpTo || this.recorded.length > 0;
  }

  /** The payments the Mac has recorded that medrec's list does not show yet. */
  private get recorded(): { mark: PendingMark; seen: number }[] {
    return this.taken.filter((t) => Date.now() - t.seen < TAKEN_MS);
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
    // Its own view of the folder: a call that hangs, or a read taken over, touches nothing others use.
    const next = new Store(this.folder.fresh());
    next.named = this.named;
    await next.loadStart();
    await next.loadRecords();
    // Another read took over from this one, which had stalled.
    if (run !== this.runs) return;
    for (const p of next.household.people) {
      // Someone the household no longer lists is gone; someone it does, with records here, is not without any.
      const error = next.indexErrors.get(p.id) ?? (next.absent.has(p.id) ? 'Their index is not in the folder.' : undefined);
      if (error && this.indexes.get(p.id)?.rev) throw new Error(`${p.name}’s records could not be read: ${error}`);
    }
    if (this.hasViews && !next.hasViews && !next.viewsError) throw new Error('medrec’s views are not in the folder.');
    // medrec answers a payment's request before it writes the list that shows it: until then the one here stands.
    for (const { mark } of this.recorded) {
      const { person } = (mark.request.paid ?? mark.request.unpaid)!;
      if (this.indexes.get(person)?.bills && !next.indexes.get(person)?.bills) throw new Error(next.billsNotes.get(person) ?? 'medrec’s list of what is paid is not in the folder.');
    }
    this.folder = next.folder;
    this.household = next.household;
    this.indexes = next.indexes;
    this.absent = next.absent;
    this.late = next.late;
    this.billsNotes = next.billsNotes;
    this.standingNotes = next.standingNotes;
    this.indexErrors = next.indexErrors;
    this.hasViews ||= next.hasViews;
    this.named = next.named;
    this.medrec = next.medrec;
    this.viewsError = next.viewsError;
    this.eventsNotes = next.eventsNotes;
    this.texts = next.texts;
    this.loadedAt = next.loadedAt;
    this.snapshot = next.snapshot;
    this.readUpTo = upTo;
    for (const name of next.answers) this.answers.add(name);
    this.taken = this.recorded.filter((t) => !markRecorded(t.mark.request, this.indexes));
  }

  private async loadHousehold(): Promise<void> {
    const raw = await readJson(this.folder, 'household.json');
    if (raw === null) throw new FolderError('not_household', 'This folder has no household.json. Choose the records folder medrec writes.');
    this.household = parseHousehold(raw);
  }

  /** Reads every person's index, with medrec's events and private list for each. */
  private async loadRecords(): Promise<void> {
    const [views] = await Promise.all([this.readViews(), this.loadIndexes()]);
    this.medrec = typeof views?.medrec === 'string' ? views.medrec : undefined;
    const household = this.folder.md5('household.json');
    // Whoever compares with it says why it could not be read; with no view to compare, nobody does.
    household.catch(() => undefined);
    await this.leaveOutAbout(views, household);
    await Promise.all([this.loadEvents(views, household), this.loadPrivate(views, household), this.loadNames(views, household), this.loadBills(views, household)]);
    this.loadedAt = Date.now();
    this.snapshot = JSON.stringify([
      this.household,
      views,
      this.viewsError,
      ...this.household.people.map((p) => {
        const index = this.indexes.get(p.id);
        return [index?.rev, index?.aboutUnsure, this.indexErrors.get(p.id), this.eventsNotes.get(p.id), index?.privacy?.kind === 'held' ? index.privacy.text : null, !!index?.codeNames, !!index?.standing, this.standingNotes.get(p.id), this.billsNotes.get(p.id)];
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

  /** Leaves out what is about somebody else, before anything is made of an index. */
  private async leaveOutAbout(views: Record<string, unknown> | null, household: Promise<string | null | undefined>): Promise<void> {
    const named = new Map<string, ReadonlySet<string>>();
    await Promise.all(
      this.household.people.map(async (p) => {
        const [h, i] = await Promise.all([household, this.folder.md5(`${p.folder}/index.json`)].map((m) => m.catch(() => undefined)));
        const said: About = this.viewsError ? { ids: new Set(), unsure: this.viewsError.kind } : aboutAnother(views, p.id, { household: h, index: i });
        const about = stillAbout(said, this.named.get(p.id) ?? new Set());
        named.set(p.id, about.ids);
        const index = this.indexes.get(p.id);
        if (index && !this.absent.has(p.id)) this.indexes.set(p.id, withoutAbout(index, about));
      }),
    );
    this.named = named;
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
    // Another person's paper (X2) or event (X1) in someone's events is of that person's index, and as private as it says.
    for (const index of this.indexes.values()) {
      if (!index.events) continue;
      const named = new Set(index.events.events.flatMap((e) => [...e.members, ...e.bornDuring].flatMap((x) => x.person ?? [])));
      index.events.others = new Map([...this.indexes].filter(([id]) => id !== index.person && named.has(id)));
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
      return raw === null ? heldFor({ kind: 'arriving' }) : parsePrivate(raw, p.id, this.medrec);
    } catch (e) {
      const why: HeldWhy = e instanceof FolderError && e.kind === 'newer_format' ? 'newer_format' : 'unreadable';
      return held(why, `medrec’s list of which items are private could not be read: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  /**
   * medrec's names for each person's codes (0.9.4 and later) and what is
   * current of theirs by every source's word (0.9.9 and later). Without a file
   * that reads and matches the folder, the sources' words and statuses stand;
   * of the names nothing says so, and standingNotes says why for the second.
   * One that may still come is read for again.
   */
  private async loadNames(views: Record<string, unknown> | null, household: Promise<string | null | undefined>): Promise<void> {
    const err = this.viewsError;
    if (err) for (const p of this.household.people) this.standingNotes.set(p.id, noLists('current')[err.kind]);
    if (views === null) return;
    const read = async (p: Person, file: ViewFile, put: (raw: unknown) => void, note?: (why: string) => void) => {
      try {
        const view = viewOf(views, p.id, file);
        if (!view) return;
        const state = await this.viewState(p, view, household);
        const raw = state ? null : await readJson(this.folder, `views/${p.id}/${view.name}`);
        if (raw === null) {
          this.late.add(`${p.id} ${file}`);
          note?.(listNote('current', state ?? { kind: 'arriving' }));
        } else put(raw);
      } catch (e) {
        // What is refused stays so until medrec writes it again.
        if (!(e instanceof FolderError)) this.late.add(`${p.id} ${file}`);
        note?.(`medrec’s list of what is current could not be read: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    };
    await Promise.all(
      this.household.people.flatMap((p) => {
        const index = this.indexes.get(p.id);
        if (!index) return [];
        return [
          read(p, 'code-names.json', (raw) => (index.codeNames = parseCodeNames(raw, p.id))),
          read(
            p,
            'standing.json',
            (raw) => (index.standing = parseStanding(raw, p.id)),
            (why) => this.standingNotes.set(p.id, why),
          ),
        ];
      }),
    );
  }

  /**
   * What medrec says of each person's bills (0.9.1 and later). Without a list
   * that reads and matches the folder, the receipts alone say what is paid,
   * and billsNotes says why; one that may still come is read for again.
   */
  private async loadBills(views: Record<string, unknown> | null, household: Promise<string | null | undefined>): Promise<void> {
    const err = this.viewsError;
    if (err) for (const p of this.household.people) this.billsNotes.set(p.id, noLists('paid')[err.kind]);
    if (views === null) return;
    await Promise.all(
      this.household.people.map(async (p) => {
        const index = this.indexes.get(p.id);
        if (!index) return;
        try {
          const view = viewOf(views, p.id, 'bills.json');
          if (!view) return;
          const state = await this.viewState(p, view, household);
          const raw = state ? null : await readJson(this.folder, `views/${p.id}/${view.name}`);
          if (raw === null) {
            this.late.add(`${p.id} bills`);
            this.billsNotes.set(p.id, listNote('paid', state ?? { kind: 'arriving' }));
          } else index.bills = parseBills(raw, p.id);
        } catch (e) {
          if (!(e instanceof FolderError)) this.late.add(`${p.id} bills`);
          this.billsNotes.set(p.id, `medrec’s list of what is paid could not be read: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }),
    );
  }

  /** Null when the folder holds the files medrec wrote a person's view from, and the view file it names; else why not. */
  private async viewState(p: Person, view: PersonView, household: Promise<string | null | undefined>): Promise<ViewState> {
    const folderOf = (id: string) => this.household.people.find((x) => x.id === id)?.folder;
    if ([...view.linked.keys()].some((id) => !folderOf(id))) return { kind: 'behind', than: 'the household' };
    const read: [Promise<string | null | undefined>, string | null][] = [
      [household, view.household],
      [this.folder.md5(`${p.folder}/index.json`), view.index],
      [this.folder.md5(`${p.folder}/text.json`), view.text],
    ];
    if (view.overrides !== undefined) read.push([this.folder.md5(`${p.folder}/overrides.json`), view.overrides]);
    if (view.marks !== undefined) read.push([this.folder.md5(`${p.folder}/marks.json`), view.marks]);
    for (const [id, l] of view.linked) {
      const f = folderOf(id)!;
      read.push([this.folder.md5(`${f}/index.json`), l.index], [this.folder.md5(`${f}/text.json`), l.text]);
    }
    // Last, to tell when nothing else differs.
    if (view.providerState !== undefined) read.push([this.folder.md5(`${p.folder}/provider-state.json`), view.providerState]);
    const [file, ...now] = await Promise.all([this.folder.md5(`views/${p.id}/${view.name}`), ...read.map(([m]) => m)]);
    if (now.some((m) => m === undefined) || file === undefined) return { kind: 'unchecked' };
    const differs = now.findIndex((m, i) => m !== read[i]![1]);
    // An update's first pass, not done yet; or medrec before 0.9.7 wrote last, and its next list is behind too.
    if (view.providerState === null && differs === now.length - 1 && !atLeast(this.medrec, [0, 9, 7])) return { kind: 'behind', than: 'what a newer medrec found' };
    if (differs >= 0) return { kind: 'behind', than: 'their records' };
    return file === view.md5 ? null : { kind: 'arriving' };
  }

  /** Reads `_status/status.json` and `_requests/` again. */
  async loadRefreshState(): Promise<void> {
    const before = new Map<string, PendingRequest | PendingMark>([...this.pending, ...this.waitingMarks].map((p) => [p.file, p]));
    this.folder.forget('_status');
    this.folder.forget(REQUESTS_DIR);
    const [statusRaw, [entries, doneEntries], may] = await Promise.all([
      readJson(this.folder, '_status/status.json').catch(() => undefined),
      this.listRequests(),
      this.folder.mayRequest(),
    ]);
    this.mayRequest = may !== false;
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
          const raw = await readJson(this.folder, `${REQUESTS_DIR}/${e.name}`);
          const [scoped, mark] = [parseRequest(raw), parseMark(raw)];
          return scoped ? { file: e.name, request: scoped, cancellable: e.deletable } : mark ? { file: e.name, request: mark, cancellable: e.deletable } : null;
        } catch {
          // Still listed, so still waiting, though it did not read this time.
          return before.get(e.name) ?? null;
        }
      }),
    );
    // What the person asked for or cancelled while this was read stands.
    const now = new Set([...this.pending, ...this.waitingMarks].map((p) => p.file));
    const waiting = read.filter((x) => x !== null).filter((x) => now.has(x.file) || !before.has(x.file));
    const names = new Set(waiting.map((p) => p.file));
    const asked = <T extends { file: string }>(of: T[]) => of.filter((p) => !before.has(p.file) && !names.has(p.file));
    this.pending = [...waiting.filter(isRefresh), ...asked(this.pending)];
    this.waitingMarks = [...waiting.filter(isMark), ...asked(this.waitingMarks)];
    const finished = new Set(this.watch(new Set(listed.map((e) => e.name)), doneNames, before));
    // Only the latest outcomes matter on screen; the names sort by time.
    const doneFiles = (doneEntries ?? [])
      .filter((e) => !e.folder && e.name.endsWith('.json'))
      .map((e) => e.name)
      .sort()
      .slice(-50);
    const done = await Promise.all(doneFiles.map((n) => readJson(this.folder, `${DONE_DIR}/${n}`).catch(() => null)));
    const marks = done.map(parseMark);
    this.done = done.map(parseRequest).filter((x): x is RefreshRequest => x !== null);
    this.answeredMarks = marks.filter((x): x is MarkRequest => x !== null);
    this.refused = done.map(parseRefused).filter((x): x is RefusedRequest => x !== null);
    doneFiles.forEach((file, i) => {
      // One asked for on another device counts as well, when it was answered after the records were read.
      if (done[i] === null || (this.answers.has(file) && !finished.has(file))) return;
      this.answers.add(file);
      const back = this.back.get(file);
      this.back.delete(file);
      const [request, asked] = [marks[i], before.get(file)];
      if (request?.handled?.outcome === 'ok' && !markRecorded(request, this.indexes)) this.taken.push({ mark: { file, request, cancellable: false, taken: true, ...(back?.here ? { late: true } : {}) }, seen: Date.now() });
      const refused = asked && isMark(asked) && this.refused.find((r) => r.id === asked.request.id);
      if (refused) this.refusedMarks.push({ ...asked.request, handled: refused.handled });
    });
    this.answeredMarks.push(...this.refusedMarks);
    this.looked = new Set(requestPaths(entries, doneEntries));
    for (const [asks, r] of this.unanswered) if ([REQUESTS_DIR, DONE_DIR].some((d) => this.looked.has(`${d}/${requestFileName(r)}`))) this.unanswered.delete(asks);
  }

  /** The requests that wait, and the answers. */
  private listRequests(): Promise<[Entry[] | null, Entry[] | null]> {
    return Promise.all([this.folder.list(REQUESTS_DIR), this.folder.list(DONE_DIR)]);
  }

  /** Looks at `_requests/` when it has something the last look did not. */
  private async lookAgain(): Promise<void> {
    this.folder.forget(REQUESTS_DIR);
    if (requestPaths(...(await this.listRequests())).some((p) => !this.looked.has(p))) await this.loadRefreshState();
  }

  /** Whether any of the household's items are off shared screens because no list says which are private. */
  anyHeld(): boolean {
    return [...this.indexes.values()].some(isHeld);
  }

  /** Whether a hold may end by itself soon: medrec is writing, or the read failed. */
  holdMayEnd(): boolean {
    return [...this.indexes.values()].some((i) => isHeld(i) && (i.privacy?.kind !== 'held' || MAY_END.has(i.privacy.why)));
  }

  /** Whether another read may bring something soon: the end of a hold, or a view medrec is writing. */
  mayBring(): boolean {
    return this.holdMayEnd() || this.late.size > 0;
  }

  /** Whether the Mac's answer to a request is still to come, or to be seen. */
  get waiting(): boolean {
    return this.watched.size > 0;
  }

  /** The payments marked, or undone, that the records do not show yet. */
  get marks(): PendingMark[] {
    return [...this.waitingMarks, ...this.recorded.map((t) => t.mark)];
  }

  /**
   * Counts the watched requests that finished: the folder has their answer.
   * One gone with no answer, at two looks, was cancelled; at one, its answer
   * may have come between the two listings. A payment's is looked for until
   * no pass that read it before can still be at work.
   */
  private watch(listed: Set<string>, done: Set<string>, before: ReadonlyMap<string, PendingRequest | PendingMark>): string[] {
    const finished: string[] = [];
    for (const [file, gone] of [...this.watched]) {
      if (done.has(file)) {
        this.finished += 1;
        finished.push(file);
        this.watched.delete(file);
        continue;
      }
      const mark = before.get(file);
      if (mark && isMark(mark) && !listed.has(file) && !this.back.has(file)) this.back.set(file, { mark, at: Date.now(), here: false });
      const back = this.back.get(file);
      if (listed.has(file) || !gone || (back && this.mayBeFiling(back.at))) this.watched.set(file, !listed.has(file));
      else {
        this.watched.delete(file);
        this.back.delete(file);
      }
    }
    for (const p of [...this.pending, ...this.waitingMarks]) this.watched.set(p.file, false);
    return finished;
  }

  /** Whether a pass that began before `at` may still be at work. */
  private mayBeFiling(at: number): boolean {
    const now = Date.now();
    if (now - at < BACK_MS) return true;
    const attempts = this.status.kind === 'ok' ? this.status.status.sources.flatMap((s) => (s.last_attempt ? [s.last_attempt] : [])) : [];
    return attempts.some((a) => a.outcome === 'running' || (!!a.finished_at && now - Date.parse(a.finished_at) < ENDING_MS));
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
    await this.write(file, request);
    const p = { file, request, cancellable: true };
    // A look meanwhile may have listed it already.
    this.pending = [...this.pending.filter((x) => x.file !== file), p];
    return p;
  }

  /**
   * Asks the Mac to mark a bill paid, or to undo a payment marked before. The
   * same asked again is the one that waits. `stands` says whether what it was
   * asked on still holds, once what another device asked meanwhile is seen.
   */
  async requestMark(mark: { paid: PaidMark } | { unpaid: UnpaidMark }, by: { email?: string; name?: string }, appVersion: string, stands = () => true): Promise<PendingMark> {
    const asksOf = (m: { paid?: PaidMark; unpaid?: UnpaidMark }) => JSON.stringify([m.paid ?? null, m.unpaid ?? null]);
    const asks = asksOf(mark);
    const waits = () => this.waitingMarks.find((m) => asksOf(m.request) === asks);
    const held = waits() ?? (await this.lookAgain().then(waits));
    if (held) return held;
    if (!stands()) throw new Error('What is left to pay has changed since this was opened, so nothing was sent. Close this and look at the bill again.');
    const request = this.unanswered.get(asks) ?? buildMark({ mark, now: new Date(), by, appVersion });
    const file = requestFileName(request);
    try {
      await this.write(file, request);
    } catch (e) {
      // The next look settles it; until then the same asked again is this one.
      if (e instanceof Unanswered) this.unanswered.set(asks, request);
      throw e;
    }
    this.unanswered.delete(asks);
    const p = { file, request, cancellable: true };
    this.waitingMarks = [...this.waitingMarks.filter((x) => x.file !== file), p];
    return p;
  }

  /** Writes a request, and watches for its answer; also where Drive did not say whether it is there. */
  private async write(file: string, request: RefreshRequest | MarkRequest): Promise<void> {
    try {
      await this.folder.createRequest(file, request);
    } catch (e) {
      if (e instanceof Unanswered) this.watched.set(file, false);
      throw e;
    }
    this.watched.set(file, false);
  }

  /**
   * Takes a request back; false when the Mac had taken it: for a payment's,
   * also when its answer is there, before or after. A payment's is watched
   * on, as a pass may have read it before.
   */
  async cancel(p: PendingRequest | PendingMark): Promise<boolean> {
    if (!isMark(p)) {
      const taken = !(await this.folder.deleteRequest(p.file));
      this.pending = this.pending.filter((x) => x.file !== p.file);
      this.watched.delete(p.file);
      return !taken;
    }
    const had = (await this.answered(p.file)) ? false : await this.folder.deleteRequest(p.file);
    // Taken back or not when this fails, a pass may have read it: the watch says.
    if (!had || (await this.answered(p.file).catch(() => false))) {
      // Its answer is read at the next look; without one, it was taken back elsewhere.
      this.waitingMarks = this.waitingMarks.map((x) => (x.file === p.file ? { ...x, cancellable: false } : x));
      return false;
    }
    this.waitingMarks = this.waitingMarks.filter((x) => x.file !== p.file);
    this.watched.set(p.file, false);
    this.back.set(p.file, { mark: p, at: Date.now(), here: true });
    return true;
  }

  private async answered(file: string): Promise<boolean> {
    this.folder.forget(DONE_DIR);
    return ((await this.folder.list(DONE_DIR)) ?? []).some((e) => e.name === file);
  }
}
