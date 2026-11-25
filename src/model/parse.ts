// Reading the folder's JSON defensively. The files are the household's own,
// written by medrec, but a person can edit them in Drive and an older or
// newer medrec writes other fields, so each reader checks the shape it
// relies on and drops what it cannot use instead of failing the whole view.

import {
  ATTEMPT_SCHEMA,
  HOUSEHOLD_FORMAT,
  HOUSEHOLD_SCHEMA,
  INDEX_SCHEMA,
  REQUEST_SCHEMA,
  STATUS_FORMAT,
  STATUS_SCHEMA,
  TEXT_SCHEMA,
  type AttemptLine,
  type Household,
  type ImagingStudy,
  type ImportRun,
  type MarkRequest,
  type MedDocument,
  type MedRecord,
  type Person,
  type PersonIndex,
  type PersonText,
  type RefreshRequest,
  type RefusedRequest,
  type RefreshStatus,
  type Source,
  type SourceStatus,
  type SourceWord,
} from './types';
import { firstNames } from './people';

export class FolderError extends Error {
  constructor(
    readonly kind: 'not_household' | 'newer_format' | 'malformed',
    message: string,
  ) {
    super(message);
    this.name = 'FolderError';
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function strArr(v: unknown): string[] {
  return arr(v).filter(isStr);
}

/** `household.json`, refused when it is not one or is a newer layout. */
export function parseHousehold(json: unknown): Household {
  if (!isObject(json) || json.schema !== HOUSEHOLD_SCHEMA) {
    throw new FolderError('not_household', 'This folder has no medrec household.json.');
  }
  if (!isNum(json.format)) {
    throw new FolderError('malformed', 'household.json has no format number.');
  }
  if (json.format > HOUSEHOLD_FORMAT) {
    throw new FolderError(
      'newer_format',
      `This records folder uses layout ${json.format}, newer than this app reads (${HOUSEHOLD_FORMAT}). Update the app.`,
    );
  }
  const people: Person[] = arr(json.people)
    .filter(isObject)
    .filter((p) => isStr(p.id) && isStr(p.name) && isStr(p.folder))
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      folder: p.folder as string,
      birth_date: isStr(p.birth_date) ? p.birth_date : undefined,
      adult: p.adult === true,
      guardians: strArr(p.guardians),
      aliases: strArr(p.aliases),
      links: isObject(p.links)
        ? {
            huishouden_health_person: isStr(p.links.huishouden_health_person)
              ? p.links.huishouden_health_person
              : undefined,
            baby_profile: isStr(p.links.baby_profile) ? p.links.baby_profile : undefined,
          }
        : undefined,
    }));
  firstNames(people).forEach((short, i) => (people[i]!.short = short));
  const sources: Source[] = arr(json.sources)
    .filter(isObject)
    .filter((s) => isStr(s.id) && isStr(s.person) && isStr(s.kind))
    .map((s) => s as unknown as Source);
  return {
    schema: json.schema,
    format: json.format,
    folder_id: isStr(json.folder_id) ? json.folder_id : '',
    rev: isNum(json.rev) ? json.rev : 0,
    created_at: isStr(json.created_at) ? json.created_at : undefined,
    people,
    organizations: arr(json.organizations)
      .filter(isObject)
      .filter((o) => isStr(o.id) && isStr(o.name))
      .map((o) => o as unknown as Household['organizations'][number]),
    sources,
  };
}

function isProvenance(p: unknown): boolean {
  return isObject(p) && isObject(p.source) && isStr(p.method);
}

/** What each source says of an item, where else a paper came from, and what it is nearly a copy of: what reads of them. */
function said(x: Record<string, unknown>): { words?: SourceWord[]; also_from?: unknown[]; near_duplicates?: unknown[] } {
  const { words, also_from, near_duplicates, ...rest } = x;
  const word = (w: Record<string, unknown>): SourceWord => Object.fromEntries((['raw_path', 'status', 'verification', 'read'] as const).flatMap((k) => (isStr(w[k]) ? [[k, w[k]]] : [])));
  return {
    ...rest,
    ...(Array.isArray(words) ? { words: words.filter(isObject).map(word) } : {}),
    ...(Array.isArray(also_from) ? { also_from: also_from.filter(isProvenance) } : {}),
    ...(Array.isArray(near_duplicates) ? { near_duplicates: near_duplicates.filter((n) => isObject(n) && isStr(n.document)) } : {}),
  };
}

/** A person's `index.json`; entries missing what the views rely on are dropped. */
export function parseIndex(json: unknown, personId: string): PersonIndex {
  if (!isObject(json) || json.schema !== INDEX_SCHEMA) {
    throw new FolderError('malformed', 'index.json is not a medrec index.');
  }
  const documents = arr(json.documents)
    .filter(isObject)
    .filter((d) => isStr(d.id) && isStr(d.path) && isProvenance(d.provenance))
    .map((d) => said(d) as unknown as MedDocument);
  const records = arr(json.records)
    .filter(isObject)
    .filter((r) => isStr(r.id) && isStr(r.kind))
    .map(
      (r) =>
        ({
          ...said(r),
          display: isStr(r.display) ? r.display : '',
          fields: isObject(r.fields) ? r.fields : {},
          documents: strArr(r.documents),
          provenance: arr(r.provenance).filter(isProvenance),
        }) as unknown as MedRecord,
    );
  const studies = arr(json.studies)
    .filter(isObject)
    .filter((s) => isStr(s.id) && isStr(s.path))
    .map(
      (s) =>
        ({
          ...s,
          modalities: strArr(s.modalities),
          series: arr(s.series).filter(isObject),
          provenance: arr(s.provenance).filter(isProvenance),
        }) as unknown as ImagingStudy,
    );
  const imports = arr(json.imports)
    .filter(isObject)
    .filter((i) => isStr(i.id) && isStr(i.cli) && isStr(i.imported_at))
    .map((i) => i as unknown as ImportRun);
  return {
    schema: json.schema,
    person: isStr(json.person) ? json.person : personId,
    rev: isNum(json.rev) ? json.rev : 0,
    documents,
    records,
    studies,
    imports,
  };
}

