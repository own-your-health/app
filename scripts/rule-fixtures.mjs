// Writes test/fixtures/rules/: the household, each person's index, one person's
// bills, and its answers to the requests put in the folder, as medrec 0.9.7
// writes them of the invented records in sample/rules.mjs, which give each of
// the app's reading rules a case. No field of them is set here.
//
//   MEDREC=<medrec 0.9.7> node scripts/rule-fixtures.mjs
//
// The same sources give the same bytes (medrec.mjs). It writes over its own
// files alone and deletes nothing.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { iso } from './medrec.mjs';
import { machineWith, put } from './providers.mjs';
import { ASKED, MARKED, PAPERS, PEOPLE, RECORDS, SOURCES } from './sample/rules.mjs';

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
ASKED.forEach(({ of, on, amount }, i) => {
  const id = `x_${[...createHash('sha256').update(`payment ${i}`).digest().subarray(0, 20)].map((b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('')}`;
  const asked = iso(6 * DAY + 60 - i);
  const paid = { person: val.person, document: of ? bill(of) : `d_${'a'.repeat(20)}`, on, amount };
  put(join(root, '_requests', `${asked.replace(/[-:]/g, '')}_${id}.json`), JSON.stringify({ schema: 'medrec-request/v1', id, requested_at: asked, requested_by: { email: 'robin@example.com' }, paid, app: { name: 'own-your-health-app', version: '0.1.0' } }, null, 2));
});
at(6 * DAY, '--profile', 'demo', 'refresh', 'add', '--source', idOf(SOURCES.valPlan), '--provider-profile', SOURCES.valPlan.login);
at(6 * DAY, 'refresh', '--scheduled');
at(0, 'verify');

mkdirSync(OUT, { recursive: true });
copyFileSync(join(root, 'household.json'), join(OUT, 'household.json'));
for (const [name, p] of Object.entries(PEOPLE)) copyFileSync(join(root, p.name, 'index.json'), join(OUT, `${name}.json`));
const views = join(root, 'views', val.person);
copyFileSync(join(views, readdirSync(views).find((f) => f.startsWith('bills.'))), join(OUT, 'bills.json'));
const done = join(root, '_requests', 'done');
for (const f of readdirSync(done).filter((x) => x.endsWith('.json'))) {
  const answer = JSON.parse(readFileSync(join(done, f), 'utf8'));
  copyFileSync(join(done, f), join(OUT, `paid-${answer.handled.outcome}.json`));
}
console.log('wrote test/fixtures/rules/');
