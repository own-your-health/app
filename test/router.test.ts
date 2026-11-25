import { describe, expect, it } from 'vitest';
import { href, LIST_SECTIONS, moved, parseRoute, SECTIONS, type Route } from '../src/ui/router';

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
    { name: 'search', query: 'flu', words: true, who: P },
    { name: 'search', who: P },
    { name: 'costs' },
    { name: 'costs', period: 'plan-1', by: 'category' },
    { name: 'costs', period: 'all', only: [{ by: 'person', key: P }, { by: 'code', key: 'CPT:99213' }] },
    { name: 'costs', only: [{ by: 'provider', key: 'example lab' }, { by: 'month', key: '2026-10' }] },
    { name: 'event', person: P, id: 'r_aaaaaaaaaaaaaaaaaaaa' },
    { name: 'provider', person: P, id: 'r_aaaaaaaaaaaaaaaaaaaa', field: 'provider' },
    { name: 'provider', person: P, id: 'd_aaaaaaaaaaaaaaaaaaaa', field: 'organization', all: true },
    { name: 'calendar' },
    { name: 'calendar', month: '2026-10' },
    { name: 'calendar', month: '2026-10', day: '2026-10-12', who: P },
    { name: 'calendar', view: 'list', who: P },
    { name: 'calendar', view: 'list', before: '2026-07' },
    { name: 'calendar', view: 'ahead' },
    { name: 'calendar', view: 'ahead', who: P },
    { name: 'money' },
    { name: 'money', view: 'calls' },
    { name: 'money', view: 'calls', who: P },
    { name: 'money', view: 'calls', who: P, bill: 'd_abcdefghijklmnopqrst' },
    { name: 'money', period: 'plan-1' },
    { name: 'health' },
    { name: 'health', who: P },
    { name: 'health', view: 'doctor', who: P },
    { name: 'money', view: 'bills', who: P },
    { name: 'money', view: 'events', who: P, period: '2025', sort: 'share' },
    { name: 'money', view: 'events', sort: 'discount' },
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

  it('give money its year, bills, calls and where the money went, and nothing else', () => {
    expect(href({ name: 'money', view: 'calls', who: P })).toBe(`#/money/calls?who=${P}`);
    expect(parseRoute('#/money/year')).toEqual({ name: 'not_found' });
    expect(parseRoute('#/health/papers')).toEqual({ name: 'not_found' });
    expect(parseRoute('#/health?who=%3Cb%3E')).toEqual({ name: 'health' });
    // A period belongs to the year and where the money went; an order only to where the money went.
    expect(parseRoute('#/money/bills?period=2025&sort=share')).toEqual({ name: 'money', view: 'bills' });
    expect(parseRoute('#/money?period=last&sort=share')).toEqual({ name: 'money' });
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
    expect(parseRoute('#/calendar?view=ahead&month=2026-10&day=2026-10-12&before=2026-07')).toEqual({ name: 'calendar', view: 'ahead' });
    expect(href({ name: 'calendar', view: 'ahead', before: '2026-07' })).toBe('#/calendar?view=ahead');
    expect(parseRoute('#/calendar/x')).toEqual({ name: 'not_found' });
  });

  it('turn anything else into not found', () => {
    for (const h of ['#/nope', `#/p/${P}/nope`, `#/p/${P}/r`, `#/p/${P}/timeline/x`, '#/s/a/b', '#/settings/x', '#/sources/x', '#/p/<script>']) {
      expect(parseRoute(h)).toEqual({ name: 'not_found' });
    }
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});

describe('addresses from before the redesign', () => {
  const to = (hash: string) => {
    const r = moved(parseRoute(hash));
    return r ? href(r) : undefined;
  };

  it('open where their page lives now', () => {
    expect(to(`#/p/${P}`)).toBe(`#/health?who=${P}`);
    expect(to(`#/p/${P}/overview`)).toBe(`#/health?who=${P}`);
    expect(to(`#/p/${P}/timeline`)).toBe(`#/calendar?view=list&who=${P}`);
    expect(to(`#/p/${P}/timeline/all`)).toBe(`#/calendar?view=list&who=${P}`);
    expect(to(`#/p/${P}/claims`)).toBe(`#/money?who=${P}`);
    expect(to(`#/p/${P}/search?q=flu&words=1`)).toBe(`#/search?q=flu&words=1&who=${P}`);
    expect(to(`#/p/${P}/search`)).toBe(`#/search?who=${P}`);
    expect(to(`#/p/${P}/documents`)).toBe(`#/papers?who=${P}`);
  });

  it('leave a person’s lists and every other page where they are', () => {
    for (const section of LIST_SECTIONS) expect(to(`#/p/${P}/${section}`)).toBeUndefined();
    expect(to(`#/p/${P}/results/2345-7`)).toBeUndefined();
    for (const hash of ['#/', '#/money', `#/p/${P}/r/r_aaaaaaaaaaaaaaaaaaaa`, `#/p/${P}/e/r_aaaaaaaaaaaaaaaaaaaa`, '#/settings']) expect(to(hash)).toBeUndefined();
  });

  it('cover every section: each moved, or still a page', () => {
    for (const section of SECTIONS) expect(!!to(`#/p/${P}/${section}`) !== (LIST_SECTIONS as readonly string[]).includes(section)).toBe(true);
  });
});
