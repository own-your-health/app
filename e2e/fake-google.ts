import { readFileSync } from 'node:fs';
import type { BrowserContext, Request, Route } from '@playwright/test';

// A stand-in for Google's sign-in and the Drive API, answered inside the
// browser test, so the signed-in app runs with no Google account. The
// records folder is the synthetic sample (public/demo/), served as Drive
// serves files. Its permissions follow the app's two scopes: drive.readonly
// reads everything, and drive.file changes only what this app created.

export const CLIENT = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
export const OTHER_CLIENT = '999999999999-zyxwvutsrqponmlkjihgfedcba543210.apps.googleusercontent.com';
export const TOKEN = 'stand-in-access-token-for-browser-tests';
export const READ = 'https://www.googleapis.com/auth/drive.readonly';
export const WRITE = 'https://www.googleapis.com/auth/drive.file';
export const USER = { displayName: 'Robin Example', emailAddress: 'robin@example.com' };
/** A second Google account in the same browser, as on a phone with a work and a personal account. */
export const OTHER_USER = { displayName: 'Sam Example', emailAddress: 'sam@example.com' };
export const FOLDER_NAME = 'Medical Records';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEMO = new URL('../public/demo/', import.meta.url);

interface Node {
  id: string;
  name: string;
  mimeType: string;
  parent: string;
  modifiedTime: string;
  content?: string;
  /** Created by the app: the only files drive.file lets it change. */
  byApp: boolean;
}

export interface Change {
  method: string;
  /** The file's path in the records folder. */
  path: string;
  /** Drive refused it: the token lacks drive.file, or the file is not the app's. */
  refused?: true;
}

export interface SignInAsk {
  clientId: string | null;
  prompt: string | null;
  scope: string | null;
  hint: string | null;
}

export class FakeGoogle {
  readonly rootId: string;
  /** Every write the app made to Drive, in order. */
  readonly changes: Change[] = [];
  readonly signIns: SignInAsk[] = [];
  readonly revoked: string[] = [];
  /** Requests to a host neither the app nor this stand-in serves. */
  readonly strays: string[] = [];
  /** How many calls reached Drive. */
  driveCalls = 0;
  /** What the sign-in grants, and so what the token may do; a person can untick a scope on Google's screen. */
  granted = [READ, WRITE];
  /** The client tokeninfo names: another one means a token issued to another app. */
  audience = CLIENT;
  /** The Google accounts signed in to this browser; none when Google's session ended. */
  accounts = [USER, OTHER_USER];
  /** The account the person picks when Google shows its chooser. */
  chooses = USER;
  /** The account the current token belongs to. */
  private account = USER;
  private nodes = new Map<string, Node>();
  private seq = 0;
  private readonly shiftMs: number;

  constructor(now = new Date()) {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', DEMO), 'utf8')) as { anchor: string; files: string[] };
    // The sample was written at its anchor; move its times to now, as the
    // demo does, so the Mac looks online.
    this.shiftMs = now.getTime() - Date.parse(manifest.anchor);
    const myDrive = this.add({ name: 'My Drive', mimeType: FOLDER_MIME, parent: '', byApp: false });
    this.rootId = this.add({ name: FOLDER_NAME, mimeType: FOLDER_MIME, parent: myDrive.id, byApp: false }).id;
    for (const f of manifest.files) {
      const parts = f.split('/');
      const name = parts.pop()!;
      const dir = this.folderAt(parts, true)!;
      if (name !== '.keep') this.add({ name, mimeType: 'application/json', parent: dir.id, byApp: false, content: this.shift(readFileSync(new URL(f.split('/').map(encodeURIComponent).join('/'), DEMO), 'utf8')) });
    }
  }

  shift(text: string): string {
    return text.replace(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z\b/g, (t) => iso(Date.parse(t) + this.shiftMs));
  }

  private add(n: Omit<Node, 'id' | 'modifiedTime'> & { modifiedTime?: string }): Node {
    const node: Node = { id: `fake${String(++this.seq).padStart(8, '0')}x`, modifiedTime: iso(Date.now()), ...n };
    this.nodes.set(node.id, node);
    return node;
  }

  private childrenOf(id: string): Node[] {
    return [...this.nodes.values()].filter((n) => n.parent === id);
  }

