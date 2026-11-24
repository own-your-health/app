// Each test's latest result, read from the index's merged records (medrec
// has already merged each record across its sources, by kind, code and
// date): out of range first, then newest.

import { isOutOfRange, resultFlag, type ResultFlag } from './flags';
import { resultSeries, type ResultPoint, type ResultSeries } from './records';
import type { PersonIndex } from './types';

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
