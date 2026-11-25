// Writes the sample records folder (public/demo/) from scripts/sample/: what
// invented providers serve and papers a household keeps. This script only
// puts those where medrec reads them. medrec 0.9.7, its own release, writes
// every record, paper, index, view and status: no field of them is set here.
//
//   MEDREC=<medrec 0.9.7> node scripts/demo-folder.mjs <a new folder>
//
// It writes to a folder that does not exist yet and deletes nothing. To take a
// new sample, move public/demo away and the new folder into its place.
//
// The same sources give the same bytes (medrec.mjs): medrec runs over
// stand-ins for the provider CLIs and pdftotext, and finds nothing else.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANCHOR, APP_VIEW, iso, md5Of, scratchMachine } from './medrec.mjs';
import { machineWith, put } from './providers.mjs';
import { PEOPLE, SOURCES } from './sample/household.mjs';
import * as alex from './sample/alex.mjs';
import * as drew from './sample/drew.mjs';
import * as robin from './sample/robin.mjs';
import * as sam from './sample/sam.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEPT = resolve(HERE, '..', 'public', 'demo');
const OUT = process.argv[2] && resolve(process.argv[2]);
if (!OUT || existsSync(OUT)) {
  console.error('usage: node scripts/demo-folder.mjs <a new folder>');
  process.exit(2);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const { home, root: ROOT, at, signedIn, serves, fails, imports, files, idOf } = machineWith(PEOPLE, SOURCES);
const refreshes = (s, before, ...more) => at(before, '--profile', 'demo', 'refresh', 'add', '--source', idOf(s), '--provider-profile', s.login, ...more);
const pass = (before) => at(before, 'refresh', '--scheduled');

const { robinChart, robinPlan, robinBlood, robinRx, samChart, samLab, samBilling, samPlan, alexPeds, alexPlan, drewPeds } = SOURCES;

// ---- The folder, and what was on paper ----

at(40 * DAY, 'profiles', 'add', 'demo');
at(40 * DAY, 'init', ROOT);
for (const p of Object.values(PEOPLE)) at(40 * DAY, 'people', 'add', p.name, '--birth-date', p.born, ...p.args);
files('robin', 39 * DAY, robin.PAPERS);
files('sam', 39 * DAY, [...sam.PAPERS, sam.LATER_PAPERS.endoscopy, sam.LATER_PAPERS.center]);
for (const image of sam.ANKLE) put(join(home, 'papers', 'ankle', image.file), image.bytes);
at(39 * DAY, 'images', 'intake', '--person', PEOPLE.sam.name, join(home, 'papers', 'ankle'));

// ---- The first loads ----

// The portal keeps the plan's own claims from its app.
const noClaims = [{ resource_type: 'ExplanationOfBenefit', reason: 'the server does not give this app claims', code: 'forbidden' }];
imports(robinChart, 38 * DAY, robin.CHART[0], noClaims);
imports(robinRx, 38 * DAY, robin.RX[0]);
imports(samPlan, 36 * DAY, sam.PLAN[0]);
imports(alexPlan, 36 * DAY, alex.PLAN[0]);
imports(alexPeds, 35 * DAY, alex.PEDS[0]);
imports(drewPeds, 35 * DAY, drew.PEDS[0]);
imports(samLab, 35 * DAY, sam.LAB[0]);
imports(robinPlan, 33 * DAY, robin.PLAN[0]);
files('robin', 32 * DAY, [robin.LATER_PAPERS.october]);
files('robin', 24 * DAY, [robin.LATER_PAPERS.lab]);
imports(robinPlan, 20 * DAY, robin.PLAN[1]);
imports(samBilling, 20 * DAY, sam.BILLING[0]);
imports(samChart, 12 * DAY, sam.CHART[0]);
imports(robinBlood, 12 * DAY, robin.BLOOD[0]);

// ---- Loads on a schedule ----

// A lab that loads every nine days or so, and last did.
refreshes(samLab, 9 * DAY, '--every', '208h');
serves(samLab, 9 * DAY, sam.LAB[0]);
pass(9 * DAY);
imports(robinChart, 8 * DAY, robin.CHART[1], noClaims);
imports(robinPlan, 3 * DAY, robin.PLAN[2]);
imports(robinBlood, 2 * DAY, robin.BLOOD[1]);
// A billing site paused by hand.
refreshes(samBilling, 2 * DAY);
at(2 * DAY, 'refresh', 'pause', idOf(samBilling), '--reason', 'user', '--note', 'Paused by hand on the Mac.');
for (const s of [robinRx, samPlan, alexPlan]) refreshes(s, 30 * HOUR, '--every', '48h');
serves(robinRx, 30 * HOUR, robin.RX[1]);
serves(samPlan, 30 * HOUR, sam.PLAN[1]);
serves(alexPlan, 30 * HOUR, alex.PLAN[1]);
pass(30 * HOUR);
refreshes(alexPeds, 26 * HOUR);
serves(alexPeds, 26 * HOUR, alex.PEDS[1]);
pass(26 * HOUR);
files('alex', DAY, [alex.LATER_PAPERS.school]);
refreshes(drewPeds, 20 * HOUR);
serves(drewPeds, 20 * HOUR, drew.PEDS[0]);
pass(20 * HOUR);
// Member sites whose sign-ins nothing renews: each loads after someone signs
// in, and otherwise waits. The lab's site does not answer from here on.
refreshes(robinPlan, 8 * HOUR);
signedIn(robinPlan, { authenticated: false, renews: false, lasts_secs: 1800 });
fails(samLab, 5, 'the site did not answer; try again later (503 Service Unavailable)\n');
pass(8 * HOUR);
refreshes(robinBlood, 6 * HOUR);
fails(robinBlood, 3, '');
pass(6 * HOUR);
refreshes(samChart, 5 * HOUR);
serves(samChart, 5 * HOUR, sam.CHART[1]);
signedIn(samChart, { session_valid: true, renews: true, expires_at: iso(-40 * HOUR) });
pass(5 * HOUR);
// A person asks for Robin's chart, as the app writes it.
refreshes(robinChart, 3 * HOUR);
serves(robinChart, 3 * HOUR, robin.CHART[2], noClaims);
signedIn(robinChart, { session_valid: true, renews: true, expires_at: iso(-200 * DAY) });
const asked = iso(3 * HOUR + 4 * MINUTE);
const id = `x_${[...createHash('sha256').update('robin chart request').digest().subarray(0, 20)].map((b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('')}`;
put(
  join(ROOT, '_requests', `${asked.replace(/[-:]/g, '')}_${id}.json`),
  JSON.stringify({ schema: 'medrec-request/v1', id, requested_at: asked, requested_by: { email: 'robin@example.com', name: PEOPLE.robin.name }, scope: { source: idOf(robinChart) }, app: { name: 'own-your-health-app', version: '0.1.0' } }, null, 2),
);
pass(3 * HOUR);
// The practice's sign-in renews itself, so its end is news.
fails(alexPeds, 3, 'The sign-in has expired and could not be renewed.\n');
signedIn(alexPeds, { session_valid: true, renews: true });
pass(2 * HOUR);
// Nothing is due: the pass that says the Mac still looks.
pass(2 * MINUTE);

// ---- The codes' names ----

// They come from CMS's table of ICD-10-CM titles, which medrec reads from a
// machine that has it and otherwise keeps from that person's last views. So the
// table is needed only when someone gains a code or their id changes, and a run
// that then goes without it stops: ICD10CM_ZIP is the zip `medrec tables list`
// gives the address of, which medrec checks against its recorded hash. The last
// pass is on a machine without it, so every machine writes the same views.
if (process.env.ICD10CM_ZIP) {
  at(2 * MINUTE, 'tables', 'fetch', 'icd10cm', '--file', resolve(process.env.ICD10CM_ZIP));
  at(2 * MINUTE, 'views', 'write', '--all');
} else {
  for (const f of readdirSync(join(KEPT, 'views'), { recursive: true })) {
    if (f === 'views.json' || f.split(sep).at(-1).startsWith('code-names.')) put(join(ROOT, 'views', f), readFileSync(join(KEPT, 'views', f)));
  }
}
const last = scratchMachine(ROOT).medrec;
for (const args of [['profiles', 'add', 'demo'], ['init', ROOT], ['views', 'write', '--all'], ['verify']]) last(2 * MINUTE, ...args);

const readJson = (...path) => JSON.parse(readFileSync(join(ROOT, ...path), 'utf8'));
/** The ICD-10-CM codes anywhere in a record. */
const icd = (o) => (o && typeof o === 'object' ? [...(o.system === 'http://hl7.org/fhir/sid/icd-10-cm' ? [o.code] : []), ...Object.values(o).flatMap(icd)] : []);
for (const p of Object.values(PEOPLE)) {
  const index = readJson(p.name, 'index.json');
  const names = readdirSync(join(ROOT, 'views', index.person)).filter((f) => f.startsWith('code-names.')).map((f) => readJson('views', index.person, f));
  const named = new Set(names.flatMap((n) => [...Object.keys(n.codes ?? {}), ...Object.keys(n.private_codes ?? {})]).map((key) => key.split('|')[1]));
  const unnamed = [...new Set(icd(index.records))].filter((code) => !named.has(code));
  if (unnamed.length) throw new Error(`${p.name}'s ${unnamed.join(', ')} have no name: run again with ICD10CM_ZIP (above)`);
}

// ---- The folder as the app ships it ----

const ships = (f) => !f.startsWith(`views${sep}`) || f === join('views', 'views.json') || APP_VIEW.test(f.split(sep).at(-1));
const list = readdirSync(ROOT, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => join(e.parentPath, e.name).slice(ROOT.length + 1))
  .filter(ships)
  .sort();
for (const f of list) {
  mkdirSync(dirname(join(OUT, f)), { recursive: true });
  copyFileSync(join(ROOT, f), join(OUT, f));
}
// The app lists this folder from the manifest, which has no empty ones.
put(join(OUT, '_requests', '.keep'), '');
const shipped = [...list.map((f) => f.split(sep).join('/')), '_requests/.keep'].sort();
// Each file's MD5, as Drive reports it: the app checks medrec's views against them.
const md5 = Object.fromEntries(shipped.map((f) => [f, md5Of(readFileSync(join(OUT, f)))]));
put(join(OUT, 'manifest.json'), `${JSON.stringify({ anchor: ANCHOR, files: shipped, md5 }, null, 2)}\n`);
console.log(`wrote ${shipped.length} files under ${OUT}`);