  /** The folder at a path; `make` adds the folders that are missing, as medrec would. */
  private folderAt(parts: string[], make = false): Node | undefined {
    let dir = this.nodes.get(this.rootId)!;
    for (const p of parts) {
      const next = this.childrenOf(dir.id).find((n) => n.name === p && n.mimeType === FOLDER_MIME);
      if (next) dir = next;
      else if (make) dir = this.add({ name: p, mimeType: FOLDER_MIME, parent: dir.id, byApp: false });
      else return undefined;
    }
    return dir;
  }

  private nodeAt(path: string): Node | undefined {
    const parts = path.split('/');
    const name = parts.pop()!;
    const dir = this.folderAt(parts);
    return dir && this.childrenOf(dir.id).find((n) => n.name === name);
  }

  pathOf(n: Node): string {
    const out: string[] = [];
    for (let x: Node | undefined = n; x && x.id !== this.rootId; x = this.nodes.get(x.parent)) out.unshift(x.name);
    return out.join('/');
  }

  /** The file names directly in a folder of the records folder. */
  list(path: string): string[] {
    const dir = this.folderAt(path.split('/'));
    return dir ? this.childrenOf(dir.id).map((n) => n.name).sort() : [];
  }

  read(path: string): string | undefined {
    return this.nodeAt(path)?.content;
  }

  /** A write by medrec on the Mac, not by the app. */
  writeAsMac(path: string, content: string): void {
    const parts = path.split('/');
    const name = parts.pop()!;
    const dir = this.folderAt(parts, true)!;
    const held = this.childrenOf(dir.id).find((n) => n.name === name);
    if (held) {
      held.content = content;
      held.modifiedTime = iso(Date.now());
    } else this.add({ name, mimeType: 'application/json', parent: dir.id, byApp: false, content });
  }

  removeAsMac(path: string): void {
    const n = this.nodeAt(path);
    if (n) this.nodes.delete(n.id);
  }

  /** Answers Google's and Drive's addresses for every page of the context. */
  async install(context: BrowserContext): Promise<void> {
    // Routes run newest first, so the catch-all goes in first.
    await context.route(/^https?:\/\//, (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'localhost') return route.fallback();
      this.strays.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    });
    await context.route(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/, (route) => this.authorize(route));
    await context.route(/^https:\/\/oauth2\.googleapis\.com\/(tokeninfo|revoke)$/, (route) => this.oauth(route));
    await context.route(/^https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\//, (route) => this.drive(route));
  }

  private authorize(route: Route): Promise<void> {
    const u = new URL(route.request().url());
    const p = u.searchParams;
    const hint = p.get('login_hint');
    this.signIns.push({ clientId: p.get('client_id'), prompt: p.get('prompt'), scope: p.get('scope'), hint });
    const state = p.get('state') ?? '';
    const answer = (fields: Record<string, string>) =>
      route.fulfill({ status: 302, headers: { location: `${p.get('redirect_uri')}#${new URLSearchParams({ ...fields, state }).toString()}` } });
    // As Google does: without a prompt it can answer only for one account it
    // can tell apart, the one named by login_hint or the only one signed in.
    const named = this.accounts.find((a) => a.emailAddress === hint);
    let account = named;
    if (p.get('prompt') === 'none') {
      if (!this.accounts.length) return answer({ error: 'login_required' });
      account ??= this.accounts.length === 1 ? this.accounts[0] : undefined;
      if (!account) return answer({ error: 'interaction_required' });
    } else {
      account ??= this.chooses;
    }
    this.account = account;
    return answer({ access_token: TOKEN, token_type: 'Bearer', expires_in: '3599', scope: this.granted.join(' ') });
  }

  private oauth(route: Route): Promise<void> {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
    const token = new URLSearchParams(req.postData() ?? '').get(new URL(req.url()).pathname === '/revoke' ? 'token' : 'access_token');
    if (new URL(req.url()).pathname === '/revoke') {
      if (token) this.revoked.push(token);
      return route.fulfill({ status: 200, headers: cors(), body: '' });
    }
    if (token !== TOKEN) return json(route, 400, { error: 'invalid_token' });
    return json(route, 200, { aud: this.audience, azp: this.audience, scope: this.granted.join(' '), expires_in: '3500' });
  }

