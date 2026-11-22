// A development page that settles which Drive scopes let this app create a
// refresh request in a records folder it did not create. It runs only under
// `vite` (import.meta.env.DEV); production builds leave it out.
//
// Open http://localhost:5173/app/?scope-test=1&client=<client id>[&folder=<name>].
// Pass A signs in with drive.readonly and drive.file, finds the folder by
// name, and creates and deletes one file in its _requests/. Pass B signs in
// again with drive.file alone and tries the same create. The page shows
// each step's HTTP status and Drive's error reason, and nothing else from
// Drive: no tokens, and no file names beyond the folder named in the URL.

import { completeSignIn, decodeState, SCOPE_READ, SCOPE_WRITE, startSignIn } from '../auth';
import { Drive, DriveError, folderNamedQuery } from '../drive';
import { clear, h } from '../ui/dom';

const KEY = 'own-your-health-app.scope_test';
const ROUTE_A = '#/scope-test/a';
const ROUTE_B = '#/scope-test/b';
const DEFAULT_FOLDER = 'oyh-app-scope-test';

interface Step {
  pass: 'A' | 'B';
  step: string;
  status: number | null;
  reason: string;
  note?: string;
}

interface Saved {
  clientId: string;
  folder: string;
  folderId?: string;
  requestsId?: string;
  scopesA?: string[];
  scopesB?: string[];
  steps: Step[];
}

