// Writes test/fixtures/errors/views/: the views the app reads, as medrec 0.9.9
// writes them of its own public fixture of what is entered in error
// (test/fixtures/errors/medrec/). No field of them is set here.
//
//   MEDREC=<medrec 0.9.9> node scripts/error-fixtures.mjs
//
// The same files give the same bytes (medrec.mjs). It writes over its own
// files alone and deletes nothing: a file there it no longer writes stops the
// run, named, for a person to remove.

import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { holdsOnly } from './cases.mjs';
import { APP_VIEW, scratchMachine } from './medrec.mjs';

const ERRORS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'errors');
const OUT = join(ERRORS, 'views');
const given = (file) => join(ERRORS, 'medrec', file);
/** Of the views this release writes, those the app reads: the sample's, and what is current. */
const read = (file) => APP_VIEW.test(file) || /^standing\.[0-9a-f]{12}\.json$/.test(file);

const { root, medrec } = scratchMachine(undefined, { release: '0.9.9' });
const [person] = JSON.parse(readFileSync(given('household.json'), 'utf8')).people;
mkdirSync(join(root, person.folder), { recursive: true });
cpSync(given('household.json'), join(root, 'household.json'));
for (const file of ['index.json', 'marks.json', 'overrides.json']) cpSync(given(file), join(root, person.folder, file));
for (const args of [['profiles', 'add', 'demo'], ['init', root], ['views', 'write', '--all']]) medrec(0, ...args);

const views = join(root, 'views');
const keep = ['views.json', ...readdirSync(join(views, person.id)).filter(read).map((file) => join(person.id, file))];
for (const file of keep) {
  mkdirSync(join(OUT, dirname(file)), { recursive: true });
  cpSync(join(views, file), join(OUT, file));
}
console.log(`wrote ${keep.length} files under test/fixtures/errors/views/`);
holdsOnly('errors/views', keep);
