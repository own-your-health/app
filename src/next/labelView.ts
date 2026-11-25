// What medrec's label says of a provider, beside the source's own words
// (src/model/providerLabels.ts): who or what it is, how sure that is and why,
// and a phone with where it came from. A likely one is marked so. What the
// printed words already say is not said again, and a label with nothing to
// add shows nothing. On a page the household shares, nothing of a private
// paper, or of what the household said of a private item, is in it.

import { labelOn, saidOn, sharedLabel, type LabelEvidence, type LabelSaid, type ProviderLabel } from '../model/providerLabels';
import { documentTitle } from '../model/records';
import type { MedDocument, PersonIndex } from '../model/types';
import { chip, link, phoneLink } from '../ui/components';
import { h, type Child } from '../ui/dom';
import { dateText, dayOfText } from '../ui/format';
import { sameName } from './providerNames';

/** Who or what the label says it is, without what is printed: "Jordan Sample, MD · family doctor · Sample Health Partners". */
export function labelWords(label: ProviderLabel, printed: string | undefined): string | undefined {
  const says = [label.name, label.role, label.practice].filter((x): x is string => !!x && !(printed && sameName(x, printed)));
  const words = [...new Set(says)].join(' · ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : undefined;
}

const andWhere = (e: LabelEvidence): string => [e.city, e.state].filter(Boolean).join(', ');
const bySomeone = (x: { by?: string; at?: string }): string => `${x.by ?? 'The household'} said so${x.at ? ` on ${dayOfText(x.at)}` : ''}.`;

/** Papers by their titles, each a link to its page. */
function papers(idx: PersonIndex, ids: string[]): Child[] {
  return ids.flatMap((id, i): Child[] => {
    const doc = idx.documents.find((d) => d.id === id);
    return [i ? ', ' : null, doc ? link({ name: 'item', person: idx.person, id }, documentTitle(doc)) : 'one that is not in these records'];
  });
}

/** Why the label is given, a sentence for each reason there are words for, its papers aside; a text's own first name, where the label came of several. What `said` tells of itself is left to it. */
export function whyWords(label: ProviderLabel, said: LabelSaid[], printed: string | undefined): string {
  const told = new Set(said.filter((s) => saidText(s)).map((s) => s.id));
  const own = label.evidence.filter((e) => e.from === 'first_name' && e.printed === printed);
  const says = label.evidence.flatMap((e): string[] => {
    if (e.from === 'household') return e.id && told.has(e.id) ? [] : [bySomeone(e)];
    if (e.from === 'npi') return ['By the provider number these records give.'];
    if (e.from === 'only_match') return [`The only one of that name in the provider directory${e.state ? ` for ${e.state}` : ''}.`];
    if (e.from === 'first_name' && (!own.length || own.includes(e))) return [`Of several of that name in the provider directory, the only one with that first name${andWhere(e) ? `, in ${andWhere(e)}` : ''}.`];
    return [];
  });
  return [...new Set(says)].join(' ');
}

/** The same, with the papers that print the name. */
function reasons(idx: PersonIndex, label: ProviderLabel, said: LabelSaid[], printed: string | undefined): Child[] {
  const words = whyWords(label, said, printed);
  const from = [...new Set(label.evidence.flatMap((e) => (e.from === 'paper' && e.document ? [e.document] : [])))];
  return [words || null, from.length ? [words ? ' ' : null, from.length === 1 ? 'A paper from the same visit prints the name: ' : 'Papers from the same visit print the name: ', papers(idx, from), '.'] : null];
}

/** Where a label's phone is from, in words: "from the provider directory, Mar 8, 2026". */
export function phoneSource(idx: PersonIndex, label: ProviderLabel): Child {
  const from = label.phoneFrom;
  if (from?.from === 'directory') return `from the provider directory${from.date ? `, ${dateText(from.date)}` : ''}`;
  if (from?.from === 'paper' && from.document) return ['from ', papers(idx, [from.document])];
  if (from?.from === 'household') {
    const by = [...(idx.providerLabels?.open.said ?? []), ...(idx.providerLabels?.closed.said ?? [])].find((s) => s.id === from.id)?.by ?? label.evidence.find((e) => e.id === from.id)?.by;
    return by ? `as ${by} said` : 'as the household said';
  }
  return null;
}

/** A label's number with where it is from. A likely one's is no link: nothing offers to call a guess. */
const numberOf = (idx: PersonIndex, label: ProviderLabel, phone: string): HTMLElement =>
  h('span', { class: 'label-phone' }, label.confidence === 'likely' ? phone : phoneLink(phone), ' ', h('span', { class: 'muted' }, phoneSource(idx, label)));

const listed = (names: string[]): string => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What the household said of a name, where its label does not say it already. */
export function saidText(s: LabelSaid): string | null {
  const on = s.at ? ` on ${dayOfText(s.at)}` : '';
  const who = s.by ?? 'The household';
  if (s.kind === 'wrong') return `${who} said${on} that the label here was wrong.`;
  if (s.kind === 'same' || s.kind === 'different') return s.printed.length > 1 ? `${who} said${on} that ${listed(s.printed)} are ${s.kind === 'same' ? 'one provider' : 'not one provider'}.` : null;
  return null;
}

/** A label, and what the household said of the name, as a small note; null where neither adds anything. */
export function noteOf(idx: PersonIndex, label: ProviderLabel | undefined, said: LabelSaid[], printed: string | undefined): HTMLElement | null {
  const words = label ? labelWords(label, printed) : undefined;
  const adds = label && (words || label.phone);
  const lines = said.map(saidText).filter((x): x is string => !!x);
  if (!adds && !lines.length) return null;
  const why = label && adds ? reasons(idx, label, said, printed) : [];
  const likely = label?.confidence === 'likely' ? [chip('Likely', 'muted'), ' '] : null;
  return h(
    'div',
    { class: 'label-note small' },
    adds && words ? h('p', null, likely, words) : null,
    adds && label.phone ? h('p', null, words ? null : likely, numberOf(idx, label, label.phone)) : null,
    why.some(Boolean) ? h('p', { class: 'muted' }, why) : null,
    lines.map((x) => h('p', { class: 'muted' }, x)),
  );
}

/** The note of a name as an item prints it, on its person's own pages. */
export function labelNote(idx: PersonIndex, item: string, printed: unknown): HTMLElement | null {
  if (typeof printed !== 'string' || !printed) return null;
  return noteOf(idx, labelOn(idx, item, printed)?.label, saidOn(idx, item, printed), printed);
}

/** The label whose number is one to call about a paper that gives none: its organization's, where it is not a guess. `shared` is for a screen the household shares: which papers it may name. */
export function labelToCall(idx: PersonIndex, doc: MedDocument, shared?: (id: string) => boolean): ProviderLabel | undefined {
  const on = labelOn(idx, doc.id, doc.organization)?.label;
  const label = on && shared ? sharedLabel(idx, on, shared) : on;
  return label?.phone && label.confidence !== 'likely' ? label : undefined;
}

/** The same, as a number to tap, with where it came from. */
export function labelPhone(idx: PersonIndex, doc: MedDocument, shared?: (id: string) => boolean): Child {
  const label = labelToCall(idx, doc, shared);
  return label ? numberOf(idx, label, label.phone!) : null;
}

/** The same in a few words, for a row that is a link: "Likely Jordan Sample, MD · radiologist". */
export function labelLine(idx: PersonIndex, item: string, printed: unknown): string | null {
  const label = typeof printed === 'string' ? labelOn(idx, item, printed)?.label : undefined;
  const words = label ? labelWords(label, printed as string) : undefined;
  return words ? `${label!.confidence === 'likely' ? 'Likely ' : ''}${words}` : null;
}
