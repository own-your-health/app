// The search box and its results, for everyone (#/search) or one person
// (#/p/<id>/search). Everything is searched here in the browser: the
// records, documents and imaging in each person's index, and the text medrec
// extracted from documents (text.json), read from Drive once a search is
// coming (this page opens, or the home screen's search field is chosen), so
// it downloads while the words are typed.
// The words (?q=) and whether to search them as written (&words=1) are part
// of the address; the filters are not.
//
// Everyone's results are a shared screen: private items are not searched for
// them at all, so neither a row nor a count says one matches, and a person's
// own results search them too.
//
// Results come in groups by kind, health records first, then imaging and
// documents, then coverage and claims. A test found several times is one
// row, under its panel, opening its history. A query that names a concept
// ("blood tests", "bills") shows that kind, with a way to search the words
// as written instead.

import { KIND_LABELS } from '../model/records';
import { errorsIndex } from '../model/inError';
import { partSays, sharedIndex, sharedTexts } from '../model/parts';
import { HELD, isHeld, itemPrivate, studyPrivate } from '../model/private';
import { conceptOf, find, matchRanges, terms, type Found, type Hit, type Searchable } from '../model/search';
import type { Person, PersonText } from '../model/types';
import { button, card, empty, filterChips, row, type Ctx } from './components';
import { h, type Child } from './dom';
import { count, dateText } from './format';
import { inErrorText } from './standing';
import { href, type Route } from './router';
import { called } from '../model/people';
import { heldNotes } from '../next/shared';

const PAGE = 50;

/** What a kind's filter says, for more than one. */
const KIND_PLURAL: Record<string, string> = {
  encounter: 'Visits',
  result: 'Results',
  report: 'Reports',
  condition: 'Conditions',
  medication: 'Medicines',
  allergy: 'Allergies',
  immunization: 'Immunizations',
  procedure: 'Procedures',
  coverage: 'Coverage',
  claim: 'Claims',
  document: 'Documents',
  study: 'Imaging',
};

/** The order of the groups: records first, claims last. */
const KIND_ORDER = ['result', 'report', 'condition', 'medication', 'allergy', 'immunization', 'procedure', 'encounter', 'study', 'document', 'coverage', 'claim'];
const kindRank = (k: string) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : KIND_ORDER.length);

/** One row of results: a test (every hit for it), or any other hit. */
export interface Entry {
  hit: Hit;
  /** How many results the test has among the hits. */
  count: number;
}

/**
 * The hits as rows by kind, in KIND_ORDER. Within results, each test once
 * (its best hit, which the sort makes its newest), by panel: panels in the
 * order their best test came, tests in the order a lab report lists them.
 */
export function entriesByKind(hits: Hit[]): { kind: string; entries: Entry[] }[] {
  const byKind = new Map<string, Entry[]>();
  const tests = new Map<string, Entry>();
  const add = (kind: string, e: Entry) => {
    const list = byKind.get(kind);
    if (list) list.push(e);
    else byKind.set(kind, [e]);
  };
  for (const hit of hits) {
    if (hit.kind === 'result' && hit.test) {
      const k = `${hit.person}|${hit.test.key}`;
      const seen = tests.get(k);
      if (seen) seen.count += 1;
      else {
        const e = { hit, count: 1 };
        tests.set(k, e);
        add('result', e);
      }
    } else add(hit.kind, { hit, count: 1 });
  }
  const results = byKind.get('result');
  if (results) {
    const panelAt = new Map<string, number>();
    results.forEach((e, i) => {
      const p = e.hit.test?.panel ?? '';
      if (!panelAt.has(p)) panelAt.set(p, i);
    });
    const panelOf = (e: Entry) => panelAt.get(e.hit.test?.panel ?? '') ?? 0;
    results.sort((a, b) => panelOf(a) - panelOf(b) || (a.hit.test?.panelOrder ?? 0) - (b.hit.test?.panelOrder ?? 0) || a.hit.title.localeCompare(b.hit.title));
  }
  return [...byKind.entries()].sort(([a], [b]) => kindRank(a) - kindRank(b)).map(([kind, entries]) => ({ kind, entries }));
}

