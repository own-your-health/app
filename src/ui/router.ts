// Routes live in the URL fragment, so every person and record has a stable
// link (`#/p/<person id>/r/<record id>`) that works on GitHub Pages without a
// server. Ids are medrec's (`p_…`, `r_…`, `d_…`, `m_…`, `s_…`), which name
// nothing about the person or the record.

export const SECTIONS = [
  'overview',
  'timeline',
  'results',
  'medicines',
  'conditions',
  'allergies',
  'immunizations',
  'claims',
  'documents',
  'imaging',
  'search',
] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  overview: 'Overview',
  timeline: 'Timeline',
  results: 'Results',
  medicines: 'Medicines',
  conditions: 'Conditions',
  allergies: 'Allergies',
  immunizations: 'Immunizations',
  claims: 'Claims and bills',
  documents: 'Documents',
  imaging: 'Imaging',
  search: 'Search',
};

/** What the costs screen can be narrowed to, and what it can break costs down by. */
export const COST_FILTERS = ['person', 'provider', 'category', 'month', 'code'] as const;
export type CostFilterBy = (typeof COST_FILTERS)[number];
export const COST_BY = ['person', 'provider', 'category'] as const;
export type CostBy = (typeof COST_BY)[number];
export interface CostFilter {
  by: CostFilterBy;
  key: string;
}

const COST_PERIOD = /^(plan|plan-1|\d{4}|all)$/;

export type Route =
  | { name: 'home' }
  // `period`: plan (this plan year), plan-1, a calendar year, or all; `only`: the drill-down, one key per kind.
  | { name: 'costs'; period?: string; by?: CostBy; only?: CostFilter[] }
  | { name: 'settings' }
  | { name: 'sources' }
  // `words`: search every word as written, not the concept a word names (?words=1).
  | { name: 'search'; query?: string; words?: true }
  | { name: 'source'; source: string }
  | { name: 'person'; person: string; section: Section; sub?: string; query?: string; words?: true }
  | { name: 'item'; person: string; id: string }
  // An event: a visit, stay, test or fill, with its claims and papers (?next).
  | { name: 'event'; person: string; id: string }
  // The calendar (?next): a month (`m`, YYYY-MM) or the whole list, everyone or one person, and a chosen day.
  | { name: 'calendar'; view?: 'list'; month?: string; who?: string; day?: string }
  | { name: 'huishouden'; hh: string }
  | { name: 'not_found' };

const ID = /^[a-z]_[a-z2-7]{20}$|^[A-Za-z0-9_.-]{1,80}$/;

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?', 2);
  const parts = pathPart.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return '';
    }
  });
  const query = new URLSearchParams(queryPart);
  if (parts.length === 0) return { name: 'home' };
  const [head, a, b, c] = parts;
  if (head === 'settings' && parts.length === 1) return { name: 'settings' };
  if (head === 'sources' && parts.length === 1) return { name: 'sources' };
  if (head === 'costs' && parts.length === 1) return costsRoute(query);
  if (head === 'calendar' && parts.length === 1) return calendarRoute(query);
  if (head === 'search' && parts.length === 1) {
    const q = query.get('q') ?? undefined;
    return { name: 'search', ...(q ? { query: q } : {}), ...(q && query.get('words') === '1' ? { words: true as const } : {}) };
  }
  if (head === 's' && a && ID.test(a) && parts.length === 2) return { name: 'source', source: a };
  if (head === 'hh' && a && ID.test(a) && parts.length === 2) return { name: 'huishouden', hh: a };
  if (head === 'p' && a && ID.test(a)) {
    if (!b) return { name: 'person', person: a, section: 'overview' };
    if (b === 'r' && c && ID.test(c) && parts.length === 4) return { name: 'item', person: a, id: c };
    if (b === 'e' && c && ID.test(c) && parts.length === 4) return { name: 'event', person: a, id: c };
    if ((SECTIONS as readonly string[]).includes(b)) {
      const section = b as Section;
      const q = query.get('q') ?? undefined;
      if (c !== undefined && section === 'results' && parts.length === 4) return { name: 'person', person: a, section, sub: c };
      if (c === 'all' && section === 'timeline' && parts.length === 4) return { name: 'person', person: a, section, sub: c };
      if (parts.length === 3) return { name: 'person', person: a, section, ...(q !== undefined ? { query: q } : {}), ...(q && section === 'search' && query.get('words') === '1' ? { words: true as const } : {}) };
    }
  }
  return { name: 'not_found' };
}

