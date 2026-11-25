// What a list of a person's own says of their chart's items about somebody
// else (src/model/aboutAnother.ts).

import { aboutText, unsureText } from '../model/aboutAnother';
import type { PersonIndex } from '../model/types';
import { h } from './dom';

/** That some of what is here may be about somebody else, where that is not known. */
export function unsureNote(idx: PersonIndex): HTMLElement | null {
  const text = unsureText(idx);
  return text ? h('p', { class: 'small muted' }, text) : null;
}

/** How many a list leaves out. */
export const aboutNote = (idx: PersonIndex): HTMLElement | null => (idx.about ? h('p', { class: 'small muted' }, `${aboutText(idx.about)}.`) : null);
