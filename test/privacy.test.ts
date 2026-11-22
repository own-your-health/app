import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers';

// What Google's review and the household need the privacy policy to say.
// The page's words, tags removed, so a line break in the HTML does not matter.
const text = readFileSync(join(ROOT, 'privacy.html'), 'utf8')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');
const html = readFileSync(join(ROOT, 'privacy.html'), 'utf8');

describe('the privacy policy', () => {
  it('says there is no server and nothing goes anywhere but Drive', () => {
    expect(text).toContain('It has no server');
    expect(text).toContain('Nothing from your records is sent anywhere but back to Google Drive.');
  });

  it('lists what the browser keeps', () => {
    for (const kept of ['client id', 'records folder you chose', 'email of the Google account']) expect(text).toContain(kept);
  });

  it('names both scopes and why', () => {
    expect(text).toContain('(drive.readonly): to read the records folder');
    expect(text).toContain('(drive.file): to write a small refresh request');
    expect(text).toContain('_requests/');
  });

  it('says how to remove access, follows Google’s user data policy, and gives a contact', () => {
    expect(text).toContain('Third-party connections');
    expect(text).toContain('Limited Use requirements');
    expect(html).toContain('href="https://developers.google.com/terms/api-services-user-data-policy"');
    expect(html).toContain('href="https://github.com/own-your-health/app/issues"');
  });
});
