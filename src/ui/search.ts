// The search box and its results, for everyone (#/search) or one person
// (#/p/<id>/search). Everything is searched here in the browser: the
// records, documents and imaging in each person's index, and the text medrec
// extracted from documents (text.json), read from Drive on the first search.

import { KIND_LABELS } from "../model/records";
import {
  matchRanges,
  searchAll,
  terms,
  type Hit,
  type Searchable,
} from "../model/search";
import type { Person, PersonText } from "../model/types";
import { button, card, empty, filterChips, row, type Ctx } from "./components";
import { h, type Child } from "./dom";
import { count, dateText } from "./format";
import { href, type Route } from "./router";

const PAGE = 50;

/** What a kind's filter says, for more than one. */
const KIND_PLURAL: Record<string, string> = {
  encounter: "Visits",
  result: "Results",
  report: "Reports",
  condition: "Conditions",
  medication: "Medicines",
  allergy: "Allergies",
  immunization: "Immunizations",
  procedure: "Procedures",
  coverage: "Coverage",
  claim: "Claims",
  document: "Documents",
  study: "Imaging",
};

/** The words of `s`, with each match in a mark. */
export function marked(s: string, ts: string[]): Child[] {
  const out: Child[] = [];
  let at = 0;
  for (const [a, b] of matchRanges(s, ts)) {
    if (a > at) out.push(s.slice(at, a));
    out.push(h("mark", null, s.slice(a, b)));
    at = b;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

function where(hit: Hit): string | null {
  if (hit.where === "field")
    return `in ${hit.field?.toLowerCase() ?? "a field"}`;
  if (hit.where === "text") return "in the document text";
  return null;
}

export interface SearchOptions {
  people: Person[];
  query?: string;
  /** The page's address for a query, kept current while typing. */
  route: (query: string | undefined) => Route;
  title: string;
  intro: string;
}

export function searchPanel(ctx: Ctx, opts: SearchOptions): HTMLElement {
  const { people } = opts;
  const many = people.length > 1;
  const names = new Map(people.map((p) => [p.id, p.name]));
  const input = h("input", {
    type: "search",
    class: "input",
    placeholder: many
      ? "Search everyone’s records and documents"
      : "Search records and documents",
    "aria-label": "Search",
    value: opts.query ?? "",
    autocomplete: "off",
    enterkeyhint: "search",
  });
  const status = h("p", { class: "muted small", "aria-live": "polite" });
  const filters = h("div", { class: "search-filters" });
  const results = h("div");
  let timer: number | undefined;
  let texts: Map<string, PersonText | null> | undefined;
  let run = 0;
  let kind = "all";
  let who = "all";

  const loadTexts = async (): Promise<Map<string, PersonText | null>> => {
    if (texts) return texts;
    status.textContent = "Reading the text of the documents…";
    const loaded = await Promise.all(
      people.map(
        async (p) =>
          [p.id, await ctx.store.text(p.id).catch(() => null)] as const,
      ),
    );
    texts = new Map(loaded);
    return texts;
  };

  const draw = (hits: Hit[], ts: string[], untexted: string[]) => {
    const kinds = [...new Set(hits.map((x) => x.kind))];
    if (!kinds.includes(kind)) kind = "all";
    const whos = [...new Set(hits.map((x) => x.person))];
    if (!whos.includes(who)) who = "all";
    const byKind = hits.filter((x) => who === "all" || x.person === who);
    const shown = byKind.filter((x) => kind === "all" || x.kind === kind);
    const n = (k: string) => byKind.filter((x) => x.kind === k).length;
    filters.replaceChildren(
      ...[
        many && whos.length > 1
          ? filterChips<string>(
              [
                ["all", "Everyone"],
                ...people
                  .filter((p) => whos.includes(p.id))
                  .map((p): [string, string] => [p.id, p.name]),
              ],
              who,
              (v) => ((who = v), draw(hits, ts, untexted)),
            )
          : null,
        kinds.length > 1
          ? filterChips<string>(
              [
                ["all", `All ${byKind.length}`],
                ...kinds
                  .filter((k) => n(k) > 0)
                  .map((k): [string, string] => [
                    k,
                    `${KIND_PLURAL[k] ?? KIND_LABELS[k] ?? k} ${n(k)}`,
                  ]),
              ],
              kind,
              (v) => ((kind = v), draw(hits, ts, untexted)),
            )
          : null,
      ].filter((x): x is HTMLElement => !!x),
    );
    const missing = untexted.length
      ? ` Document text is not searched for ${untexted.join(" and ")}: there is no text.json in ${untexted.length === 1 ? "their folder" : "their folders"}.`
      : "";
    status.textContent = `${count(hits.length, "match", "matches")}.${missing}`;
    const list = h("div");
    let at = 0;
    const more = button("Show more", () => page(), { ghost: true });
    const page = () => {
      more.remove();
      for (const hit of shown.slice(at, at + PAGE)) {
        list.appendChild(
          row({
            route: { name: "item", person: hit.person, id: hit.id },
            title: marked(hit.title, ts),
            meta: [
              many ? names.get(hit.person) : null,
              dateText(hit.date),
              KIND_LABELS[hit.kind] ?? hit.kind,
              where(hit),
            ]
              .filter(Boolean)
              .join(" · "),
            extra: hit.snippet
              ? h(
                  "p",
                  { class: "snippet" },
                  hit.where === "field" && hit.field
                    ? [
                        h("span", { class: "muted" }, `${hit.field}: `),
                        ...marked(hit.snippet, ts),
                      ]
                    : marked(hit.snippet, ts),
                )
              : null,
          }),
        );
      }
      at = Math.min(shown.length, at + PAGE);
      if (at < shown.length) list.appendChild(more);
    };
    page();
    results.replaceChildren(
      shown.length ? list : empty("Nothing matches every word."),
    );
  };

  const search = async () => {
    const mine = (run += 1);
    const q = input.value.trim();
    history.replaceState(null, "", href(opts.route(q || undefined)));
    const ts = terms(q);
    if (ts.length === 0) {
      results.replaceChildren();
      filters.replaceChildren();
      status.textContent = "";
      return;
    }
    const loaded = await loadTexts();
    if (mine !== run) return;
    const scope: Searchable[] = people.flatMap((p) => {
      const index = ctx.store.index(p.id);
      return index
        ? [{ person: p.id, index, text: loaded.get(p.id) ?? null }]
        : [];
    });
    const untexted = scope
      .filter((x) => !x.text)
      .map((x) => names.get(x.person) ?? x.person);
    draw(
      searchAll(scope, q),
      ts,
      many ? untexted : untexted.length ? ["this person"] : [],
    );
  };

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void search(), 200);
  });
  if (opts.query) void search();
  else requestAnimationFrame(() => input.focus());
  return card(
    { title: opts.title },
    h("p", { class: "muted small" }, opts.intro),
    input,
    status,
    filters,
    results,
  );
}

/** #/search: one search over everyone in the folder. */
export function searchView(ctx: Ctx, query: string | undefined): HTMLElement {
  const people = ctx.store.household.people;
  return h(
    "div",
    { class: "stack" },
    people.length
      ? searchPanel(ctx, {
          people,
          query,
          route: (q) => ({ name: "search", ...(q ? { query: q } : {}) }),
          title: "Search",
          intro: `Searches ${people.length === 1 ? "the" : "everyone’s"} records, documents and imaging, and the text medrec extracted from documents. The search runs here in the browser; nothing is sent anywhere.`,
        })
      : card(
          { title: "Search" },
          empty("No people in this records folder yet."),
        ),
  );
}
