// The ICD-10-CM titles of the codes a person's conditions and claim diagnoses
// use: medrec's views/<person id>/code-names.json (`medrec-code-names/v1`,
// medrec 0.9.4 and later), from the published table. A title only labels an
// item that is shown anyway. The source's words lead where they are plain,
// with the title in Details; the title leads where the source gives none, a
// bare code, billing wording in capitals, or an abbreviation, which is shown
// beside it. A longer word in capitals leads in sentence case. Search,
// sorting and grouping use the source's words alone. Without a file that
// reads and matches the folder, or for a code it does not name, the source's
// words stand.

import { claimDiagnoses, diagnosisText, type Diagnosis } from './claims';
import { FolderError, isObject } from './parse';
import { recordPrivate } from './private';
import { recordTitle } from './titles';
import type { MedRecord, PersonIndex } from './types';
import { capitalWord, plainWords, sentenceCase } from './words';

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

/** What leads, and what Details add. */
export interface Named {
  name: string;
  /** The source's exact words, where the name is not them. */
  source?: string;
  /** The code's title, where it says something other than the source's words. */
  title?: string;
  /** Whether the title is what leads. */
  titleLeads?: boolean;
}

const bare = (s: string | undefined) => (s ?? '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** Whether the source's words are ones a person can read: not billing wording in capitals, nor a bare code. */
const readable = (words: string, code: string | undefined) => !!plainWords(words) && /\p{L}{2,}/u.test(words) && bare(words) !== bare(code);

/** A title's "unspecified" only says that nothing more is known. */
const folded = (s: string) => s.toLowerCase().replace(/\bunspecified\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Which leads, the source's words or the code's title; `say` is how either is
 * shown, with the source's abbreviation beside the title it stands for.
 */
function choose(title: string | undefined, words: string, code: string | undefined, say: (text: string, beside?: string) => string): Named {
  const apart = title !== undefined && folded(title) !== folded(words) ? { title: say(title) } : {};
  const plain = readable(words, code);
  if (title && !plain) return { name: say(title), source: say(words), ...apart, titleLeads: true };
  const capitals = plain ? capitalWord(words) : undefined;
  if (title && apart.title && capitals === 'abbreviation') return { name: say(title, words), source: say(words), ...apart, titleLeads: true };
  const name = capitals === 'word' ? sentenceCase(words) : words;
  return { name: say(name), ...(name === words ? {} : { source: say(words) }), ...apart };
}

/** A condition by the source's words, or by its code's title where they are none a person can read. */
export function conditionName(index: PersonIndex, r: MedRecord): Named {
  const words = r.display || r.code?.display;
  if (r.kind !== 'condition') return { name: recordTitle(r) };
  const title = titleOn(index, r, r.code?.system, r.code?.code);
  if (!words) return { name: title ?? recordTitle(r) };
  return choose(title, words, r.code?.code, (text, beside) => (beside ? `${text} (${beside})` : text));
}

/** The title, where the name does not give it. */
export const secondTitle = (n: Named): string | undefined => (n.titleLeads ? undefined : n.title);

/** In Details: the source's exact words, else the title, and the title beside words it differs from. */
export const inDetails = (n: Named): { words: string; title?: string } => ({ words: n.source ?? n.name, title: n.title });

/** A claim's diagnosis with its code, "Ear infection (H66.90)", by the same rule. */
export function diagnosisName(index: PersonIndex, claim: MedRecord, d: Diagnosis): Named {
  const title = titleOn(index, claim, d.system, d.code);
  if (!d.display) return { name: diagnosisText({ ...d, display: title }) };
  return choose(title, d.display, d.code, (text, beside) => (beside ? `${text} (${beside}, ${d.code})` : diagnosisText({ ...d, display: text })));
}

/** A claim's diagnoses in the payer's order. */
export const diagnosisNames = (index: PersonIndex, claim: MedRecord): Named[] => claimDiagnoses(claim).map((d) => diagnosisName(index, claim, d));

/** Names in one sentence. Words for a diagnosis may hold commas. */
export const nameList = (all: string[]): string => all.join(all.some((x) => x.includes(',')) ? '; ' : ', ');
