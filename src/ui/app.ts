// The app: sign-in, the folder, and the views, in one page.

import { completeSignIn, SCOPE_READ, SCOPE_WRITE, signInErrorText, startSignIn, verifyToken, type Token, type Unsent } from '../auth';
import { startDemoMac } from '../data/demo-mac';
import { Rereads } from '../data/rereads';
import { Store } from '../data/store';
import { Drive, DriveError } from '../drive';
import { whyNotOpened } from '../find-folder';
import { DemoFolder, DriveFolder } from '../folder';
import { FolderError } from '../model/parse';
import { needsAttention } from '../model/sources';
import type { RequestScope } from '../model/types';
import { getAccount, getClientId, getFolder, setAccount, setClientId, setFolder } from '../settings';
import { readSetupLink, setupLinkFor, withoutClient, type SetupLink } from '../setup-link';
import { button, sheet, type Ctx, type Mark } from './components';
import { clear, h, icon, s } from './dom';
import { href, isListSection, moved, parseRoute, type Route } from './router';
import { tabBar } from './tabs';
import { buildOf, fetchAppPage, updateWatcher } from './update';
import { costsView } from './views/costs';
import { homeView } from './views/home';
import { itemView } from './views/item';
import { personView } from './views/person';
import { folderView, messageView, signInView, welcomeView } from './views/setup';
import { settingsView } from './views/settings';
import { sourceView } from './views/source';
import { sourcesView } from './views/sources';
import { searchView } from './search';
import { calendarView, hidePrivateEvents } from '../next/calendarView';
import { moneyView } from '../next/moneyView';
import { healthView, leaveOutPrivate } from '../next/healthView';
import { papersView } from '../next/papersView';
import { eventView } from '../next/eventView';
import { providerView } from '../next/providerView';
import { RECHECK } from '../paper/view';

/** What the app says when a renewal interrupted a write the person asked for. */
const UNSENT_TEXT: Record<Unsent, string> = {
  refresh: 'The refresh request was not sent: tap Refresh again.',
  cancel: 'The request was not cancelled: tap Cancel again.',
  paid: 'The payment was not marked: open the bill and tap Mark paid again.',
  undo: 'The payment was not undone: tap Undo again.',
};

