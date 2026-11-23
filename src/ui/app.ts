// The app: sign-in, the folder, and the views, in one page.

import { completeSignIn, revokeToken, SCOPE_READ, SCOPE_WRITE, signInErrorText, startSignIn, verifyToken, type Token, type Unsent } from '../auth';
import { startDemoMac } from '../data/demo-mac';
import { Store } from '../data/store';
import { Drive, DriveError } from '../drive';
import { DemoFolder, DriveFolder } from '../folder';
import { FolderError } from '../model/parse';
import { needsAttention } from '../model/sources';
import type { RequestScope } from '../model/types';
import { getAccount, getClientId, getFolder, setAccount, setClientId, setFolder } from '../settings';
import { readSetupLink, setupLinkFor, withoutClient } from '../setup-link';
import { button, type Ctx } from './components';
import { clear, h, icon, s } from './dom';
import { href, parseRoute, type Route } from './router';
import { homeView } from './views/home';
import { itemView } from './views/item';
import { personView } from './views/person';
import { folderView, messageView, signInView, welcomeView } from './views/setup';
import { settingsView } from './views/settings';
import { sourceView } from './views/source';
import { sourcesView } from './views/sources';
import { searchView } from './search';

/** What the app says when a renewal interrupted a write the person asked for. */
const UNSENT_TEXT: Record<Unsent, string> = {
  refresh: 'The refresh request was not sent: tap Refresh again.',
  cancel: 'The request was not cancelled: tap Cancel again.',
};

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

type Phase =
  | { name: 'welcome'; error?: string }
  | { name: 'signin'; error?: string }
  | { name: 'folder' }
  | { name: 'loading' }
  | { name: 'ready' }
  | { name: 'message'; title: string; text: string; actions?: HTMLElement[] };

function logo(): SVGSVGElement {
  return s(
    'svg',
    { viewBox: '0 0 32 32', width: 32, height: 32, class: 'logo', 'aria-hidden': 'true' },
    s('rect', { width: 32, height: 32, rx: 7, class: 'logo-tile' }),
    s('path', { d: 'M6.5 11a2 2 0 0 1 2-2h5l2 2.2h8a2 2 0 0 1 2 2V22a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z', class: 'logo-folder' }),
    s('path', { d: 'M8.5 17.5h3.5l1.8-3.6 3 6.4 1.9-4h4.8', class: 'logo-pulse' }),
  );
}

export class App {
  private phase: Phase = { name: 'loading' };
  private token: Token | null = null;
  /** When Google issued the token, so one Drive refuses at once is not renewed in a loop. */
  private tokenAt = 0;
  private renewing = false;
  /** A write the person started, which a renewal would interrupt. */
  private writing: Unsent | null = null;
  private scopes: string[] = [];
  private user: { email?: string; name?: string } = {};
  private store: Store | null = null;
  private drive: Drive | null = null;
  private demo: boolean;
  private demoMac: ((file: string) => void) | null = null;
  private main = h('main', { class: 'main', id: 'main' });
  private bar = h('header', { class: 'app-bar' });
  private banner = h('div', { class: 'banner-slot', 'aria-live': 'polite' });
  private toastBox = h('div', { class: 'toast-slot', 'aria-live': 'polite' });
  private toastTimer: number | undefined;
  private signature = '';
  private pollTimer: number | undefined;

  constructor(private readonly root: HTMLElement) {
    this.demo = new URLSearchParams(location.search).has('demo');
    root.append(this.bar, this.banner, this.main, this.toastBox);
  }

