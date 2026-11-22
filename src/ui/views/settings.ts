// Settings: the Google client, the folder, the account, and what the app
// keeps and sends.

import { SCOPE_READ, SCOPE_WRITE } from '../../auth';
import { button, card, kv, type Ctx } from '../components';
import { h } from '../dom';
import { dateTime } from '../format';
import { REGISTRATION_URL, REPO_URL } from './setup';

export function settingsView(
  ctx: Ctx,
  opts: { clientId: string | null; scopes: string[]; onChangeFolder: () => void; onChangeClient: () => void },
): HTMLElement {
  const f = ctx.store.folder;
  const status = ctx.store.status;
  const refresher = status.kind === 'ok' ? status.status.refresher : undefined;
  return h(
    'div',
    { class: 'stack narrow' },
    card(
      { title: 'Records folder' },
      kv([
        ['Folder', ctx.demo ? 'Sample records (invented)' : f.name],
        ['Layout', `household.json format ${ctx.store.household.format}`],
        ['Read', dateTime(new Date(ctx.store.loadedAt).toISOString())],
        ['Refresh on the Mac', status.kind === 'ok' ? `medrec ${refresher?.medrec_version ?? ''}`.trim() : status.kind === 'missing' ? 'Not set up' : 'Unreadable status'],
      ]),
      ctx.demo ? h('a', { class: 'button button-outline', href: './' }, 'Leave the sample records') : h('div', { class: 'actions' }, button('Choose another folder', opts.onChangeFolder)),
    ),
    ctx.demo
      ? null
      : card(
          { title: 'Google' },
          kv([
            ['Signed in as', [ctx.user.name, ctx.user.email].filter(Boolean).join(' · ') || 'Unknown'],
            ['Read the records', opts.scopes.includes(SCOPE_READ) ? 'Allowed' : 'Not allowed'],
            ['Ask the Mac to refresh', opts.scopes.includes(SCOPE_WRITE) ? 'Allowed' : 'Not allowed: sign in again and tick the box for files this app creates'],
            ['Client id', opts.clientId ? h('code', { class: 'wrap' }, opts.clientId) : undefined],
          ]),
          h('div', { class: 'actions' }, button('Sign out', () => ctx.signOut()), button('Use another Google client', opts.onChangeClient, { ghost: true })),
        ),
    card(
      { title: 'What this app keeps and sends' },
      h('ul', { class: 'plain' },
        h('li', null, 'Your records stay in your Drive and in this page’s memory. Closing the page forgets them.'),
        h('li', null, 'Browser storage holds only your Google client id and which folder to open.'),
        h('li', null, 'The Google sign-in lives in memory and ends within an hour.'),
        h('li', null, 'The page talks only to Google: the sign-in and the Drive API. It loads no other scripts, fonts or trackers.'),
        h('li', null, 'The only files it writes are refresh requests in the folder’s _requests/ folder.'),
      ),
      h('p', null, h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Source code'), ' · ', h('a', { href: REGISTRATION_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Setting up a Google client')),
      h('p', { class: 'muted small' }, `Version ${ctx.version}`),
    ),
  );
}
