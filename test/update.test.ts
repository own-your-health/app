// The look for a newer build: what the site's page names, once per while, and only one notice.
import { describe, expect, it, vi } from 'vitest';
import { buildOf, LOOK_EVERY_MS, updateWatcher } from '../src/ui/update';

const page = (build: string) => `<!doctype html><html><head><script src="./theme.js"></script><script type="module" crossorigin src="/app/assets/${build}"></script></head></html>`;

function watcher(current: string | undefined, answers: (string | Error)[]) {
  let t = 1_000_000;
  const onNew = vi.fn();
  const fetchPage = vi.fn(async () => {
    const a = answers.shift() ?? answers.at(-1)!;
    if (a instanceof Error) throw a;
    return a;
  });
  const look = updateWatcher({ current, fetchPage, now: () => t, onNew });
  return { look, onNew, fetchPage, later: (ms: number) => (t += ms) };
}

describe('the build a page names', () => {
  it('is the hashed script of a built page, and none on the dev server’s', () => {
    expect(buildOf(page('index-gbTdvQCx.js'))).toBe('assets/index-gbTdvQCx.js');
    expect(buildOf('/app/assets/index-a_b-C.js')).toBe('assets/index-a_b-C.js');
    expect(buildOf('<script type="module" src="/app/src/main.ts"></script>')).toBeUndefined();
  });
});

describe('looking for a newer build', () => {
  it('tells once, when the site’s page names another build', async () => {
    const w = watcher('assets/index-old.js', [page('index-new.js')]);
    await w.look();
    expect(w.onNew).toHaveBeenCalledTimes(1);
    w.later(LOOK_EVERY_MS);
    await w.look();
    expect(w.onNew).toHaveBeenCalledTimes(1);
    expect(w.fetchPage).toHaveBeenCalledTimes(1);
  });

  it('says nothing while the build is the same, and looks at most once per while', async () => {
    const w = watcher('assets/index-same.js', [page('index-same.js')]);
    await w.look();
    await w.look();
    expect(w.fetchPage).toHaveBeenCalledTimes(1);
    w.later(LOOK_EVERY_MS - 1);
    await w.look();
    expect(w.fetchPage).toHaveBeenCalledTimes(1);
    w.later(1);
    await w.look();
    expect(w.fetchPage).toHaveBeenCalledTimes(2);
    expect(w.onNew).not.toHaveBeenCalled();
  });

  it('looks again the next time after a failed look, and never on a page that names no build', async () => {
    const w = watcher('assets/index-old.js', [new Error('offline'), '<html></html>', page('index-new.js')]);
    await w.look();
    await w.look();
    expect(w.onNew).not.toHaveBeenCalled();
    w.later(LOOK_EVERY_MS);
    await w.look();
    expect(w.onNew).toHaveBeenCalledTimes(1);

    const dev = watcher(undefined, [page('index-new.js')]);
    await dev.look();
    expect(dev.fetchPage).not.toHaveBeenCalled();
  });
});
