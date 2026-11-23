// The records folder's files, as medrec writes them (medrec-cli
// docs/data-contract.md). Only the fields the app reads are typed; every
// object keeps the rest, which the Inspect view shows as it is.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const HOUSEHOLD_SCHEMA = 'medrec-household/v1';
export const INDEX_SCHEMA = 'medrec-index/v1';
export const TEXT_SCHEMA = 'medrec-text/v1';
export const STATUS_SCHEMA = 'medrec-status/v1';
export const ATTEMPT_SCHEMA = 'medrec-attempt/v1';
export const REQUEST_SCHEMA = 'medrec-request/v1';

/** The newest `household.json` layout this app reads. A larger one is refused. */
export const HOUSEHOLD_FORMAT = 1;
/** The newest `_status/status.json` layout this app reads. */
export const STATUS_FORMAT = 1;

export interface Household {
  schema: string;
  format: number;
  folder_id: string;
  rev: number;
  created_at?: string;
  people: Person[];
  organizations: Organization[];
  sources: Source[];
}

export interface Person {
  id: string;
  name: string;
  folder: string;
  birth_date?: string;
  adult?: boolean;
  guardians?: string[];
  aliases?: string[];
  links?: { huishouden_health_person?: string; baby_profile?: string };
}

export interface Organization {
  id: string;
  name: string;
  aliases?: string[];
  fhir_base?: string;
}

export interface Source {
  id: string;
  kind: string;
  person: string;
  cli?: string;
  organization?: string;
  organization_name?: string;
  fhir_base?: string;
  patient_id?: string;
  patient_label?: string;
  last_pull?: string;
}

export interface Code {
  system?: string;
  code?: string;
  display?: string;
}

export interface Provenance {
  source: {
    kind: string;
    cli?: string;
    cli_version?: string;
    organization_id?: string;
    fhir_base?: string;
  };
  method: string;
  source_resource?: { type: string; id: string; version_id?: string; last_updated?: string };
  fetched_at?: string;
  filed_at: string;
  raw_path?: string;
  classified_by?: string;
  derived_from?: { document_id: string; rule_id: string };
  filed_by: string;
  [extra: string]: Json | undefined;
}

export interface Amount {
  amount: string;
  currency: string;
}

export interface Statement {
  statement_date?: string;
  amount_due?: Amount;
  due_date?: string;
  account?: string;
}

export interface MedDocument {
  id: string;
  path: string;
  sha256: string;
  md5: string;
  size: number;
  media_type: string;
  pages?: number;
  original_name?: string;
  title?: string;
  doc_type?: string;
  loinc?: string;
  date?: string;
  organization?: string;
  filed_at: string;
  origin?: { kind: string; name?: string; action: string };
  text?: { chars: number; engines?: string[]; ocr_pages?: number; note?: string };
  statement?: Statement;
  same_statement_as?: string;
  near_duplicates?: { document: string; similarity: number }[];
  provenance: Provenance;
}

export type RecordKind =
  | 'encounter'
  | 'result'
  | 'report'
  | 'condition'
  | 'medication'
  | 'allergy'
  | 'immunization'
  | 'procedure'
  | 'coverage'
  | 'claim';

export interface MedRecord {
  id: string;
  kind: RecordKind | string;
  key: string;
  date?: string;
  code?: Code;
  display: string;
  status?: string;
  fields: JsonObject;
  documents: string[];
  provenance: Provenance[];
}

export interface ImagingSeries {
  uid: string;
  number?: number;
  modality?: string;
  description?: string;
  instances: Record<string, string>;
}

export interface ImagingStudy {
  id: string;
  study_uid: string;
  path: string;
  date?: string;
  modalities: string[];
  body_part?: string;
  description?: string;
  facility?: string;
  accession?: string;
  referring?: string;
  series: ImagingSeries[];
  instances: number;
  size: number;
  report?: string;
  filed_at: string;
  provenance: Provenance[];
}

export interface ImportRun {
  id: string;
  source_dir: string;
  cli: string;
  cli_version: string;
  organization: string;
  patient_id: string;
  pulled_at: string;
  imported_at: string;
  counts: Record<string, number>;
  skipped?: JsonObject[];
  records_added: number;
  records_updated: number;
  records_unchanged: number;
  records_older?: number;
  resources_written: number;
  resources_unchanged: number;
  documents_added: number;
}

