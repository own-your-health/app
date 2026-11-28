// Writes test/fixtures/results/views/: one person's household, index and text,
// and the views the app reads, as medrec 0.9.10 writes them of its own public
// fixture of a result's shapes (test/fixtures/results/medrec/readings.json,
// unmodified): each on a day of its own, with a heading that lists two of them
// and a report that lists one and one not filed, as medrec's own test of them
// has it (tests/flow.rs). Beside them, invented here: a visit with two results,
// a heading that lists them, one whose results are none of them filed, and one
// entered in error; a blood pressure sent as a panel of its two numbers; and
// two tests sent in two units. No field of them is set here.
//
//   MEDREC=<medrec 0.9.10> node scripts/result-fixtures.mjs
//
// The same files give the same bytes (medrec.mjs). It writes over its own
// files alone and deletes nothing: a file there it no longer writes stops the
// run, named, for a person to remove.

import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { holdsOnly } from './cases.mjs';
import { APP_VIEW } from './medrec.mjs';
import { machineWith } from './providers.mjs';
import { encounter, result, rid } from './sample/fhir.mjs';

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'results');
const OUT = join(RESULTS, 'views');
const DAY = 24 * 60 * 60;

const PEOPLE = { pat: { name: 'Pat Example', born: '1984-04-04', args: ['--adult'] } };
const LAB = { id: 'example-lab', name: 'Example Lab', fhir_base: 'https://example-lab.example', vendor: 'site' };
const SOURCE = { cli: 'labcorp', version: '0.2.1', person: 'pat', login: 'pat', org: LAB, patient: rid('pat', 'pat lab'), relationship: 'self', method: 'portal' };

const subject = { reference: `Patient/${SOURCE.patient}` };
const refs = (...ids) => ids.map((id) => ({ reference: `Observation/${id}` }));
const cases = JSON.parse(readFileSync(join(RESULTS, 'medrec', 'readings.json'), 'utf8'));
const VISIT = '2024-05-14';
const drawn = [result('pat visit', VISIT, ['2951-2', 'Sodium', 139, 'mmol/L', '135-145 mmol/L']), result('pat visit', VISIT, ['2823-3', 'Potassium', 5.4, 'mmol/L', '3.5-5.1 mmol/L', 'High'])];
const LAB_CATEGORY = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }];
const lab = (name) => (date, value, unit, range) => ({ resourceType: 'Observation', id: rid('Observation', `pat ${name} ${date}`), status: 'final', category: LAB_CATEGORY, code: { text: name }, effectiveDateTime: date, valueQuantity: { value, unit }, referenceRange: [{ text: range }] });
const glucose = lab('Example glucose');
const lactate = lab('Example lactate');
const VITAL = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }];
const PANEL_DAY = '2024-06-10T08:15:00Z';
const vital = (id, code, display, value) => ({ resourceType: 'Observation', id, status: 'final', category: VITAL, code: { coding: [{ system: 'http://loinc.org', code, display }] }, effectiveDateTime: PANEL_DAY, valueQuantity: { value, unit: 'mmHg' } });
const heading = (display, members, more = {}) => ({ resourceType: 'Observation', id: rid('Observation', `pat ${display}`), status: 'final', code: { text: display }, effectiveDateTime: `${VISIT}T09:30:00Z`, hasMember: refs(...members), ...more });
const resources = [
  // Each of its own day, so of its own record.
  ...cases.map((c, i) => ({ ...c.resource, effectiveDateTime: `2024-04-${String(i + 1).padStart(2, '0')}T09:30:00Z` })),
  { resourceType: 'Observation', id: 'panel-1', status: 'final', code: { text: 'Example heading' }, effectiveDateTime: '2024-04-21T09:30:00Z', hasMember: refs('lt-1', 'range-1') },
  {
    resourceType: 'DiagnosticReport',
    id: 'report-1',
    status: 'final',
    code: { text: 'Example panel' },
    effectiveDateTime: '2024-04-30T09:30:00Z',
    result: refs('sum-1', 'not-filed'),
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }],
  },
  encounter('pat visit', { start: `${VISIT}T09:00:00Z`, end: `${VISIT}T09:40:00Z`, type: 'Office visit', place: 'Example Clinic', clinician: 'Dr. Example Clinician', reason: 'Check-up' }),
  ...drawn,
  heading('Example salts panel', drawn.map((r) => r.id)),
  heading('Example metals panel', ['not-filed-2', 'not-filed-3']),
  heading('Example withdrawn panel', drawn.map((r) => r.id), { status: 'entered-in-error' }),
  vital('pat-sys', '8480-6', 'Systolic blood pressure', 130),
  vital('pat-dia', '8462-4', 'Diastolic blood pressure', 85),
  { resourceType: 'Observation', id: 'pat-bp-panel', status: 'final', category: VITAL, code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }] }, effectiveDateTime: PANEL_DAY, hasMember: refs('pat-sys', 'pat-dia') },
  glucose('2024-02-01', 95, 'mg/dL', '70-99 mg/dL'),
  glucose('2024-03-01', 5.4, 'mmol/L', '3.9-5.5 mmol/L'),
  glucose('2024-06-01', 99, 'mg/dL', '70-99 mg/dL'),
  lactate('2024-02-01', 1.2, 'mmol/L', '0.5-2.2 mmol/L'),
  lactate('2024-03-01', 11, 'mg/dL', '4.5-19.8 mg/dL'),
].map((r) => ({ ...r, subject }));

const { root, at, imports } = machineWith(PEOPLE, { lab: SOURCE }, '0.9.10');
at(10 * DAY, 'profiles', 'add', 'demo');
at(10 * DAY, 'init', root);
at(10 * DAY, 'people', 'add', PEOPLE.pat.name, '--birth-date', PEOPLE.pat.born, ...PEOPLE.pat.args);
imports(SOURCE, 8 * DAY, resources);
at(7 * DAY, 'views', 'write', '--all');

const household = JSON.parse(readFileSync(join(root, 'household.json'), 'utf8'));
const [person] = household.people;
const keep = ['household.json', join(person.folder, 'index.json'), join(person.folder, 'text.json'), join('views', 'views.json'), ...readdirSync(join(root, 'views', person.id)).filter((f) => APP_VIEW.test(f) || /^standing\.[0-9a-f]{12}\.json$/.test(f)).map((f) => join('views', person.id, f))];
for (const file of keep) {
  mkdirSync(join(OUT, dirname(file)), { recursive: true });
  cpSync(join(root, file), join(OUT, file));
}
console.log(`wrote ${keep.length} files under test/fixtures/results/views/`);
holdsOnly('results/views', keep);
