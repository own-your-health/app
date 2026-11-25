// Words from the records as the screens may show them: a billing descriptor
// in capitals is never a headline, and a portal platform's name is no place.

/** Billing words in capitals, as an encounter or a claim gives them ("FIRST APPOINTMENT TIER THREE"): never a headline, and shown only in Details. */
export function isDescriptor(text: string): boolean {
  return (text.match(/\p{Lu}{2,}/gu)?.length ?? 0) >= 2 && !/\p{Ll}/u.test(text);
}

/** The text when it is in a household's words, not a billing descriptor. */
export function plainWords(text: string | undefined): string | undefined {
  return text && !isDescriptor(text) ? text : undefined;
}

/** What one word in capitals is: of 5 letters or fewer an abbreviation ("HTN"), else a word the source wrote so ("ASTHMA"). Undefined for anything else. */
export function capitalWord(text: string): 'abbreviation' | 'word' | undefined {
  if (/\s/.test(text.trim()) || /\p{Ll}/u.test(text) || !/\p{Lu}{2,}/u.test(text) || isDescriptor(text)) return undefined;
  return text.match(/\p{L}/gu)!.length <= 5 ? 'abbreviation' : 'word';
}

/** A word in capitals in sentence case; a letter that stands alone keeps its case ("HEPATITIS-B" is "Hepatitis-B"). */
export function sentenceCase(word: string): string {
  const first = word.search(/\p{Lu}{2,}/u);
  return word.replace(/\p{Lu}{2,}/gu, (run, at: number) => (at === first ? run[0]! + run.slice(1).toLowerCase() : run.toLowerCase()));
}

// Portal and records platforms, as medrec lists them (src/plain.rs): a platform's name stands for a sign-in, not a place.
const PLATFORMS = new Set([
  'allscripts',
  'athena',
  'athenahealth',
  'athenaone',
  'athenapatient',
  'cerner',
  'eclinicalworks',
  'epic',
  'followmyhealth',
  'healow',
  'healthelife',
  'icanotes',
  'modmed',
  'modernizing medicine',
  'mychart',
  'nextgen',
  'nextgen healthcare',
  'oracle health',
  'patient portal',
  'veradigm',
]);

/** Whether a name is for every practice a records connection serves: "athenahealth (all practices)". */
export function everyPractice(name: string): boolean {
  return /\(all (practices|locations|sites|clinics)\)$/i.test(name);
}

/** Whether a name is a records connection's, not a place's: a platform's own ("MyChart", "MyChart (Example Health)"), or one for every practice it serves. */
function isConnection(name: string): boolean {
  return everyPractice(name) || PLATFORMS.has(name.split('(')[0]!.trim().toLowerCase());
}

/** A provider's name with a store's number said once: "Example Pharmacy #1234 1234" is "Example Pharmacy #1234". */
export function tidyName(name: string | undefined): string | undefined {
  return name?.replace(/(#\s*(\d+))\s+\2\b/, '$1').replace(/\s+/g, ' ').trim() || undefined;
}

/** A place as the screens show it: tidied, and never a records connection's name, which is no place. */
export function placeName(place: string | undefined): string | undefined {
  const tidy = tidyName(place);
  return tidy && !isConnection(tidy) ? tidy : undefined;
}
