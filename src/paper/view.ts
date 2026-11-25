// A paper, shown in the app when someone asks to see it, and only then. Its
// bytes are read from the folder for that, held in memory while it is open and
// dropped when it is closed or its page left: nothing of it is kept in the
// browser, and nothing of it is sent anywhere.

import { DriveError } from '../drive';
import { documentTitle } from '../model/records';
import type { MedDocument } from '../model/types';
import { button, type Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { bytes as sizeText } from '../ui/format';
import { mayShow, MOST_BYTES, SAY_BYTES } from './kind';

/** A paper's button, null where it does not show here, and the place it opens in. */
export function paperView(ctx: Ctx, d: MedDocument): { button: HTMLElement | null; panel: HTMLElement | null } {
  if (!mayShow(d.media_type) || d.size > MOST_BYTES) return { button: null, panel: null };
  const title = documentTitle(d);
  const panel = h('div', { class: 'paper', id: `paper-${d.id}`, hidden: true });
  const label = d.size > SAY_BYTES ? `View (${sizeText(d.size)})` : 'View';
  let open: AbortController | null = null;
  const shut = () => {
    open?.abort();
    open = null;
    panel.hidden = true;
    panel.replaceChildren();
    say(label);
    // The page may draw what it held back (App.holdsInput).
    panel.dispatchEvent(new Event('close', { bubbles: true }));
  };
  const toggle = button(
    label,
    () => {
      if (open) return shut();
      open = new AbortController();
      ctx.leaving.addEventListener('abort', () => open?.abort(), { once: true, signal: open.signal });
      panel.hidden = false;
      say('Hide');
      void show(ctx, d, panel, title, open.signal);
    },
    { small: true },
  );
  const say = (text: string) => {
    toggle.firstElementChild!.textContent = text;
    toggle.setAttribute('aria-label', `${text}: ${title}`);
    toggle.setAttribute('aria-expanded', String(text === 'Hide'));
  };
  toggle.setAttribute('aria-controls', panel.id);
  say(label);
  return { button: toggle, panel };
}

async function show(ctx: Ctx, d: MedDocument, panel: HTMLElement, title: string, signal: AbortSignal): Promise<void> {
  const status = h('p', { class: 'small muted', role: 'status' }, 'Reading the paper…');
  // What draws a paper is loaded with the first one asked for.
  const drawing = import('./draw');
  drawing.catch(() => undefined);
  const progress = h('progress', { class: 'paper-progress', max: d.size || 1, value: 0, 'aria-label': 'Read so far' });
  const bar = h('div', { class: 'paper-bar' }, status);
  panel.replaceChildren(bar, progress);
  const fail = (why: string) => panel.replaceChildren(h('p', { class: 'small attention', role: 'alert' }, why));
  try {
    const read = await ctx.store.folder.readBytes(d.path, { signal, progress: (done) => (progress.value = done) });
    signal.throwIfAborted();
    if (!read) return fail(ctx.demo ? 'The sample does not hold this file.' : 'The file is not in the folder. It may have been moved or renamed.');
    const why = await (await drawing).drawPaper({ bar, status, progress, title, signal }, d.media_type, read);
    if (why && !signal.aborted) fail(why);
  } catch (e) {
    // Closed, or its page left, while it was read.
    if (signal.aborted) return;
    fail(e instanceof DriveError ? `${e.status === 401 ? 'Your Google sign-in ended.' : 'Drive did not give the file.'} Try again, or open it in Drive.` : 'The file was not read. Check the connection and try again.');
  }
}
