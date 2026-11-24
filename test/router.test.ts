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
    { name: 'costs' },
    { name: 'costs', period: 'plan-1', by: 'category' },
    { name: 'costs', period: 'all', only: [{ by: 'person', key: P }, { by: 'code', key: 'CPT:99213' }] },
    { name: 'costs', only: [{ by: 'provider', key: 'example lab' }, { by: 'month', key: '2026-10' }] },
    { name: 'event', person: P, id: 'r_aaaaaaaaaaaaaaaaaaaa' },
    { name: 'calendar' },
    { name: 'calendar', month: '2026-10' },
    { name: 'calendar', month: '2026-10', day: '2026-10-12', who: P },
    { name: 'calendar', view: 'list', who: P },
    { name: 'calendar', view: 'list', before: '2026-07' },
    { name: 'money' },
    { name: 'money', view: 'calls' },
    { name: 'money', view: 'calls', who: P },
    { name: 'money', view: 'calls', who: P, bill: 'd_abcdefghijklmnopqrst' },
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

  it('keep only the costs choices they know', () => {
    expect(href({ name: 'costs', period: '2025', only: [{ by: 'code', key: 'CPT:99213' }] })).toBe('#/costs?period=2025&only=code%3ACPT%3A99213');
    expect(parseRoute('#/costs?period=lifetime&by=code&only=nope:x&only=person:&only=month:2026-10')).toEqual({ name: 'costs', only: [{ by: 'month', key: '2026-10' }] });
    // Months are a chart and a filter, never the breakdown.
    expect(parseRoute('#/costs?by=month')).toEqual({ name: 'costs' });
    // One key for each kind: the last one wins.
    expect(parseRoute('#/costs?only=person:a&only=person:b')).toEqual({ name: 'costs', only: [{ by: 'person', key: 'b' }] });
    expect(parseRoute('#/costs/x')).toEqual({ name: 'not_found' });
  });

  it('give money its bills and calls, and nothing else', () => {
    expect(href({ name: 'money', view: 'calls', who: P })).toBe(`#/money/calls?who=${P}`);
    expect(parseRoute('#/money/bills')).toEqual({ name: 'not_found' });
    expect(parseRoute('#/money?who=%3Cscript%3E')).toEqual({ name: 'money' });
    // A bill is picked only on Worth a call.
    expect(parseRoute('#/money?bill=d_abcdefghijklmnopqrst')).toEqual({ name: 'money' });
    expect(parseRoute('#/money/calls?bill=%3Cb%3E')).toEqual({ name: 'money', view: 'calls' });
  });

  it('keep only the calendar choices they know', () => {
    expect(href({ name: 'calendar', month: '2026-10', day: '2026-10-12' })).toBe('#/calendar?month=2026-10&day=2026-10-12');
    expect(parseRoute('#/calendar?month=2026-13&day=2026-02-3x&who=%3Cscript%3E&view=year&before=2026-07')).toEqual({ name: 'calendar' });
    // A day that does not exist is dropped, not rolled over.
    expect(parseRoute('#/calendar?day=2026-02-31')).toEqual({ name: 'calendar' });
    expect(parseRoute('#/calendar?day=2028-02-29')).toEqual({ name: 'calendar', month: '2028-02', day: '2028-02-29' });
    // A day picks its month; the list has neither.
    expect(parseRoute('#/calendar?month=2026-01&day=2026-10-12')).toEqual({ name: 'calendar', month: '2026-10', day: '2026-10-12' });
    expect(parseRoute('#/calendar?view=list&month=2026-10&day=2026-10-12')).toEqual({ name: 'calendar', view: 'list' });
    expect(parseRoute('#/calendar/x')).toEqual({ name: 'not_found' });
  });

  it('turn anything else into not found', () => {
    for (const h of ['#/nope', `#/p/${P}/nope`, `#/p/${P}/r`, `#/p/${P}/timeline/x`, '#/s/a/b', '#/settings/x', '#/sources/x', '#/p/<script>']) {
      expect(parseRoute(h)).toEqual({ name: 'not_found' });
    }
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});
