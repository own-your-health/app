// A person's overview: what is going on now, read from the index's merged
// records (medrec has already merged each record across its sources, by
// kind, code and date). Each list here is one card on the person's first
// screen; the sections show everything.

import { isOutOfRange, resultFlag, type ResultFlag } from './flags';
import { isDoseGiven, resultSeries, sortByDateDesc, type ResultPoint, type ResultSeries } from './records';
import type { MedDocument, MedRecord, PersonIndex } from './types';

export interface LatestResult {
  series: ResultSeries;
  latest: ResultPoint;
  flag?: ResultFlag;
}

/** Each test's newest result: critical first, then other out-of-range ones, then the rest, newest first within each. */
export function latestResults(index: PersonIndex): LatestResult[] {
  const rank = (x: LatestResult) => (x.flag?.critical ? 0 : isOutOfRange(x.flag) ? 1 : 2);
  return resultSeries(index)
    .filter((s): s is ResultSeries & { latest: ResultPoint } => !!s.latest)
    .map((s) => ({ series: s, latest: s.latest, flag: resultFlag(s.latest) }))
    .sort((a, b) => rank(a) - rank(b) || (b.latest.date ?? '').localeCompare(a.latest.date ?? '') || a.series.name.localeCompare(b.series.name));
}

// ---- Immunizations and visits ----

/** Doses given, newest first. */
export function immunizationsGiven(index: PersonIndex): MedRecord[] {
  return sortByDateDesc(index.records.filter((r) => r.kind === 'immunization' && isDoseGiven(r)));
}


// ---- New in the latest loads ----

export interface NewInLoad {
  cli: string;
  organization: string;
  at: string;
  records: MedRecord[];
  documents: MedDocument[];
}

/** How far back a load still counts as recent. */
export const RECENT_LOAD_MS = 30 * 86_400_000;

/**
 * What each source's newest import added, within RECENT_LOAD_MS. medrec
 * stamps a record's first provenance, and a document, with the import's
 * own `imported_at`, so a record first filed at that moment is new in it.
 * Newest load first; a load that added nothing is left out.
 */
export function newInLatestLoads(index: PersonIndex, now: Date): NewInLoad[] {
  const newest = new Map<string, PersonIndex['imports'][number]>();
  for (const run of index.imports) {
    const k = `${run.cli}|${run.organization}`;
    const prev = newest.get(k);
    if (!prev || run.imported_at > prev.imported_at) newest.set(k, run);
  }
  const firstFiled = (r: MedRecord) => r.provenance.map((p) => p.filed_at).sort()[0];
  const fromRun = (orgs: (string | undefined)[], run: PersonIndex['imports'][number]) => orgs.includes(run.organization);
  const out: NewInLoad[] = [];
  for (const run of newest.values()) {
    const age = now.getTime() - Date.parse(run.imported_at);
    if (age < 0 || age > RECENT_LOAD_MS) continue;
    const records = sortByDateDesc(
      index.records.filter((r) => firstFiled(r) === run.imported_at && fromRun(r.provenance.filter((p) => p.filed_at === run.imported_at).map((p) => p.source.organization_id), run)),
    );
    const documents = sortByDateDesc(index.documents.filter((d) => d.filed_at === run.imported_at && d.provenance.source.organization_id === run.organization));
    if (records.length || documents.length) out.push({ cli: run.cli, organization: run.organization, at: run.imported_at, records, documents });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
