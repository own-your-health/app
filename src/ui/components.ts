// Small building blocks shared by the views.

import type { PendingRequest } from '../data/store';
import type { Store } from '../data/store';
import { requestWait } from '../model/sources';
import type { RequestScope } from '../model/types';
import { h, icon, type Child } from './dom';
import { relative } from './format';
import type { Route } from './router';
import { href } from './router';

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
  toast(text: string, kind?: 'info' | 'error'): void;
  refresh(scope: RequestScope, what: string): Promise<void>;
  cancel(p: PendingRequest): Promise<void>;
  signOut(): void;
}

export type Tone = 'ok' | 'attention' | 'muted' | 'error' | 'running';

export function chip(text: string, tone: Tone = 'muted'): HTMLElement {
  return h('span', { class: ['chip', `chip-${tone}`] }, text);
}

export function card(opts: { title?: string; class?: string; actions?: Child }, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: ['card', opts.class] },
    opts.title || opts.actions ? h('div', { class: 'card-head' }, opts.title ? h('h2', null, opts.title) : null, opts.actions ?? null) : null,
    ...children,
  );
}

export function link(route: Route, ...children: Child[]): HTMLAnchorElement {
  return h('a', { href: href(route) }, ...children);
}

export function row(opts: { route?: Route; title: Child; meta?: Child; aside?: Child; extra?: Child; class?: string }): HTMLElement {
  const body = h(
    'div',
    { class: 'row-body' },
    h('div', { class: 'row-title' }, opts.title),
    opts.meta ? h('div', { class: 'row-meta' }, opts.meta) : null,
  );
  const main = opts.route ? h('a', { class: 'row-main', href: href(opts.route) }, body, h('span', { class: 'row-chevron' }, icon('next', 18))) : h('div', { class: 'row-main' }, body);
  return h('div', { class: ['row', opts.class] }, h('div', { class: 'row-line' }, main, opts.aside ? h('div', { class: 'row-aside' }, opts.aside) : null), opts.extra ?? null);
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

/** Refresh for a scope: a button, or the request already waiting with a cancel. */
export function refreshControl(ctx: Ctx, scope: RequestScope, what: string, opts: { primary?: boolean } = {}): HTMLElement {
  const store = ctx.store;
  const held = store.pendingFor(scope);
  if (held) {
    const now = ctx.now();
    const wait = requestWait(held.request, store.sources(), store.mac(now), now);
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
  return button(
    opts.primary ? `Refresh ${what}` : 'Refresh',
    (ev) => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      void ctx.refresh(scope, what).finally(() => (b.disabled = false));
    },
    { primary: opts.primary, icon: 'refresh', small: !opts.primary, title: `Ask the Mac to load ${what} again` },
  );
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

export function sheet(title: string, body: Child, onClose: () => void): HTMLElement {
  const close = () => {
    document.removeEventListener('keydown', onKey);
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
    if (e.key === 'Escape' || !scrim.isConnected) close();
  };
  document.addEventListener('keydown', onKey);
  return scrim;
}
