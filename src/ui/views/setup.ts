// Before the records: the household's own Google client id, sign-in, and
// choosing the records folder.

import { readPaste, type Paste } from '../../setup-link';
import { Drive } from '../../drive';
import { findFolders, folderOfLink, type Candidate } from '../../find-folder';
import { button, card, empty, outLink } from '../components';
import { h } from '../dom';
import { dateTime } from '../format';

/** The project's own page, which says what Own Your Health is. */
export const SITE_URL = 'https://own-your-health.github.io/';
export const REPO_URL = 'https://github.com/own-your-health/app';
export const REGISTRATION_URL = `${REPO_URL}/blob/main/docs/registration.md`;
/** From nothing to the records on a phone: medrec, its folder, the providers, the client, the app. */
export const GETTING_STARTED_URL = `${REPO_URL}/blob/main/docs/getting-started.md`;
export const MEDREC_URL = 'https://github.com/own-your-health/medrec-cli';
/** The privacy policy, a static page next to the app. */
export const PRIVACY_URL = './privacy.html';

function demoLink(): HTMLElement {
  return h('a', { class: 'button button-outline', href: './?demo' }, 'Try it with sample records');
}

function intro(): HTMLElement {
  return h(
    'div',
    { class: 'intro' },
    h('h1', null, 'Your household’s health records, in your browser'),
    h(
      'p',
      null,
      'Own Your Health is a free, open-source app for looking through your household’s health records: visits, results, medicines, claims and what care cost. It shows the records folder that medrec, its companion tool, keeps in your own Google Drive.',
    ),
    h('p', null, 'The app runs in this browser and has no server. Nothing from your records is sent anywhere but back to your Drive.'),
    h(
      'ul',
      { class: 'intro-links' },
      h('li', null, outLink(SITE_URL, 'About the project')),
      h('li', null, outLink(REPO_URL, 'Source code on GitHub')),
      h('li', null, h('a', { href: PRIVACY_URL }, 'Privacy policy')),
    ),
  );
}

/**
 * Google's own Sign in with Google button: the pre-approved images from its
 * branding guidelines (public/google-sign-in/), light or dark with the theme,
 * so the button is Google's and nothing on the page imitates Google's sign-in.
 */
function googleButton(onClick: () => void): HTMLButtonElement {
  const image = (theme: 'light' | 'dark') =>
    h('img', {
      class: `google-button-${theme}`,
      src: `./google-sign-in/${theme}-1x.png`,
      srcset: [1, 2, 3, 4].map((n) => `./google-sign-in/${theme}-${n}x.png ${n}x`).join(', '),
      width: '180',
      height: '40',
      alt: '',
    });
  return h('button', { type: 'button', class: 'google-button', 'aria-label': 'Sign in with Google', on: { click: onClick } }, image('light'), image('dark'));
}

const PASTE_PROBLEM: Record<Exclude<Paste['kind'], 'client'>, string> = {
  bad_link: 'That link has no valid Google client id; it may have been cut short. Copy the setup link again from Settings on a device that is set up.',
  other_site: 'That link is not this app’s setup link. Copy it from Settings, under Setup link for another device.',
  bad: 'That is not a Google OAuth client id or a setup link. A client id ends in .apps.googleusercontent.com.',
};

