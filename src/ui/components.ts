// Small building blocks shared by the views.

import type { PendingRequest } from '../data/store';
import type { Store } from '../data/store';
import { isOutOfRange, type ResultFlag } from '../model/flags';
import { requestWait } from '../model/sources';
import type { PaidMark, PendingMark, RequestScope, UnpaidMark } from '../model/types';
import { h, icon, type Child } from './dom';
import { relative } from './format';
import type { Route } from './router';
import { href } from './router';

export type Mark = { paid: PaidMark } | { unpaid: UnpaidMark };

export interface Ctx {
  store: Store;
  demo: boolean;
  user: { email?: string; name?: string };
  /** drive.file was granted (or demo mode): Refresh can write a request. */
  canWrite: boolean;
  version: string;
  now(): Date;
  go(route: Route): void;
  render(): void;
  /** Aborted when this drawing of the page is replaced: a paper open on it is closed. */
  leaving: AbortSignal;
  toast(text: string, kind?: 'info' | 'error'): void;
  refresh(scope: RequestScope, what: string): Promise<void>;
  /** Removes one of the app's own requests while it waits. */
  cancel(p: PendingRequest | PendingMark): Promise<void>;
  /**
   * Asks the Mac to mark a bill paid, or to undo that; whether it was sent.
   * `failed` takes the reason it was not, else a toast does. Nothing is sent
   * when `stands`, asked after a last look at the folder, says no.
   */
  mark(mark: Mark, failed?: (text: string) => void, stands?: () => boolean): Promise<boolean>;
  signOut(): void;
}

export type Tone = 'ok' | 'attention' | 'muted' | 'error' | 'running';

export function chip(text: string, tone: Tone = 'muted'): HTMLElement {
  return h('span', { class: ['chip', `chip-${tone}`] }, text);
}

export function card(opts: { title?: Child; class?: string; actions?: Child }, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: ['card', opts.class] },
    opts.title || opts.actions ? h('div', { class: 'card-head' }, opts.title ? h('h2', null, opts.title) : null, opts.actions ?? null) : null,
    ...children,
  );
}

/** What a line says, dotted apart, with what is not there left out. */
export const dotted = (parts: Child[]): Child[] => parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '').flatMap((p, i) => (i ? [' · ', p] : [p]));

export function link(route: Route, ...children: Child[]): HTMLAnchorElement {
  return h('a', { href: href(route) }, ...children);
}

/** A link that leaves the app: a new tab, no opener, no referrer. */
export function outLink(url: string, ...children: Child[]): HTMLAnchorElement {
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, ...children);
}

/** A number to call; plain text when it is not one to dial. */
export function phoneLink(number: string): Child {
  const digits = number.replace(/[\s().-]/g, '');
  return /^\+?\d{7,15}$/.test(digits) ? h('a', { href: `tel:${digits}` }, number) : number;
}

/** A result's flag as a chip, when it is out of range. */
export function flagChip(flag: ResultFlag | undefined): HTMLElement | null {
  return isOutOfRange(flag) ? chip(flag.label, flag.critical ? 'error' : 'attention') : null;
}

export function row(opts: { route?: Route; title: Child; meta?: Child; aside?: Child; extra?: Child; class?: string }): HTMLElement {
  const body = h(
    'div',
    { class: 'row-body' },
    h('div', { class: 'row-title' }, opts.title),
    opts.meta ? h('div', { class: 'row-meta' }, opts.meta) : null,
  );
  // Several are one under the other, so the title keeps its width on a phone.
  const beside = (Array.isArray(opts.aside) ? opts.aside : [opts.aside]).filter(Boolean);
  const aside = beside.length ? h('div', { class: ['row-aside', beside.length > 1 ? 'chips-aside' : null] }, beside) : null;
  // The arrow is last, at the right edge, so amounts line up and the text keeps its width.
  const main = opts.route ? h('a', { class: 'row-main', href: href(opts.route) }, body, aside, h('span', { class: 'row-chevron' }, icon('next', 18))) : h('div', { class: 'row-main' }, body, aside);
  return h('div', { class: ['row', opts.class] }, h('div', { class: 'row-line' }, main), opts.extra ?? null);
}

export function button(label: Child, onClick: (ev: Event) => void, opts: { primary?: boolean; ghost?: boolean; icon?: string; disabled?: boolean; title?: string; small?: boolean } = {}): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: ['button', opts.primary ? 'button-primary' : opts.ghost ? 'button-ghost' : 'button-outline', opts.small ? 'button-small' : null],
      disabled: opts.disabled ?? false,
      title: opts.title,
      on: { click: onClick },
    },
    opts.icon ? icon(opts.icon, 18) : null,
    h('span', null, label),
  );
}

export function empty(text: string, action?: Child): HTMLElement {
  return h('div', { class: 'empty' }, h('p', null, text), action ?? null);
}

/** A command to type on the Mac, with a copy button. */
export function command(cmd: string, ctx: Pick<Ctx, 'toast'>): HTMLElement {
  return h(
    'div',
    { class: 'command' },
    h('code', null, cmd),
    button(
      'Copy',
      () => {
        navigator.clipboard?.writeText(cmd).then(
          () => ctx.toast('Command copied'),
          () => ctx.toast('Copying is not available here; select the text instead.', 'error'),
        );
      },
      { ghost: true, small: true, icon: 'copy' },
    ),
  );
}

