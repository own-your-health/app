// What every list, search hit and page heading calls a record.

import { claimTitle } from './claims';
import { resultName } from './labtests';
import { KIND_LABELS, str } from './records';
import type { MedRecord } from './types';
import { plainWords } from './words';

/** A claim by its services, a result by its plain name, a visit in plain words, the rest by their names, else their kind. */
export function recordTitle(r: MedRecord): string {
  if (r.kind === 'claim') return claimTitle(r);
  if (r.kind === 'result') return resultName(r);
  const kind = KIND_LABELS[r.kind] || r.kind;
  return r.kind === 'encounter' ? (visitName(r) ?? kind) : ownName(r) || kind;
}

const ownName = (r: MedRecord): string | undefined => r.display || r.code?.display;

/** A portal visit's own name, else its reason, never its billing descriptor. */
const visitName = (v: MedRecord): string | undefined => plainWords(ownName(v)) ?? plainWords(str(v.fields.reason));

/** A portal visit as a link of its event names it, where "Visit" would not say which. */
export function visitTitle(v: MedRecord): string {
  return visitName(v) ?? 'The portal’s record of the visit';
}