  private drive(route: Route): Promise<void> {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
    this.driveCalls++;
    if (req.headers()['authorization'] !== `Bearer ${TOKEN}`) return driveError(route, 401, 'authError', 'Invalid Credentials');
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/(upload\/)?drive\/v3\//, '');
    if (path === 'about') return json(route, 200, { user: this.account });
    if (path === 'files' && req.method() === 'GET') return this.listFiles(route, url.searchParams.get('q') ?? '');
    if (path === 'files' && req.method() === 'POST' && url.pathname.startsWith('/upload/')) return this.create(route, req);
    const m = /^files\/([^/]+)$/.exec(path);
    const node = m ? this.nodes.get(decodeURIComponent(m[1]!)) : undefined;
    if (!m) return driveError(route, 400, 'badRequest', `Not a call this stand-in knows: ${req.method()} ${url.pathname}`);
    if (!node || !this.sees(node)) return driveError(route, 404, 'notFound', `File not found: ${m[1]}.`);
    if (req.method() === 'DELETE') {
      if (!this.granted.includes(WRITE)) {
        this.changes.push({ method: 'DELETE', path: this.pathOf(node), refused: true });
        return insufficientScopes(route);
      }
      if (!node.byApp) {
        this.changes.push({ method: 'DELETE', path: this.pathOf(node), refused: true });
        return driveError(route, 403, 'insufficientFilePermissions', 'The user does not have sufficient permissions for this file.');
      }
      this.nodes.delete(node.id);
      this.changes.push({ method: 'DELETE', path: this.pathOf(node) });
      return route.fulfill({ status: 204, headers: cors() });
    }
    if (req.method() !== 'GET') {
      this.changes.push({ method: req.method(), path: this.pathOf(node), refused: true });
      return driveError(route, 403, 'insufficientFilePermissions', 'The user does not have sufficient permissions for this file.');
    }
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors(), 'content-type': 'application/json' }, body: node.content ?? '' });
    return json(route, 200, this.resource(node));
  }

  private listFiles(route: Route, q: string): Promise<void> {
    const str = "'((?:[^'\\\\]|\\\\.)*)'";
    const unq = (s: string) => s.replace(/\\(.)/g, '$1');
    let found: Node[];
    let m: RegExpExecArray | null;
    if ((m = new RegExp(`^${str} in parents and trashed = false$`).exec(q))) found = this.childrenOf(unq(m[1]!));
    else if ((m = new RegExp(`^name = ${str} and trashed = false$`).exec(q))) found = [...this.nodes.values()].filter((n) => n.name === unq(m![1]!));
    else return driveError(route, 400, 'invalid', `A query this stand-in does not know: ${q}`);
    return json(route, 200, { files: found.filter((n) => this.sees(n)).map((n) => this.resource(n)) });
  }

  /** drive.readonly sees every file; drive.file alone sees only the app's own. */
  private sees(n: Node): boolean {
    return this.granted.includes(READ) || n.byApp;
  }

  private create(route: Route, req: Request): Promise<void> {
    const boundary = /boundary=([^;]+)/.exec(req.headers()['content-type'] ?? '')?.[1];
    const parts = (req.postData() ?? '').split(`--${boundary}`).slice(1, -1).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
    const meta = JSON.parse(parts[0] ?? '{}') as { name?: string; parents?: string[]; mimeType?: string };
    const parent = this.nodes.get(meta.parents?.[0] ?? '');
    if (!meta.name || !parent || parent.mimeType !== FOLDER_MIME) return driveError(route, 400, 'badRequest', 'A file needs a name and a folder.');
    if (!this.granted.includes(WRITE)) {
      this.changes.push({ method: 'CREATE', path: `${this.pathOf(parent)}/${meta.name}`, refused: true });
      return insufficientScopes(route);
    }
    const node = this.add({ name: meta.name, mimeType: meta.mimeType ?? 'application/octet-stream', parent: parent.id, byApp: true, content: parts[1] ?? '' });
    this.changes.push({ method: 'CREATE', path: this.pathOf(node) });
    return json(route, 200, this.resource(node));
  }

  private resource(n: Node) {
    return {
      id: n.id,
      name: n.name,
      mimeType: n.mimeType,
      modifiedTime: n.modifiedTime,
      parents: n.parent ? [n.parent] : [],
      ...(n.content !== undefined ? { size: String(n.content.length) } : {}),
      capabilities: { canEdit: n.byApp, canDelete: n.byApp, canAddChildren: n.mimeType === FOLDER_MIME },
    };
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
  };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...cors(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** Drive's answer to a call the token's scopes do not cover. */
function insufficientScopes(route: Route): Promise<void> {
  return driveError(route, 403, 'insufficientPermissions', 'Request had insufficient authentication scopes.');
}

function driveError(route: Route, status: number, reason: string, message: string): Promise<void> {
  return json(route, status, { error: { code: status, message, errors: [{ reason, message }] } });
}
