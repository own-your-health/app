// Cases for tests: the sample with something changed in it, as medrec writes
// it then. A case holds the files that differ from public/demo/, by their
// path there, so a test lays them over it. medrec writes every one, the same
// on each run (scripts/medrec.mjs): nothing in a view, or in the marks it is
// made from, is set by hand.
//
// Nothing is deleted. medrec works on a copy of the sample in a new folder
// under the system's temporary one, which the system clears. A case is
// written only into its own folder, over what it wrote there before, and a
// file there that is no longer part of it stops the run, named, for a person
// to remove.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VIEW, md5Of, scratchMachine } from './medrec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO = join(ROOT, 'public', 'demo');
const FIXTURES = join(ROOT, 'test', 'fixtures');
/** The cases' own folders under test/fixtures/: nothing is written anywhere else. */
const CASES = ['bills/paid', 'labels/said', 'private/marked', 'private/unreadable'];

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

/** Whether a file of the folder belongs in a case: the marks, what medrec keeps of labels, and the views the app reads. */
const inCase = (f) => f.endsWith('marks.json') || f.endsWith('provider-state.json') || f === join('views', 'views.json') || (f.startsWith(`views${sep}`) && APP_VIEW.test(f.split(sep).at(-1)));

/** Stops the run when test/fixtures/<dir>/ holds a file that is not one of these. */
export function holdsOnly(dir, files) {
  const extra = filesIn(join(FIXTURES, dir)).filter((f) => !files.includes(f));
  if (extra.length) throw new Error(`no longer part of test/fixtures/${dir}/, so remove by hand:\n${extra.map((f) => `  ${f}`).join('\n')}`);
}

/** Writes test/fixtures/<dir>/: what differs from the sample once `before` has changed its folder, or its machine's home, and medrec has run `steps` on it, at the sample's moment. */
export function writeCase(dir, steps, before = () => {}) {
  if (!CASES.includes(dir)) throw new Error(`${dir} is not one of the cases' folders`);
  const out = join(FIXTURES, dir);
  const { root, home, medrec } = scratchMachine();
  cpSync(DEMO, root, { recursive: true, filter: (f) => relative(DEMO, f) !== 'manifest.json' });
  before(root, home);
  for (const args of [['profiles', 'add', 'demo'], ['init', root], ...steps, ['views', 'write', '--all']]) medrec(0, ...args);
  const same = (f) => existsSync(join(DEMO, f)) && md5Of(readFileSync(join(DEMO, f))) === md5Of(readFileSync(join(root, f)));
  const keep = filesIn(root).filter((f) => inCase(f) && !same(f));
  for (const f of keep) {
    mkdirSync(join(out, dirname(f)), { recursive: true });
    cpSync(join(root, f), join(out, f));
  }
  console.log(`wrote ${keep.length} files under test/fixtures/${dir}/`);
  holdsOnly(dir, keep);
}
