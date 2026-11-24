// The app's tabs: Home, Calendar, Money and Health. On a phone they sit at
// the bottom of the screen; from 640px wide they are a row above the page.

import { h, icon } from './dom';
import { href, type Route } from './router';

type Tab = 'home' | 'calendar' | 'money' | 'health';

const TABS: { tab: Tab; route: Route; label: string; icon: string }[] = [
  { tab: 'home', route: { name: 'home' }, label: 'Home', icon: 'home' },
  { tab: 'calendar', route: { name: 'calendar' }, label: 'Calendar', icon: 'calendar' },
  { tab: 'money', route: { name: 'money' }, label: 'Money', icon: 'money' },
  { tab: 'health', route: { name: 'health' }, label: 'Health', icon: 'heart' },
];

/** The tab a page belongs to. A part's own pages keep its tab: every claim is Money's, a person's full lists are Health's. A visit, a record, documents, search and settings belong to none. */
export function tabOf(route: Route): Tab | undefined {
  switch (route.name) {
    case 'home':
    case 'calendar':
    case 'money':
    case 'health':
      return route.name;
    case 'costs':
      return 'money';
    case 'person':
      return route.section === 'documents' ? undefined : 'health';
    default:
      return undefined;
  }
}

/** The tabs, the one for the page's part of the app marked current. */
export function tabBar(route: Route): HTMLElement {
  const current = tabOf(route);
  return h(
    'nav',
    { class: 'bottom-nav app-tabs', 'aria-label': 'Main' },
    TABS.map((t) => {
      const on = t.tab === current;
      return h('a', { href: href(t.route), class: ['bottom-item', on ? 'bottom-current' : null], 'aria-current': on ? 'page' : undefined }, icon(t.icon, 22), h('span', null, t.label));
    }),
  );
}
