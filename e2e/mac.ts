import { expect, type Page } from '@playwright/test';
import type { Overlay } from '../test/helpers';
import type { FakeGoogle } from './fake-google';

/** The folder as medrec writes it next, read again by the app: a request it saw waiting is done. `n` is another each time. */
export async function macWrites(page: Page, google: FakeGoogle, files: Overlay, n: number): Promise<void> {
  const look = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const [at, id] = [new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), `x_${'abcdefghij'[n]!.repeat(20)}`];
  const name = `20261122T20031${n}Z_${id}.json`;
  const asking = { schema: 'medrec-request/v1', id, requested_at: at, requested_by: { email: 'sam@example.com' }, scope: { all: true }, app: { name: 'own-your-health-app', version: '0.1.0' } };
  const reads = (path: string) => google.reads.filter((r) => r === path).length;
  google.writeAsMac(`_requests/${name}`, JSON.stringify(asking));
  const before = reads(`_requests/${name}`);
  await look();
  await expect.poll(() => reads(`_requests/${name}`)).toBeGreaterThan(before);
  for (const [path, text] of Object.entries(files)) if (text !== null) google.writeAsMac(path, text);
  google.writeAsMac(`_requests/done/${name}`, JSON.stringify({ ...asking, handled: { picked_up_at: at, finished_at: at, outcome: 'ok', sources: [], message: 'loaded', by: 'medrec 0.9.7' } }));
  google.removeAsMac(`_requests/${name}`);
  const views = reads('views/views.json');
  await expect(async () => {
    await look();
    expect(reads('views/views.json')).toBeGreaterThan(views);
  }).toPass();
}