export function welcomeView(onSave: (clientId: string) => void, error?: string): HTMLElement {
  const input = h('input', { class: 'input', type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: '123456789012-abc….apps.googleusercontent.com', 'aria-label': 'Google OAuth client id or setup link' });
  const msg = h('p', { class: 'error-text small', 'aria-live': 'polite' }, error ?? '');
  const save = () => {
    const paste = readPaste(input.value, location.origin);
    if (paste.kind === 'client') return onSave(paste.clientId);
    msg.textContent = PASTE_PROBLEM[paste.kind];
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  return h(
    'div',
    { class: 'stack narrow' },
    intro(),
    card(
      { title: 'First, a records folder' },
      h('p', null, 'The app shows a records folder that medrec made in your Google Drive. medrec is a free command-line tool that runs in a terminal on a Mac or a Linux computer: it files your documents and fetches records from your providers into that folder.'),
      h('p', null, 'No folder yet? Set up medrec first. The Google client below comes after.'),
      h('ul', { class: 'link-list' }, h('li', null, outLink(GETTING_STARTED_URL, 'Getting started, from nothing to your records here')), h('li', null, outLink(MEDREC_URL, 'medrec'))),
    ),
    card(
      { title: 'Your Google client' },
      h('p', null, 'Each household signs in through its own Google OAuth client, so no one else’s app holds access to your Drive. Creating one takes about ten minutes in Google Cloud, free.'),
      h('p', null, outLink(REGISTRATION_URL, 'How to create your Google client')),
      h('p', { class: 'muted small' }, 'Someone in your household already uses the app? Ask them for the setup link in its Settings: opening it on this device skips this step. In an app added to an iPhone’s Home Screen, paste the link here instead.'),
      h('label', { class: 'label' }, 'Client id or setup link', input),
      msg,
      h('div', { class: 'actions' }, button('Save', save, { primary: true })),
    ),
    card({ title: 'Just looking?' }, h('p', null, 'The sample records are invented. Nothing is read from or written to any Drive.'), demoLink()),
  );
}

export function signInView(onSignIn: () => void, opts: { error?: string; account: string | null; onDifferentAccount: () => void; onChangeClient: () => void }): HTMLElement {
  return h(
    'div',
    { class: 'stack narrow' },
    intro(),
    card(
      { title: 'Sign in' },
      h('p', null, 'Sign in with the Google account that holds the records folder, or one it is shared with. The app asks Google for two things: to read your Drive, and to create files of its own, which it uses only to ask your Mac to refresh or to mark a bill paid.'),
      opts.error ? h('p', { class: 'error-text' }, opts.error) : null,
      opts.account ? h('p', { class: 'muted small' }, `As ${opts.account}, the account that signed in last.`) : null,
      h(
        'div',
        { class: 'actions' },
        googleButton(onSignIn),
        opts.account ? button('Use a different account', opts.onDifferentAccount, { ghost: true }) : null,
        button('Use another Google client', opts.onChangeClient, { ghost: true }),
      ),
    ),
    card({ title: 'Just looking?' }, demoLink()),
  );
}

/** Whose a folder is when it is not the account's own, and that it can only view it. */
function sharing(c: Candidate): string | null {
  const by = c.owner === undefined ? null : c.owner ? `Shared by ${c.owner}` : 'Shared with you';
  return c.viewOnly ? `${by}, to view only` : by;
}

/** Finds folders holding a household.json, those shared with the account too, and takes a pasted link. */
export function folderView(drive: Drive, opts: { account?: string; onPick: (f: { id: string; name: string }) => Promise<void>; onDifferentAccount: () => void }): HTMLElement {
  const { account } = opts;
  const list = h('div', { 'aria-live': 'polite' });
  const msg = h('p', { class: 'error-text small', 'aria-live': 'polite' });
  const pick = (c: { id: string; name: string }) => {
    msg.textContent = '';
    void opts.onPick({ id: c.id, name: c.name }).catch((e: unknown) => (msg.textContent = e instanceof Error ? e.message : 'That folder could not be opened.'));
  };
  const lookAgain = () => h('div', { class: 'actions' }, button('Look again', () => void look()));
  const look = async () => {
    list.replaceChildren(h('p', { class: 'muted' }, 'Looking for records folders in your Drive, and in what is shared with you…'));
    try {
      const candidates = await findFolders(drive);
      list.replaceChildren(
        candidates.length
          ? h(
              'div',
              null,
              candidates.map((c) =>
                h(
                  'div',
                  { class: 'row' },
                  h(
                    'div',
                    { class: 'row-line' },
                    h('div', { class: 'row-main' }, h('div', { class: 'row-body' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-meta' }, [sharing(c), c.modified ? `household.json changed ${dateTime(c.modified)}` : null].filter(Boolean).join(' · ')))),
                    h('div', { class: 'row-aside' }, button('Open', () => pick(c), { primary: true, small: true })),
                  ),
                ),
              ),
            )
          : h(
              'div',
              null,
              empty('No folder with a household.json was found in this account, or in the folders shared with it.'),
              h('p', null, `If someone else keeps the records, ask them to share the folder with ${account ?? 'this account'} in Google Drive. Then look again, or paste its link below.`),
              h('p', null, 'If no one does yet, medrec makes the folder: ', outLink(GETTING_STARTED_URL, 'Getting started with medrec')),
              lookAgain(),
            ),
      );
    } catch (e) {
      list.replaceChildren(empty(e instanceof Error ? e.message : 'Drive did not answer.'), lookAgain());
    }
  };
  void look();
  const input = h('input', { class: 'input', type: 'url', autocomplete: 'off', placeholder: 'https://drive.google.com/drive/folders/…', 'aria-label': 'Folder link' });
  const openLink = async () => {
    const of = await folderOfLink(drive, input.value, account);
    if (typeof of === 'string') msg.textContent = of;
    else pick(of);
  };
  return h(
    'div',
    { class: 'stack narrow' },
    card({ title: 'Choose the records folder' }, h('p', { class: 'muted small' }, 'The folder medrec keeps, with household.json at its top.'), list),
    card({ title: 'Or paste its link' }, h('label', { class: 'label' }, 'Folder link', input), msg, h('div', { class: 'actions' }, button('Open', () => void openLink()))),
    card({}, h('p', { class: 'muted small' }, account ? `Signed in as ${account}.` : 'Signed in to Google.'), h('div', { class: 'actions' }, button('Use a different account', opts.onDifferentAccount, { ghost: true }))),
  );
}

export function messageView(title: string, text: string, actions: HTMLElement[] = []): HTMLElement {
  return h('div', { class: 'stack narrow' }, card({ title }, h('p', null, text), actions.length ? h('div', { class: 'actions' }, actions) : null));
}
