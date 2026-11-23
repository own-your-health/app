// Whether two names are the same provider: bills and claims pair by it, and
// a visit takes a document filed by hand, or a claim, by it.

/** A provider's name for comparing: lower case, words only, no "Inc", "LLC" or "The". */
export function providerKey(name: string | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|inc|llc|pllc|pa|pc|md|corp|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the words of `inner`, run together, are some run of whole words of `outer`, run together. */
function insideRun(outer: string, inner: string): boolean {
  const words = outer.split(' ');
  const want = inner.replace(/ /g, '');
  for (let i = 0; i < words.length; i++) {
    let run = '';
    for (let j = i; j < words.length && run.length < want.length; j++) {
      run += words[j];
      if (run === want) return true;
    }
  }
  return false;
}

/**
 * The same provider: one name, or one inside the other ("Example Health" in
 * "Example Health Main Clinic"), with or without the spaces between words
 * ("Example Health Plan" is "ExampleHealth Plan"). Whole words only:
 * "Example Health" is not "Example Healthcare".
 */
export function sameProvider(a: string | undefined, b: string | undefined): boolean {
  const ka = providerKey(a);
  const kb = providerKey(b);
  if (ka.length < 3 || kb.length < 3) return false;
  return ka === kb || insideRun(ka, kb) || insideRun(kb, ka);
}