/** Whether this page load belongs to the scope test. */
export function isScopeTest(loc: Location): boolean {
  if (new URLSearchParams(loc.search).has('scope-test')) return true;
  const route = decodeState(new URLSearchParams(loc.hash.replace(/^#/, '')).get('state'))?.r ?? '';
  return route.startsWith('#/scope-test/') && sessionStorage.getItem(KEY) !== null;
}

function load(): Saved | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Saved;
  } catch {
    return null;
  }
}

function save(s: Saved): void {
  sessionStorage.setItem(KEY, JSON.stringify(s));
}

function redirectUri(): string {
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

function short(scopes: string[] | undefined): string {
  return (scopes ?? []).map((x) => x.replace('https://www.googleapis.com/auth/', '')).join(', ') || '(none)';
}

async function attempt(pass: 'A' | 'B', step: string, fn: () => Promise<string | undefined>): Promise<Step> {
  try {
    const note = await fn();
    return { pass, step, status: 200, reason: 'ok', ...(note ? { note } : {}) };
  } catch (e) {
    if (e instanceof DriveError) return { pass, step, status: e.status, reason: e.reason || 'unknown' };
    return { pass, step, status: null, reason: e instanceof Error ? e.name : 'error' };
  }
}

function render(root: HTMLElement, saved: Saved, message: string): void {
  clear(root);
  root.append(
    h(
      'main',
      { class: 'main' },
      h(
        'div',
        { class: 'stack narrow' },
        h(
          'section',
          { class: 'card' },
          h('h1', {}, 'Drive scope test'),
          h('p', { class: 'muted' }, `Folder: ${saved.folder}`),
          h('p', {}, message),
          h('p', { class: 'small' }, `Pass A granted: ${short(saved.scopesA)}`),
          h('p', { class: 'small' }, `Pass B granted: ${short(saved.scopesB)}`),
          h(
            'table',
            { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Pass'), h('th', {}, 'Step'), h('th', {}, 'HTTP'), h('th', {}, 'Reason'))),
            h(
              'tbody',
              {},
              ...saved.steps.map((s) =>
                h(
                  'tr',
                  {},
                  h('td', {}, s.pass),
                  h('td', {}, s.step),
                  h('td', { class: 'num' }, s.status === null ? 'none' : String(s.status)),
                  h('td', {}, s.note ? `${s.reason} (${s.note})` : s.reason),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

async function passA(drive: Drive, saved: Saved): Promise<void> {
  let folders: { id: string }[] = [];
  saved.steps.push(
    await attempt('A', 'Find the folder by name', async () => {
      folders = await drive.list(folderNamedQuery(saved.folder));
      return `${folders.length} found`;
    }),
  );
  if (folders.length !== 1) return;
  saved.folderId = folders[0]!.id;
  let requests: { id: string }[] = [];
  saved.steps.push(
    await attempt('A', 'Find _requests/ in it', async () => {
      requests = await drive.list(folderNamedQuery('_requests', saved.folderId!));
      return requests.length === 1 ? 'found' : `${requests.length} found; not created`;
    }),
  );
  if (requests.length !== 1) return;
  saved.requestsId = requests[0]!.id;
  saved.steps.push(
    await attempt('A', 'Read _requests/ capabilities', async () => {
      const f = await drive.get(saved.requestsId!);
      return `canAddChildren ${String(f.capabilities?.canAddChildren ?? 'not given')}`;
    }),
  );
  await createAndDelete(drive, saved, 'A');
}

async function createAndDelete(drive: Drive, saved: Saved, pass: 'A' | 'B'): Promise<void> {
  let createdId: string | null = null;
  const name = `scope-test-${pass.toLowerCase()}-${Date.now()}.json`;
  saved.steps.push(
    await attempt(pass, 'Create a file in _requests/', async () => {
      const f = await drive.createJson(saved.requestsId!, name, { schema: 'own-your-health-scope-test/v1', pass });
      createdId = f.id;
      return undefined;
    }),
  );
  if (createdId) {
    const id: string = createdId;
    saved.steps.push(
      await attempt(pass, 'Delete that file', async () => {
        await drive.remove(id);
        return undefined;
      }),
    );
  }
}

async function passB(drive: Drive, saved: Saved): Promise<void> {
  if (!saved.requestsId) {
    saved.steps.push({ pass: 'B', step: 'Skipped', status: null, reason: 'pass A did not find _requests/' });
    return;
  }
  saved.steps.push(
    await attempt('B', 'Read the folder', async () => {
      await drive.get(saved.folderId!);
      return undefined;
    }),
  );
  await createAndDelete(drive, saved, 'B');
}

export async function runScopeTest(root: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.has('scope-test')) {
    const clientId = (params.get('client') ?? '').trim();
    const folder = (params.get('folder') ?? DEFAULT_FOLDER).trim();
    const saved: Saved = { clientId, folder, steps: [] };
    if (!clientId) {
      render(root, saved, 'Add &client=<your OAuth client id> to the URL.');
      return;
    }
    save(saved);
    render(root, saved, 'Signing in for pass A (drive.readonly and drive.file)…');
    startSignIn({
      clientId,
      redirectUri: redirectUri(),
      route: ROUTE_A,
      chooseAccount: true,
      scopes: [SCOPE_READ, SCOPE_WRITE],
      includeGranted: false,
      storage: sessionStorage,
      go: (url) => location.assign(url),
    });
    return;
  }

  const saved = load();
  if (!saved) return;
  const result = completeSignIn(location.hash, sessionStorage, Date.now());
  history.replaceState(null, '', `${import.meta.env.BASE_URL}#/`);
  if (result.kind !== 'signed_in') {
    saved.steps.push({ pass: '?' as 'A', step: 'Sign in', status: null, reason: result.kind === 'failed' ? result.error : 'no answer' });
    render(root, saved, 'Sign-in did not complete.');
    sessionStorage.removeItem(KEY);
    return;
  }
  const token = result.token.accessToken;
  const drive = new Drive(
    () => token,
    (input, init) => fetch(input, init),
    () => undefined,
  );

  if (result.route === ROUTE_A) {
    saved.scopesA = result.token.scopes;
    render(root, saved, 'Running pass A…');
    await passA(drive, saved);
    save(saved);
    render(root, saved, 'Pass A done. Signing in for pass B (drive.file alone) in 3 seconds…');
    setTimeout(() => {
      startSignIn({
        clientId: saved.clientId,
        redirectUri: redirectUri(),
        route: ROUTE_B,
        scopes: [SCOPE_WRITE],
        includeGranted: false,
        storage: sessionStorage,
        go: (url) => location.assign(url),
      });
    }, 3000);
    return;
  }

  saved.scopesB = result.token.scopes;
  render(root, saved, 'Running pass B…');
  await passB(drive, saved);
  sessionStorage.removeItem(KEY);
  render(root, saved, 'Done. Nothing from the test is kept.');
}
