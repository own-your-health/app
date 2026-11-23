// What every list, search hit and page heading calls a record.

import { claimTitle } from './claims';
import { resultName } from './labtests';
import { KIND_LABELS } from './records';
import type { MedRecord } from './types';

/** A claim by its services, a result by its plain name, the rest by their names, else their kind. */
export function recordTitle(r: MedRecord): string {
  if (r.kind === 'claim') return claimTitle(r);
  if (r.kind === 'result') return resultName(r);
  return r.display || r.code?.display || KIND_LABELS[r.kind] || r.kind;
}
