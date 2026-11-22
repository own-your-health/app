// Routes live in the URL fragment, so every person and record has a stable
// link (`#/p/<person id>/r/<record id>`) that works on GitHub Pages without a
// server. Ids are medrec's (`p_…`, `r_…`, `d_…`, `m_…`, `s_…`), which name
// nothing about the person or the record.

export const SECTIONS = [
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

export type Route =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'source'; source: string }
  | { name: 'person'; person: string; section: Section; sub?: string; query?: string }
  | { name: 'item'; person: string; id: string }
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
  if (head === 's' && a && ID.test(a) && parts.length === 2) return { name: 'source', source: a };
  if (head === 'hh' && a && ID.test(a) && parts.length === 2) return { name: 'huishouden', hh: a };
  if (head === 'p' && a && ID.test(a)) {
    if (!b) return { name: 'person', person: a, section: 'timeline' };
    if (b === 'r' && c && ID.test(c) && parts.length === 4) return { name: 'item', person: a, id: c };
    if ((SECTIONS as readonly string[]).includes(b)) {
      const section = b as Section;
      const q = query.get('q') ?? undefined;
      if (c !== undefined && section === 'results' && parts.length === 4) return { name: 'person', person: a, section, sub: c };
      if (parts.length === 3) return { name: 'person', person: a, section, ...(q !== undefined ? { query: q } : {}) };
    }
  }
  return { name: 'not_found' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'source':
      return `#/s/${encodeURIComponent(route.source)}`;
    case 'huishouden':
      return `#/hh/${encodeURIComponent(route.hh)}`;
    case 'item':
      return `#/p/${encodeURIComponent(route.person)}/r/${encodeURIComponent(route.id)}`;
    case 'person': {
      let h = `#/p/${encodeURIComponent(route.person)}`;
      if (route.section !== 'timeline' || route.sub || route.query) h += `/${route.section}`;
      if (route.sub) h += `/${encodeURIComponent(route.sub)}`;
      if (route.query) h += `?${new URLSearchParams({ q: route.query }).toString()}`;
      return h;
    }
    case 'not_found':
      return '#/';
  }
}