  async start(): Promise<void> {
    if (window.top !== window.self) {
      this.show({ name: 'message', title: 'Open the app on its own', text: 'For your records’ safety this page does not run inside another page.' });
      return;
    }
    if (this.sameOriginOpener()) {
      const a = h('a', { class: 'button button-primary', href: location.href, target: '_blank', rel: 'noopener noreferrer' }, 'Open it in a new tab');
      this.show({ name: 'message', title: 'Open the app in its own tab', text: 'Another page on this site opened this one and could read it, so it will not sign in here.', actions: [a] });
      return;
    }
    window.addEventListener('hashchange', () => this.onRoute());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.signInEnded()) return this.renew();
      void this.pollOnce();
    });
    if (this.demo) return this.startDemo();

    const answer = completeSignIn(location.hash, sessionStorage, Date.now());
    if (answer.kind !== 'none') history.replaceState(null, '', `${location.pathname}${location.search}${answer.route}`);
    // A setup link (?client=) leaves the address before anything else runs,
    // so it is never carried into Google's sign-in or a bookmark.
    const link = readSetupLink(location.search, getClientId());
    if (link.kind !== 'none') history.replaceState(null, '', withoutClient(location));
    if (answer.kind === 'none') {
      switch (link.kind) {
        case 'new':
          setClientId(link.clientId);
          return this.signIn(false, true);
        case 'same':
          return getFolder() ? this.signIn(true) : this.signIn(false, true);
        case 'different':
          return this.show({
            name: 'message',
            title: 'Use the client in this link?',
            text: `This browser signs in through the Google client ${link.current}. The link you opened names ${link.clientId}. Use the link’s client if this device belongs to that household.`,
            actions: [
              button('Use the link’s client', () => (setClientId(link.clientId), this.signIn(false, true)), { primary: true }),
              button('Keep the current one', () => this.resume()),
            ],
          });
        case 'invalid':
          if (!getClientId()) {
            return this.show({ name: 'welcome', error: 'The link you opened has no valid Google client id. Ask for the setup link again, or paste the client id here.' });
          }
          this.toast('The link you opened has no valid Google client id, so the app kept its own.', 'error');
          break;
      }
    }
    const clientId = getClientId();
    if (!clientId) return this.show({ name: 'welcome' });
    if (answer.kind === 'signed_in') return this.signedIn(answer.token, clientId, answer.unsent);
    if (answer.kind === 'failed') {
      // A silent attempt on opening that needs the person is not an error to
      // show; one renewing an ended sign-in says why the app stopped.
      const error = !answer.silent
        ? signInErrorText(answer.error)
        : answer.renewal
          ? `Your Google sign-in ended, as it does after an hour, and Google needs you to sign in again.${answer.unsent ? ` ${UNSENT_TEXT[answer.unsent]}` : ''}`
          : undefined;
      return this.show({ name: 'signin', error });
    }
    this.resume();
  }

  /** Signed out, with a client: sign in again quietly when a folder was chosen before. */
  private resume(): void {
    if (getFolder()) return this.signIn(true);
    this.show({ name: 'signin' });
  }

  private sameOriginOpener(): boolean {
    if (!window.opener) return false;
    try {
      return Boolean((window.opener as Window).location.href);
    } catch {
      window.opener = null;
      return false;
    }
  }

  private redirectUri(): string {
    return `${location.origin}${import.meta.env.BASE_URL}`;
  }

  /** Leaves for Google's sign-in, as the account that last signed in when there is one. */
  private signIn(silent = false, chooseAccount = false, renewal = false, unsent?: Unsent): void {
    const clientId = getClientId();
    if (!clientId) return this.show({ name: 'welcome' });
    startSignIn({
      clientId,
      redirectUri: this.redirectUri(),
      route: location.hash || '#/',
      silent,
      renewal,
      ...(unsent ? { unsent } : {}),
      chooseAccount,
      loginHint: getAccount(),
      storage: sessionStorage,
      go: (u) => location.assign(u),
    });
  }

  /** Forgets the account, so Google asks which one to use. */
  private differentAccount(): void {
    setAccount(null);
    this.signIn(false, true);
  }

  private async signedIn(token: Token, clientId: string, unsent?: Unsent): Promise<void> {
    this.show({ name: 'loading' });
    const check = await verifyToken((...a) => fetch(...a), token.accessToken, clientId).catch(() => ({ ok: false, scopes: [] as string[] }));
    if (!check.ok) return this.show({ name: 'signin', error: 'Google did not confirm this sign-in for your client. Sign in again.' });
    this.token = token;
    this.tokenAt = Date.now();
    this.scopes = check.scopes.length ? check.scopes : token.scopes;
    if (!this.scopes.includes(SCOPE_READ)) {
      return this.show({ name: 'signin', error: 'The app needs permission to read your Drive to show the records. Sign in again and allow it.' });
    }
    this.drive = new Drive(
      () => this.accessToken(),
      (...a) => fetch(...a),
      () => this.tokenEnded(),
    );
    this.user = await this.drive.about().catch(() => ({}));
    if (this.user.email) setAccount(this.user.email);
    const folder = getFolder();
    if (!folder) return this.show({ name: 'folder' });
    await this.openFolder(folder);
    if (unsent) this.toast(`Your Google sign-in had ended, so the app signed in again. ${UNSENT_TEXT[unsent]}`, 'error');
  }

  private accessToken(): string {
    if (!this.token || Date.now() >= this.token.expiresAt) {
      this.tokenEnded();
      throw new DriveError(401, 'expired', 'Your Google sign-in ended.');
    }
    return this.token.accessToken;
  }

  /**
   * The token's hour is up, or Drive refused it: a Drive call needs a new
   * one, so sign in again silently, as the same account. A token Drive
   * refuses right after Google issued it is not renewed again, or the app
   * would go round in a loop.
   */
  private tokenEnded(): void {
    if (this.demo || !this.token || this.renewing) return;
    if (Date.now() - this.tokenAt < 60_000) {
      this.token = null;
      return this.show({ name: 'signin', error: 'Google did not accept this sign-in for Drive. Sign in again.' });
    }
    this.renew();
  }

  /** Signed in once in this page, and that sign-in has ended. */
  private signInEnded(): boolean {
    return !this.demo && this.drive !== null && this.token !== null && Date.now() >= this.token.expiresAt;
  }

  private renew(): void {
    if (this.renewing) return;
    this.renewing = true;
    this.signIn(true, false, true, this.writing ?? undefined);
  }

  private async openFolder(f: { id: string; name: string }): Promise<void> {
    if (!this.drive) return;
    this.show({ name: 'loading' });
    const store = new Store(new DriveFolder(this.drive, f.id, f.name));
    try {
      await store.load();
    } catch (e) {
      if (e instanceof FolderError && e.kind === 'newer_format') {
        return this.show({ name: 'message', title: 'Update the app', text: e.message, actions: [button('Reload', () => location.reload(), { primary: true })] });
      }
      setFolder(null);
      const text = e instanceof Error ? e.message : 'The folder could not be read.';
      return this.show({ name: 'message', title: 'That folder could not be opened', text, actions: [button('Choose a folder', () => this.show({ name: 'folder' }), { primary: true })] });
    }
    setFolder(f);
    this.store = store;
    this.show({ name: 'ready' });
    this.startPolling();
  }

  private async startDemo(): Promise<void> {
    this.show({ name: 'loading' });
    const folder = new DemoFolder(`${import.meta.env.BASE_URL}demo/`);
    const store = new Store(folder);
    try {
      await store.load();
    } catch (e) {
      return this.show({ name: 'message', title: 'The sample records did not load', text: e instanceof Error ? e.message : String(e) });
    }
    this.store = store;
    this.scopes = [SCOPE_READ, SCOPE_WRITE];
    this.user = { name: 'Sample visitor' };
    this.demoMac = startDemoMac(folder, () => void this.pollOnce());
    this.show({ name: 'ready' });
    this.startPolling();
  }

  private startPolling(): void {
    window.clearInterval(this.pollTimer);
    // While a request waits, look for the Mac's answer: two Drive listings
    // and a status read per look.
    this.pollTimer = window.setInterval(() => {
      if (this.store?.pending.length && document.visibilityState === 'visible') void this.pollOnce();
    }, this.demo ? 1500 : 30_000);
  }

  private async pollOnce(): Promise<void> {
    if (!this.store || (!this.demo && !this.token)) return;
    try {
      await this.store.loadRefreshState();
    } catch {
      return;
    }
    const sig = this.stateSignature();
    if (sig !== this.signature) {
      this.signature = sig;
      const r = parseRoute(location.hash);
      // Re-drawing a search would drop what is being typed.
      if (!(r.name === 'search' || (r.name === 'person' && r.section === 'search'))) this.renderKeepingScroll();
    }
  }

  private stateSignature(): string {
    const st = this.store;
    if (!st) return '';
    return JSON.stringify([st.status.kind === 'ok' ? st.status.status.updated_at : st.status.kind, st.pending.map((p) => p.file), st.done.length, st.refused.length]);
  }

  private ctx(): Ctx {
    return {
      store: this.store!,
      demo: this.demo,
      user: this.user,
      canWrite: this.demo || this.scopes.includes(SCOPE_WRITE),
      version: VERSION,
      now: () => new Date(),
      go: (r: Route) => (location.hash = href(r)),
      render: () => this.render(),
      toast: (t, kind) => this.toast(t, kind),
      refresh: (scope, what) => this.refresh(scope, what),
      cancel: async (p) => {
        this.writing = 'cancel';
        try {
          await this.store!.cancel(p);
          this.toast('Request cancelled');
        } catch (e) {
          // A renewal is leaving the page; it says so when it comes back.
          if (this.renewing) return;
          this.toast(e instanceof Error ? e.message : 'The request could not be cancelled.', 'error');
        } finally {
          this.writing = null;
        }
        this.renderKeepingScroll();
      },
      signOut: () => void this.signOut(),
    };
  }

  private async refresh(scope: RequestScope, what: string): Promise<void> {
    const store = this.store;
    if (!store) return;
    this.writing = 'refresh';
    try {
      const p = await store.requestRefresh(scope, this.user, VERSION);
      this.demoMac?.(p.file);
      this.signature = this.stateSignature();
      this.toast(`Asked the Mac to refresh ${what}`);
    } catch (e) {
      // A renewal is leaving the page; it says so when it comes back.
      if (this.renewing) return;
      const text =
        e instanceof DriveError && e.status === 403
          ? 'Google did not let the app write the request into this folder. Check that this account may edit the records folder.'
          : e instanceof Error
            ? e.message
            : 'The request could not be written.';
      this.toast(text, 'error');
    } finally {
      this.writing = null;
    }
    this.renderKeepingScroll();
  }

  private async signOut(): Promise<void> {
    const t = this.token;
    this.token = null;
    this.store = null;
    this.drive = null;
    window.clearInterval(this.pollTimer);
    setAccount(null);
    if (t) await revokeToken((...a) => fetch(...a), t.accessToken);
    this.banner.replaceChildren();
    this.show({ name: 'signin' });
  }

  private toast(text: string, kind: 'info' | 'error' = 'info'): void {
    window.clearTimeout(this.toastTimer);
    this.toastBox.replaceChildren(h('div', { class: ['toast', kind === 'error' ? 'toast-error' : null], role: kind === 'error' ? 'alert' : 'status' }, text));
    this.toastTimer = window.setTimeout(() => this.toastBox.replaceChildren(), kind === 'error' ? 9000 : 6000);
  }

  private show(phase: Phase): void {
    this.phase = phase;
    this.render();
  }

  private onRoute(): void {
    if (this.phase.name === 'ready') {
      this.render();
      window.scrollTo(0, 0);
    }
  }

  private renderKeepingScroll(): void {
    const y = window.scrollY;
    this.render();
    window.scrollTo(0, y);
  }

  private renderBar(): void {
    const ready = this.phase.name === 'ready';
    this.bar.replaceChildren(
      h(
        'div',
        { class: 'bar-inner' },
        h('a', { class: 'brand', href: ready ? '#/' : './' }, logo(), h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'Own Your Health'), h('span', { class: 'brand-sub' }, 'Records'))),
        ready
          ? h(
              'nav',
              { class: 'bar-actions', 'aria-label': 'App' },
              h('a', { class: 'icon-button', href: '#/search', 'aria-label': 'Search' }, icon('search')),
              this.sourcesButton(),
              h('a', { class: 'icon-button', href: '#/settings', 'aria-label': 'Settings' }, icon('settings')),
            )
          : null,
      ),
    );
    if (this.demo && ready) {
      this.banner.replaceChildren(h('div', { class: 'banner banner-sample' }, h('span', { class: 'chip chip-attention' }, 'Sample data'), h('span', null, 'Invented records. Nothing is saved.')));
    }
  }

  /** Sources, with a dot while a source needs attention at the Mac. */
  private sourcesButton(): HTMLElement {
    const alert = this.store ? needsAttention(this.store.sources()).length > 0 : false;
    return h(
      'a',
      { class: ['icon-button', alert ? 'icon-button-alert' : null], href: '#/sources', 'aria-label': alert ? 'Sources: a source needs attention' : 'Sources' },
      icon('sources'),
    );
  }

  render(): void {
    this.renderBar();
    clear(this.main);
    const p = this.phase;
    switch (p.name) {
      case 'loading':
        this.main.append(h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'Reading the records folder…')));
        return;
      case 'welcome':
        this.main.append(
          welcomeView((id) => {
            setClientId(id);
            this.show({ name: 'signin' });
          }, p.error),
        );
        return;
      case 'signin':
        this.main.append(
          signInView(() => this.signIn(false, true), {
            error: p.error,
            account: getAccount(),
            onDifferentAccount: () => this.differentAccount(),
            onChangeClient: () => (setClientId(null), this.show({ name: 'welcome' })),
          }),
        );
        return;
      case 'folder':
        if (!this.drive) return this.show({ name: 'signin' });
        this.main.append(folderView(this.drive, (f) => this.openFolder(f)));
        return;
      case 'message':
        this.main.append(messageView(p.title, p.text, p.actions));
        return;
      case 'ready':
        this.main.append(this.routeView());
        return;
    }
  }

  private routeView(): HTMLElement {
    const ctx = this.ctx();
    const r = parseRoute(location.hash);
    switch (r.name) {
      case 'home':
        return homeView(ctx);
      case 'settings':
        return settingsView(ctx, {
          clientId: getClientId(),
          setupLink: getClientId() ? setupLinkFor(getClientId()!, this.redirectUri()) : null,
          scopes: this.scopes,
          onChangeFolder: () => {
            setFolder(null);
            this.store = null;
            this.show({ name: 'folder' });
          },
          onChangeClient: () => {
            setClientId(null);
            void this.signOut().then(() => this.show({ name: 'welcome' }));
          },
        });
      case 'sources':
        return sourcesView(ctx);
      case 'search':
        return searchView(ctx, r.query);
      case 'source':
        return sourceView(ctx, r.source);
      case 'person':
        return personView(ctx, r.person, r.section, r.sub, r.query);
      case 'item':
        return itemView(ctx, r.person, r.id);
      case 'huishouden': {
        const person = this.store!.personForHuishouden(r.hh);
        if (person) {
          history.replaceState(null, '', href({ name: 'person', person: person.id, section: 'overview' }));
          return personView(ctx, person.id, 'overview');
        }
        return messageView('Not linked yet', 'No one in this records folder is linked to that Huishouden Health person. Link them on the Mac with medrec.');
      }
      case 'not_found':
        return messageView('Page not found', 'That link does not match anything in the app.', [h('a', { class: 'button button-primary', href: '#/' }, 'Home')]);
    }
  }
}
