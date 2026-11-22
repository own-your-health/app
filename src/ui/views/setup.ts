// Before the records: the household's own Google client id, sign-in, and
// choosing the records folder.

import { clientFromPaste } from '../../setup-link';
import { Drive, folderIdFrom, FOLDER_MIME, HOUSEHOLD_QUERY } from '../../drive';
import { button, card, empty } from '../components';
import { h } from '../dom';
import { dateTime } from '../format';

export const REPO_URL = 'https://github.com/own-your-health/app';
export const REGISTRATION_URL = `${REPO_URL}/blob/main/docs/registration.md`;

function demoLink(): HTMLElement {
  return h('a', { class: 'button button-outline', href: './?demo' }, 'Try it with sample records');
}

function intro(): HTMLElement {
  return h(
    'div',
    { class: 'intro' },
    h('h1', null, 'Your household’s health records, from your own Google Drive'),
    h(
      'p',
      null,
      'This page reads the records folder that medrec keeps in your Drive and shows it here, in your browser. Nothing is stored on a server, and nothing from your records is sent anywhere but back to Google Drive.',
    ),
  );
}

export function welcomeView(onSave: (clientId: string) => void, error?: string): HTMLElement {
  const input = h('input', { class: 'input', type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: '123456789012-abc….apps.googleusercontent.com', 'aria-label': 'Google OAuth client id' });
  const msg = h('p', { class: 'error-text small', 'aria-live': 'polite' }, error ?? '');
  const save = () => {
    const id = clientFromPaste(input.value);
    if (!id) {
      msg.textContent = 'That is not a Google OAuth client id or a setup link. A client id ends in .apps.googleusercontent.com.';
      return;
    }
    onSave(id);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  return h(
    'div',
    { class: 'stack narrow' },
    intro(),
    card(
      { title: 'Your Google client' },
      h('p', null, 'Each household signs in through its own Google OAuth client, so no one else’s app holds access to your Drive. Creating one takes about ten minutes in Google Cloud, free.'),
      h('p', null, h('a', { href: REGISTRATION_URL, target: '_blank', rel: 'noopener noreferrer' }, 'How to create your Google client')),
      h('p', { class: 'muted small' }, 'Someone in your household already uses the app? Ask them for the setup link in its Settings: opening it on this device skips this step. In an app added to an iPhone’s Home Screen, paste the link here instead.'),
      h('label', { class: 'label' }, 'Client id or setup link', input),
      msg,
      h('div', { class: 'actions' }, button('Save', save, { primary: true })),
    ),
    card({ title: 'Just looking?' }, h('p', null, 'The sample records are invented. Nothing is read from or written to any Drive.'), demoLink()),
  );
}

export function signInView(onSignIn: () => void, opts: { error?: string; onChangeClient: () => void }): HTMLElement {
  return h(
    'div',
    { class: 'stack narrow' },
    intro(),
    card(
      { title: 'Sign in' },
      h('p', null, 'Sign in with the Google account that holds the records folder, or one it is shared with. The app asks Google for two things: to read your Drive, and to create files of its own, which it uses only to ask your Mac to refresh.'),
      opts.error ? h('p', { class: 'error-text' }, opts.error) : null,
      h('div', { class: 'actions' }, button('Sign in with Google', onSignIn, { primary: true }), button('Use another Google client', opts.onChangeClient, { ghost: true })),
    ),
    card({ title: 'Just looking?' }, demoLink()),
  );
}

interface Candidate {
  id: string;
  name: string;
  modified?: string;
}

/** Finds folders holding a household.json, and takes a pasted link too. */
export function folderView(drive: Drive, onPick: (f: { id: string; name: string }) => Promise<void>): HTMLElement {
  const list = h('div', null, h('p', { class: 'muted' }, 'Looking for records folders in your Drive…'));
  const msg = h('p', { class: 'error-text small', 'aria-live': 'polite' });
  const pick = (c: Candidate) => {
    msg.textContent = '';
    void onPick({ id: c.id, name: c.name }).catch((e: unknown) => (msg.textContent = e instanceof Error ? e.message : 'That folder could not be opened.'));
  };
  void (async () => {
    try {
      const files = await drive.list(HOUSEHOLD_QUERY, { pageSize: 50 });
      const parents = [...new Set(files.flatMap((f) => f.parents ?? []))].slice(0, 20);
      const folders = (await Promise.all(parents.map((id) => drive.get(id).catch(() => null)))).filter((f) => f && f.mimeType === FOLDER_MIME);
      const candidates: Candidate[] = folders.map((f) => ({ id: f!.id, name: f!.name, modified: files.find((x) => x.parents?.includes(f!.id))?.modifiedTime }));
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
                    h('div', { class: 'row-main' }, h('div', { class: 'row-body' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-meta' }, c.modified ? `household.json changed ${dateTime(c.modified)}` : ''))),
                    h('div', { class: 'row-aside' }, button('Open', () => pick(c), { primary: true, small: true })),
                  ),
                ),
              ),
            )
          : empty('No folder with a household.json was found in this account. If the records folder was shared with you, paste its link below.'),
      );
    } catch (e) {
      list.replaceChildren(empty(e instanceof Error ? e.message : 'Drive did not answer.'));
    }
  })();
  const input = h('input', { class: 'input', type: 'url', autocomplete: 'off', placeholder: 'https://drive.google.com/drive/folders/…', 'aria-label': 'Folder link' });
  const openLink = () => {
    const id = folderIdFrom(input.value);
    if (!id) {
      msg.textContent = 'Paste a Drive folder link, like https://drive.google.com/drive/folders/….';
      return;
    }
    void drive.get(id).then(
      (f) => (f.mimeType === FOLDER_MIME ? pick({ id: f.id, name: f.name }) : (msg.textContent = 'That link is a file, not a folder.')),
      () => (msg.textContent = 'This account cannot open that folder.'),
    );
  };
  return h(
    'div',
    { class: 'stack narrow' },
    card({ title: 'Choose the records folder' }, h('p', { class: 'muted small' }, 'The folder medrec keeps, with household.json at its top.'), list),
    card({ title: 'Or paste its link' }, h('label', { class: 'label' }, 'Folder link', input), msg, h('div', { class: 'actions' }, button('Open', openLink))),
  );
}

export function messageView(title: string, text: string, actions: HTMLElement[] = []): HTMLElement {
  return h('div', { class: 'stack narrow' }, card({ title }, h('p', null, text), actions.length ? h('div', { class: 'actions' }, actions) : null));
}