/** A link into Drive's own viewer, resolved when it is shown. */
export function driveLink(ctx: Ctx, path: string, label = 'Open in Drive'): HTMLElement {
  if (ctx.demo) return h('span', { class: 'muted small' }, 'Opens in Drive on a real folder');
  const a = h('a', { class: 'button button-outline button-small', target: '_blank', rel: 'noopener noreferrer', 'aria-disabled': 'true' }, icon('external', 16), h('span', null, label));
  ctx.store.folder.link(path).then(
    (url) => {
      if (url) {
        a.setAttribute('href', url);
        a.removeAttribute('aria-disabled');
      } else {
        a.replaceWith(h('span', { class: 'muted small' }, 'Not found in Drive'));
      }
    },
    () => a.replaceWith(h('span', { class: 'muted small' }, 'Drive did not answer')),
  );
  return a;
}

/** What an account the folder is shared with to view only is told where Refresh would be. */
const VIEW_ONLY_REFRESH = 'This account can only view the records folder, so it cannot ask the Mac to refresh.';

function viewOnlyLink(): HTMLElement {
  const to = link({ name: 'settings' }, 'View only');
  to.setAttribute('aria-label', 'View only: this account cannot ask the Mac to refresh, see Settings');
  return h('span', { class: 'small' }, to);
}

/**
 * Refresh for a scope: a button, or the request already waiting with a cancel,
 * or why there is none. Null beside a list's rows for an account that may only
 * view the folder, which the page says once.
 */
export function refreshControl(ctx: Ctx, scope: RequestScope, what: string, opts: { primary?: boolean; named?: boolean } = {}): HTMLElement | null {
  const store = ctx.store;
  const held = store.pendingFor(scope);
  if (held) {
    const now = ctx.now();
    const wait = requestWait(held.request, store.sources(now), store.mac(now), now);
    const asked = `Asked ${relative(held.request.requested_at, now)}`;
    const text =
      wait.kind === 'loading'
        ? `${asked}; the Mac is loading ${wait.source} for it now`
        : wait.kind === 'busy'
          ? `${asked}; the Mac is loading ${wait.source} and takes this on its next pass`
          : wait.kind === 'late'
            ? `${asked}; the Mac has not taken it yet`
            : `${asked}; waiting for the Mac`;
    return h(
      'div',
      { class: 'refresh-held' },
      h('span', { class: wait.kind === 'late' ? 'attention small' : 'muted small' }, text),
      held.cancellable && sameScopeText(held, scope)
        ? button(
            'Cancel',
            () => {
              void ctx.cancel(held);
            },
            { ghost: true, small: true },
          )
        : null,
    );
  }
  if (!store.requestsReady) return h('span', { class: 'muted small' }, 'Refresh is not set up on the Mac');
  if (!ctx.canWrite) return h('span', { class: 'muted small' }, 'Refresh needs the Drive file permission (Settings)');
  if (!store.mayRequest) return opts.primary ? h('span', { class: 'muted small' }, VIEW_ONLY_REFRESH) : opts.named ? viewOnlyLink() : null;
  const refresh = button(
    opts.primary ? `Refresh ${what}` : 'Refresh',
    (ev) => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      void ctx.refresh(scope, what).finally(() => (b.disabled = false));
    },
    { primary: opts.primary, icon: 'refresh', small: !opts.primary, title: `Ask the Mac to load ${what} again` },
  );
  if (opts.named) refresh.setAttribute('aria-label', `Refresh ${what}`);
  return refresh;
}

function sameScopeText(p: PendingRequest, scope: RequestScope): boolean {
  // A request for everything covers a narrower one, but only the request's
  // own scope offers its cancel.
  return JSON.stringify(p.request.scope) === JSON.stringify(scope);
}

export function kv(pairs: [string, Child][]): HTMLElement {
  return h(
    'dl',
    { class: 'kv' },
    pairs.filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => h('div', { class: 'kv-row' }, h('dt', null, k), h('dd', null, v))),
  );
}

export function jsonBlock(value: unknown): HTMLElement {
  return h('pre', { class: 'json' }, JSON.stringify(value, null, 2));
}

/** A panel over the page. It closes on Escape, beside it, or when the page is left; Tab stays in it. */
export function sheet(title: string, body: Child, onClose: () => void): HTMLElement {
  const close = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    scrim.remove();
    onClose();
  };
  const scrim = h(
    'div',
    { class: 'scrim', on: { click: (e) => e.target === scrim && close() } },
    h(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', on: { click: close } }, icon('close'))),
      body,
    ),
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || !scrim.isConnected) return close();
    if (e.key !== 'Tab') return;
    const stops = [...scrim.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (at > 0 && at < stops.length - 1) return;
    if (e.shiftKey ? at <= 0 : at < 0 || at === stops.length - 1) {
      e.preventDefault();
      stops[e.shiftKey ? stops.length - 1 : 0]?.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  return scrim;
}

/**
 * One choice among a few, as a row of toggle buttons named by `label` ("Filter
 * by kind"). The row marks the pressed button itself, so a caller that leaves
 * it in place keeps keyboard focus on the button just pressed.
 */
export function filterChips<T extends string>(options: [T, string][], current: T, onPick: (v: T) => void, label = 'Filter'): HTMLElement {
  const press = (v: T) => {
    for (const b of buttons) {
      const on = b.dataset.value === v;
      b.classList.toggle('filter-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    onPick(v);
  };
  const buttons = options.map(([v, text]) => h('button', { type: 'button', class: ['filter', v === current ? 'filter-on' : null], 'aria-pressed': v === current ? 'true' : 'false', 'data-value': v, on: { click: () => press(v) } }, text));
  return h('div', { class: 'chips', role: 'group', 'aria-label': label }, buttons);
}
