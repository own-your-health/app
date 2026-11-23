import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GETTING_STARTED_URL, REGISTRATION_URL, REPO_URL } from '../src/ui/views/setup';

const root = new URL('../', import.meta.url);
const local = (url: string) => new URL(url.replace(`${REPO_URL}/blob/main/`, ''), root);

describe('the guides the app links', () => {
  it('are files in this repository', () => {
    for (const url of [GETTING_STARTED_URL, REGISTRATION_URL]) {
      expect(url.startsWith(`${REPO_URL}/blob/main/docs/`)).toBe(true);
      expect(existsSync(local(url))).toBe(true);
    }
  });

  it('link each other by sections that exist', () => {
    const guide = readFileSync(local(GETTING_STARTED_URL), 'utf8');
    const registration = readFileSync(local(REGISTRATION_URL), 'utf8');
    // GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens.
    const anchors = registration
      .split('\n')
      .filter((l) => l.startsWith('#'))
      .map((l) => l.replace(/^#+\s*/, '').toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-'));
    const linked = [...guide.matchAll(/\(registration\.md#([^)]+)\)/g)].map((m) => m[1]);
    expect(linked.length).toBeGreaterThan(0);
    for (const a of linked) expect(anchors).toContain(a);
  });
});
