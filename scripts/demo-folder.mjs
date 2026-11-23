// Writes public/demo/: a synthetic records folder in medrec's layout, for
// the demo mode and the tests. Every person, organization, id and value is
// invented. Run `node scripts/demo-folder.mjs` after changing it, and commit
// the result; the tests check the manifest against the files.
//
// The folder's times are anchored at ANCHOR. The demo moves the times of
// loads, filings, requests and checks forward by (now - ANCHOR) when it reads
// them (LOAD_TIMES in src/folder.ts), so the sample's loads always look
// recent; times of care stay as written.

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
// A newborn. Its id is drawn after the other sources', so theirs stay put.
const jamie = { id: null, name: 'Jamie Example', folder: 'Jamie Example', birth_date: '2026-11-08', guardians: [robin.id, sam.id], links: { huishouden_health_person: 'hh-demo-jamie' }, created_at: at(-60 * 24 * 12) };
const people = [robin, sam, alex, jamie];

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
jamie.id = id('p');
src.jamiePeds = source(jamie, 'athena', 'example-pediatrics', orgs.peds);
const JAMIE_PEDS_LOAD = at(-60 * 20);
FIRST_IMPORT.set(src.jamiePeds.id, -60 * 20);

const writeHousehold = () => write('household.json', {
  schema: 'medrec-household/v1',
  format: 1,
  folder_id: folderId,
  rev: 12,
  created_at: at(-60 * 24 * 40),
  people,
  organizations: Object.values(orgs).map((o) => ({ ...o, aliases: [] })),
  sources: Object.values(src),
});
writeHousehold();

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
    this.noteId ??= id('n');
    write(`${f}/notes.md`, `# Notes: ${this.person.name}\n\n## 2026-10-02 (${this.noteId})\nTags: question\n\nAsk about the cholesterol recheck at the next visit.\n`);
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
  // The first came the way some labs send a number: as text (a FHIR
  // valueString), with a structured range and no flag.
  const asText = date === '2025-03-10';
  const quantity = obs('2345-7', 'Glucose', v, 'mg/dL', 'mg/dL', '70-99 mg/dL', v > 99 ? 'High' : 'Normal');
  const plain = { ...quantity };
  delete plain.valueQuantity;
  delete plain.interpretation;
  const mgdl = (n) => ({ value: n, unit: 'mg/dL', system: 'http://unitsofmeasure.org', code: 'mg/dL' });
  R.record(src.robinChart, 'Observation', 'result', {
    date,
    code: { system: LOINC, code: '2345-7', display: 'Glucose [Mass/volume] in Serum or Plasma' },
    display: 'Glucose',
    status: 'final',
    fields: asText
      ? { value: String(v), reference_range: '70 mg/dL – 99 mg/dL', category: 'Laboratory' }
      : { value: { value: v, unit: 'mg/dL' }, reference_range: '70-99 mg/dL', interpretation: v > 99 ? 'High' : 'Normal', category: 'Laboratory' },
    resource: asText
      ? { ...plain, valueString: String(v), referenceRange: [{ low: mgdl(70), high: mgdl(99), text: '70 - 99 mg/dL' }], effectiveDateTime: date }
      : { ...quantity, effectiveDateTime: date },
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
// The rest of each lipid panel and metabolic panel those visits drew.
function lab(P, source, date, [code, name, display, v, unit, range, interp]) {
  P.record(source, 'Observation', 'result', {
    date,
    code: { system: LOINC, code, display: name },
    display,
    status: 'final',
    fields: { value: { value: v, unit }, reference_range: range, interpretation: interp, category: 'Laboratory' },
    resource: { ...obs(code, display, v, unit, unit, range, interp), effectiveDateTime: date },
  });
}
for (const [date, total, trig, hdl] of [['2025-03-10', 238, 168, 44], ['2025-09-15', 214, 152, 46], ['2026-03-20', 189, 128, 48], ['2026-10-01', 176, 117, 51]]) {
  lab(R, src.robinChart, date, ['2093-3', 'Cholesterol [Mass/volume] in Serum or Plasma', 'Cholesterol, total', total, 'mg/dL', '<200 mg/dL', total >= 200 ? 'High' : 'Normal']);
  lab(R, src.robinChart, date, ['2571-8', 'Triglyceride [Mass/volume] in Serum or Plasma', 'Triglycerides', trig, 'mg/dL', '<150 mg/dL', trig >= 150 ? 'High' : 'Normal']);
  lab(R, src.robinChart, date, ['2085-9', 'Cholesterol in HDL [Mass/volume] in Serum or Plasma', 'HDL cholesterol', hdl, 'mg/dL', '>39 mg/dL', 'Normal']);
}
for (const [date, k, cr, na] of [['2025-03-10', 4.4, 0.8, 140], ['2025-09-15', 4.6, 0.9, 139], ['2026-10-01', 4.9, 0.9, 141]]) {
  lab(R, src.robinChart, date, ['2823-3', 'Potassium [Moles/volume] in Serum or Plasma', 'Potassium', k, 'mmol/L', '3.5-5.1 mmol/L', 'Normal']);
  lab(R, src.robinChart, date, ['2160-0', 'Creatinine [Mass/volume] in Serum or Plasma', 'Creatinine', cr, 'mg/dL', '0.6-1.2 mg/dL', 'Normal']);
  lab(R, src.robinChart, date, ['2951-2', 'Sodium [Moles/volume] in Serum or Plasma', 'Sodium', na, 'mmol/L', '136-145 mmol/L', 'Normal']);
}
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
// The pharmacy's fills of the lisinopril prescription.
for (const date of ['2026-08-14', '2026-11-12']) {
  R.record(src.robinChart, 'MedicationDispense', 'medication', {
    date,
    code: { system: RXNORM, code: '314076', display: 'lisinopril 10 MG Oral Tablet' },
    display: 'Lisinopril 10 mg tablet',
    status: 'completed',
    fields: { dosage: 'Take 1 tablet by mouth once a day', quantity: '90 tablet', days_supply: 90, pharmacy: 'Example Pharmacy', prescriber: 'Dr. Jordan Sample', source: 'dispense' },
    resource: { status: 'completed', medicationCodeableConcept: { coding: [{ system: RXNORM, code: '314076' }], text: 'Lisinopril 10 mg tablet' }, whenHandedOver: date, quantity: { value: 90, unit: 'tablet' }, daysSupply: { value: 90, unit: 'days' } },
  });
}
R.record(src.robinChart, 'AllergyIntolerance', 'allergy', {
  date: '2016-08-01',
  code: { system: SNOMED, code: '300916003', display: 'Latex allergy' },
  display: 'Latex',
  status: 'inactive',
  fields: { criticality: 'low', reaction: ['Itching'] },
  resource: { clinicalStatus: { coding: [{ code: 'inactive' }] }, code: { text: 'Latex' }, criticality: 'low', reaction: [{ manifestation: [{ text: 'Itching' }] }] },
});
R.record(src.robinChart, 'Immunization', 'immunization', {
  date: '2025-10-04',
  code: { system: CVX, code: '309', display: 'COVID-19, mRNA, 2024-2025 formula' },
  display: 'COVID-19 vaccine',
  status: 'not-done',
  fields: {},
  resource: { status: 'not-done', statusReason: { text: 'Patient declined' }, vaccineCode: { coding: [{ system: CVX, code: '309' }], text: 'COVID-19 vaccine' }, occurrenceDateTime: '2025-10-04' },
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
const usd = (amount) => ({ amount, currency: 'USD' });
// The plan balances the newest statement printed: the year's deductible and out-of-pocket limit.
const planBalance = [
  {
    category: '1',
    network: 'in',
    unit: 'individual',
    term: 'annual',
    financial: [
      { type: 'Deductible', allowed: usd('1500.00'), used: usd('1120.40') },
      { type: 'Out-of-pocket limit', allowed: usd('4000.00'), used: usd('1356.10') },
    ],
  },
];
// A claim's lines: [code, what was done, billed, allowed, plan paid, coinsurance].
// Each claim's totals are its lines' sums. medrec names a claim for its type
// today ("Professional"); the app names it for its lines.
const CPT = 'http://www.ama-assn.org/go/cpt';
const claims = [
  ['2026-11-18', 'Example Health', [['99213', 'Office visit', '180.00', '112.50', '87.50', '25.00']]],
  ['2026-10-03', 'Example Lab', [['80061', 'Lipid panel', '180.00', '78.40', '62.72', '15.68'], ['36415', 'Blood draw', '40.00', '18.00', '14.40', '3.60']]],
  ['2026-10-01', 'Example Health', [['99396', 'Preventive visit', '320.00', '210.00', '168.00', '42.00'], ['90686', 'Flu vaccine', '62.00', '38.40', '30.72', '7.68'], ['90471', 'Vaccine given', '30.00', '20.00', '16.00', '4.00']], planBalance],
  ['2025-09-15', 'Example Health', [['99213', 'Office visit', '189.00', '121.10', '121.10', '0.00']]],
  ['2025-03-10', 'Example Health', [['99214', 'Office visit', '290.00', '190.00', '152.00', '38.00'], ['85025', 'Blood count', '108.00', '65.90', '52.72', '13.18']]],
];
const sum = (xs) => (xs.reduce((a, x) => a + Math.round(Number(x) * 100), 0) / 100).toFixed(2);
const adjudication = (billed, allowed, paid, coinsurance) => [
  { category: 'Submitted Amount', amount: usd(billed), reason: null },
  { category: 'Eligible Amount', amount: usd(allowed), reason: null },
  { category: 'Benefit Amount', amount: usd(paid), reason: null },
  { category: 'Deductible', amount: usd('0.00'), reason: null },
  { category: 'Coinsurance', amount: usd(coinsurance), reason: null },
  { category: 'Member liability', amount: usd(coinsurance), reason: null },
];
for (const [date, provider, lines, balances] of claims) {
  const [billed, allowed, paid, share] = [2, 3, 4, 5].map((i) => sum(lines.map((l) => l[i])));
  const items = lines.map(([code, display, b, a, p, c], i) => ({
    sequence: i + 1,
    service: { system: CPT, code, display },
    serviced: date,
    quantity: { value: 1, unit: null },
    net: usd(b),
    adjudication: adjudication(b, a, p, c),
  }));
  R.record(src.robinPlan, 'ExplanationOfBenefit', 'claim', {
    date,
    code: { system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional', display: 'Professional' },
    display: 'Professional',
    status: 'active',
    fields: {
      provider,
      insurer: 'Example Health Plan',
      outcome: 'complete',
      billable_period: { start: date, end: date },
      total: adjudication(billed, allowed, paid, share).map(({ category, amount }) => ({ category, amount })),
      payment: usd(paid),
      type: 'Professional',
      use: 'claim',
      items,
      ...(balances ? { benefit_balance: balances } : {}),
    },
    resource: {
      status: 'active',
      type: { coding: [{ code: 'professional' }] },
      use: 'claim',
      billablePeriod: { start: date, end: date },
      outcome: 'complete',
      item: lines.map(([code, display, b], i) => ({ sequence: i + 1, productOrService: { coding: [{ system: CPT, code, display }] }, servicedDate: date, net: { value: Number(b), currency: 'USD' } })),
    },
  });
}
// The insurer's statement for the October visit, linked to its claim.
const eob = R.document(src.robinPlan, { date: '2026-10-20', doc_type: 'eob', title: 'Explanation of Benefits', organization: 'Example Health Plan', pages: 2, text: 'Explanation of Benefits. Example Health, office visit 10/01/2026. Amount billed $412.00. Plan paid $214.72. You may owe the provider $53.68.', original: 'eob_2026-10.pdf', filed: at(-60 * 24 * 20) });
R.records.find((r) => r.kind === 'claim' && r.date === '2026-10-01').documents.push(eob.id);
// Robin's coverage as the insurer gives it: the family coverage that took
// effect the day Jamie was born, open-ended. The portal keeps the one before.
const HIP = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HIP', display: 'health insurance plan policy' };
R.record(src.robinPlan, 'Coverage', 'coverage', {
  date: '2026-11-08',
  code: HIP,
  display: 'Example Health Plan PPO',
  status: 'active',
  fields: { payer: 'Example Health Plan', period: { start: '2026-11-08', end: '9999-12-31' }, relationship: 'self', plan: 'PPO Choice', group: 'GRP-000000' },
  resource: { status: 'active', period: { start: '2026-11-08', end: '9999-12-31' } },
});
const visitText = 'Visit summary. Annual physical with Dr. Jordan Sample. Discussed home blood pressure readings and continuing lisinopril. LDL cholesterol is lower than last year. Influenza vaccine given today. Return in twelve months.';
const visit = R.document(src.robinChart, { date: '2026-10-01', doc_type: 'visit_summary', title: 'After visit summary', organization: 'Example Health', pages: 3, text: visitText, original: 'after_visit_summary.pdf' });
R.records.find((r) => r.kind === 'encounter' && r.date === '2026-10-01').documents.push(visit.id);
R.document(src.robinChart, { date: '2026-10-01', doc_type: 'lab_report', title: 'Lipid panel', organization: 'Example Health', pages: 2, text: 'Lipid panel, fasting 12 hours. LDL cholesterol 104 mg/dL. Total cholesterol 176 mg/dL. HDL 51 mg/dL. Triglycerides 117 mg/dL.', original: 'lipid_panel.pdf' });
R.document(null, {
  date: '2026-10-01',
  doc_type: 'bill',
  title: 'Statement from Example Health',
  organization: 'Example Health',
  text: 'Statement date 10/20/2026. Account number ****0000. Amount due $53.68. Please pay by 11/19/2026.',
  statement: { statement_date: '2026-10-20', amount_due: { amount: '53.68', currency: 'USD' }, due_date: '2026-11-19', account: '****0000' },
  original: 'statement_oct.pdf',
});
// Last year's bill and the receipt for paying it.
R.document(null, {
  date: '2025-04-02',
  doc_type: 'bill',
  title: 'Statement from Example Health',
  organization: 'Example Health',
  text: 'Statement date 04/02/2025. Account number ****0000. Amount due $51.18. Please pay by 05/02/2025.',
  statement: { statement_date: '2025-04-02', amount_due: { amount: '51.18', currency: 'USD' }, due_date: '2025-05-02', account: '****0000' },
  original: 'statement_apr_2025.pdf',
});
R.document(null, { date: '2025-04-20', doc_type: 'receipt', title: 'Payment receipt from Example Health', organization: 'Example Health', text: 'Payment received 04/20/2025. Account ****0000. Amount paid $51.18. Thank you.', original: 'receipt_apr_2025.pdf' });
R.document(null, {
  date: '2026-10-28',
  doc_type: 'bill',
  title: 'Statement from Example Lab',
  organization: 'Example Lab',
  text: 'Statement date 10/28/2026. Account # ****1111. Balance due $19.28. Due date 11/27/2026.',
  statement: { statement_date: '2026-10-28', amount_due: { amount: '19.28', currency: 'USD' }, due_date: '2026-11-27', account: '****1111' },
  original: 'lab_statement.pdf',
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
// The follow-up visit the November claim is for; its results came in a later load.
R.record(src.robinChart, 'Encounter', 'encounter', {
  date: '2026-11-18',
  code: { system: 'http://www.ama-assn.org/go/cpt', code: '99213', display: 'Office visit' },
  display: 'Office visit',
  status: 'finished',
  fields: { class: 'ambulatory', practitioner: 'Dr. Jordan Sample', location: 'Example Health Main Clinic', reason: 'Blood pressure follow-up', period: { start: '2026-11-18T15:00:00Z', end: '2026-11-18T15:20:00Z' } },
  resource: { status: 'finished', class: { code: 'AMB', display: 'ambulatory' }, type: [{ text: 'Office visit' }], period: { start: '2026-11-18T15:00:00Z', end: '2026-11-18T15:20:00Z' }, reasonCode: [{ text: 'Blood pressure follow-up' }] },
});
R.document(src.robinChart, { date: '2026-11-18', doc_type: 'lab_report', title: 'Basic metabolic panel', organization: 'Example Health', text: 'Basic metabolic panel. Potassium 5.4 mmol/L (high). Creatinine 0.9 mg/dL.', original: 'basic_metabolic_panel.pdf', filed: ROBIN_CHART_LOAD });
const rChart = R.importRun(src.robinChart, { importedAt: ROBIN_CHART_LOAD, added: 2, updated: 0, unchanged: 41, docs: 1 });
R.importRun(src.robinChart, { importedAt: at(-60 * 24 * 8), added: 5, updated: 1, unchanged: 36 });
R.importRun(src.robinPlan, { importedAt: at(-60 * 24 * 3), added: 1, updated: 0, unchanged: 3, cliVersion: '0.3.2' });
R.importRun(src.robinBlood, { importedAt: at(-60 * 24 * 2), added: 0, updated: 0, unchanged: 3, cliVersion: '0.1.1' });
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
// A blood count with a low hemoglobin, drawn twice.
for (const [date, hgb, wbc, plt] of [['2026-07-09', 11.2, 6.1, 245], ['2026-10-12', 11.8, 5.8, 260]]) {
  lab(S, src.samLab, date, ['718-7', 'Hemoglobin [Mass/volume] in Blood', 'Hemoglobin', hgb, 'g/dL', '12.0-15.5 g/dL', hgb < 12 ? 'Low' : 'Normal']);
  lab(S, src.samLab, date, ['6690-2', 'Leukocytes [#/volume] in Blood by Automated count', 'White blood cells', wbc, '10*3/uL', '4.5-11.0 10*3/uL', 'Normal']);
  lab(S, src.samLab, date, ['777-3', 'Platelets [#/volume] in Blood by Automated count', 'Platelets', plt, '10*3/uL', '150-400 10*3/uL', 'Normal']);
}
S.record(src.samChart, 'Condition', 'condition', {
  date: '2026-04-02',
  code: { system: ICD10, code: 'E55.9', display: 'Vitamin D deficiency, unspecified' },
  display: 'Vitamin D deficiency',
  status: 'active',
  fields: { verification_status: 'confirmed', category: 'Problem list item' },
  resource: { clinicalStatus: { coding: [{ code: 'active' }] }, code: { coding: [{ system: ICD10, code: 'E55.9' }], text: 'Vitamin D deficiency' }, onsetDateTime: '2026-04-02' },
});
S.record(src.samChart, 'Condition', 'condition', {
  date: '2026-05-20',
  code: { system: ICD10, code: 'S93.401A', display: 'Sprain of unspecified ligament of right ankle, initial encounter' },
  display: 'Right ankle sprain',
  status: 'resolved',
  fields: { verification_status: 'confirmed', category: 'Encounter diagnosis', abatement: '2026-07-01' },
  resource: { clinicalStatus: { coding: [{ code: 'resolved' }] }, code: { coding: [{ system: ICD10, code: 'S93.401A' }], text: 'Right ankle sprain' }, onsetDateTime: '2026-05-20', abatementDateTime: '2026-07-01' },
});
S.record(src.samChart, 'AllergyIntolerance', 'allergy', {
  date: '2001-03-01',
  code: { system: SNOMED, code: '91935009', display: 'Allergy to peanut' },
  display: 'Peanuts',
  status: 'active',
  fields: { criticality: 'high', reaction: ['Hives', 'Swelling of the lips'] },
  resource: { clinicalStatus: { coding: [{ code: 'active' }] }, code: { text: 'Peanuts' }, criticality: 'high', reaction: [{ manifestation: [{ text: 'Hives' }, { text: 'Swelling of the lips' }] }] },
});
S.record(src.samChart, 'MedicationStatement', 'medication', {
  date: '2026-05-20',
  display: 'Ibuprofen 200 mg tablet',
  status: 'completed',
  fields: { dosage: '2 tablets by mouth every 6 hours as needed for pain', source: 'statement' },
  resource: { status: 'completed', medicationCodeableConcept: { text: 'Ibuprofen 200 mg tablet' }, effectiveDateTime: '2026-05-20', dosage: [{ text: '2 tablets by mouth every 6 hours as needed for pain' }] },
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
const samNote = S.document(src.samChart, {
  date: '2026-05-20',
  doc_type: 'visit_summary',
  title: 'Sports medicine visit note',
  organization: 'Example Health',
  pages: 2,
  text: 'Sports medicine visit with Dr. Casey Placeholder. Right ankle sprain while running. X-ray of the ankle shows no fracture. Brace, ice and rest for two weeks, then physical therapy exercises.',
  original: 'visit_note.pdf',
  filed: at(-60 * 24 * 150),
});
S.records.find((r) => r.kind === 'encounter' && r.date === '2026-05-20').documents.push(samNote.id);
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
for (const [date, code, name] of [
  ['2018-01-01', '08', 'Hep B, adolescent or pediatric'],
  ['2018-02-05', '08', 'Hep B, adolescent or pediatric'],
  ['2018-03-05', '120', 'DTaP-Hib-IPV'],
  ['2018-03-05', '133', 'Pneumococcal conjugate PCV 13'],
  ['2018-03-05', '119', 'Rotavirus, monovalent'],
  ['2018-05-07', '120', 'DTaP-Hib-IPV'],
  ['2018-05-07', '133', 'Pneumococcal conjugate PCV 13'],
  ['2018-05-07', '119', 'Rotavirus, monovalent'],
  ['2018-07-09', '110', 'DTaP-hepatitis B and poliovirus vaccine'],
  ['2018-07-09', '48', 'Hib (PRP-T)'],
  ['2018-07-09', '133', 'Pneumococcal conjugate PCV 13'],
  ['2019-01-07', '03', 'MMR'],
  ['2019-01-07', '21', 'Varicella'],
  ['2019-01-07', '83', 'Hep A, ped/adol, 2 dose'],
  ['2019-01-07', '133', 'Pneumococcal conjugate PCV 13'],
  ['2019-04-08', '20', 'DTaP'],
  ['2019-04-08', '48', 'Hib (PRP-T)'],
  ['2019-07-08', '83', 'Hep A, ped/adol, 2 dose'],
  ['2022-01-10', '20', 'DTaP'],
  ['2022-01-10', '10', 'IPV'],
  ['2022-01-10', '03', 'MMR'],
  ['2022-01-10', '21', 'Varicella'],
  ['2024-10-14', '141', 'Influenza, seasonal, injectable'],
  ['2025-10-20', '141', 'Influenza, seasonal, injectable'],
]) {
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
// A note from the sick visit, scanned and filed by hand: it carries only the practice's name.
A.document(null, { date: '2026-11-20', doc_type: 'letter', title: 'School note', organization: 'Example Pediatrics', text: 'Alex Example was seen in clinic on 11/20/2026 and may return to school on 11/22/2026.', original: 'scan_0012.pdf' });
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

// Jamie: a newborn, two weeks old at the anchor, loaded yesterday.
const J = new PersonData(jamie);
J.record(src.jamiePeds, 'Encounter', 'encounter', {
  date: '2026-11-08',
  display: 'Birth hospital stay',
  status: 'finished',
  fields: { class: 'inpatient', practitioner: 'Dr. Riley Placeholder', location: 'Example Health Birth Center', reason: 'Newborn delivery', period: { start: '2026-11-08T06:10:00Z', end: '2026-11-10T15:00:00Z' } },
  resource: { status: 'finished', class: { code: 'IMP', display: 'inpatient encounter' }, type: [{ text: 'Birth hospital stay' }], period: { start: '2026-11-08T06:10:00Z', end: '2026-11-10T15:00:00Z' } },
  filed: JAMIE_PEDS_LOAD,
});
J.record(src.jamiePeds, 'Immunization', 'immunization', {
  date: '2026-11-08',
  code: { system: CVX, code: '08', display: 'Hep B, adolescent or pediatric' },
  display: 'Hep B, adolescent or pediatric',
  status: 'completed',
  fields: { performer: 'Example Health Birth Center', lot_number: `LOT${hex(4).toUpperCase()}`, site: 'Right thigh', route: 'Intramuscular' },
  resource: { status: 'completed', vaccineCode: { coding: [{ system: CVX, code: '08' }], text: 'Hep B, adolescent or pediatric' }, occurrenceDateTime: '2026-11-08' },
  filed: JAMIE_PEDS_LOAD,
});
for (const [date, kg] of [['2026-11-08', 3.42], ['2026-11-12', 3.31], ['2026-11-19', 3.55]]) {
  J.record(src.jamiePeds, 'Observation', 'result', {
    date,
    code: { system: LOINC, code: '29463-7', display: 'Body weight' },
    display: 'Weight',
    status: 'final',
    fields: { value: { value: kg, unit: 'kg' }, category: 'Vital signs' },
    resource: { status: 'final', code: { coding: [{ system: LOINC, code: '29463-7', display: 'Body weight' }] }, valueQuantity: { value: kg, unit: 'kg' }, effectiveDateTime: date },
    filed: JAMIE_PEDS_LOAD,
  });
}
J.record(src.jamiePeds, 'Observation', 'result', {
  date: '2026-11-09',
  code: { system: LOINC, code: '42719-5', display: 'Bilirubin.total [Mass/volume] in Blood' },
  display: 'Bilirubin, total',
  status: 'final',
  fields: { value: { value: 7.2, unit: 'mg/dL' }, reference_range: '1.0-12.0 mg/dL', category: 'Laboratory' },
  resource: { ...obs('42719-5', 'Bilirubin, total', 7.2, 'mg/dL', 'mg/dL', '1.0-12.0 mg/dL'), effectiveDateTime: '2026-11-09' },
  filed: JAMIE_PEDS_LOAD,
});
for (const [date, what] of [['2026-11-12', 'Newborn visit'], ['2026-11-19', 'Weight check']]) {
  J.record(src.jamiePeds, 'Encounter', 'encounter', {
    date,
    display: what,
    status: 'finished',
    fields: { class: 'ambulatory', practitioner: 'Dr. Morgan Placeholder', location: 'Example Pediatrics' },
    resource: { status: 'finished', type: [{ text: what }], period: { start: `${date}T15:00:00Z` } },
    filed: JAMIE_PEDS_LOAD,
  });
}
const discharge = J.document(src.jamiePeds, { date: '2026-11-10', doc_type: 'discharge_summary', title: 'Newborn discharge summary', organization: 'Example Health', pages: 2, text: 'Newborn discharge summary. Born 11/08/2026 at 39 weeks. Birth weight 3.42 kg. Hepatitis B vaccine given 11/08/2026. Total bilirubin 7.2 mg/dL on day 1. Follow up with pediatrician in 2 to 3 days.', original: 'newborn_discharge.pdf', filed: JAMIE_PEDS_LOAD });
J.records.find((r) => r.kind === 'encounter' && r.date === '2026-11-08').documents.push(discharge.id);
J.importRun(src.jamiePeds, { importedAt: JAMIE_PEDS_LOAD, added: 7, updated: 0, unchanged: 0, docs: 1, cliVersion: '0.6.1' });
J.write();

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
const robinPlanNeeds = attempt(src.robinPlan, robin, { started: at(-60 * 8), outcome: 'needs_person', exit: 3, error: { code: 'needs_person', message: 'The member site session has expired. Sign in with `uhc auth login --browser --profile <provider profile> --overwrite`.', remedy: 'Run `uhc auth login`, then import again.' } });


// ---- More claims, for the costs screen ----
// Sam's employer plan, whose plan year starts in July, with Alex on it as a
// child; and Robin's pharmacy benefit. Every id here is drawn after all the
// others, so the rest of the folder keeps its ids.
orgs.carePlan = { id: id('g'), name: 'Example Care Plan', fhir_base: 'https://fhir.example.com/r4' };
orgs.rx = { id: id('g'), name: 'Example Pharmacy Benefits' };
src.samPlan = source(sam, 'kp', 'example-care-plan', orgs.carePlan);
src.alexPlan = source(alex, 'kp', 'example-care-plan', orgs.carePlan);
src.robinRx = source(robin, 'caremark', 'example-pharmacy-benefits', orgs.rx, 'portal');
const PLANS_LOAD = at(-60 * 30);
for (const s of [src.samPlan, src.alexPlan, src.robinRx]) FIRST_IMPORT.set(s.id, -60 * 30);
writeHousehold();

const NDC = 'http://hl7.org/fhir/sid/ndc';
const cents = (x) => Math.round(Number(x) * 100);
const dollars = (c) => usd((c / 100).toFixed(2));
// A line: [code, what was done, billed, allowed, deductible, copay, coinsurance, plan paid].
// Allowed is what the plan paid plus your share (deductible, copay, coinsurance).
// The plan year a July plan's claim prints as its benefit period (FHIR ExplanationOfBenefit.benefitPeriod).
function julyYear(date) {
  const y = Number(date.slice(0, 4)) - (date.slice(5) < '07-01' ? 1 : 0);
  return { start: `${y}-07-01`, end: `${y + 1}-06-30` };
}

// What a medrec that writes the claim fields of its data contract adds to a
// claim: a name from its lines, each line's category and the claim's,
// amounts under fixed names, the diagnoses, and links to the visit, the
// results and what each line paid for, matched by day and provider. The
// plans' and the pharmacy benefit's claims carry them; Robin's member-site
// plan keeps the older shape, so the sample shows both.
const LINE_CATEGORY = { 99213: 'visit', 99214: 'visit', 73610: 'imaging', 84443: 'lab', 36415: 'lab', 85025: 'lab', 82306: 'lab', 87880: 'lab', 90686: 'vaccine', 90471: 'vaccine' };
// The results each lab line paid for, by their LOINC codes.
const PAID_FOR = { 84443: ['3016-3'], 85025: ['718-7', '6690-2', '777-3'], 82306: ['62292-8'] };
const lowerFirst = (s) => (/^[A-Z][a-z]+(?![\w])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
function nameFrom(labels) {
  const [first, ...rest] = [...new Map(labels.map((l) => [l.toLowerCase(), l])).values()];
  const later = rest.map(lowerFirst);
  if (later.length === 0) return first;
  if (later.length === 1) return `${first} and ${later[0]}`;
  return `${first}, ${later[0]} and ${later.length - 1} more`;
}
function claimFields(P, { date, provider, type, lines, diagnoses }) {
  const orgName = (r) => Object.values(src).find((s) => s.organization === r.provenance[0].source.organization_id)?.organization_name;
  const sameDay = P.records.filter((r) => r.date?.slice(0, 10) === date);
  const visit = sameDay.find((r) => r.kind === 'encounter' && orgName(r) === provider);
  const results = sameDay.filter((r) => (r.kind === 'result' || r.kind === 'report') && orgName(r) === provider);
  const pharmacy = type === 'Pharmacy';
  const categoryOf = (code) => {
    if (pharmacy) return 'pharmacy';
    const c = LINE_CATEGORY[code];
    if (!c) throw new Error(`no category for ${code}`);
    return c;
  };
  const paidFor = (code) => {
    const c = categoryOf(code);
    if (c === 'visit') return visit ? [visit.id] : [];
    if (c === 'lab') return results.filter((r) => (PAID_FOR[code] ?? []).includes(r.code?.code)).map((r) => r.id);
    if (c === 'vaccine') return sameDay.filter((r) => r.kind === 'immunization' && orgName(r) === provider).map((r) => r.id);
    if (c === 'pharmacy') return sameDay.filter((r) => r.kind === 'medication' && r.fields.pharmacy === provider).map((r) => r.id);
    return [];
  };
  const named = (l) => ({
    billed: usd(l[2]),
    ...(pharmacy ? { discount: dollars(cents(l[2]) - cents(l[3])) } : {}),
    allowed: usd(l[3]),
    plan_paid: usd(l[7]),
    deductible: usd(l[4]),
    copay: usd(l[5]),
    coinsurance: usd(l[6]),
    you_owe: dollars(cents(l[4]) + cents(l[5]) + cents(l[6])),
  });
  const kinds = [...new Set(lines.map((l) => categoryOf(l[0])))];
  const total = (i) => (lines.reduce((t, l) => t + cents(l[i]), 0) / 100).toFixed(2);
  return {
    display: pharmacy ? lines[0][1] : nameFrom(lines.map((l) => l[1])),
    category: kinds.length === 1 ? kinds[0] : 'mixed',
    amounts: named(['', '', total(2), total(3), total(4), total(5), total(6), total(7)]),
    diagnoses: diagnoses.map(([code, display], i) => ({ sequence: i + 1, code: { system: ICD10, code, display } })),
    ...(visit ? { visit: visit.id } : {}),
    results: results.map((r) => r.id),
    items: lines.map((l) => ({ category: categoryOf(l[0]), amounts: named(l), records: paidFor(l[0]) })),
  };
}

function claimOf(P, s, { date, provider, insurer, type = 'Professional', system = CPT, lines, balances, benefitPeriod, diagnoses = [] }) {
  for (const l of lines) if (cents(l[3]) !== cents(l[4]) + cents(l[5]) + cents(l[6]) + cents(l[7])) throw new Error(`allowed is not paid plus share: ${l}`);
  const share = (l) => cents(l[4]) + cents(l[5]) + cents(l[6]);
  const amounts = (l) => [
    ['Submitted Amount', usd(l[2])],
    ['Eligible Amount', usd(l[3])],
    ['Benefit Amount', usd(l[7])],
    ['Deductible', usd(l[4])],
    ['Copay', usd(l[5])],
    ['Coinsurance', usd(l[6])],
    ['Member liability', dollars(share(l))],
    ...(type === 'Pharmacy' ? [['Discount', dollars(cents(l[2]) - cents(l[3]))]] : []),
  ];
  const sumAt = (i) => (lines.reduce((t, l) => t + cents(l[i]), 0) / 100).toFixed(2);
  const totals = amounts(['', '', sumAt(2), sumAt(3), sumAt(4), sumAt(5), sumAt(6), sumAt(7)]);
  const medrec = claimFields(P, { date, provider, type, lines, diagnoses });
  P.record(s, 'ExplanationOfBenefit', 'claim', {
    date,
    code: { system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: type.toLowerCase(), display: type },
    display: medrec.display,
    status: 'active',
    fields: {
      provider,
      insurer,
      outcome: 'complete',
      billable_period: { start: date, end: date },
      total: totals.map(([category, amount]) => ({ category, amount })),
      payment: usd(sumAt(7)),
      type,
      use: 'claim',
      items: lines.map((l, i) => ({
        sequence: i + 1,
        service: { system, code: l[0], display: l[1] },
        serviced: date,
        quantity: { value: 1, unit: null },
        net: usd(l[2]),
        adjudication: amounts(l).map(([category, amount]) => ({ category, amount, reason: null })),
        ...medrec.items[i],
      })),
      ...(balances ? { benefit_balance: balances } : {}),
      ...(benefitPeriod ? { benefit_period: benefitPeriod } : {}),
      category: medrec.category,
      amounts: medrec.amounts,
      diagnoses: medrec.diagnoses,
      ...(medrec.visit ? { visit: medrec.visit } : {}),
      results: medrec.results,
    },
    resource: {
      status: 'active',
      type: { coding: [{ code: type.toLowerCase() }] },
      use: 'claim',
      billablePeriod: { start: date, end: date },
      ...(benefitPeriod ? { benefitPeriod } : {}),
      outcome: 'complete',
      item: lines.map(([code, display, b], i) => ({ sequence: i + 1, productOrService: { coding: [{ system, code, display }] }, servicedDate: date, net: { value: Number(b), currency: 'USD' } })),
    },
  });
}
const careBalance = (deductibleUsed, outOfPocketUsed) => [
  {
    category: '1',
    network: 'in',
    unit: 'individual',
    term: 'annual',
    financial: [
      { type: 'Deductible', allowed: usd('750.00'), used: usd(deductibleUsed) },
      { type: 'Out-of-pocket limit', allowed: usd('3000.00'), used: usd(outOfPocketUsed) },
    ],
  },
];
const coverage = (P, s, display, relationship) =>
  P.record(s, 'Coverage', 'coverage', {
    date: '2025-07-01',
    code: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HIP', display: 'health insurance plan policy' },
    display,
    status: 'active',
    fields: { payer: 'Example Care Plan', period: { start: '2025-07-01' }, relationship, plan: 'HMO Family', group: 'GRP-111111' },
    resource: { status: 'active', period: { start: '2025-07-01' } },
  });

// Sam: a sports-medicine visit with an X-ray late in one plan year; then, in
// the next, lab work that went to the deductible.
coverage(S, src.samPlan, 'Example Care Plan HMO', 'self');
claimOf(S, src.samPlan, { date: '2026-05-20', provider: 'Example Health', insurer: 'Example Care Plan', benefitPeriod: julyYear('2026-05-20'), diagnoses: [['S93.401A', 'Sprain of unspecified ligament of right ankle, initial encounter']], lines: [['99214', 'Office visit', '260.00', '168.00', '0.00', '40.00', '0.00', '128.00'], ['73610', 'X-ray of the ankle', '145.00', '82.00', '0.00', '0.00', '16.40', '65.60']] });
claimOf(S, src.samPlan, { date: '2026-07-09', provider: 'Example Lab', insurer: 'Example Care Plan', benefitPeriod: julyYear('2026-07-09'), diagnoses: [['Z13.29', 'Encounter for screening for other suspected endocrine disorder']], lines: [['84443', 'Thyroid test (TSH)', '95.00', '41.20', '41.20', '0.00', '0.00', '0.00'], ['36415', 'Blood draw', '25.00', '9.50', '9.50', '0.00', '0.00', '0.00']] });
claimOf(S, src.samPlan, { date: '2026-10-12', provider: 'Example Lab', insurer: 'Example Care Plan', benefitPeriod: julyYear('2026-10-12'), diagnoses: [['E55.9', 'Vitamin D deficiency, unspecified']], lines: [['85025', 'Blood count', '98.00', '31.40', '31.40', '0.00', '0.00', '0.00'], ['82306', 'Vitamin D test', '150.00', '38.90', '38.90', '0.00', '0.00', '0.00']], balances: careBalance('121.00', '121.00') });
S.importRun(src.samPlan, { importedAt: PLANS_LOAD, added: 4, updated: 0, unchanged: 0, cliVersion: '0.4.0' });
S.write();

// Alex, on Sam's plan: a flu shot, and a sick visit at the pediatric practice.
coverage(A, src.alexPlan, 'Example Care Plan HMO (dependent)', 'child');
claimOf(A, src.alexPlan, { date: '2025-10-20', provider: 'Example Pediatrics', insurer: 'Example Care Plan', benefitPeriod: julyYear('2025-10-20'), diagnoses: [['Z23', 'Encounter for immunization']], lines: [['90686', 'Flu vaccine', '55.00', '32.00', '0.00', '0.00', '0.00', '32.00'], ['90471', 'Vaccine given', '28.00', '18.00', '0.00', '0.00', '0.00', '18.00']] });
claimOf(A, src.alexPlan, { date: '2026-11-20', provider: 'Example Pediatrics', insurer: 'Example Care Plan', benefitPeriod: julyYear('2026-11-20'), diagnoses: [['H66.90', 'Otitis media, unspecified, unspecified ear']], lines: [['99213', 'Office visit', '165.00', '98.00', '0.00', '25.00', '0.00', '73.00'], ['87880', 'Strep test', '48.00', '21.30', '0.00', '0.00', '0.00', '21.30']], balances: careBalance('0.00', '25.00') });
A.importRun(src.alexPlan, { importedAt: PLANS_LOAD, added: 3, updated: 0, unchanged: 0, cliVersion: '0.4.0' });
A.write();

// Robin's lisinopril fills, as the pharmacy benefit's claims.
for (const date of ['2026-08-14', '2026-11-12']) {
  claimOf(R, src.robinRx, { date, provider: 'Example Pharmacy', insurer: 'Example Pharmacy Benefits', type: 'Pharmacy', system: NDC, diagnoses: [['I10', 'Essential (primary) hypertension']], lines: [['00000-1111-90', 'Lisinopril 10 mg tablet, 90 days', '32.50', '12.40', '0.00', '10.00', '0.00', '2.40']] });
}
R.importRun(src.robinRx, { importedAt: PLANS_LOAD, added: 2, updated: 0, unchanged: 0, cliVersion: '1.2.0' });
R.write();
const planOk = (s, person, run) => attempt(s, person, { started: at(-60 * 30 - 1), importId: run.id, c: counts(run) });
const samPlanOk = planOk(src.samPlan, sam, S.imports.at(-1));
const alexPlanOk = planOk(src.alexPlan, alex, A.imports.at(-1));
const robinRxOk = planOk(src.robinRx, robin, R.imports.at(-1));
const planStatus = (s, person, ok, run) => ({
  source: s.id, person: person.id, cli: s.cli, organization: s.organization, auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: at(60 * 24 - 30),
  sign_in: { state: 'ok', expires_at: at(60 * 24 * 60), checked_at: at(-60 * 30 - 1), renews: s.cli !== 'caremark', needs_person: null },
  last_attempt: ok,
  last_success: { attempt: ok.attempt, finished_at: ok.finished_at, import: run.id, counts: counts(run), withheld_types: [] },
});

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

// ---- Coverage over time ----

// Robin's portal lists the coverage before Jamie was born and the one since,
// naming the insurer without its space. Written last, so no other id moves.
const portalCoverage = (start, end) =>
  R.record(src.robinChart, 'Coverage', 'coverage', {
    date: start,
    code: HIP,
    display: 'ExampleHealth Plan',
    status: 'active',
    fields: { payer: 'ExampleHealth Plan', period: { start, ...(end ? { end } : {}) }, relationship: 'self', plan: 'PPO Choice' },
    resource: { status: 'active', payor: [{ display: 'ExampleHealth Plan' }], period: { start, ...(end ? { end } : {}) }, class: [{ type: { coding: [{ code: 'plan' }] }, name: 'PPO Choice' }] },
  });
portalCoverage('2024-01-01', '2026-11-07');
portalCoverage('2026-11-08');
R.write();

// ---- The Mac's status ----

// Robin's plan and blood centre are member sites whose sign-ins nothing
// renews: each loads after someone signs in, and otherwise waits quietly.
const robinBloodWaits = attempt(src.robinBlood, robin, { started: at(-60 * 6), outcome: 'needs_person', exit: 3, error: { code: 'needs_person', message: 'Session expired. Run `oneblood auth login --profile <provider profile>`.', remedy: 'Sign in again with `oneblood auth login`.' } });
// Alex's practice loaded yesterday, and its next load found the sign-in
// ended. medrec renews this sign-in on its own, so an end is news: a person
// must sign in. These attempts are drawn last, so no other id moves.
const alexPedsEnded = attempt(src.alexPeds, alex, { started: at(-60 * 2), outcome: 'needs_person', exit: 3, error: { code: 'needs_person', message: 'The sign-in has expired and could not be renewed. Run `athena auth login --profile <provider profile>`.', remedy: 'Run `athena auth login`, then import again.' } });

write('_status/status.json', {
  schema: 'medrec-status/v1',
  format: 1,
  updated_at: at(-2),
  refresher: { medrec_version: '0.3.0', machine, last_pass_at: at(-2), next_pass_at: at(3), pass_every_secs: 300, heartbeat_every_secs: 3600 },
  sources: [
    {
      source: src.robinChart.id, person: robin.id, cli: 'mychart', organization: 'example-health', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: at(60 * 21),
      sign_in: { state: 'ok', expires_at: at(60 * 24 * 200), checked_at: at(-60 * 3 - 1), renews: true, needs_person: null },
      last_attempt: robinChartOk,
      last_success: { attempt: robinChartOk.attempt, finished_at: robinChartOk.finished_at, import: rChart.id, counts: counts(rChart), withheld_types: ['ExplanationOfBenefit'] },
    },
    {
      source: src.robinPlan.id, person: robin.id, cli: 'uhc', organization: 'example-health-plan', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: null,
      sign_in: { state: 'signed_out', expires_at: null, checked_at: at(-60 * 8), renews: false, lasts_secs: 1800, needs_person: { reason: 'sign_in', since: at(-60 * 8), command: `medrec refresh sign-in ${src.robinPlan.id}` } },
      last_attempt: robinPlanNeeds,
      last_success: null,
    },
    {
      source: src.robinBlood.id, person: robin.id, cli: 'oneblood', organization: 'example-blood-center', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: null,
      sign_in: { state: 'expired', expires_at: null, checked_at: at(-60 * 6), renews: false, needs_person: { reason: 'sign_in', since: at(-60 * 6), command: `medrec refresh sign-in ${src.robinBlood.id}` } },
      last_attempt: robinBloodWaits,
      last_success: null,
    },
    {
      source: src.samChart.id, person: sam.id, cli: 'mychart', organization: 'example-health', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: at(60 * 19),
      sign_in: { state: 'expiring', expires_at: at(60 * 40), checked_at: at(-60 * 5 - 1), renews: true, needs_person: null },
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
      sign_in: { state: 'unknown', expires_at: null, checked_at: at(-60 * 24 * 2), renews: false, needs_person: null },
      last_attempt: null,
      last_success: null,
    },
    {
      source: src.alexPeds.id, person: alex.id, cli: 'athena', organization: 'example-pediatrics', auto: true, paused: null, failures: 0, min_interval_secs: 86400, next_run_at: null,
      sign_in: { state: 'expired', expires_at: null, checked_at: at(-60 * 2), renews: true, needs_person: { reason: 'sign_in', since: at(-60 * 2), command: `medrec refresh sign-in ${src.alexPeds.id}` } },
      last_attempt: alexPedsEnded,
      last_success: { attempt: alexOk.attempt, finished_at: alexOk.finished_at, import: aPeds.id, counts: counts(aPeds), withheld_types: [] },
    },
    planStatus(src.samPlan, sam, samPlanOk, S.imports.at(-1)),
    planStatus(src.alexPlan, alex, alexPlanOk, A.imports.at(-1)),
    planStatus(src.robinRx, robin, robinRxOk, R.imports.at(-1)),
  ],
});
attempts.sort((a, b) => a.started_at.localeCompare(b.started_at));
const byMonth = new Map();
for (const a of attempts) {
  const m = a.started_at.slice(0, 7);
  byMonth.set(m, [...(byMonth.get(m) ?? []), a]);
}
for (const [m, lines] of byMonth) write(`_status/attempts/${m}.ndjson`, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

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