const KEPT_CLIENT = 'The link you opened has no valid Google client id, so the app kept its own.';

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
  private rereads: Rereads | null = null;
  private main = h('main', { class: 'main', id: 'main' });
  private bar = h('header', { class: 'app-bar' });
  private banner = h('div', { class: 'banner-slot', 'aria-live': 'polite' });
  /** A newer build of the app is on the site: a line that stays until the page reloads. */
  private update = h('div', { class: 'banner-slot', 'aria-live': 'polite' });
  private lookForUpdate = updateWatcher({
    current: buildOf(document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? ''),
    fetchPage: fetchAppPage,
    now: () => Date.now(),
    onNew: () =>
      this.update.replaceChildren(
        h('div', { class: 'banner banner-update', role: 'status' }, h('span', null, 'A new version of the app is ready.'), button('Reload', () => location.reload(), { small: true })),
      ),
  });
  /** The tabs, once the folder is read. */
  private tabs = h('div', { class: 'tabs-slot' });
  private toastBox = h('div', { class: 'toast-slot', 'aria-live': 'polite' });
  private toastTimer: number | undefined;
  private signature = '';
  /** The folder's state changed while the page held input; it is drawn when the input is let go. */
  private stale = false;
  private pollTimer: number | undefined;
  /** Ends what the page drawn now started. */
  private leave = new AbortController();

  constructor(private readonly root: HTMLElement) {
    this.demo = new URLSearchParams(location.search).has('demo');
    // The redesign was behind ?next; it is the app now, so an old link's ?next is dropped from the address.
    const kept = location.search.slice(1).split('&').filter((part) => part && part.split('=')[0] !== 'next');
    if (kept.length !== location.search.slice(1).split('&').filter(Boolean).length) history.replaceState(null, '', `${location.pathname}${kept.length ? `?${kept.join('&')}` : ''}${location.hash}`);
    root.append(this.bar, this.banner, this.update, this.tabs, this.main, this.toastBox);
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
    // Leaving or emptying a text field draws a change the poll held back for it.
    // So does closing a paper. After the event, so focus has moved on by the time it is checked.
    for (const type of ['focusout', 'input', 'close']) this.main.addEventListener(type, () => window.setTimeout(() => this.drawIfStale(), 0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void this.lookForUpdate();
      if (this.signInEnded()) return this.renew();
      void this.pollOnce(true);
    });
    const answer = this.demo ? ({ kind: 'none' } as const) : completeSignIn(location.hash, sessionStorage, Date.now());
    if (answer.kind !== 'none') history.replaceState(null, '', `${location.pathname}${location.search}${answer.route}`);
    // A setup link's client leaves the address before anything else runs,
    // so it is never carried into Google's sign-in or a bookmark.
    const link = readSetupLink(location, getClientId());
    if (link.kind !== 'none') history.replaceState(null, '', withoutClient(location));
    if (this.demo) return this.startDemo();

    if (answer.kind === 'none') {
      switch (link.kind) {
        case 'new':
          setClientId(link.clientId);
          return this.signIn(false, true);
        case 'same':
          return getFolder() ? this.signIn(true) : this.signIn(false, true);
        case 'different':
          return this.askClient(link, () => this.resume());
        case 'invalid':
          if (!getClientId()) {
            return this.show({ name: 'welcome', error: 'The link you opened has no valid Google client id. Ask for the setup link again, or paste the client id here.' });
          }
          this.toast(KEPT_CLIENT, 'error');
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

  /** A setup link names another client than this browser's: use it only when the person says so. */
  private askClient(link: Extract<SetupLink, { kind: 'different' }>, keep: () => void): void {
    this.show({
      name: 'message',
      title: 'Use the client in this link?',
      text: `This browser signs in through the Google client ${link.current}. The link you opened names ${link.clientId}. Use the link’s client if this device belongs to that household.`,
      actions: [button('Use the link’s client', () => (setClientId(link.clientId), this.signIn(false, true)), { primary: true }), button('Keep the current one', keep)],
    });
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
      const text = await whyNotOpened(this.drive, f.id, e, this.user.email);
      return this.show({ name: 'message', title: 'That folder could not be opened', text, actions: [button('Choose a folder', () => this.show({ name: 'folder' }), { primary: true })] });
    }
    setFolder(f);
    this.opened(store);
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
    this.opened(store);
    this.scopes = [SCOPE_READ, SCOPE_WRITE];
    this.user = { name: 'Sample visitor' };
    this.demoMac = startDemoMac(folder, () => void this.pollOnce());
    this.show({ name: 'ready' });
    this.startPolling();
  }

  private opened(store: Store): void {
    this.store = store;
    this.rereads = new Rereads(store, () => Date.now(), (text) => store === this.store && this.toast(text, 'error'));
  }

  private startPolling(): void {
    window.clearInterval(this.pollTimer);
    // While a request waits, look for the Mac's answer: two Drive listings
    // and a status read per look.
    this.pollTimer = window.setInterval(() => {
      if ((this.store?.waiting || this.rereads?.due()) && document.visibilityState === 'visible') void this.pollOnce();
    }, this.demo ? 1500 : 30_000);
  }

  /** Looks for the Mac's answer, draws it, and reads the records again when that is due. */
  private async pollOnce(front = false): Promise<void> {
    const { store, rereads } = this;
    if (!store || !rereads || (!this.demo && !this.token)) return;
    // With Drive out, a read that is due fails as well: it counts as a try, and is said.
    await store.loadRefreshState().catch(() => undefined);
    this.drawIfNew(store);
    await rereads.look(front);
    this.drawIfNew(store);
  }

  /** Draws the page again when what it shows has changed. */
  private drawIfNew(store: Store): void {
    if (store !== this.store) return;
    const sig = this.stateSignature();
    if (sig === this.signature) return;
    // Held back, not dropped: the poll stops once nothing is pending, so the change is drawn when the input is let go.
    if (this.holdsInput()) {
      this.stale = true;
      // What is open may be no longer.
      for (const p of this.main.querySelectorAll('.paper:not([hidden])')) p.dispatchEvent(new Event(RECHECK));
      return;
    }
    this.signature = sig;
    this.renderKeepingScroll();
  }

  private drawIfStale(): void {
    if (!this.stale || this.holdsInput()) return;
    this.signature = this.stateSignature();
    this.renderKeepingScroll();
  }

  /**
   * Whether drawing the page again would lose what someone is doing: a search
   * page (its words, filters and results), any text field on the page that
   * has focus or has been typed in (the setup screens'), or a paper open on it.
   */
  private holdsInput(): boolean {
    const r = parseRoute(location.hash);
    if (r.name === 'search' || (r.name === 'person' && r.section === 'search')) return true;
    if (this.main.querySelector('.paper:not([hidden])')) return true;
    return [...this.main.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].some((el) => {
      if (el instanceof HTMLInputElement && !['text', 'search', 'email', 'url'].includes(el.type)) return false;
      return el === document.activeElement || el.value !== el.defaultValue;
    });
  }

  private stateSignature(): string {
    const st = this.store;
    if (!st) return '';
    return JSON.stringify([st.status.kind === 'ok' ? st.status.status.updated_at : st.status.kind, st.pending.map((p) => p.file), st.marks.map((m) => [m.file, m.taken]), st.answeredMarks.length, st.mayRequest, st.done.length, st.refused.length, st.snapshot]);
  }

  private ctx(): Ctx {
    return {
      store: this.store!,
      demo: this.demo,
      user: this.user,
      canWrite: this.demo || this.scopes.includes(SCOPE_WRITE),
      version: VERSION,
      now: () => this.now(),
      go: (r: Route) => (location.hash = href(r)),
      render: () => this.render(),
      leaving: this.leave.signal,
      toast: (t, kind) => this.toast(t, kind),
      refresh: (scope, what) => this.refresh(scope, what),
      cancel: async (p) => {
        const mark = 'scope' in p.request ? null : p.request;
        this.writing = mark ? 'undo' : 'cancel';
        try {
          const back = await this.store!.cancel(p);
          this.toast(!back ? 'The Mac had already taken it' : mark ? 'The request is taken back' : 'Request cancelled');
          if (!back) void this.pollOnce();
        } catch (e) {
          // A renewal is leaving the page; it says so when it comes back.
          if (this.renewing) return;
          this.toast(e instanceof Error ? e.message : `The request could not be ${mark ? 'undone' : 'cancelled'}.`, 'error');
        } finally {
          this.writing = null;
        }
        this.renderKeepingScroll();
      },
      mark: (mark, failed, stands) => this.mark(mark, failed, stands),
      signOut: () => this.signOut(),
    };
  }

  private async refresh(scope: RequestScope, what: string): Promise<void> {
    await this.ask('refresh', (store) => store.requestRefresh(scope, this.user, VERSION), `Asked the Mac to refresh ${what}`);
  }

  private mark(mark: Mark, failed?: (text: string) => void, stands?: () => boolean): Promise<boolean> {
    const paid = 'paid' in mark;
    return this.ask(paid ? 'paid' : 'undo', (store) => store.requestMark(mark, this.user, VERSION, stands), paid ? 'Marked paid. The Mac files it on its next pass.' : 'Asked the Mac to undo the payment', failed);
  }

  /** Writes a request, and says whether it was sent. */
  private async ask(writing: Unsent, send: (store: Store) => Promise<{ file: string }>, sent: string, failed = (text: string) => this.toast(text, 'error')): Promise<boolean> {
    const store = this.store;
    if (!store) return false;
    this.writing = writing;
    let ok = false;
    try {
      const p = await send(store);
      ok = true;
      this.demoMac?.(p.file);
      this.signature = this.stateSignature();
      this.toast(sent);
    } catch (e) {
      // A renewal is leaving the page; it says so when it comes back.
      if (this.renewing) return false;
      const text =
        e instanceof DriveError && e.status === 403
          ? 'Google did not let the app write the request into this folder. Check that this account may edit the records folder.'
          : e instanceof Error
            ? e.message
            : 'The request could not be written.';
      failed(text);
    } finally {
      this.writing = null;
    }
    this.renderKeepingScroll();
    return ok;
  }

  // Signing out forgets the token and does not revoke it. Google's revoke ends
  // every sign-in to the Cloud project, medrec's on the Mac too when it signs
  // in through the household's project; the token lasts an hour at most, and
  // only this page held it.
  private signOut(): void {
    this.token = null;
    this.store = null;
    this.rereads = null;
    this.drive = null;
    window.clearInterval(this.pollTimer);
    setAccount(null);
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
    const link = readSetupLink({ search: '', hash: location.hash }, getClientId());
    if (link.kind !== 'none') {
      // Only the part after # changed, so nothing loaded: start again with it, unless that would sign the person out for nothing.
      const ready = this.phase.name === 'ready';
      const stays = this.demo || (this.token !== null && (link.kind === 'same' || link.kind === 'invalid' || (link.kind === 'different' && ready)));
      if (!stays) return location.reload();
      history.replaceState(null, '', withoutClient(location));
    }
    // Private events shown on the calendar, and private items on a doctor’s sheet, are left off again once the page is left. A setup link leaves it, whatever page it goes to.
    const now = parseRoute(location.hash);
    if (link.kind !== 'none' || now.name !== 'calendar') hidePrivateEvents();
    leaveOutPrivate(link.kind === 'none' ? now : { name: 'home' });
    if (!this.demo && link.kind === 'different') return this.askClient(link, () => this.show({ name: 'ready' }));
    if (!this.demo && link.kind === 'invalid') this.toast(KEPT_CLIENT, 'error');
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
              this.menuButton(),
            )
          : null,
      ),
    );
    this.tabs.replaceChildren(...(ready ? [tabBar(parseRoute(location.hash))] : []));
    if (this.demo && ready) {
      this.banner.replaceChildren(h('div', { class: 'banner banner-sample' }, h('span', { class: 'chip chip-attention' }, 'Sample data'), h('span', null, 'Invented records. Nothing is saved.')));
    }
  }

  /** The one clock the views and the bar read. */
  private now(): Date {
    return new Date();
  }

  /** The menu: the sources and the settings, with a dot while a source needs attention at the Mac. */
  private menuButton(): HTMLElement {
    const alert = this.store ? needsAttention(this.store.sources(this.now())).length > 0 : false;
    const open = () => {
      const close = () => panel.querySelector<HTMLElement>('.sheet-head .icon-button')?.click();
      const item = (route: Route, text: string, extra?: string) => h('a', { class: 'menu-item', href: href(route), on: { click: close } }, text, extra ? h('span', { class: 'menu-note' }, extra) : null);
      const body = h(
        'div',
        { class: 'menu-list' },
        item({ name: 'sources' }, 'Sources', alert ? 'A source needs attention' : undefined),
        item({ name: 'settings' }, 'Settings'),
      );
      const panel = sheet('Menu', body, () => menu.focus());
      document.body.appendChild(panel);
      panel.querySelector<HTMLElement>('.menu-item')?.focus();
    };
    const menu = h(
      'button',
      { type: 'button', class: ['icon-button', alert ? 'icon-button-alert' : null], 'aria-label': alert ? 'Menu: a source needs attention' : 'Menu', 'aria-haspopup': 'dialog', on: { click: open } },
      icon('menu'),
    );
    return menu;
  }

  render(): void {
    // Whatever the page held back, this draw shows the folder as it is now.
    this.stale = false;
    // An address from before the redesign opens where its page lives now.
    const to = moved(parseRoute(location.hash));
    if (to) history.replaceState(null, '', href(to));
    this.renderBar();
    this.leave.abort();
    this.leave = new AbortController();
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
        this.main.append(folderView(this.drive, { account: this.user.email, onPick: (f) => this.openFolder(f), onDifferentAccount: () => this.differentAccount() }));
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
            this.signOut();
            this.show({ name: 'welcome' });
          },
        });
      case 'sources':
        return sourcesView(ctx);
      case 'costs':
        return costsView(ctx, r);
      case 'search':
        return searchView(ctx, r.query, r.words, r.who);
      case 'source':
        return sourceView(ctx, r.source);
      case 'person':
        return isListSection(r.section) ? personView(ctx, r.person, r.section, r.sub) : messageView('Page not found', 'That link does not match anything in the app.');
      case 'item':
        return itemView(ctx, r.person, r.id);
      case 'event':
        return eventView(ctx, r.person, r.id);
      case 'provider':
        return providerView(ctx, r);
      case 'health':
        return healthView(ctx, r);
      case 'papers':
        return papersView(ctx, r);
      case 'money':
        return moneyView(ctx, r);
      case 'calendar':
        return calendarView(ctx, r);
      case 'huishouden': {
        const person = this.store!.personForHuishouden(r.hh);
        if (person) {
          const to: Route = { name: 'health', who: person.id };
          history.replaceState(null, '', href(to));
          this.renderBar();
          return healthView(ctx, to);
        }
        return messageView('Not linked yet', 'No one in this records folder is linked to that Huishouden Health person. Link them on the Mac with medrec.');
      }
      case 'not_found':
        return messageView('Page not found', 'That link does not match anything in the app.', [h('a', { class: 'button button-primary', href: '#/' }, 'Home')]);
    }
  }
}