function costsRoute(query: URLSearchParams): Route {
  const period = query.get('period') ?? '';
  const by = query.get('by') ?? '';
  const only = new Map<CostFilterBy, string>();
  for (const f of query.getAll('only')) {
    const at = f.indexOf(':');
    const kind = f.slice(0, at) as CostFilterBy;
    const key = f.slice(at + 1);
    if (at > 0 && COST_FILTERS.includes(kind) && key.length > 0 && key.length <= 120) only.set(kind, key);
  }
  return {
    name: 'costs',
    ...(COST_PERIOD.test(period) ? { period } : {}),
    ...(COST_BY.includes(by as CostBy) ? { by: by as CostBy } : {}),
    ...(only.size ? { only: [...only].map(([k, key]) => ({ by: k, key })) } : {}),
  };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function calendarRoute(query: URLSearchParams): Route {
  const view = query.get('view') === 'list' ? ('list' as const) : undefined;
  const month = query.get('m') ?? '';
  const who = query.get('who') ?? '';
  const day = query.get('day') ?? '';
  return {
    name: 'calendar',
    ...(view ? { view } : {}),
    ...(!view && MONTH.test(month) ? { month } : {}),
    ...(ID.test(who) ? { who } : {}),
    ...(!view && DAY.test(day) ? { day, month: day.slice(0, 7) } : {}),
  };
}

function calendarQuery(r: Extract<Route, { name: 'calendar' }>): string {
  const q = new URLSearchParams();
  if (r.view) q.set('view', r.view);
  if (r.month && !r.view) q.set('m', r.month);
  if (r.day && !r.view) q.set('day', r.day);
  if (r.who) q.set('who', r.who);
  const t = q.toString();
  return t ? `?${t}` : '';
}

function costsQuery(r: Extract<Route, { name: 'costs' }>): string {
  const q = new URLSearchParams();
  if (r.period) q.set('period', r.period);
  if (r.by) q.set('by', r.by);
  for (const f of r.only ?? []) q.append('only', `${f.by}:${f.key}`);
  const t = q.toString();
  return t ? `?${t}` : '';
}

function searchQuery(q: string, words: true | undefined): string {
  return new URLSearchParams({ q, ...(words ? { words: '1' } : {}) }).toString();
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'sources':
      return '#/sources';
    case 'costs':
      return `#/costs${costsQuery(route)}`;
    case 'calendar':
      return `#/calendar${calendarQuery(route)}`;
    case 'search':
      return route.query ? `#/search?${searchQuery(route.query, route.words)}` : '#/search';
    case 'source':
      return `#/s/${encodeURIComponent(route.source)}`;
    case 'huishouden':
      return `#/hh/${encodeURIComponent(route.hh)}`;
    case 'item':
      return `#/p/${encodeURIComponent(route.person)}/r/${encodeURIComponent(route.id)}`;
    case 'event':
      return `#/p/${encodeURIComponent(route.person)}/e/${encodeURIComponent(route.id)}`;
    case 'person': {
      let h = `#/p/${encodeURIComponent(route.person)}`;
      if (route.section !== 'overview' || route.sub || route.query) h += `/${route.section}`;
      if (route.sub) h += `/${encodeURIComponent(route.sub)}`;
      if (route.query) h += `?${searchQuery(route.query, route.words)}`;
      return h;
    }
    case 'not_found':
      return '#/';
  }
}
