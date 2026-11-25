// Cases for tests: the sample with something changed in it, as medrec writes
// it then. A case holds the files that differ from public/demo/, by their
// path there, so a test lays them over it. medrec writes every one
// (scripts/medrec.mjs): nothing in a view, or in the marks it is made from,
// is set by hand.
//
// medrec gives a mark its time and a random id, so the marks made once are
// kept and each run writes the views from them again; --marks makes them anew.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VIEW, md5Of, withMedrec } from './medrec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO = join(ROOT, 'public', 'demo');

/** Every file under a folder, by its path in it. */
function filesIn(dir, at = '') {
  return readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(dir, join(at, e.name)) : [join(at, e.name)]));
}

/** One of the sample's items: the only one that fits. */
export function only(folder, list, fits, what) {
  const found = JSON.parse(readFileSync(join(DEMO, folder, 'index.json'), 'utf8'))[list].filter(fits);
  if (found.length !== 1) throw new Error(`${found.length} of ${folder}'s ${list} are ${what}, not 1`);
  return found[0].id;
}

/** Writes test/fixtures/<dir>/: what differs from the sample once `before` has changed its folder and `steps` has run medrec on it. */
export function writeCase(dir, before, steps) {
  const out = join(ROOT, 'test', 'fixtures', dir);
  const root = mkdtempSync(join(tmpdir(), 'medrec-case-'));
  try {
    cpSync(DEMO, root, { recursive: true });
    rmSync(join(root, 'manifest.json'));
    before(root);
    withMedrec(root, steps);
    rmSync(out, { recursive: true, force: true });
    const keep = filesIn(root).filter((f) => {
      const base = f.split('/').at(-1);
      const wanted = base === 'marks.json' || f === join('views', 'views.json') || (f.startsWith('views/') && APP_VIEW.test(base));
      const same = existsSync(join(DEMO, f)) && md5Of(readFileSync(join(DEMO, f))) === md5Of(readFileSync(join(root, f)));
      return wanted && !same;
    });
    for (const f of keep) {
      mkdirSync(join(out, dirname(f)), { recursive: true });
      cpSync(join(root, f), join(out, f));
    }
    console.log(`wrote ${keep.length} files under test/fixtures/${dir}/`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A case with the household's marks in it: `marks` are medrec's arguments for each, used when none are kept. */
export function writeMarked(dir, marks) {
  const kept = join(ROOT, 'test', 'fixtures', dir);
  const made = !process.argv.includes('--marks') && existsSync(kept) ? filesIn(kept).filter((f) => f.endsWith('marks.json')) : [];
  const bytes = made.map((f) => [f, readFileSync(join(kept, f))]);
  writeCase(
    dir,
    (root) => bytes.forEach(([f, b]) => writeFileSync(join(root, f), b)),
    (medrec) => {
      if (!bytes.length) for (const args of marks) medrec(...args);
      medrec('views', 'write', '--all');
    },
  );
}
