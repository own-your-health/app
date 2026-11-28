// Writes test/fixtures/rules/: the household, each person's index, one person's
// bills, and its answers to the requests put in the folder, as medrec 0.9.10
// writes them of the invented records in sample/rules.mjs, which give each of
// the app's reading rules a case. No field of them is set here.
//
//   MEDREC=<medrec 0.9.10> node scripts/rule-fixtures.mjs
//
// The same sources give the same bytes (medrec.mjs). It writes over its own
// files alone and deletes nothing: a file there it no longer writes stops the
// run, named, for a person to remove.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { holdsOnly } from './cases.mjs';
import { iso } from './medrec.mjs';
import { machineWith, put } from './providers.mjs';
import { ASKED, MARKED, MISNAMED, PAPERS, PEOPLE, RECORDS, SOURCES, TOO_LARGE } from './sample/rules.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'rules');
const DAY = 24 * 60 * 60;

const { root, at, imports, files, idOf } = machineWith(PEOPLE, SOURCES);
at(10 * DAY, 'profiles', 'add', 'demo');
at(10 * DAY, 'init', root);
for (const p of Object.values(PEOPLE)) at(10 * DAY, 'people', 'add', p.name, '--birth-date', p.born, ...p.args);
for (const [person, papers] of Object.entries(PAPERS)) files(person, 9 * DAY, papers);
// Each load at a moment of its own.
Object.entries(SOURCES).forEach(([name, s], i) => imports(s, 8 * DAY - i * 60, RECORDS[name]));

const val = JSON.parse(readFileSync(join(root, PEOPLE.val.name, 'index.json'), 'utf8'));
const bill = (due) => val.documents.find((d) => d.doc_type === 'bill' && !d.same_statement_as && d.statement?.amount_due?.amount === due).id;
for (const [due, on, amount] of MARKED) at(7 * DAY, 'bills', 'paid', bill(due), '--on', on, '--amount', amount);
// As the app asks, for the Mac's next pass.
const asks = (i, what, request) => {
  const id = `x_${[...createHash('sha256').update(what).digest().subarray(0, 20)].map((b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('')}`;
  const asked = iso(6 * DAY + 60 - i);
  put(join(root, '_requests', `${asked.replace(/[-:]/g, '')}_${id}.json`), JSON.stringify({ schema: 'medrec-request/v1', id, requested_at: asked, requested_by: { email: 'robin@example.com' }, ...request, app: { name: 'own-your-health-app', version: '0.1.0' } }, null, 2));
};
ASKED.forEach(({ of, on, amount }, i) => asks(i, `payment ${i}`, { paid: { person: val.person, document: of ? bill(of) : `d_${'a'.repeat(20)}`, on, amount } }));
asks(ASKED.length, 'too large', TOO_LARGE);
put(join(root, '_requests', MISNAMED.file), JSON.stringify(MISNAMED.request));
at(6 * DAY, '--profile', 'demo', 'refresh', 'add', '--source', idOf(SOURCES.valPlan), '--provider-profile', SOURCES.valPlan.login);
at(6 * DAY, 'refresh', '--scheduled');
at(0, 'verify');

mkdirSync(OUT, { recursive: true });
const written = [];
const keep = (file, as) => {
  if (written.includes(as)) throw new Error(`two files would be test/fixtures/rules/${as}`);
  copyFileSync(file, join(OUT, as));
  written.push(as);
};
keep(join(root, 'household.json'), 'household.json');
for (const [name, p] of Object.entries(PEOPLE)) keep(join(root, p.name, 'index.json'), `${name}.json`);
const views = join(root, 'views', val.person);
keep(join(views, readdirSync(views).find((f) => f.startsWith('bills.'))), 'bills.json');
const done = join(root, '_requests', 'done');
for (const f of readdirSync(done).filter((x) => x.endsWith('.json'))) {
  const answer = JSON.parse(readFileSync(join(done, f), 'utf8'));
  keep(join(done, f), answer.paid ? `paid-${answer.handled.outcome}.json` : answer.id ? 'refused-large.json' : 'refused-name.json');
}
console.log(`wrote ${written.length} files under test/fixtures/rules/`);
holdsOnly('rules', written);
