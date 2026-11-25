// The ICD-10-CM titles of the codes a person's conditions and claim diagnoses
// use: medrec's views/<person id>/code-names.json (`medrec-code-names/v1`,
// medrec 0.9.4 and later), from the published table. A name only labels an
// item that is shown anyway: it comes first, the source's own words stay
// beside it or in Details, and search, sorting and grouping use the source's
// words alone. Without a file that reads and matches the folder, or for a
// code it does not name, the source's words stand.

import { claimDiagnoses, diagnosisText, type Diagnosis } from './claims';
import { FolderError, isObject } from './parse';
import { recordPrivate } from './private';
import { recordTitle } from './titles';
import type { MedRecord, PersonIndex } from './types';

export interface CodeNames {
  /** The codes an item that is not private uses, by key. */
  codes: Map<string, string>;
  /** Those only private items use. */
  privateCodes: Map<string, string>;
}

const ICD10CM = 'http://hl7.org/fhir/sid/icd-10-cm';

/** `icd10cm|J30.9` for J309, j30.9 and J30.9, by the data contract's rule; undefined for another system's code. */
export function codeKey(system: string | undefined, code: string | undefined): string | undefined {
  if (system?.trim().toLowerCase() !== ICD10CM) return undefined;
  const bare = (code ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();
  if (!/^[A-Z][0-9A-Z]{2,6}$/.test(bare)) return undefined;
  return `icd10cm|${bare.length > 3 ? `${bare.slice(0, 3)}.${bare.slice(3)}` : bare}`;
}

function names(v: unknown): Map<string, string> {
  if (!isObject(v)) throw new FolderError('malformed', 'a list of code names is missing.');
  return new Map(
    Object.entries(v).flatMap(([key, x]): [string, string][] => {
      const name = isObject(x) && typeof x.name === 'string' ? x.name.trim() : '';
      return name ? [[key, name]] : [];
    }),
  );
}

/** A person's code-names.json. Refused when it is not one, is a newer format, or is another person's. */
export function parseCodeNames(raw: unknown, person: string): CodeNames {
  if (!isObject(raw) || raw.schema !== 'medrec-code-names/v1' || raw.person !== person) throw new FolderError('malformed', 'it is not medrec’s names for this person’s codes.');
  return { codes: names(raw.codes), privateCodes: names(raw.private_codes) };
}

/** A code's name on a record that uses it. A name only private items' codes have is for a private record alone. */
function nameOn(index: PersonIndex, r: MedRecord, system: string | undefined, code: string | undefined): string | undefined {
  const key = codeKey(system, code);
  if (!key || !index.codeNames) return undefined;
  return index.codeNames.codes.get(key) ?? (recordPrivate(index, r.id) ? index.codeNames.privateCodes.get(key) : undefined);
}

export interface Named {
  /** What to show first. */
  name: string;
  /** The source's words, where they are not the name's. */
  source?: string;
}

/** "recorded as “High blood pressure”", beside a name the source's words differ from. */
export const recordedAs = (n: Named): string | null => (n.source ? `recorded as “${n.source}”` : null);

/** A title's "unspecified" only says that nothing more is known. */
const folded = (s: string) => s.toLowerCase().replace(/\bunspecified\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A condition by its code's name, else by the source's words. */
export function conditionName(index: PersonIndex, r: MedRecord): Named {
  const source = recordTitle(r);
  const name = r.kind === 'condition' ? nameOn(index, r, r.code?.system, r.code?.code) : undefined;
  return !name || folded(name) === folded(source) ? { name: source } : { name, source };
}

/** A claim's diagnosis as the claim names it, "Ear infection (H66.90)", with its code's name in place of the claim's words for it. */
export function diagnosisName(index: PersonIndex, claim: MedRecord, d: Diagnosis): Named {
  const name = nameOn(index, claim, d.system, d.code);
  if (!name || (d.display && folded(name) === folded(d.display))) return { name: diagnosisText(d) };
  return { name: diagnosisText({ ...d, display: name }), ...(d.display ? { source: diagnosisText(d) } : {}) };
}

/** A claim's diagnoses in the payer's order. */
export const diagnosisNames = (index: PersonIndex, claim: MedRecord): Named[] => claimDiagnoses(claim).map((d) => diagnosisName(index, claim, d));

/** Names in one sentence. A code's name may hold commas. */
export const nameList = (all: string[]): string => all.join(all.some((x) => x.includes(',')) ? '; ' : ', ');
