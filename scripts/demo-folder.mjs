// Writes public/demo/: a synthetic records folder in medrec's layout, for
// the demo mode and the tests. Every person, organization, id and value is
// invented. Run `node scripts/demo-folder.mjs` after changing it, and commit
// the result; the tests check the manifest against the files.
//
// The folder's times are anchored at ANCHOR. The demo moves every full
// timestamp forward by (now - ANCHOR) when it reads them, so the sample's
// loads always look recent; dates of service stay as written.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo');
const ANCHOR = '2026-11-22T20:00:00Z';

// A seeded generator, so the folder is the same on every run.
let seed = 0x5eed1234;
// mulberry32: 32-bit integer steps, so no bits are lost to floating point.
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function id(kind) {
  let s = '';
  for (let i = 0; i < 20; i++) s += B32[rand() & 31];
  return `${kind}_${s}`;
}
function hex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += '0123456789abcdef'[rand() & 15];
  return s;
}
function at(offsetMinutes) {
  return new Date(Date.parse(ANCHOR) + offsetMinutes * 60_000).toISOString().replace('.000Z', 'Z');
}

const files = new Map();
// When each source's newest import ran: the records and documents it added
// are filed at that moment, as medrec files them, and the app shows them as
// new in the latest load.
const ROBIN_CHART_LOAD = at(-60 * 3);
const ALEX_PEDS_LOAD = at(-60 * 26);
// When each source's first import ran (minutes from the anchor); its
// records were filed then.
const FIRST_IMPORT = new Map();

