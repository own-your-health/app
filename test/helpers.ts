import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DemoFolder } from '../src/folder';

export const ROOT = join(import.meta.dirname, '..');
export const DEMO = join(ROOT, 'public', 'demo');
export const FIXTURES = join(ROOT, 'test', 'fixtures');

export function fixture<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as T;
}

export function demoJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(DEMO, path), 'utf8')) as T;
}

/** A fetch that serves public/demo/ as the page's own origin would. */
export function demoFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = decodeURIComponent(url.replace(/^\/app\/demo\//, ''));
    try {
      return new Response(readFileSync(join(DEMO, path)), { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
}

export function demoFolder(now = new Date('2026-11-22T20:00:00Z')): DemoFolder {
  return new DemoFolder('/app/demo/', demoFetch(), now);
}

/** Files laid over the sample, by their path in it; null takes one away. */
export type Overlay = Record<string, string | null>;

/** What medrec wrote for a case of scripts/private-fixtures.mjs, to lay over the sample. */
export function privateCase(name: 'marked' | 'unreadable'): Overlay {
  const dir = join(FIXTURES, 'private', name);
  return Object.fromEntries(filesUnder(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

/** The sample once the household has marked payments, as medrec wrote it (scripts/bill-fixtures.mjs). */
export function paidCase(): Overlay {
  const dir = join(FIXTURES, 'bills', 'paid');
  return Object.fromEntries(filesUnder(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

interface StandingRecord {
  id: string;
  display: string;
  date?: string;
  code?: object;
  fields: Record<string, unknown>;
}

/**
 * The sample with one of its people having medrec's own standing fixture as
 * their records, and nothing else: what is current by every source's word,
 * or, with `standing: false`, the folder as a medrec before 0.9.9 leaves it.
 * `hidden` names the records medrec's list has as private; `change` alters
 * records, `line` what medrec says is one medicine, and `schema` the layout.
 */
export function standingCase(person: string, { standing = true, hidden = [], schema, change, line }: { standing?: boolean; hidden?: string[]; schema?: string; change?: (r: StandingRecord) => void; line?: (id: string, line: string) => string } = {}): Overlay {
  const { people } = demoJson<{ people: { id: string; folder: string }[] }>('household.json');
  const views = demoJson<{ people: Record<string, { index: string; text: string | null; linked: Record<string, { index: string; text: string | null }>; files: Record<string, string> }> }>('views/views.json');
  const folder = people.find((p) => p.id === person)!.folder;
  const v = views.people[person]!;
  const out: Overlay = {};
  const md5 = (text: string) => createHash('md5').update(text).digest('hex');
  const put = (path: string, body: object): string => {
    const text = JSON.stringify(body);
    out[path] = text;
    return md5(text);
  };
  const index = fixture<{ records: StandingRecord[] }>('standing/medrec/index.json');
  if (change) index.records.forEach(change);
  v.index = put(`${folder}/index.json`, { ...index, person, documents: [], imports: [], studies: [] });
  v.text = put(`${folder}/text.json`, { schema: 'medrec-text/v1', person, texts: {} });
  for (const other of Object.values(views.people)) if (other.linked[person]) other.linked[person] = { index: v.index, text: v.text };
  const view = (file: string, body: object): void => {
    const before = v.files[`${file}.json`];
    if (before) out[`views/${person}/${file}.${before.slice(0, 12)}.json`] = null;
    const text = JSON.stringify(body);
    v.files[`${file}.json`] = md5(text);
    out[`views/${person}/${file}.${md5(text).slice(0, 12)}.json`] = text;
  };
  const viewNow = (file: string) => demoJson<object>(`views/${person}/${file}.${v.files[`${file}.json`]!.slice(0, 12)}.json`);
  view('events', { ...viewNow('events'), events: [], pending: [], aliases: [] });
  view('bills', { ...viewNow('bills'), bills: {}, copy_of: {}, receipts: [], worth_a_call: [], not_billed: [] });
  view('private', { ...viewNow('private'), records: Object.fromEntries(hidden.map((id) => [id, { area: 'mental_health' }])), documents: {}, events: {}, studies: {}, unreported_studies: [] });
  for (const file of ['code-names', 'providers'] as const) delete v.files[`${file}.json`];
  const said = fixture<{ records: Record<string, { line: string }> }>('standing/medrec/standing.json');
  if (line) for (const [id, r] of Object.entries(said.records)) r.line = line(id, r.line);
  if (standing) view('standing', { ...said, person, ...(schema ? { schema } : {}) });
  out['views/views.json'] = JSON.stringify(views);
  return out;
}

/** The sample's manifest with an overlay's files and MD5s, as a folder holding them would give them. */
export function manifestWith(overlay: Overlay): string {
  const m = demoJson<{ anchor: string; files: string[]; md5: Record<string, string> }>('manifest.json');
  for (const [f, text] of Object.entries(overlay)) {
    m.files = m.files.filter((x) => x !== f);
    delete m.md5[f];
    if (text === null) continue;
    m.files.push(f);
    m.md5[f] = createHash('md5').update(text).digest('hex');
  }
  return JSON.stringify(m);
}

/** The sample with an overlay on it; `manifest` changes its manifest (its MD5s, say) further. */
export function demoFolderWith(overlay: Overlay, manifest: (m: { files: string[]; md5?: Record<string, string> }) => void = () => {}): DemoFolder {
  const files = demoFetch();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const path = decodeURIComponent(String(input).replace(/^\/app\/demo\//, ''));
    if (path === 'manifest.json') {
      const m = JSON.parse(manifestWith(overlay)) as { files: string[]; md5?: Record<string, string> };
      manifest(m);
      return new Response(JSON.stringify(m), { status: 200 });
    }
    const over = overlay[path];
    if (over === undefined) return files(input);
    return over === null ? new Response('not found', { status: 404 }) : new Response(over, { status: 200 });
  }) as typeof fetch;
  return new DemoFolder('/app/demo/', fetchImpl, new Date(demoJson<{ anchor: string }>('manifest.json').anchor));
}

export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
