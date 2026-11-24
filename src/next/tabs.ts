// The redesign's tabs (?next): Home, Calendar, Money, Health and Papers. On
// a phone they sit at the bottom of the screen, from 640px wide they are a
// row above the page. A person's own pages keep their section tabs instead.

import { h, icon } from '../ui/dom';
import { href, type Route } from '../ui/router';

const TABS: { route: Route; label: string; icon: string }[] = [
  { route: { name: 'home' }, label: 'Home', icon: 'home' },
  { route: { name: 'calendar' }, label: 'Calendar', icon: 'calendar' },
  { route: { name: 'money' }, label: 'Money', icon: 'money' },
  { route: { name: 'health' }, label: 'Health', icon: 'heart' },
  { route: { name: 'papers' }, label: 'Papers', icon: 'file' },
];

/** Whether a page shows the tabs: every page but a person's own, which has its section tabs. */
export const hasTabs = (route: Route): boolean => route.name !== 'person';

/** The tabs, the one for the page's part of the app marked current. */
export function tabBar(route: Route): HTMLElement {
  return h(
    'nav',
    { class: 'bottom-nav app-tabs', 'aria-label': 'Main' },
    TABS.map((t) => {
      const on = route.name === t.route.name;
      return h('a', { href: href(t.route), class: ['bottom-item', on ? 'bottom-current' : null], 'aria-current': on ? 'page' : undefined }, icon(t.icon, 22), h('span', null, t.label));
    }),
  );
}