function write(path, value) {
  files.set(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

// ---- People, organizations, sources ----

const folderId = id('f');
const robin = { id: id('p'), name: 'Robin Example', folder: 'Robin Example', birth_date: '1980-01-01', adult: true, aliases: ['Robin Q Example'], links: { huishouden_health_person: 'hh-demo-robin' }, created_at: at(-60 * 24 * 40) };
const sam = { id: id('p'), name: 'Sam Example', folder: 'Sam Example', birth_date: '1980-07-01', adult: true, links: { huishouden_health_person: 'hh-demo-sam' }, created_at: at(-60 * 24 * 40) };
const alex = { id: id('p'), name: 'Alex Example', folder: 'Alex Example', birth_date: '2018-01-01', guardians: [robin.id, sam.id], links: { huishouden_health_person: 'hh-demo-alex' }, created_at: at(-60 * 24 * 40) };
const people = [robin, sam, alex];

const orgs = {
  health: { id: id('g'), name: 'Example Health', fhir_base: 'https://fhir.example.org/r4' },
  peds: { id: id('g'), name: 'Example Pediatrics', fhir_base: 'https://api.example.net/fhir/r4' },
  plan: { id: id('g'), name: 'Example Health Plan' },
  blood: { id: id('g'), name: 'Example Blood Center' },
  lab: { id: id('g'), name: 'Example Lab' },
  billing: { id: id('g'), name: 'Example Billing' },
};

function source(person, cli, slug, org, kind = 'fhir') {
  return {
    id: id('s'),
    kind,
    person: person.id,
    cli,
    organization: slug,
    organization_name: org.name,
    ...(org.fhir_base ? { fhir_base: org.fhir_base } : {}),
    patient_id: `pat-${hex(6)}`,
    last_pull: at(-90),
  };
}

const src = {
  robinChart: source(robin, 'mychart', 'example-health', orgs.health),
  robinPlan: source(robin, 'uhc', 'example-health-plan', orgs.plan, 'portal'),
  robinBlood: source(robin, 'oneblood', 'example-blood-center', orgs.blood, 'portal'),
  samChart: source(sam, 'mychart', 'example-health', orgs.health),
  samLab: source(sam, 'labcorp', 'example-lab', orgs.lab, 'portal'),
  samBilling: source(sam, 'peryourhealth', 'example-billing', orgs.billing, 'portal'),
  alexPeds: source(alex, 'athena', 'example-pediatrics', orgs.peds),
};
FIRST_IMPORT.set(src.robinChart.id, -60 * 24 * 8);
FIRST_IMPORT.set(src.robinPlan.id, -60 * 24 * 3);
FIRST_IMPORT.set(src.robinBlood.id, -60 * 24 * 12);
FIRST_IMPORT.set(src.samChart.id, -60 * 5);
FIRST_IMPORT.set(src.samLab.id, -60 * 24 * 9);
FIRST_IMPORT.set(src.alexPeds.id, -60 * 26);

write('household.json', {
  schema: 'medrec-household/v1',
  format: 1,
  folder_id: folderId,
  rev: 12,
  created_at: at(-60 * 24 * 40),
  people,
  organizations: Object.values(orgs).map((o) => ({ ...o, aliases: [] })),
  sources: Object.values(src),
});

// ---- Records ----

const LOINC = 'http://loinc.org';
const SNOMED = 'http://snomed.info/sct';
const ICD10 = 'http://hl7.org/fhir/sid/icd-10-cm';
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const CVX = 'http://hl7.org/fhir/sid/cvx';

function sourceDir(person, s) {
  return `${person.folder}/Records/${s.cli}-${s.organization}`;
}

function provenance(person, s, type, rid, filedAt, cliVersion = '0.7.1') {
  return {
    source: { kind: s.kind === 'fhir' ? 'fhir' : 'portal', cli: s.cli, cli_version: cliVersion, organization_id: s.organization, ...(s.fhir_base ? { fhir_base: s.fhir_base } : {}) },
    method: s.kind === 'fhir' ? 'fhir-api' : 'portal',
    source_resource: { type, id: rid, last_updated: `${filedAt.slice(0, 10)}T08:00:00Z` },
    fetched_at: filedAt,
    filed_at: filedAt,
    raw_path: `${sourceDir(person, s)}/${type}/${rid}.json`,
    filed_by: 'medrec 0.2.11',
  };
}

class PersonData {
  constructor(person) {
    this.person = person;
    this.records = [];
    this.documents = [];
    this.studies = [];
    this.imports = [];
    this.texts = {};
  }

  record(s, type, kind, { date, code, display, status, fields = {}, resource, filed = at((FIRST_IMPORT.get(s.id) ?? -60 * 24 * 30) - 1), extraVersions = 0 }) {
    const rid = `${type.toLowerCase()}-${hex(8)}`;
    const prov = provenance(this.person, s, type, rid, filed);
    const rec = {
      id: id('r'),
      kind,
      key: `${kind}|${code ? `${code.system}|${code.code}` : display.toLowerCase()}|${date ?? ''}`,
      ...(date ? { date } : {}),
      ...(code ? { code } : {}),
      display,
      ...(status ? { status } : {}),
      fields: { ...(date ? { when: date } : {}), ...fields },
      documents: [],
      provenance: [prov],
    };
    this.records.push(rec);
    write(prov.raw_path, { resourceType: type, id: rid, meta: { lastUpdated: prov.source_resource.last_updated }, ...resource });
    for (let i = 0; i < extraVersions; i++) {
      write(prov.raw_path.replace(/\.json$/, `~${hex(8)}.json`), { resourceType: type, id: rid, meta: { lastUpdated: `${date}T08:00:00Z` }, ...resource, status: 'preliminary' });
    }
    return rec;
  }

  document(s, { date, doc_type, title, organization, pages = 1, text, statement, filed = at((s && FIRST_IMPORT.get(s.id)) ?? -60 * 24 * 20) , original }) {
    const did = id('d');
    const year = (date ?? '2026').slice(0, 4);
    const name = `${date}_${doc_type}_${organization.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${original}`;
    const binId = `binary-${hex(8)}`;
    const doc = {
      id: did,
      path: `${this.person.folder}/${doc_type === 'bill' || doc_type === 'eob' ? 'Claims' : 'Documents'}/${year}/${name}`,
      sha256: hex(64),
      md5: hex(32),
      size: 40_000 + (rand() % 200_000),
      media_type: 'application/pdf',
      pages,
      original_name: original,
      title,
      doc_type,
      date,
      organization,
      filed_at: filed,
      origin: { kind: s ? 'fhir' : 'inbox', name: original, action: s ? 'copied' : 'moved' },
      text: { chars: text.length, engines: ['pdftotext 26.10.0'] },
      ...(statement ? { statement } : {}),
      provenance: s
        ? provenance(this.person, s, 'Binary', binId, filed)
        : { source: { kind: 'scan' }, method: 'scan', filed_at: filed, classified_by: 'medrec intake', filed_by: 'medrec 0.2.11' },
    };
    if (s) write(doc.provenance.raw_path, { resourceType: 'Binary', id: binId, contentType: 'application/pdf', data: '(the bytes of the filed PDF)' });
    this.documents.push(doc);
    this.texts[did] = text;
    return doc;
  }

  importRun(s, { importedAt, added, updated, unchanged, docs = 0, cliVersion = '0.7.1' }) {
    const run = {
      id: id('i'),
      source_dir: sourceDir(this.person, s),
      stream_sha256: hex(64),
      stream_bytes: 100_000 + (rand() % 900_000),
      cli: s.cli,
      cli_version: cliVersion,
      organization: s.organization,
      patient_id: s.patient_id,
      pulled_at: importedAt,
      imported_at: importedAt,
      counts: { Patient: 1, Observation: added + unchanged },
      records_added: added,
      records_updated: updated,
      records_unchanged: unchanged,
      records_older: 0,
      resources_written: added + updated,
      resources_unchanged: unchanged,
      documents_added: docs,
    };
    this.imports.push(run);
    return run;
  }

  write() {
    const f = this.person.folder;
    write(`${f}/index.json`, { schema: 'medrec-index/v1', person: this.person.id, rev: 9, documents: this.documents, records: this.records, studies: this.studies, imports: this.imports });
    write(`${f}/text.json`, { schema: 'medrec-text/v1', person: this.person.id, texts: this.texts });
    write(`${f}/notes.md`, `# Notes: ${this.person.name}\n\n## 2026-10-02 (${id('n')})\nTags: question\n\nAsk about the cholesterol recheck at the next visit.\n`);
  }
}

function obs(code, display, value, unit, ucum, range, interp) {
  return {
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
    code: { coding: [{ system: LOINC, code, display }], text: display },
    valueQuantity: { value, unit, system: 'http://unitsofmeasure.org', code: ucum },
    ...(range ? { referenceRange: [{ text: range }] } : {}),
    ...(interp ? { interpretation: [{ text: interp }] } : {}),
  };
}

// Robin: a primary-care system, an insurer, a blood donor centre.
const R = new PersonData(robin);
const ldl = [['2025-03-10', 162, 'High'], ['2025-09-15', 141, 'High'], ['2026-03-20', 118, 'Normal'], ['2026-10-01', 104, 'Normal']];
for (const [date, v, interp] of ldl) {
  R.record(src.robinChart, 'Observation', 'result', {
    date,
    code: { system: LOINC, code: '13457-7', display: 'Cholesterol in LDL, calculated' },
    display: 'LDL cholesterol',
    status: 'final',
    fields: { value: { value: v, unit: 'mg/dL', system: 'http://unitsofmeasure.org' }, reference_range: '<130 mg/dL', interpretation: interp, category: 'Laboratory', issued: `${date}T15:00:00Z` },
    resource: { ...obs('13457-7', 'Cholesterol in LDL, calculated', v, 'mg/dL', 'mg/dL', '<130 mg/dL', interp), effectiveDateTime: date },
    extraVersions: date === '2026-10-01' ? 1 : 0,
  });
}
for (const [date, v] of [['2025-03-10', 94], ['2025-09-15', 101], ['2026-10-01', 92]]) {
  R.record(src.robinChart, 'Observation', 'result', {
    date,
    code: { system: LOINC, code: '2345-7', display: 'Glucose [Mass/volume] in Serum or Plasma' },
    display: 'Glucose',
    status: 'final',
    fields: { value: { value: v, unit: 'mg/dL' }, reference_range: '70-99 mg/dL', interpretation: v > 99 ? 'High' : 'Normal', category: 'Laboratory' },
    resource: { ...obs('2345-7', 'Glucose', v, 'mg/dL', 'mg/dL', '70-99 mg/dL', v > 99 ? 'High' : 'Normal'), effectiveDateTime: date },
  });
}
R.record(src.robinChart, 'Observation', 'result', {
  date: '2026-10-01',
  code: { system: LOINC, code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood' },
  display: 'Hemoglobin A1c',
  status: 'final',
  fields: { value: { value: 5.4, unit: '%' }, reference_range: '4.0-5.6 %', interpretation: 'Normal', category: 'Laboratory' },
  resource: { ...obs('4548-4', 'Hemoglobin A1c', 5.4, '%', '%', '4.0-5.6 %', 'Normal'), effectiveDateTime: '2026-10-01' },
});
for (const [date, reason] of [['2025-03-10', 'Annual physical'], ['2025-09-15', 'Follow-up'], ['2026-10-01', 'Annual physical']]) {
  R.record(src.robinChart, 'Encounter', 'encounter', {
    date,
    code: { system: 'http://www.ama-assn.org/go/cpt', code: '99396', display: 'Office visit' },
    display: 'Office visit',
    status: 'finished',
    fields: { class: 'ambulatory', practitioner: 'Dr. Jordan Sample', location: 'Example Health Main Clinic', reason, period: { start: `${date}T14:00:00Z`, end: `${date}T14:40:00Z` } },
    resource: { status: 'finished', class: { code: 'AMB', display: 'ambulatory' }, type: [{ text: 'Office visit' }], period: { start: `${date}T14:00:00Z`, end: `${date}T14:40:00Z` }, reasonCode: [{ text: reason }] },
  });
}
R.record(src.robinChart, 'Condition', 'condition', {
  date: '2025-03-10',
  code: { system: ICD10, code: 'I10', display: 'Essential (primary) hypertension' },
  display: 'High blood pressure',
  status: 'active',
  fields: { verification_status: 'confirmed', category: 'Problem list item' },
  resource: { clinicalStatus: { coding: [{ code: 'active' }] }, code: { coding: [{ system: ICD10, code: 'I10', display: 'Essential (primary) hypertension' }] }, onsetDateTime: '2025-03-10' },
});
R.record(src.robinChart, 'Condition', 'condition', {
  date: '2019-05-01',
  code: { system: ICD10, code: 'J30.2', display: 'Other seasonal allergic rhinitis' },
  display: 'Seasonal allergies',
  status: 'resolved',
  fields: { verification_status: 'confirmed', abatement: '2024-06-01' },
  resource: { clinicalStatus: { coding: [{ code: 'resolved' }] }, code: { coding: [{ system: ICD10, code: 'J30.2' }] }, onsetDateTime: '2019-05-01', abatementDateTime: '2024-06-01' },
});
R.record(src.robinChart, 'MedicationRequest', 'medication', {
  date: '2025-03-12',
  code: { system: RXNORM, code: '314076', display: 'lisinopril 10 MG Oral Tablet' },
  display: 'Lisinopril 10 mg tablet',
  status: 'active',
  fields: { dosage: 'Take 1 tablet by mouth once a day', prescriber: 'Dr. Jordan Sample', intent: 'order', source: 'request' },
  resource: { status: 'active', intent: 'order', medicationCodeableConcept: { coding: [{ system: RXNORM, code: '314076' }], text: 'Lisinopril 10 mg tablet' }, authoredOn: '2025-03-12', dosageInstruction: [{ text: 'Take 1 tablet by mouth once a day' }] },
});
R.record(src.robinChart, 'MedicationRequest', 'medication', {
  date: '2023-04-02',
  code: { system: RXNORM, code: '1014678', display: 'cetirizine hydrochloride 10 MG Oral Tablet' },
  display: 'Cetirizine 10 mg tablet',
  status: 'stopped',
  fields: { dosage: 'Take 1 tablet daily as needed', source: 'request' },
  resource: { status: 'stopped', intent: 'order', medicationCodeableConcept: { text: 'Cetirizine 10 mg tablet' }, authoredOn: '2023-04-02' },
});
R.record(src.robinChart, 'AllergyIntolerance', 'allergy', {
  date: '2012-01-01',
  code: { system: SNOMED, code: '91939003', display: 'Allergy to sulfonamide' },
  display: 'Sulfa drugs',
  status: 'active',
  fields: { criticality: 'low', reaction: ['Rash'] },
  resource: { clinicalStatus: { coding: [{ code: 'active' }] }, code: { text: 'Sulfa drugs' }, criticality: 'low', reaction: [{ manifestation: [{ text: 'Rash' }] }] },
});
for (const [date, code, name] of [['2025-10-04', '141', 'Influenza, seasonal, injectable'], ['2026-10-01', '141', 'Influenza, seasonal, injectable'], ['2024-02-11', '115', 'Tdap']]) {
  R.record(src.robinChart, 'Immunization', 'immunization', {
    date,
    code: { system: CVX, code, display: name },
    display: name,
    status: 'completed',
    fields: { performer: 'Example Health Main Clinic', lot_number: `LOT${hex(4).toUpperCase()}`, site: 'Left arm' },
    resource: { status: 'completed', vaccineCode: { coding: [{ system: CVX, code }], text: name }, occurrenceDateTime: date },
  });
}
for (const [date, provider, billed, allowed, paid, share] of [
  ['2026-10-01', 'Example Health', '412.00', '268.40', '214.72', '53.68'],
  ['2025-09-15', 'Example Health', '189.00', '121.10', '121.10', '0.00'],
  ['2025-03-10', 'Example Health', '398.00', '255.90', '204.72', '51.18'],
]) {
  R.record(src.robinPlan, 'ExplanationOfBenefit', 'claim', {
    date,
    code: { system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional', display: 'Professional' },
    display: 'Office visit claim',
    status: 'active',
    fields: {
      provider,
      insurer: 'Example Health Plan',
      outcome: 'complete',
      billable_period: { start: date, end: date },
      total: [
        { category: 'Submitted Amount', amount: { amount: billed, currency: 'USD' } },
        { category: 'Eligible Amount', amount: { amount: allowed, currency: 'USD' } },
        { category: 'Benefit Amount', amount: { amount: paid, currency: 'USD' } },
        { category: 'Member liability', amount: { amount: share, currency: 'USD' } },
      ],
      payment: { amount: paid, currency: 'USD' },
      type: 'Professional',
      use: 'claim',
    },
    resource: { status: 'active', type: { coding: [{ code: 'professional' }] }, use: 'claim', billablePeriod: { start: date, end: date }, outcome: 'complete' },
  });
}
R.record(src.robinPlan, 'Coverage', 'coverage', {
  date: '2026-01-01',
  code: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HIP', display: 'health insurance plan policy' },
  display: 'Example Health Plan PPO',
  status: 'active',
  fields: { payer: 'Example Health Plan', period: { start: '2026-01-01' }, relationship: 'self', plan: 'PPO Choice', group: 'GRP-000000' },
  resource: { status: 'active', period: { start: '2026-01-01' } },
});
const visitText = 'Visit summary. Annual physical with Dr. Jordan Sample. Discussed home blood pressure readings and continuing lisinopril. LDL cholesterol is lower than last year. Influenza vaccine given today. Return in twelve months.';
const visit = R.document(src.robinChart, { date: '2026-10-01', doc_type: 'visit_summary', title: 'After visit summary', organization: 'Example Health', pages: 3, text: visitText, original: 'after_visit_summary.pdf' });
R.records.find((r) => r.kind === 'encounter' && r.date === '2026-10-01').documents.push(visit.id);
R.document(src.robinChart, { date: '2026-10-01', doc_type: 'lab_report', title: 'Lipid panel', organization: 'Example Health', pages: 2, text: 'Lipid panel. LDL cholesterol 104 mg/dL. Total cholesterol 182 mg/dL. HDL 58 mg/dL. Triglycerides 99 mg/dL.', original: 'lipid_panel.pdf' });
R.document(null, {
  date: '2026-10-01',
  doc_type: 'bill',
  title: 'Statement from Example Health',
  organization: 'Example Health',
  text: 'Statement date 10/20/2026. Account number ****0000. Amount due $53.68. Please pay by 11/19/2026.',
  statement: { statement_date: '2026-10-20', amount_due: { amount: '53.68', currency: 'USD' }, due_date: '2026-11-19', account: '****0000' },
  original: 'statement_oct.pdf',
});
R.document(null, { date: '2024-02-11', doc_type: 'immunization_record', title: 'Vaccination card', organization: 'Example Health', text: 'Vaccination record. Tdap 02/11/2024.', original: 'scan_0007.pdf' });
for (const [date, v] of [['2025-06-01', 13.9], ['2025-12-02', 14.2], ['2026-06-05', 14.0]]) {
  R.record(src.robinBlood, 'Observation', 'result', {
    date,
    code: { system: LOINC, code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood' },
    display: 'Hemoglobin',
    status: 'final',
    fields: { value: { value: v, unit: 'g/dL' }, category: 'Donation screening' },
    resource: { ...obs('718-7', 'Hemoglobin', v, 'g/dL', 'g/dL'), effectiveDateTime: date },
  });
}
for (const [code, name, display, v, unit, range, interp] of [
  ['2823-3', 'Potassium [Moles/volume] in Serum or Plasma', 'Potassium', 5.4, 'mmol/L', '3.5-5.1 mmol/L', 'High'],
  ['2160-0', 'Creatinine [Mass/volume] in Serum or Plasma', 'Creatinine', 0.9, 'mg/dL', '0.6-1.2 mg/dL', 'Normal'],
]) {
  R.record(src.robinChart, 'Observation', 'result', {
    date: '2026-11-18',
    code: { system: LOINC, code, display: name },
    display,
    status: 'final',
    fields: { value: { value: v, unit }, reference_range: range, interpretation: interp, category: 'Laboratory', issued: '2026-11-19T16:00:00Z' },
    resource: { ...obs(code, display, v, unit, unit, range, interp), effectiveDateTime: '2026-11-18' },
    filed: ROBIN_CHART_LOAD,
  });
}
R.document(src.robinChart, { date: '2026-11-18', doc_type: 'lab_report', title: 'Basic metabolic panel', organization: 'Example Health', text: 'Basic metabolic panel. Potassium 5.4 mmol/L (high). Creatinine 0.9 mg/dL.', original: 'basic_metabolic_panel.pdf', filed: ROBIN_CHART_LOAD });
const rChart = R.importRun(src.robinChart, { importedAt: ROBIN_CHART_LOAD, added: 2, updated: 0, unchanged: 41, docs: 1 });
R.importRun(src.robinChart, { importedAt: at(-60 * 24 * 8), added: 5, updated: 1, unchanged: 36 });
R.importRun(src.robinPlan, { importedAt: at(-60 * 24 * 3), added: 1, updated: 0, unchanged: 3, cliVersion: '0.3.2' });
R.importRun(src.robinBlood, { importedAt: at(-60 * 24 * 12), added: 0, updated: 0, unchanged: 3, cliVersion: '0.1.1' });
R.write();

// Sam: the same primary-care system, a lab, a billing site, an X-ray.
const S = new PersonData(sam);
for (const [date, v] of [['2026-04-02', 18], ['2026-07-09', 24], ['2026-10-12', 33]]) {
  const flag = v < 30 ? 'Low' : 'Normal';
  S.record(src.samChart, 'Observation', 'result', {
    date,
    code: { system: LOINC, code: '62292-8', display: '25-Hydroxyvitamin D2+D3 [Mass/volume] in Serum or Plasma' },
    display: 'Vitamin D, 25-hydroxy',
    status: 'final',
    fields: { value: { value: v, unit: 'ng/mL' }, reference_range: '30-100 ng/mL', interpretation: flag, category: 'Laboratory' },
    resource: { ...obs('62292-8', 'Vitamin D, 25-hydroxy', v, 'ng/mL', 'ng/mL', '30-100 ng/mL', flag), effectiveDateTime: date },
  });
}
S.record(src.samLab, 'Observation', 'result', {
  date: '2026-07-09',
  code: { system: LOINC, code: '3016-3', display: 'Thyrotropin [Units/volume] in Serum or Plasma' },
  display: 'TSH',
  status: 'final',
  fields: { value: { value: 2.1, unit: 'mIU/L' }, reference_range: '0.4-4.0 mIU/L', interpretation: 'Normal', category: 'Laboratory' },
  resource: { ...obs('3016-3', 'TSH', 2.1, 'mIU/L', 'mIU/L', '0.4-4.0 mIU/L', 'Normal'), effectiveDateTime: '2026-07-09' },
});
S.record(src.samChart, 'MedicationRequest', 'medication', {
  date: '2026-04-03',
  display: 'Vitamin D3 2,000 unit capsule',
  status: 'active',
  fields: { dosage: 'Take 1 capsule by mouth once a day', prescriber: 'Dr. Casey Placeholder', source: 'request' },
  resource: { status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Vitamin D3 2,000 unit capsule' }, authoredOn: '2026-04-03' },
});
S.record(src.samChart, 'Encounter', 'encounter', {
  date: '2026-05-20',
  display: 'Sports medicine visit',
  status: 'finished',
  fields: { class: 'ambulatory', practitioner: 'Dr. Casey Placeholder', location: 'Example Health Orthopedics', reason: 'Ankle sprain' },
  resource: { status: 'finished', class: { code: 'AMB' }, type: [{ text: 'Sports medicine visit' }], period: { start: '2026-05-20T15:00:00Z' }, reasonCode: [{ text: 'Ankle sprain' }] },
});
S.studies.push({
  id: id('m'),
  study_uid: `2.25.${String(rand())}${String(rand())}`,
  path: 'Sam Example/Imaging/2026-05-20_xr_ankle_example_imaging/',
  date: '2026-05-20',
  modalities: ['DX'],
  body_part: 'ANKLE',
  description: 'XR ankle, 3 views',
  facility: 'Example Imaging',
  accession: `ACC${hex(6).toUpperCase()}`,
  series: [
    { uid: `2.25.${String(rand())}`, number: 1, modality: 'DX', description: 'AP', instances: { [`2.25.${String(rand())}`]: 'S001/00001.dcm' } },
    { uid: `2.25.${String(rand())}`, number: 2, modality: 'DX', description: 'Lateral', instances: { [`2.25.${String(rand())}`]: 'S002/00001.dcm' } },
    { uid: `2.25.${String(rand())}`, number: 3, modality: 'DX', description: 'Oblique', instances: { [`2.25.${String(rand())}`]: 'S003/00001.dcm' } },
  ],
  instances: 3,
  size: 21_402_118,
  filed_at: at(-60 * 24 * 60),
  provenance: [{ source: { kind: 'media' }, method: 'media', filed_at: at(-60 * 24 * 60), filed_by: 'medrec 0.2.11' }],
});
S.document(null, {
  date: '2026-07-09',
  doc_type: 'bill',
  title: 'Statement from Example Billing',
  organization: 'Example Billing',
  text: 'Statement date 08/01/2026. Guarantor account # EX-000000. Balance due $120.00. Due date 08/31/2026.',
  statement: { statement_date: '2026-08-01', amount_due: { amount: '120.00', currency: 'USD' }, due_date: '2026-08-31', account: 'EX-000000' },
  original: 'statement.pdf',
});
S.importRun(src.samChart, { importedAt: at(-60 * 5), added: 0, updated: 1, unchanged: 5 });
S.importRun(src.samLab, { importedAt: at(-60 * 24 * 9), added: 1, updated: 0, unchanged: 0, cliVersion: '0.2.1' });
S.write();

// Alex: a child at a pediatric practice.
const A = new PersonData(alex);
for (const [date, kg] of [['2024-01-08', 20.4], ['2025-01-13', 22.6], ['2026-01-12', 25.1]]) {
  A.record(src.alexPeds, 'Observation', 'result', {
    date,
    code: { system: LOINC, code: '29463-7', display: 'Body weight' },
    display: 'Weight',
    status: 'final',
    fields: { value: { value: kg, unit: 'kg' }, category: 'Vital signs' },
    resource: { status: 'final', code: { coding: [{ system: LOINC, code: '29463-7', display: 'Body weight' }] }, valueQuantity: { value: kg, unit: 'kg' }, effectiveDateTime: date },
  });
}
for (const [date, code, name] of [['2022-01-10', '20', 'DTaP'], ['2022-01-10', '10', 'IPV'], ['2022-01-10', '03', 'MMR'], ['2025-10-20', '141', 'Influenza, seasonal, injectable']]) {
  A.record(src.alexPeds, 'Immunization', 'immunization', {
    date,
    code: { system: CVX, code, display: name },
    display: name,
    status: 'completed',
    fields: { performer: 'Example Pediatrics', route: 'Intramuscular' },
    resource: { status: 'completed', vaccineCode: { coding: [{ system: CVX, code }], text: name }, occurrenceDateTime: date },
  });
}
for (const [date, what] of [['2024-01-08', 'Well child visit, 6 years'], ['2025-01-13', 'Well child visit, 7 years'], ['2026-01-12', 'Well child visit, 8 years']]) {
  A.record(src.alexPeds, 'Encounter', 'encounter', {
    date,
    display: what,
    status: 'finished',
    fields: { class: 'ambulatory', practitioner: 'Dr. Morgan Placeholder', location: 'Example Pediatrics' },
    resource: { status: 'finished', type: [{ text: what }], period: { start: `${date}T13:00:00Z` } },
  });
}
A.record(src.alexPeds, 'Encounter', 'encounter', {
  date: '2026-11-20',
  display: 'Sick visit',
  status: 'finished',
  fields: { class: 'ambulatory', practitioner: 'Dr. Morgan Placeholder', location: 'Example Pediatrics', reason: 'Ear pain' },
  resource: { status: 'finished', type: [{ text: 'Sick visit' }], period: { start: '2026-11-20T16:00:00Z' }, reasonCode: [{ text: 'Ear pain' }] },
  filed: ALEX_PEDS_LOAD,
});
A.record(src.alexPeds, 'Condition', 'condition', {
  date: '2026-11-20',
  code: { system: ICD10, code: 'H66.90', display: 'Otitis media, unspecified, unspecified ear' },
  display: 'Ear infection',
  status: 'active',
  fields: { verification_status: 'confirmed', category: 'Encounter diagnosis' },
  resource: { clinicalStatus: { coding: [{ code: 'active' }] }, code: { coding: [{ system: ICD10, code: 'H66.90' }], text: 'Ear infection' }, onsetDateTime: '2026-11-20' },
  filed: ALEX_PEDS_LOAD,
});
A.record(src.alexPeds, 'MedicationRequest', 'medication', {
  date: '2026-11-20',
  code: { system: RXNORM, code: '308189', display: 'amoxicillin 400 MG in 5 mL Oral Suspension' },
  display: 'Amoxicillin 400 mg/5 mL suspension',
  status: 'active',
  fields: { dosage: 'Take 7 mL by mouth twice a day for 10 days', prescriber: 'Dr. Morgan Placeholder', intent: 'order', source: 'request' },
  resource: { status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Amoxicillin 400 mg/5 mL suspension' }, authoredOn: '2026-11-20', dosageInstruction: [{ text: 'Take 7 mL by mouth twice a day for 10 days' }] },
  filed: ALEX_PEDS_LOAD,
});
A.document(src.alexPeds, { date: '2025-10-20', doc_type: 'immunization_record', title: 'Immunization history', organization: 'Example Pediatrics', text: 'Immunization history. DTaP, IPV, MMR 01/10/2022. Influenza 10/20/2025.', original: 'immunizations.pdf' });
const aPeds = A.importRun(src.alexPeds, { importedAt: ALEX_PEDS_LOAD, added: 3, updated: 0, unchanged: 11, docs: 1, cliVersion: '0.6.1' });
A.write();

// ---- What the Mac's `medrec refresh` wrote ----

// An attempt's counts are its import's, so the status, the attempts log and
// the index always agree.
function counts(run) {
  return {
    records_added: run.records_added,
    records_updated: run.records_updated,
    records_unchanged: run.records_unchanged,
    records_older: run.records_older,
    resources_written: run.resources_written,
    resources_unchanged: run.resources_unchanged,
    documents_added: run.documents_added,
    documents_duplicate: 0,
    documents_unchanged: 0,
    documents_same_statement: 0,
  };
}
const machine = id('h');
const attempts = [];
function attempt(s, person, { started, minutes = 1, trigger = 'schedule', requests = [], outcome = 'ok', exit = 0, error = null, importId = null, c }) {
  const a = { attempt: id('t'), started_at: started, finished_at: at(Date.parse(started) / 60_000 - Date.parse(ANCHOR) / 60_000 + minutes), trigger, requests, outcome, exit_code: exit, error, import: importId };
  attempts.push({ schema: 'medrec-attempt/v1', attempt: a.attempt, source: s.id, person: person.id, cli: s.cli, organization: s.organization, started_at: a.started_at, finished_at: a.finished_at, trigger, requests, outcome, exit_code: exit, error, import: importId, ...(c ? { counts: c } : {}) });
  return a;
}

const doneReq = { schema: 'medrec-request/v1', id: id('x'), requested_at: at(-60 * 3 - 4), requested_by: { email: 'robin@example.com', name: 'Robin Example' }, scope: { source: src.robinChart.id }, app: { name: 'own-your-health-app', version: '0.1.0' } };
const robinChartOk = attempt(src.robinChart, robin, { started: at(-60 * 3 - 1), trigger: 'request', requests: [doneReq.id], importId: rChart.id, c: counts(rChart) });
const alexOk = attempt(src.alexPeds, alex, { started: at(-60 * 26 - 1), importId: aPeds.id, c: counts(aPeds) });
const samChartOk = attempt(src.samChart, sam, { started: at(-60 * 5 - 1), importId: S.imports[0].id, c: counts(S.imports[0]) });
attempt(src.samLab, sam, { started: at(-60 * 24 * 9 - 1), importId: S.imports[1].id, c: counts(S.imports[1]) });
const samLabFail = attempt(src.samLab, sam, {
  started: at(-60 * 2),
  outcome: 'failed',
  exit: 5,
  error: { code: 'upstream', message: 'The lab site answered 503 three times.', remedy: 'Nothing to do; the Mac tries again later.' },
});
const robinPlanNeeds = attempt(src.robinPlan, robin, { started: at(-60 * 8), outcome: 'needs_person', exit: 3, error: { code: 'needs_person', message: 'The member site session ended.', remedy: 'Sign in again on the Mac.' } });

write('_status/status.json', {
  schema: 'medrec-status/v1',
  format: 1,
  updated_at: at(-2),
  refresher: { medrec_version: '0.3.0', machine, last_pass_at: at(-2), next_pass_at: at(3), pass_every_secs: 300, heartbeat_every_secs: 3600 },
  sources: [
    {
      source: src.robinChart.id, person: robin.id, cli: 'mychart', organization: 'example-health', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: at(60 * 21),
      sign_in: { state: 'ok', expires_at: at(60 * 24 * 200), checked_at: at(-60 * 3 - 1), needs_person: null },
      last_attempt: robinChartOk,
      last_success: { attempt: robinChartOk.attempt, finished_at: robinChartOk.finished_at, import: rChart.id, counts: counts(rChart), withheld_types: ['ExplanationOfBenefit'] },
    },
    {
      source: src.robinPlan.id, person: robin.id, cli: 'uhc', organization: 'example-health-plan', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: null,
      sign_in: { state: 'signed_out', expires_at: null, checked_at: at(-60 * 8), needs_person: { reason: 'sign_in', since: at(-60 * 8), command: `medrec refresh sign-in ${src.robinPlan.id}` } },
      last_attempt: robinPlanNeeds,
      last_success: null,
    },
    {
      source: src.samChart.id, person: sam.id, cli: 'mychart', organization: 'example-health', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: at(60 * 19),
      sign_in: { state: 'expiring', expires_at: at(60 * 40), checked_at: at(-60 * 5 - 1), needs_person: null },
      last_attempt: samChartOk,
      last_success: { attempt: samChartOk.attempt, finished_at: samChartOk.finished_at, import: S.imports[0].id, counts: counts(S.imports[0]), withheld_types: [] },
    },
    {
      source: src.samLab.id, person: sam.id, cli: 'labcorp', organization: 'example-lab', auto: true, paused: null, failures: 2, min_interval_secs: 86400, next_run_at: at(60),
      sign_in: { state: 'ok', expires_at: null, checked_at: at(-60 * 2), needs_person: null },
      last_attempt: samLabFail,
      last_success: null,
    },
    {
      source: src.samBilling.id, person: sam.id, cli: 'peryourhealth', organization: 'example-billing', auto: false, paused: { reason: 'user', note: 'Paused by hand on the Mac.', since: at(-60 * 24 * 2) }, failures: 0, min_interval_secs: 86400, next_run_at: null,
      sign_in: { state: 'unknown', expires_at: null, checked_at: at(-60 * 24 * 2), needs_person: null },
      last_attempt: null,
      last_success: null,
    },
    {
      source: src.alexPeds.id, person: alex.id, cli: 'athena', organization: 'example-pediatrics', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: at(60 * 22 - 26),
      sign_in: { state: 'ok', expires_at: at(60 * 24 * 87), checked_at: at(-60 * 26 - 1), needs_person: null },
      last_attempt: alexOk,
      last_success: { attempt: alexOk.attempt, finished_at: alexOk.finished_at, import: aPeds.id, counts: counts(aPeds), withheld_types: [] },
    },
  ],
});
attempts.sort((a, b) => a.started_at.localeCompare(b.started_at));
const byMonth = new Map();
for (const a of attempts) {
  const m = a.started_at.slice(0, 7);
  byMonth.set(m, [...(byMonth.get(m) ?? []), a]);
}
for (const [m, lines] of byMonth) write(`_status/attempts/${m}.ndjson`, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

write('_requests/.keep', '');
const compact = (iso) => iso.replace(/[-:]/g, '');
write(`_requests/done/${compact(doneReq.requested_at)}_${doneReq.id}.json`, {
  ...doneReq,
  handled: {
    picked_up_at: at(-60 * 3 - 1),
    finished_at: robinChartOk.finished_at,
    outcome: 'ok',
    sources: [{ source: src.robinChart.id, outcome: 'ok', attempt: robinChartOk.attempt, next_allowed_at: at(60 * 21) }],
    message: '1 source imported',
    by: 'medrec 0.3.0',
  },
});

write('README.md', '# Sample records\n\nA synthetic medrec records folder for the app’s demo mode and tests. Every person, organization and value in it is invented.\n');

// ---- Write ----

rmSync(ROOT, { recursive: true, force: true });
const list = [...files.keys()].sort();
for (const path of list) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, files.get(path));
}
writeFileSync(join(ROOT, 'manifest.json'), `${JSON.stringify({ anchor: ANCHOR, files: list }, null, 2)}\n`);
console.log(`wrote ${list.length} files under public/demo/`);