export function parseText(json: unknown): PersonText | null {
  if (!isObject(json) || json.schema !== TEXT_SCHEMA || !isObject(json.texts)) return null;
  const texts: Record<string, string> = {};
  for (const [k, v] of Object.entries(json.texts)) if (isStr(v)) texts[k] = v;
  return { schema: json.schema, person: isStr(json.person) ? json.person : '', texts };
}

export type StatusRead =
  | { kind: 'ok'; status: RefreshStatus }
  | { kind: 'newer_format'; format: number }
  | { kind: 'malformed' };

/** `_status/status.json`. */
export function parseStatus(json: unknown): StatusRead {
  if (!isObject(json) || json.schema !== STATUS_SCHEMA || !isNum(json.format)) {
    return { kind: 'malformed' };
  }
  if (json.format > STATUS_FORMAT) return { kind: 'newer_format', format: json.format };
  const r = isObject(json.refresher) ? json.refresher : {};
  const sources = arr(json.sources)
    .filter(isObject)
    .filter((s) => isStr(s.source) && isStr(s.person))
    .map((s) => ({ ...s, auto: s.auto === true }) as unknown as SourceStatus);
  return {
    kind: 'ok',
    status: {
      schema: json.schema,
      format: json.format,
      updated_at: isStr(json.updated_at) ? json.updated_at : '',
      refresher: {
        medrec_version: isStr(r.medrec_version) ? r.medrec_version : undefined,
        last_pass_at: isStr(r.last_pass_at) ? r.last_pass_at : undefined,
        next_pass_at: isStr(r.next_pass_at) ? r.next_pass_at : undefined,
        pass_every_secs: isNum(r.pass_every_secs) ? r.pass_every_secs : 300,
        heartbeat_every_secs: isNum(r.heartbeat_every_secs) ? r.heartbeat_every_secs : 3600,
      },
      sources,
    },
  };
}

/** `_status/attempts/<YYYY-MM>.ndjson`: one attempt per line; bad lines are skipped. */
export function parseAttempts(text: string): AttemptLine[] {
  const out: AttemptLine[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let v: unknown;
    try {
      v = JSON.parse(t);
    } catch {
      continue;
    }
    if (isObject(v) && v.schema === ATTEMPT_SCHEMA && isStr(v.source) && isStr(v.started_at)) {
      out.push(v as unknown as AttemptLine);
    }
  }
  return out;
}

function isScope(v: unknown): boolean {
  if (!isObject(v)) return false;
  return v.all === true || isStr(v.person) || isStr(v.source);
}

/** A request file from `_requests/` or `_requests/done/`. */
export function parseRequest(json: unknown): RefreshRequest | null {
  if (!isObject(json) || json.schema !== REQUEST_SCHEMA || !isStr(json.id)) return null;
  if (!isStr(json.requested_at) || !isScope(json.scope)) return null;
  return json as unknown as RefreshRequest;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

function isPaid(v: unknown): boolean {
  if (!isObject(v) || !isStr(v.person) || !isStr(v.document) || !isStr(v.on) || !DAY.test(v.on)) return false;
  const [amount, currency] = isObject(v.amount) ? [v.amount.amount, v.amount.currency] : [v.amount, 'USD'];
  return isStr(amount) && AMOUNT.test(amount) && isStr(currency);
}

/** A request to mark a bill paid, or to undo it, from `_requests/` or `_requests/done/`. Null for any other. */
export function parseMark(json: unknown): MarkRequest | null {
  if (!isObject(json) || json.schema !== REQUEST_SCHEMA || !isStr(json.id) || !isStr(json.requested_at) || json.scope !== undefined) return null;
  const { paid, unpaid } = json;
  const one = paid !== undefined ? unpaid === undefined && isPaid(paid) : isObject(unpaid) && isStr(unpaid.person) && isStr(unpaid.payment);
  return one ? (json as unknown as MarkRequest) : null;
}

/** A `done/` file medrec refused, which keeps no scope and maybe no id. */
export function parseRefused(json: unknown): RefusedRequest | null {
  if (!isObject(json) || json.schema !== REQUEST_SCHEMA || !isObject(json.handled)) return null;
  if (json.handled.outcome !== 'invalid' || isScope(json.scope)) return null;
  return {
    schema: json.schema,
    id: isStr(json.id) ? json.id : null,
    received: isObject(json.received) ? (json.received as RefusedRequest['received']) : undefined,
    handled: json.handled as unknown as RefusedRequest['handled'],
  };
}
