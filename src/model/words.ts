// Words from the records as the screens may show them: a billing descriptor
// in capitals is never a headline, and a portal platform's name is no place.

/** Billing words in capitals, as an encounter or a claim gives them ("OFC VISIT, NEW PT, MOD MDM"): never a headline, and shown only in Details. */
export function isDescriptor(text: string): boolean {
  return (text.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 2 && !/[a-z]/.test(text);
}

/** The text when it is in a household's words, not a billing descriptor. */
export function plainWords(text: string | undefined): string | undefined {
  return text && !isDescriptor(text) ? text : undefined;
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

/** Whether a name is a records connection's, not a place's: a platform's own ("MyChart", "MyChart (Example Health)"), or one for every practice it serves. */
function isConnection(name: string): boolean {
  return /\(all (practices|locations|sites|clinics)\)$/i.test(name) || PLATFORMS.has(name.split('(')[0]!.trim().toLowerCase());
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
