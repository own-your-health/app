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

/** The same provider: one name, or one inside the other ("Example Health" in "Example Health Main Clinic"). */
export function sameProvider(a: string | undefined, b: string | undefined): boolean {
  const ka = providerKey(a);
  const kb = providerKey(b);
  if (ka.length < 3 || kb.length < 3) return false;
  return ka === kb || ` ${ka} `.includes(` ${kb} `) || ` ${kb} `.includes(` ${ka} `);
}
