// The colour theme: the system's (the default), or light or dark, chosen in
// Settings. public/theme.js applies the stored choice before the first paint;
// this module applies a change made in Settings. Both set the browser's bar
// colour (theme-color) to match the app's bar.

import { getTheme, type Theme } from './settings';

/** The app bar's colour in each palette (--bar in styles.css), as theme-color. */
export const BAR_COLOURS = { light: '#121848', dark: '#1d2452' } as const;

export function applyTheme(theme: Theme = getTheme(), doc: Document = document): void {
  const root = doc.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const forDark = (meta.getAttribute('media') ?? '').includes('dark');
    meta.content = theme === 'system' ? BAR_COLOURS[forDark ? 'dark' : 'light'] : BAR_COLOURS[theme];
  }
}
