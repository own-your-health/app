// The app has no service worker, so an installed copy that comes back from
// the background goes on running the build it opened with. When it comes to
// the front, it asks the site for the app's own page, past the browser's
// cache, and says so when that page names another build. It reads nothing
// else, and sends nothing.

/** The build a page names: its script's hashed file name. The dev server's page names none. */
export function buildOf(html: string): string | undefined {
  return /assets\/index-[\w-]+\.js/.exec(html)?.[0];
}

/** At most one look this often, however often the app comes to the front. */
export const LOOK_EVERY_MS = 5 * 60_000;

export interface UpdateWatch {
  /** The build this page runs, from its own script's address. */
  current: string | undefined;
  /** The site's page for the app, as text. */
  fetchPage: () => Promise<string>;
  now: () => number;
  /** Called once, when the site's page names another build. */
  onNew: () => void;
}

/** A look to run each time the app comes to the front. */
export function updateWatcher(w: UpdateWatch): () => Promise<void> {
  let last = -Infinity;
  let told = false;
  return async () => {
    if (!w.current || told || w.now() - last < LOOK_EVERY_MS) return;
    last = w.now();
    let page: string;
    try {
      page = await w.fetchPage();
    } catch {
      // Offline, or the site did not answer: the next look tries again.
      last = -Infinity;
      return;
    }
    const next = buildOf(page);
    if (next && next !== w.current) {
      told = true;
      w.onNew();
    }
  };
}

/** What a look at the site found: another build, this one (or, on the dev server, none to compare), or nothing it could read. */
export type SiteBuild = { kind: 'other'; build: string } | { kind: 'same' } | { kind: 'failed' };

/** The build the site's page names, beside this page's. */
export async function siteBuild(current: string | undefined, fetchPage: () => Promise<string>): Promise<SiteBuild> {
  if (!current) return { kind: 'same' };
  const next = await fetchPage().then(buildOf, () => undefined);
  return !next ? { kind: 'failed' } : next === current ? { kind: 'same' } : { kind: 'other', build: next };
}

/** How long a look at the site may take before it counts as failed: a stalled connection does not hold a screen. */
export const LOOK_TIMEOUT_MS = 10_000;

/** The site's page for the app, revalidated past the HTTP cache. */
export async function fetchAppPage(timeout = LOOK_TIMEOUT_MS): Promise<string> {
  const res = await fetch(new URL('./', location.href), { cache: 'no-cache', credentials: 'omit', signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`The app's page answered ${res.status}.`);
  return res.text();
}
