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
    { name: 'person', person: P, section: 'timeline' },
    ...SECTIONS.filter((s) => s !== 'timeline').map((section): Route => ({ name: 'person', person: P, section })),
    { name: 'person', person: P, section: 'results', sub: 'http://loinc.org|13457-7' },
    { name: 'person', person: P, section: 'search', query: 'ldl & a1c' },
  ];

  it.each(routes.map((r) => [href(r), r]))('%s round-trips', (h, r) => {
    expect(parseRoute(h)).toEqual(r);
  });

  it('are stable for links from outside', () => {
    expect(href({ name: 'person', person: P, section: 'timeline' })).toBe(`#/p/${P}`);
    expect(href({ name: 'item', person: P, id: 'd_aaaaaaaaaaaaaaaaaaaa' })).toBe(`#/p/${P}/r/d_aaaaaaaaaaaaaaaaaaaa`);
    expect(href({ name: 'huishouden', hh: 'abc' })).toBe('#/hh/abc');
    expect(href({ name: 'sources' })).toBe('#/sources');
  });

  it('turn anything else into not found', () => {
    for (const h of ['#/nope', `#/p/${P}/nope`, `#/p/${P}/r`, `#/p/${P}/timeline/x`, '#/s/a/b', '#/settings/x', '#/sources/x', '#/p/<script>']) {
      expect(parseRoute(h)).toEqual({ name: 'not_found' });
    }
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});
