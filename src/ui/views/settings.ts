// Settings: the Google client, the folder, the account, and what the app
// keeps and sends.

import { SCOPE_READ, SCOPE_WRITE } from '../../auth';
import { button, card, kv, type Ctx } from '../components';
import { h } from '../dom';
import { dateTime } from '../format';
import { PRIVACY_URL, REGISTRATION_URL, REPO_URL } from './setup';
import { getPlanStart, getTheme, setPlanStart, setTheme, type Theme } from '../../settings';
import { applyTheme } from '../../theme';
import { heldPeople } from '../../next/shared';

/** Who grouped the records into visits: medrec's events (0.9.0 and later), else the app. */
function visitsText(ctx: Ctx): string {
  const { store } = ctx;
  if (store.viewsError) return 'Grouped by this app';
  const people = store.household.people;
  const byMedrec = people.filter((p) => store.index(p.id)?.events).length;
  if (byMedrec === people.length && people.length) return 'Grouped by medrec';
  if (byMedrec === 0 && store.eventsNotes.size === 0) return 'Grouped by this app: medrec groups them itself from 0.9.0';
  return `Grouped by medrec for ${byMedrec} of ${people.length} people`;
}

/** Why the app groups anyone's visits itself when medrec wrote them, one line each. */
function visitsNotes(ctx: Ctx): HTMLElement[] {
  const { store } = ctx;
  if (store.viewsError) return [h('p', { class: 'small muted' }, store.viewsError.text)];
  return store.household.people.flatMap((p) => {
    const note = store.eventsNotes.get(p.id);
    return note ? [h('p', { class: 'small muted' }, `${p.name}: ${note.text}`)] : [];
  });
}

/** Whether medrec's list of private items is in use: read for everyone, or for how many; everyone else's items are off shared screens. */
function privateText(ctx: Ctx): string {
  const people = ctx.store.household.people.filter((p) => ctx.store.index(p.id));
  const held = heldPeople(ctx.store).length;
  if (!held) return 'Left off shared screens, as medrec lists them';
  return held === people.length ? 'Not listed: everyone’s items are left off shared screens' : `Listed for ${people.length - held} of ${people.length} people: the rest’s items are all left off shared screens`;
}

export function settingsView(
  ctx: Ctx,
  opts: { clientId: string | null; setupLink: string | null; scopes: string[]; onChangeFolder: () => void; onChangeClient: () => void },
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
        ['Visits', visitsText(ctx)],
        ['Private items', privateText(ctx)],
      ]),
      ...visitsNotes(ctx),
      ...heldPeople(ctx.store).map(({ person, why }) => h('p', { class: 'small muted' }, `${person.name}: ${why}`)),
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
          h('p', { class: 'small muted' }, 'Signing out forgets this browser’s sign-in. medrec on the Mac stays signed in.'),
        ),
    ctx.demo || !opts.setupLink ? null : setupLinkCard(ctx, opts.setupLink),
    themeCard(),
    planYearCard(ctx),
    card(
      { title: 'What this app keeps and sends' },
      h('ul', { class: 'plain' },
        h('li', null, 'Your records stay in your Drive and in this page’s memory. Closing the page forgets them.'),
        h('li', null, 'Browser storage holds only your Google client id, which folder to open, the email of the Google account that signed in (so the next sign-in needs no account chooser), the theme you chose, and the month your plan year starts, if you set it.'),
        h('li', null, 'The Google sign-in lives in memory and ends within an hour.'),
        h('li', null, 'The page talks only to Google: the sign-in and the Drive API. It loads no other scripts, fonts or trackers.'),
        h('li', null, 'The only files it writes are refresh requests in the folder’s _requests/ folder.'),
      ),
      h(
        'p',
        null,
        h('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener' }, 'Privacy policy'),
        ' · ',
        h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Source code'),
        ' · ',
        h('a', { href: REGISTRATION_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Setting up a Google client'),
      ),
      h('p', { class: 'muted small' }, `Version ${ctx.version}`),
    ),
  );
}

const THEMES: [Theme, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/** Light, dark, or the device's setting; it applies at once and on every open. */
function themeCard(): HTMLElement {
  const current = getTheme();
  const pick = (ev: Event) => {
    const theme = (ev.currentTarget as HTMLInputElement).value as Theme;
    setTheme(theme);
    applyTheme(theme);
  };
  return card(
    { title: 'Theme' },
    h(
      'div',
      { class: 'choices', role: 'radiogroup', 'aria-label': 'Theme' },
      THEMES.map(([value, label]) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'theme', value, checked: value === current, on: { change: pick } }), h('span', null, label))),
    ),
    h('p', { class: 'muted small' }, 'System follows this device’s light or dark setting.'),
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The month the household's plan year starts, for Costs, when the plan's own
 * claims do not say. Not the day coverage started: that moves when coverage
 * changes mid-year.
 */
function planYearCard(ctx: Ctx): HTMLElement {
  const current = getPlanStart();
  const select = h(
    'select',
    {
      class: 'input',
      id: 'plan-year-start',
      on: {
        change: (ev: Event) => {
          const v = (ev.currentTarget as HTMLSelectElement).value;
          setPlanStart(v || null);
          ctx.toast(v ? `Plan year set to start ${MONTHS[Number(v.slice(0, 2)) - 1]} 1` : 'Plan year set to the calendar year');
        },
      },
    },
    h('option', { value: '', selected: !current }, 'Not set: the calendar year'),
    MONTHS.map((m, i) => {
      const v = `${String(i + 1).padStart(2, '0')}-01`;
      return h('option', { value: v, selected: current === v }, `${m} 1`);
    }),
  );
  return card(
    { title: 'Plan year' },
    h('p', null, 'Costs counts deductibles and out-of-pocket limits by plan year. When a plan’s claims give its year, Costs uses that. Otherwise it uses the month set here, or the calendar year.'),
    h('label', { class: 'label', for: 'plan-year-start' }, 'Plan year starts'),
    select,
    h('p', { class: 'muted small' }, 'Your plan’s documents or benefits site say when its year starts. It is often January 1, or the month an employer’s benefits renew.'),
  );
}

/** The address that sets up another phone or computer in one tap. */
function setupLinkCard(ctx: Ctx, link: string): HTMLElement {
  const copy = () =>
    navigator.clipboard.writeText(link).then(
      () => ctx.toast('Setup link copied'),
      () => ctx.toast('Copying did not work. Select the link and copy it.', 'error'),
    );
  const share = () => void navigator.share({ title: 'Own Your Health', url: link }).catch(() => undefined);
  return card(
    { title: 'Setup link for another device' },
    h('p', null, 'Open this link on another phone or computer to set the app up there: it fills in your Google client and goes straight to sign-in.'),
    h('p', { class: 'muted small' }, 'It is fine to share with your household. The client id is not a secret, and only the test users listed for your Google client can sign in through it.'),
    h('code', { class: 'wrap setup-link' }, link),
    h(
      'div',
      { class: 'actions' },
      button('Copy', () => void copy(), { primary: true, icon: 'copy' }),
      typeof navigator.share === 'function' ? button('Share', share, { icon: 'external' }) : null,
    ),
  );
}