/** The words of `s`, with each match in a mark. */
export function marked(s: string, ts: string[]): Child[] {
  const out: Child[] = [];
  let at = 0;
  for (const [a, b] of matchRanges(s, ts)) {
    if (a > at) out.push(s.slice(at, a));
    out.push(h('mark', null, s.slice(a, b)));
    at = b;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

function where(hit: Hit): string | null {
  // A claim's matching line shows as itself, under the row.
  if (hit.line) return null;
  if (hit.where === 'field') return `in ${hit.field?.toLowerCase() ?? 'a field'}`;
  if (hit.where === 'text') return 'in the document text';
  return null;
}

/** What a row says under its title: a test's value and how many results; a claim's provider and amount; a document's kind. */
function metaOf(e: Entry, person: string | null): string {
  const { hit } = e;
  const parts: (string | null | undefined)[] = [person];
  if (hit.test) parts.push(hit.test.value ? `${hit.test.value} on ${dateText(hit.date)}` : dateText(hit.date), e.count > 1 ? `${e.count} results` : null);
  else parts.push(dateText(hit.date));
  if (hit.claim) parts.push(hit.claim.provider, hit.claim.amount);
  if (hit.docType) parts.push(hit.docType);
  parts.push(where(hit));
  return parts.filter(Boolean).join(' · ');
}

export interface SearchOptions {
  people: Person[];
  query?: string;
  /** Search the words as written, not the concept a word names. */
  words?: true;
  /** The person the filter starts on. */
  who?: string;
  /** The page's address for a query and the person chosen, kept current while typing and choosing. */
  route: (query: string | undefined, words: boolean, who: string | undefined) => Route;
  title: string;
  intro: string;
}

export function searchPanel(ctx: Ctx, opts: SearchOptions): HTMLElement {
  const { people } = opts;
  const many = people.length > 1;
  const names = new Map(people.map((p) => [p.id, called(p)]));
  const input = h('input', {
    type: 'search',
    class: 'input',
    placeholder: many ? 'Search everyone’s records and documents' : 'Search records and documents',
    'aria-label': 'Search',
    value: opts.query ?? '',
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  // Each filter row is drawn again only when its choices change, so the button just pressed keeps focus.
  const whoRow = h('div');
  const kindRow = h('div');
  const filters = h('div', { class: 'search-filters' }, whoRow, kindRow);
  const results = h('div');
  let timer: number | undefined;
  let reading = true;
  let run = 0;
  let kind = 'all';
  let who = opts.who && people.some((p) => p.id === opts.who) ? opts.who : 'all';
  const address = () => history.replaceState(null, '', href(opts.route(lastQuery || undefined, words, who === 'all' ? undefined : who)));

  /** The store reads them once for each read of the records, which this page stays open through. */
  const loadTexts = async (): Promise<Map<string, PersonText | null>> => {
    if (reading) status.textContent = 'Reading the text of the documents…';
    reading = false;
    return new Map(await Promise.all(people.map(async (p) => [p.id, await ctx.store.text(p.id).catch(() => null)] as const)));
  };

  /** Whether to search the words as written rather than the concept they name; a new query starts over. */
  let words = opts.words === true;
  let lastQuery = opts.query?.trim() ?? '';
  // Says how the words were read; announced when it changes.
  const notice = h('div', { 'aria-live': 'polite' });

  // Says what everyone's results leave off, whatever was searched for.
  const left = h('div');
  // Everyone's chip is there to choose whoever has a match, and the line is there whether or not anything is left off: neither says whose private item matched, or that there is one.
  const unjudged = () =>
    people.reduce((n, p) => {
      const idx = ctx.store.index(p.id);
      return n + (idx && !isHeld(idx) ? idx.studies.filter((s) => studyPrivate(idx, s) === HELD).length : 0);
    }, 0);
  /** Imaging no report judges, counted for everyone and never for what was searched for. */
  const imagingLeft = (n: number) => (n ? ` So ${n === 1 ? 'is' : 'are'} ${count(n, 'imaging study', 'imaging studies')} with no report in these records: nothing says whether ${n === 1 ? 'it is' : 'they are'} private.` : '');
  let errors: { own: string[]; shared: number } = { own: [], shared: 0 };
  /** Whose papers' text changed since medrec said what in it is private. */
  let unsaid: string[] = [];
  const leftNotes = () =>
    many && who === 'all'
      ? [
          h('p', { class: 'small muted' }, `Private items are left off everyone’s results.${imagingLeft(unjudged())} Choose a person to search theirs.`),
          ...heldNotes(ctx, 'everyone’s results'),
          ...(unsaid.length ? [h('p', { class: 'small muted' }, `The text of ${unsaid.join(' and ')}’s papers is not searched here: it changed since medrec said what in it is private. medrec says it again after its next import or refresh.`)] : []),
        ]
      : [];

  /** What everyone's results leave out of an open item, for its row. */
  const says = (hit: Hit) => {
    const idx = ctx.store.index(hit.person);
    return idx ? partSays(idx, hit.id) : undefined;
  };

  /** `found` searches everyone's shared items; `own` searches private ones too, for the person chosen. */
  const draw = (found: Found, own: Found, untexted: string[], keep?: 'who' | 'kind') => {
    const { hits, terms: ts } = who === 'all' ? found : own;
    say(who === 'all' ? found : own);
    left.replaceChildren(...leftNotes());
    const whos = many ? people.map((p) => p.id) : [...new Set(hits.map((x) => x.person))];
    const groups = entriesByKind(hits.filter((x) => who === 'all' || x.person === who));
    // Kinds come from the chosen person's hits, so a kind they have none of falls back to All.
    if (!groups.some((g) => g.kind === kind)) kind = 'all';
    const shownGroups = groups.filter((g) => kind === 'all' || g.kind === kind);
    const plural = (k: string) => KIND_PLURAL[k] ?? KIND_LABELS[k] ?? k;
    const all = groups.reduce((n, g) => n + g.entries.length, 0);

    if (keep !== 'who') {
      // The person chosen keeps their chip with no matches of their own, so the page still says whose search it is.
      const options: [string, string][] = [['all', 'Everyone'], ...people.filter((p) => p.id === who || whos.includes(p.id)).map((p): [string, string] => [p.id, called(p)])];
      const pick = (v: string) => {
        who = v;
        address();
        draw(found, own, untexted, 'who');
      };
      whoRow.replaceChildren(...(many && (whos.length > 1 || who !== 'all') ? [filterChips<string>(options, who, pick, 'Filter by person')] : []));
    }
    if (keep !== 'kind') {
      const options: [string, string][] = [['all', `All ${all}`], ...groups.map((g): [string, string] => [g.kind, `${plural(g.kind)} ${g.entries.length}`])];
      kindRow.replaceChildren(...(groups.length > 1 ? [filterChips<string>(options, kind, (v) => ((kind = v), draw(found, own, untexted, 'kind')), 'Filter by kind')] : []));
    }

    const missing = untexted.length ? ` Document text is not searched for ${untexted.join(' and ')}: there is no text.json in ${untexted.length === 1 ? 'their folder' : 'their folders'}.` : '';
    const shown = shownGroups.reduce((n, g) => n + g.entries.length, 0);
    const total = count(all, 'match', 'matches');
    const wrong = many && who === 'all' ? errors.shared : errors.own.filter((p) => who === 'all' || p === who).length;
    status.textContent = `${shown === all ? total : `${shown} of ${total}`}.${wrong ? ` ${inErrorText(wrong)}.` : ''}${missing}`;

    // Headings and rows in order; a page is PAGE rows, with the headings above them.
    type Line = { head: string; level: 'kind' | 'panel' } | { entry: Entry };
    const lines: Line[] = [];
    for (const g of shownGroups) {
      // Every group is headed while all are shown, a lone one too: the heading is where a row's kind is said.
      if (kind === 'all') lines.push({ head: `${plural(g.kind)} (${g.entries.length})`, level: 'kind' });
      const panels = new Set(g.entries.map((e) => e.hit.test?.panel).filter(Boolean));
      let panel: string | undefined;
      for (const entry of g.entries) {
        const p = entry.hit.test?.panel;
        if (panels.size > 1 && p && p !== panel) lines.push({ head: p, level: 'panel' });
        panel = p;
        lines.push({ entry });
      }
    }

    const list = h('div');
    let at = 0;
    const more = button('Show more', () => page(), { ghost: true });
    const page = () => {
      more.remove();
      let n = 0;
      while (at < lines.length && n < PAGE) {
        const line = lines[at]!;
        at += 1;
        if ('head' in line) {
          list.appendChild(line.level === 'kind' ? h('h3', { class: 'search-group' }, line.head) : h('h4', { class: 'group-head' }, line.head));
          continue;
        }
        n += 1;
        const { hit } = line.entry;
        // A test found more than once opens its history; anything else, its own page.
        const route: Route = hit.test && line.entry.count > 1 ? { name: 'person', person: hit.person, section: 'results', sub: hit.test.key } : { name: 'item', person: hit.person, id: hit.id };
        list.appendChild(
          row({
            route,
            title: marked(hit.title, ts),
            meta: [metaOf(line.entry, many ? (names.get(hit.person) ?? null) : null), many && who === 'all' && line.entry.count === 1 ? says(hit) : null].filter(Boolean).join(' · '),
            extra: hit.line
              ? h('p', { class: 'snippet' }, h('span', { class: 'muted' }, 'Line: '), ...marked(hit.line, ts))
              : hit.snippet
                ? h('p', { class: 'snippet' }, hit.field ? [h('span', { class: 'muted' }, `${hit.field}: `), ...marked(hit.snippet, ts)] : marked(hit.snippet, ts))
                : null,
          }),
        );
      }
      if (at < lines.length) list.appendChild(more);
    };
    page();
    const none = who !== 'all' && !all && found.hits.length ? `No matches for ${names.get(who) ?? 'this person'}; ${count(found.hits.length, 'match', 'matches')} for everyone.` : ts.length ? 'Nothing matches every word.' : 'Nothing of this kind in these records.';
    results.replaceChildren(shown ? list : empty(none));
  };

  const search = async () => {
    const mine = (run += 1);
    const q = input.value.trim();
    if (q !== lastQuery) {
      words = false;
      lastQuery = q;
    }
    address();
    if (!conceptOf(q) && terms(q).length === 0) {
      results.replaceChildren();
      whoRow.replaceChildren();
      kindRow.replaceChildren();
      notice.replaceChildren();
      left.replaceChildren();
      status.textContent = '';
      return;
    }
    const loaded = await loadTexts();
    if (mine !== run) return;
    const scope: Searchable[] = people.flatMap((p) => {
      const index = ctx.store.index(p.id);
      return index ? [{ person: p.id, index, text: loaded.get(p.id) ?? null }] : [];
    });
    const named = (xs: Searchable[]) => xs.map((x) => names.get(x.person) ?? x.person);
    const untexted = named(scope.filter((x) => !x.text));
    unsaid = named(scope.filter((x) => x.text && !sharedTexts(x.index, x.text)));
    const own = find(scope, q, { words });
    const shared = (s: Searchable): Searchable => ({ ...s, index: sharedIndex(s.index), text: sharedTexts(s.index, s.text), leave: (kind: string, id: string) => !!itemPrivate(s.index, kind, id) });
    const found = many ? find(scope.map(shared), q, { words }) : own;
    // The same words over what is entered in error, for how many of it they would have found.
    const wrong = scope.flatMap((s) => (s.index.inError ? [{ ...s, index: errorsIndex(s.index) }] : []));
    const how = { words: words || own.how === 'fallback' };
    errors = { own: wrong.length ? find(wrong, q, how).hits.map((x) => x.person) : [], shared: wrong.length ? find(wrong.map(shared), q, how).hits.length : 0 };
    draw(found, own, many ? untexted : untexted.length ? ['this person'] : []);
  };

  /** Says how the words were read. */
  const say = (found: Found) => {
    const switchTo = (w: boolean) => async () => {
      words = w;
      kind = 'all';
      await search();
      // The button pressed was replaced: keep the keyboard on its successor.
      notice.querySelector<HTMLButtonElement>('.link-button')?.focus();
    };
    const toggle = (label: string, w: boolean) => h('button', { type: 'button', class: 'link-button', on: { click: () => void switchTo(w)() } }, label);
    const label = found.named?.label.toLowerCase();
    const said: Child[] | null =
      found.how === 'concept'
        ? [`Showing ${label}${found.rest.length ? ` with “${found.rest.join(' ')}”` : ''}. `, toggle('Search for the words instead', true)]
        : found.how === 'fallback'
          ? [`No ${label} with “${found.rest.join(' ')}”, so this is every match for the words.`]
          : found.named
            ? ['Showing every match for the words. ', toggle(`Show ${label} instead`, false)]
            : null;
    notice.replaceChildren(...(said ? [h('p', { class: 'search-concept' }, said)] : []));
  };

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void search(), 200);
  });
  if (opts.query) void search();
  else {
    requestAnimationFrame(() => input.focus());
    // Read the documents' text while the words are typed: on a slow link it is most of the first search's wait.
    for (const p of people) void ctx.store.text(p.id).catch(() => null);
  }
  return card({ title: opts.title }, h('p', { class: 'muted small' }, opts.intro), input, notice, status, filters, left, results);
}

/** #/search: one search over everyone in the folder. */
export function searchView(ctx: Ctx, query: string | undefined, words?: true, who?: string): HTMLElement {
  const people = ctx.store.household.people;
  return h(
    'div',
    { class: 'stack' },
    people.length
      ? searchPanel(ctx, {
          people,
          query,
          words,
          who,
          route: (q, w, p) => ({ name: 'search', ...(q ? { query: q } : {}), ...(q && w ? { words: true as const } : {}), ...(p ? { who: p } : {}) }),
          title: 'Search',
          intro: `Searches ${people.length === 1 ? 'the' : 'everyone’s'} records, documents and imaging, and the text medrec extracted from documents. The search runs here in the browser; nothing is sent anywhere.`,
        })
      : card({ title: 'Search' }, empty('No people in this records folder yet.')),
  );
}
