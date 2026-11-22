// Search over one person's titles and extracted text, in the browser only.

import { KIND_LABELS, docTypeLabel, documentTitle, studyTitle } from './records';
import type { PersonIndex, PersonText } from './types';

export interface Hit {
  id: string;
  kind: string;
  title: string;
  date?: string;
  /** A short piece of the text around the first match, when the match is in the text. */
  snippet?: string;
  inText: boolean;
}

function words(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function allIn(hay: string, ws: string[]): boolean {
  return ws.every((w) => hay.includes(w));
}

export function snippet(text: string, word: string, around = 60): string {
  const at = text.toLowerCase().indexOf(word);
  if (at < 0) return '';
  const start = Math.max(0, at - around);
  const end = Math.min(text.length, at + word.length + around);
  const piece = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`;
}

/** Every word must appear in the title fields or in the document's text. */
export function search(index: PersonIndex, text: PersonText | null, query: string, limit = 200): Hit[] {
  const ws = words(query);
  if (ws.length === 0) return [];
  const hits: Hit[] = [];
  for (const r of index.records) {
    const hay = [r.display, r.code?.display, r.code?.code, KIND_LABELS[r.kind], r.status].filter(Boolean).join(' ').toLowerCase();
    if (allIn(hay, ws)) hits.push({ id: r.id, kind: r.kind, title: r.display || KIND_LABELS[r.kind] || r.kind, date: r.date, inText: false });
  }
  for (const d of index.documents) {
    const title = documentTitle(d);
    const hay = [title, d.original_name, docTypeLabel(d.doc_type), d.organization].filter(Boolean).join(' ').toLowerCase();
    const body = text?.texts[d.id];
    if (allIn(hay, ws)) {
      hits.push({ id: d.id, kind: 'document', title, date: d.date, inText: false });
    } else if (body && allIn(`${hay} ${body.toLowerCase()}`, ws)) {
      const w = ws.find((x) => body.toLowerCase().includes(x)) ?? ws[0]!;
      hits.push({ id: d.id, kind: 'document', title, date: d.date, snippet: snippet(body, w), inText: true });
    }
  }
  for (const s of index.studies) {
    const title = studyTitle(s);
    const hay = [title, s.facility, s.body_part, s.modalities.join(' ')].filter(Boolean).join(' ').toLowerCase();
    if (allIn(hay, ws)) hits.push({ id: s.id, kind: 'study', title, date: s.date, inText: false });
  }
  hits.sort((a, b) => Number(a.inText) - Number(b.inText) || (b.date ?? '').localeCompare(a.date ?? ''));
  return hits.slice(0, limit);
}
