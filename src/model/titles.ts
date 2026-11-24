// What every list, search hit and page heading calls a record.

import { claimTitle } from './claims';
import { resultName } from './labtests';
import { KIND_LABELS, str } from './records';
import type { MedRecord } from './types';
import { plainWords } from './words';

/** A claim by its services, a result by its plain name, the rest by their names, else their kind. */
export function recordTitle(r: MedRecord): string {
  if (r.kind === 'claim') return claimTitle(r);
  if (r.kind === 'result') return resultName(r);
  return r.display || r.code?.display || KIND_LABELS[r.kind] || r.kind;
}

/** A portal visit as a link names it: its own name in plain words, else its reason, never its billing descriptor. */
export function visitTitle(v: MedRecord): string {
  return plainWords(recordTitle(v)) ?? plainWords(str(v.fields.reason)) ?? 'The portal’s record of the visit';
}
