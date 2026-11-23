import { describe, expect, it } from 'vitest';
import { href, parseRoute, SECTIONS, type Route } from '../src/ui/router';

const P = 'p_aaaaaaaaaaaaaaaaaaaa';

describe('routes', () => {
  const routes: Route[] = [
    { name: 'home' },
    { name: 'settings' },
    { name: 'sources' },
    { name: 'source', source: 's_aaaaaaaaaaaaaaaaaaaa' },
    { name: 'huishouden', hh: 'hh-demo-robin' },
    { name: 'item', person: P, id: 'r_aaaaaaaaaaaaaaaaaaaa' },
    { name: 'person', person: P, section: 'overview' },
    ...SECTIONS.filter((s) => s !== 'overview').map((section): Route => ({ name: 'person', person: P, section })),
    { name: 'person', person: P, section: 'results', sub: 'http://loinc.org|13457-7' },
    { name: 'person', person: P, section: 'search', query: 'ldl & a1c' },
    { name: 'person', person: P, section: 'timeline', sub: 'all' },
    { name: 'search' },
    { name: 'search', query: '"fasting 12 hours" ldl' },
  ];

  it.each(routes.map((r) => [href(r), r]))('%s round-trips', (h, r) => {
    expect(parseRoute(h)).toEqual(r);
  });

  it('are stable for links from outside', () => {
    expect(href({ name: 'person', person: P, section: 'overview' })).toBe(`#/p/${P}`);
    expect(href({ name: 'person', person: P, section: 'timeline' })).toBe(`#/p/${P}/timeline`);
    expect(parseRoute(`#/p/${P}/overview`)).toEqual({ name: 'person', person: P, section: 'overview' });
    expect(href({ name: 'item', person: P, id: 'd_aaaaaaaaaaaaaaaaaaaa' })).toBe(`#/p/${P}/r/d_aaaaaaaaaaaaaaaaaaaa`);
    expect(href({ name: 'huishouden', hh: 'abc' })).toBe('#/hh/abc');
    expect(href({ name: 'search', query: 'ear pain' })).toBe('#/search?q=ear+pain');
    expect(parseRoute('#/search?q=')).toEqual({ name: 'search' });
    expect(parseRoute(`#/p/${P}/timeline/other`)).toEqual({ name: 'not_found' });
    expect(href({ name: 'sources' })).toBe('#/sources');
  });

  it('turn anything else into not found', () => {
    for (const h of ['#/nope', `#/p/${P}/nope`, `#/p/${P}/r`, `#/p/${P}/timeline/x`, '#/s/a/b', '#/settings/x', '#/sources/x', '#/p/<script>']) {
      expect(parseRoute(h)).toEqual({ name: 'not_found' });
    }
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});
