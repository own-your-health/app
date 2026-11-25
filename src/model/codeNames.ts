// The ICD-10-CM titles of the codes a person's conditions and claim diagnoses
// use: medrec's views/<person id>/code-names.json (`medrec-code-names/v1`,
// medrec 0.9.4 and later), from the published table. A title only labels an
// item that is shown anyway. The source's words lead where they are plain,
// with the title in Details; the title leads where the source gives none, a
// bare code or billing wording in capitals. Search, sorting and grouping use
// the source's words alone. Without a file that reads and matches the folder,
// or for a code it does not name, the source's words stand.

import { claimDiagnoses, diagnosisText, type Diagnosis } from './claims';
import { FolderError, isObject } from './parse';
import { recordPrivate } from './private';
import { recordTitle } from './titles';
import type { MedRecord, PersonIndex } from './types';
import { plainWords } from './words';

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

/** A code's title on a record that uses it. One only private items' codes have is for a private record alone. */
function titleOn(index: PersonIndex, r: MedRecord, system: string | undefined, code: string | undefined): string | undefined {
  const key = codeKey(system, code);
  if (!key || !index.codeNames) return undefined;
  return index.codeNames.codes.get(key) ?? (recordPrivate(index, r.id) ? index.codeNames.privateCodes.get(key) : undefined);
}

/** What leads, and what Details add: at most one of the two. */
export interface Named {
  name: string;
  /** The code's title, where the source's words lead and it says something else. */
  title?: string;
  /** The source's words, where the title leads instead of them. */
  source?: string;
}

const bare = (s: string | undefined) => (s ?? '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** Whether the source's words can lead: not billing wording in capitals, nor a bare code. */
const leads = (words: string, code: string | undefined) => !!plainWords(words) && /\p{L}{2,}/u.test(words) && bare(words) !== bare(code);

/** A title's "unspecified" only says that nothing more is known. */
const folded = (s: string) => s.toLowerCase().replace(/\bunspecified\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A condition by the source's words, or by its code's title where they are none a person can read. */
export function conditionName(index: PersonIndex, r: MedRecord): Named {
  const title = r.kind === 'condition' ? titleOn(index, r, r.code?.system, r.code?.code) : undefined;
  if (!title) return { name: recordTitle(r) };
  const words = r.display || r.code?.display;
  if (!words) return { name: title };
  if (!leads(words, r.code?.code)) return { name: title, source: words };
  return { name: words, ...(folded(title) === folded(words) ? {} : { title }) };
}

/** A claim's diagnosis with its code, "Ear infection (H66.90)", by the same rule. */
export function diagnosisName(index: PersonIndex, claim: MedRecord, d: Diagnosis): Named {
  const title = titleOn(index, claim, d.system, d.code);
  if (!title) return { name: diagnosisText(d) };
  const titled = diagnosisText({ ...d, display: title });
  if (!d.display) return { name: titled };
  if (!leads(d.display, d.code)) return { name: titled, source: diagnosisText(d) };
  return { name: diagnosisText(d), ...(folded(title) === folded(d.display) ? {} : { title: titled }) };
}

/** A claim's diagnoses in the payer's order. */
export const diagnosisNames = (index: PersonIndex, claim: MedRecord): Named[] => claimDiagnoses(claim).map((d) => diagnosisName(index, claim, d));

/** Names in one sentence. Words for a diagnosis may hold commas. */
export const nameList = (all: string[]): string => all.join(all.some((x) => x.includes(',')) ? '; ' : ', ');
