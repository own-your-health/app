import type { Page } from '@playwright/test';
import { manifestWith, type Overlay } from '../test/helpers';

/** Serves the sample with these files laid over it, as a folder holding them would. */
export async function lay(page: Page, overlay: Overlay) {
  await page.route(/\/app\/demo\//, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*?\/demo\//, ''));
    if (path === 'manifest.json') return route.fulfill({ contentType: 'application/json', body: manifestWith(overlay) });
    const over = overlay[path];
    if (over === undefined) return route.continue();
    return over === null ? route.fulfill({ status: 404, body: 'not found' }) : route.fulfill({ contentType: 'application/json', body: over });
  });
}