export interface PersonIndex {
  schema: string;
  person: string;
  rev: number;
  documents: MedDocument[];
  records: MedRecord[];
  studies: ImagingStudy[];
  imports: ImportRun[];
}

export interface PersonText {
  schema: string;
  person: string;
  texts: Record<string, string>;
}

// ---- _status/ (medrec-status/v1), written only by `medrec refresh` ----

/** medrec's reading of the provider's `auth status`. A person is needed when `needs_person` is set. */
export type SignInState = 'ok' | 'expiring' | 'expired' | 'signed_out' | 'not_needed' | 'unknown';

export type AttemptOutcome =
  | 'running'
  | 'ok'
  | 'failed'
  | 'needs_person'
  | 'skipped_interval'
  | 'skipped_paused';

export interface ErrorInfo {
  code?: string;
  message?: string;
  remedy?: string;
  /**
   * The provider tool's own words, when its sign-in ended (medrec 0.7.0 and
   * later). `message` and `remedy` are then medrec's, and the remedy runs
   * `medrec refresh sign-in`; these words name the tool's own sign-in.
   */
  provider_message?: string;
}

export interface ImportCounts {
  records_added?: number;
  records_updated?: number;
  records_unchanged?: number;
  records_older?: number;
  resources_written?: number;
  resources_unchanged?: number;
  documents_added?: number;
  documents_duplicate?: number;
  documents_unchanged?: number;
  documents_same_statement?: number;
  [extra: string]: number | undefined;
}

export interface Attempt {
  attempt: string;
  started_at: string;
  finished_at?: string | null;
  trigger: 'schedule' | 'request' | 'manual' | string;
  requests?: string[];
  outcome: AttemptOutcome | string;
  exit_code?: number | null;
  error?: ErrorInfo | null;
  import?: string | null;
}

export interface SourceStatus {
  source: string;
  person: string;
  cli?: string;
  organization?: string;
  auto: boolean;
  /** `failed` attempts in a row since the last `ok`; medrec backs off after each. */
  failures?: number;
  paused?: { reason: 'consent' | 'user' | string; note?: string; since?: string } | null;
  min_interval_secs?: number;
  next_run_at?: string | null;
  sign_in?: {
    state: SignInState | string;
    expires_at?: string | null;
    checked_at?: string;
    /**
     * `false`: a member-site session that ends within hours and nothing
     * renews, so the source loads only soon after someone signs in.
     * Missing: unknown, read as renewing.
     */
    renews?: boolean | null;
    /** About how long a fresh sign-in lasts, where known. */
    lasts_secs?: number | null;
    needs_person?: { reason: 'sign_in' | 'keychain' | string; since?: string; command: string } | null;
  };
  last_attempt?: Attempt | null;
  last_success?: {
    attempt: string;
    finished_at: string;
    import?: string;
    counts?: ImportCounts;
    withheld_types?: string[];
  } | null;
}

export interface RefreshStatus {
  schema: string;
  format: number;
  updated_at: string;
  refresher: {
    medrec_version?: string;
    /** The one machine that refreshes this folder (`h_…`). */
    machine?: string;
    last_pass_at?: string;
    next_pass_at?: string;
    pass_every_secs: number;
    heartbeat_every_secs: number;
  };
  sources: SourceStatus[];
}

export interface AttemptLine extends Attempt {
  schema: string;
  source: string;
  person: string;
  cli?: string;
  organization?: string;
  counts?: ImportCounts;
}

// ---- _requests/ (medrec-request/v1): the only files the app writes ----

export type RequestScope = { all: true } | { person: string } | { source: string };

export interface RefreshRequest {
  schema: string;
  id: string;
  requested_at: string;
  requested_by: { email?: string; name?: string };
  scope: RequestScope;
  app: { name: string; version: string };
  handled?: Handled;
}

/** A request medrec refused: it keeps only what it can show safely. */
export interface RefusedRequest {
  schema: string;
  id: string | null;
  received?: { bytes?: number; sha256?: string };
  handled: Handled;
}

export interface Handled {
    picked_up_at?: string;
    finished_at?: string;
    outcome: 'ok' | 'partial' | 'needs_person' | 'failed' | 'skipped' | 'invalid' | string;
    sources?: { source: string; outcome: string; attempt?: string | null; next_allowed_at?: string }[];
    message?: string;
    by?: string;
}
