// Writes test/fixtures/private/: what medrec writes about the sample's private
// items when a household has marked some, and when its marks don't read. Each
// case holds the files that differ from public/demo/, by their path there, so
// a test lays them over it. medrec writes every one (scripts/medrec.mjs):
// nothing in a private.json, or in the marks it is made from, is set by hand.
// Run it after scripts/demo-folder.mjs, and commit the result.
//
// - marked: the household marked items private and not (MARKS below).
// - unreadable: Sam's marks.json does not read.
//
// `medrec private` gives a mark its time and a random id, so the marks made
// once are kept and each run writes the views from them again; --marks makes
// them anew.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VIEW, md5Of, withMedrec } from './medrec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, '..', 'public', 'demo');
const OUT = join(HERE, '..', 'test', 'fixtures', 'private');

/** One of the sample's items: the only one that fits. */
function only(folder, list, fits, what) {
  const found = JSON.parse(readFileSync(join(DEMO, folder, 'index.json'), 'utf8'))[list].filter(fits);
  if (found.length !== 1) throw new Error(`${found.length} of ${folder}'s ${list} are ${what}, not 1`);
  return found[0].id;
}

const household = JSON.parse(readFileSync(join(DEMO, 'household.json'), 'utf8'));
const person = (name) => household.people.find((p) => p.name === name);

/** The event one of a person's records or papers is in. */
function eventWith(name, item) {
  const views = join(DEMO, 'views', person(name).id);
  const file = readdirSync(views).find((f) => /^events\.[0-9a-f]{12}\.json$/.test(f));
  const event = JSON.parse(readFileSync(join(views, file), 'utf8')).events.find((e) => e.members.some((m) => (m.record ?? m.document) === item));
  if (!event) throw new Error(`no event of ${name}'s holds ${item}`);
  return event.id;
}

const goingHome = only('Sam Example', 'documents', (d) => d.title === 'Going home after knee surgery', 'the going-home instructions');
const counseling = only('Sam Example', 'records', (r) => r.kind === 'encounter' && r.display === 'Counseling session', 'the counseling session');
const MARKS = [
  // A procedure marked private takes its claims and papers with it; one paper of it is marked not private.
  ['mark', eventWith('Sam Example', goingHome)],
  ['unmark', goingHome],
  // A visit the rules make private, marked not private. Its records stay private.
  ['unmark', eventWith('Sam Example', counseling)],
  // One record, and one paper, marked by themselves.
  ['mark', only('Robin Example', 'records', (r) => r.kind === 'allergy' && r.status === 'active', 'the current allergy')],
  ['mark', only('Robin Example', 'documents', (d) => d.title === 'Statement from Example Lab', 'the lab’s statement')],
];

/** Every file under a folder, by its path in it. */
function filesIn(dir, at = '') {
  return readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(dir, join(at, e.name)) : [join(at, e.name)]));
}

function write(name, before, steps) {
  const root = mkdtempSync(join(tmpdir(), 'medrec-private-'));
  try {
    cpSync(DEMO, root, { recursive: true });
    rmSync(join(root, 'manifest.json'));
    before(root);
    withMedrec(root, steps);
    rmSync(join(OUT, name), { recursive: true, force: true });
    const keep = filesIn(root).filter((f) => {
      const base = f.split('/').at(-1);
      const wanted = base === 'marks.json' || f === join('views', 'views.json') || (f.startsWith('views/') && APP_VIEW.test(base));
      const same = existsSync(join(DEMO, f)) && md5Of(readFileSync(join(DEMO, f))) === md5Of(readFileSync(join(root, f)));
      return wanted && !same;
    });
    for (const f of keep) {
      mkdirSync(join(OUT, name, dirname(f)), { recursive: true });
      cpSync(join(root, f), join(OUT, name, f));
    }
    console.log(`wrote ${keep.length} files under test/fixtures/private/${name}/`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const kept = join(OUT, 'marked');
const made = !process.argv.includes('--marks') && existsSync(kept) ? filesIn(kept).filter((f) => f.endsWith('marks.json')) : [];
const marks = made.map((f) => [f, readFileSync(join(kept, f))]);
write(
  'marked',
  (root) => marks.forEach(([f, bytes]) => writeFileSync(join(root, f), bytes)),
  (medrec) => {
    if (!marks.length) for (const [verb, id] of MARKS) medrec('private', verb, id);
    medrec('views', 'write', '--all');
  },
);
write(
  'unreadable',
  (root) => writeFileSync(join(root, 'Sam Example', 'marks.json'), '{"schema": "medrec-marks/v1", "person": '),
  (medrec) => medrec('views', 'write', '--all'),
);
