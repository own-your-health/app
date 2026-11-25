// Invented people whose records give each of the app's reading rules a case
// of its own, beside the sample household: results sent as text, a coverage's
// history, plan years, lines a claim's totals leave out, a hospital's revenue
// codes, how care is grouped, which practice a sign-in is, what a claim says it
// paid for, and what is paid of a bill. Written from the rules' own text (the
// app's, and medrec's docs/data-contract.md).

import { claim, CPT, encounter, line, NDC, resource, result, rid, textResult, who, wordResult } from './fhir.mjs';
import { pdf } from './papers.mjs';

export const PEOPLE = {
  riley: { name: 'Riley Example', born: '1971-05-05', args: ['--adult'] },
  kit: { name: 'Kit Example', born: '1976-03-03', args: ['--adult'] },
  // Born the day Kit's second coverage started.
  wren: { name: 'Wren Example', born: '2015-09-01', args: ['--child', '--guardian', 'Kit Example'] },
  dale: { name: 'Dale Example', born: '1969-02-02', args: ['--adult'] },
  pat: { name: 'Pat Example', born: '1984-04-04', args: ['--adult'] },
  quinn: { name: 'Quinn Example', born: '1979-06-06', args: ['--adult'] },
  noor: { name: 'Noor Example', born: '1966-08-08', args: ['--adult'] },
  lee: { name: 'Lee Example', born: '1973-09-09', args: ['--adult'] },
  toni: { name: 'Toni Example', born: '1975-10-10', args: ['--adult'] },
  wyn: { name: 'Wyn Example', born: '1988-11-11', args: ['--adult'] },
  val: { name: 'Val Example', born: '1963-12-12', args: ['--adult'] },
};

const HEALTH = { id: 'example-health', name: 'Example Health', fhir_base: 'https://fhir.example.org/r4', vendor: 'epic' };
const PLAN = { id: 'example-health-plan', name: 'Example Health Plan', fhir_base: 'https://example-health-plan.example', vendor: 'site' };
const CARE_PLAN = { id: 'example-care-plan', name: 'Example Care Plan', fhir_base: 'https://fhir.example.com/r4', vendor: 'plan' };
const LAB = { id: 'example-lab', name: 'Example Lab', fhir_base: 'https://example-lab.example', vendor: 'site' };
/** A practice on the one address many share. */
const practice = (id, name) => ({ id, name, fhir_base: 'https://records.example.net/fhir/r4', vendor: 'athena' });

const chart = (person, org = HEALTH) => ({ cli: 'mychart', version: '0.7.1', person, login: person, org, patient: rid('pat', `${person} chart`), relationship: 'self' });
const plan = (person, login = person) => ({ cli: 'uhc', version: '0.3.6', person, login, org: PLAN, patient: rid('pat', `${person} plan`), relationship: person === login ? 'self' : 'child', method: 'portal' });
const carePlan = (person, org = CARE_PLAN) => ({ cli: 'kp', version: '0.4.0', person, login: person, org, patient: rid('pat', `${person} care plan`), relationship: 'self' });
const at = (person, org, what = org.id) => ({ cli: 'athena', version: '0.6.1', person, login: person, org, patient: rid('pat', `${person} ${what}`), relationship: 'self' });

export const SOURCES = {
  rileyLab: { cli: 'labcorp', version: '0.2.1', person: 'riley', login: 'riley', org: LAB, patient: rid('pat', 'riley lab'), relationship: 'self', method: 'portal' },
  kitPlan: plan('kit'),
  kitChart: chart('kit'),
  wrenPlan: plan('wren', 'kit'),
  // Two sources whose ids are one, and who are not.
  dalePlan: carePlan('dale', { ...CARE_PLAN, id: '700001' }),
  daleChart: chart('dale', { ...HEALTH, id: '700001' }),
  patPlan: carePlan('pat'),
  quinnPlan: plan('quinn'),
  noorPlan: carePlan('noor'),
  noorChart: chart('noor'),
  leeFoot: at('lee', practice('800001', 'Example Foot Care')),
  leeHearing: at('lee', practice('800002', 'Example Hearing Center')),
  leeUnnamed: at('lee', practice('800003', ' ')),
  leeEvery: at('lee', practice('800004', 'Example Records (all practices)')),
  leeChart: chart('lee', { ...HEALTH, id: '800001' }),
  // Two practices one id stands for, a third that is another person's, and others by their own.
  leeNorth: at('lee', practice('example-group', 'Example North Clinic'), 'north'),
  leeSouth: at('lee', practice('example-group', 'Example South Clinic'), 'south'),
  leeLake: at('lee', practice('example-lake', 'Example Lake Clinic')),
  leeNorthAlone: at('lee', practice('example-north', 'Example North Clinic')),
  toniWest: at('toni', practice('example-group', 'Example West Clinic')),
  toniEast: at('toni', practice('example-east', 'Example East Clinic')),
  wynPlan: plan('wyn'),
  wynChart: chart('wyn'),
  valPlan: plan('val'),
};

const R = {};
/** What each source serves. */
export { R as RECORDS };

// ---- Results whose values came as text ----

/** A result whose value is text, with the lab's range as it words it, or none. */
const said = (date, [code, text, value, range]) =>
  resource('Observation', `riley ${code} ${date}`, date, {
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
    code: { coding: [{ system: 'http://loinc.org', code }], text },
    effectiveDateTime: date,
    valueString: value,
    ...(range ? { referenceRange: [{ text: range }] } : {}),
  });

R.rileyLab = [
  textResult('riley', '2026-03-24', ['19123-9', 'Magnesium', 2.1, 'mg/dL', 1.6, 2.6]),
  result('riley', '2025-06-10', ['19123-9', 'Magnesium', 1.9, 'mg/dL', '1.6-2.6 mg/dL', 'Normal']),
  said('2026-03-24', ['2777-1', 'Phosphorus', '5.9', '2.5 - 4.5 mg/dL']),
  said('2026-03-24', ['736-9', 'Lymphocytes', '31']),
  said('2026-03-24', ['1988-5', 'C-reactive protein', '<0.3', '0.0-1.0 mg/dL']),
  said('2026-03-24', ['2132-9', 'Vitamin B12', '>2000', '>=200 pg/mL']),
  said('2026-03-24', ['2498-4', 'Iron', '<10', '50-150 ug/dL']),
  said('2026-03-24', ['5767-9', 'Urine clarity', 'Clear']),
];

// ---- Coverages over time ----

const covers = (what, { payer, plan, start, end, relationship = 'self', status = 'active' }) =>
  resource('Coverage', what, start ?? '2026-01-05', {
    status,
    relationship: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship', code: relationship }] },
    ...(start ? { period: { start, ...(end ? { end } : {}) } } : {}),
    payor: [{ display: payer }],
    ...(plan ? { class: [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/coverage-class', code: 'plan' }] }, value: plan, name: plan }] } : {}),
  });

R.kitPlan = [covers('kit now', { payer: 'Example Health Plan', plan: 'Saver 1500', start: '2015-09-01', end: '9999-12-31' })];
R.kitChart = [
  covers('kit now, at the portal', { payer: 'EXAMPLE HEALTH PLAN, INC.', start: '2015-09-01' }),
  covers('kit before', { payer: 'EXAMPLE HEALTH PLAN, INC.', plan: 'Saver 1500', start: '2009-07-01', end: '2015-08-31' }),
  covers('kit eyes', { payer: 'Example Vision', plan: 'Vision Plus', start: '2011-02-01', end: '2013-01-31' }),
  covers('kit by mistake', { payer: 'Example Health Plan', start: '2005-01-01', status: 'entered-in-error' }),
  covers('kit teeth', { payer: 'Example Dental' }),
];
R.wrenPlan = [covers('wren', { payer: 'Example Health Plan', plan: 'Saver 1500', start: '2015-09-01', end: '9999-12-31', relationship: 'child' })];
R.dalePlan = [covers('dale', { payer: 'Example Care Plan', start: '2018-02-01' })];
R.daleChart = [covers('dale at the portal', { payer: 'EXAMPLE CARE PLAN OPEN ACCESS', start: '2018-02-01' })];

// ---- Plan years ----

const seen = (what, date, insurer, period) => claim(`pat ${what}`, { date, provider: 'Example Clinic', insurer, lines: [line('99213', 'Office visit', '150.00', { copay: '25.00', paid: '75.00' })], ...(period ? { period } : {}) });
R.patPlan = [
  covers('pat', { payer: 'EXAMPLE HEALTH PLAN, INC.', start: '2026-06-15', end: '9999-12-31' }),
  seen('winter', '2026-02-12', 'Example Health Plan'),
  seen('fall', '2026-10-05', 'Example Health Plan'),
  // A plan that prints its benefit period on one claim only.
  seen('spring', '2026-03-20', 'Example Care Plan'),
  seen('september', '2026-09-09', 'Example Care Plan', { start: '2026-06-01', end: '2027-05-31' }),
  // One whose "benefit period" is a single day.
  seen('teeth', '2026-08-08', 'Example Dental', { start: '2026-08-08', end: '2026-08-08' }),
];

// ---- Lines a claim's totals leave out, and revenue codes ----

const HL7 = 'http://terminology.hl7.org/CodeSystem';
const CARIN = 'http://hl7.org/fhir/us/carin-bb/CodeSystem/C4BBAdjudication';
const money = (value) => ({ value, currency: 'USD' });
const of = (system, code, value) => ({ category: { coding: [{ system, code }] }, amount: money(value) });
/** A line the plan lists beside the ones its totals count, with nothing to mark it. */
const beside = (c, at, { code, text, billed, allowed, notCovered, owed = 0 }) => {
  c.item.splice(at, 0, {
    productOrService: { coding: [{ system: CPT, code, display: text }] },
    servicedDate: c.created,
    quantity: { value: 1 },
    net: money(billed),
    adjudication: [
      of(`${HL7}/adjudication`, 'submitted', billed),
      ...(allowed ? [of(`${HL7}/adjudication`, 'eligible', allowed)] : []),
      of(`${HL7}/adjudication`, 'benefit', 0),
      ...(notCovered ? [of(CARIN, 'noncovered', notCovered)] : []),
      of(CARIN, 'memberliability', owed),
    ],
  });
  c.item.forEach((l, i) => (l.sequence = i + 1));
  return c;
};
const WORDS = { submitted: 'Billed charges', eligible: 'Allowed amount', benefit: 'Plan paid', deductible: 'Deductible', copay: 'Copay', coinsurance: 'Coinsurance', noncovered: 'Not covered', memberliability: 'Your share' };
/** The same claim with each amount named in the payer's own words. */
const inWords = (c) => {
  for (const a of [...c.total, ...c.item.flatMap((l) => l.adjudication)]) a.category = { text: WORDS[a.category.coding[0].code] };
  return c;
};
/** The claim with other totals than its lines add up to. */
const totalling = (c, totals) => {
  for (const t of c.total) if (t.category.coding[0].code in totals) t.amount = money(totals[t.category.coding[0].code]);
  return c;
};
const quinn = (what, date, provider, lines, more = {}) => claim(`quinn ${what}`, { date, provider, insurer: 'Example Health Plan', lines, cli: 'uhc', ...more });
const some = { prints: ['submitted', 'owed'] };

const marked = quinn('marked', '2026-07-07', 'Example Skin Clinic', [
  line('11400', 'Skin growth removed, small', '170.00', { leftOut: 'Q4 -- Another code on this claim stands for this one.' }),
  line('11401', 'Skin growth removed, medium', '230.00', { deductible: '40.00', paid: '95.00' }),
]);
marked.processNote.push({ number: 2, text: 'Z9 -- Part of this went to your deductible.' });

R.quinnPlan = [
  beside(quinn('recoded', '2026-03-12', 'Example Skin Clinic', [line('17111', 'Wart removal, 15 or more', '310.00', { copay: '40.00', paid: '110.00' }), line('88305', 'Tissue exam', '95.00', { paid: '31.50' })]), 0, { code: '17110', text: 'Wart removal, up to 14', billed: 240, notCovered: 240, owed: 240 }),
  inWords(beside(quinn('in words', '2026-04-08', 'Example Hearing Center', [line('92557', 'Hearing test, full', '180.00', { copay: '30.00', paid: '90.00' })], { prints: ['submitted', 'eligible', 'benefit', 'copay', 'owed'] }), 0, { code: '92552', text: 'Hearing test, tones', billed: 70, notCovered: 70, owed: 70 })),
  totalling(
    beside(
      beside(quinn('written off', '2026-05-18', 'Example Urgent Care', [line('99203', 'New patient visit', '260.00', { copay: '60.00', paid: '120.00' })], { prints: ['submitted', 'eligible', 'benefit', 'copay', 'owed'] }), 1, { code: '99058', text: 'Urgent visit fee', billed: 35, allowed: 35 }),
      2,
      { code: '99070', text: 'Supplies', billed: 15, allowed: 15 },
    ),
    { eligible: 190 },
  ),
  marked,
  // Either of two lines would do.
  totalling(quinn('either', '2026-08-11', 'Example Therapy', [line('97530', 'Balance practice', '90.00', { copay: '18.00' }), line('97530', 'Balance practice', '90.00', { copay: '18.00' })], some), { submitted: 90, memberliability: 18 }),
  // No set of lines is the difference.
  totalling(quinn('neither', '2026-09-03', 'Example Therapy', [line('97112', 'Nerve retraining', '90.00', { copay: '20.00' }), line('97116', 'Walking practice', '60.00', { copay: '10.00' })], some), { submitted: 110, memberliability: 25 }),
  quinn(
    'infusion',
    '2026-10-06',
    'Example Infusion Center',
    [
      line('96365', 'Infusion, first hour', '640.00', { coinsurance: '60.00', paid: '240.00', revenue: ['0260', 'IV therapy'] }),
      line(undefined, undefined, '210.00', { paid: '90.00', revenue: ['0250', 'Pharmacy supplies'] }),
      line('96366', 'Infusion, each added hour', '120.00', { coinsurance: '10.00', paid: '40.00' }),
    ],
    { type: 'institutional', prints: ['submitted', 'eligible', 'benefit', 'coinsurance', 'owed'] },
  ),
];

// ---- How care is grouped ----

const noor = (what, date, provider, lines, more = {}) => claim(`noor ${what}`, { date, provider, insurer: 'Example Care Plan', lines, cli: 'kp', ...more });
const bloodCount = line('85025', 'Blood cell test', '48.00', { paid: '14.00' });
R.noorPlan = [
  // A stay: the hospital's claim, and a doctor's and a lab's dated within it.
  noor(
    'stay',
    '2026-01-19',
    'Example Hospital',
    [
      line(undefined, undefined, '4200.00', { deductible: '500.00', coinsurance: '280.00', paid: '1120.00', revenue: ['0120', 'Room and board, semi-private'] }),
      line('70450', 'CT scan of the head', '900.00', { coinsurance: '60.00', paid: '240.00', revenue: ['0351', 'CT scan, head'] }),
      line('70486', 'CT scan of the sinuses', '700.00', { revenue: ['0351', 'CT scan, head'], leftOut: 'Q4 -- Another code on this claim stands for this one.' }),
    ],
    { type: 'institutional', end: '2026-01-21' },
  ),
  noor('first day', '2026-01-19', 'Sample Ward Doctors', [line('99222', 'Admitted to the hospital, first day', '410.00', { coinsurance: '45.00', paid: '180.00' })]),
  noor('last day', '2026-01-21', 'Sample Ward Doctors', [line('99238', 'Day of discharge', '230.00', { coinsurance: '22.00', paid: '88.00' })]),
  noor('pathology', '2026-01-20', 'Example Lab', [line('88305', 'Tissue exam', '95.00', { paid: '31.50' })]),
  // An emergency room on one day, with the reading of its X-ray.
  noor(
    'emergency',
    '2026-06-14',
    'Example Hospital',
    [line('99283', 'Emergency visit', '780.00', { copay: '150.00', paid: '270.00', revenue: ['0450', 'Emergency room'] }), line('73110', 'X-ray of the wrist', '190.00', { paid: '75.00', revenue: ['0320', 'Radiology'] })],
    { type: 'institutional' },
  ),
  noor('reading', '2026-06-14', 'Example Imaging', [line('73110', 'X-ray of the wrist', '60.00', { paid: '18.00' })]),
  // A hospital doctor's claims alone, on days next to each other.
  noor('rounds', '2026-05-03', 'Sample Lung Group', [line('99232', 'Hospital care, a later day', '190.00', { coinsurance: '16.00', paid: '64.00' })]),
  noor('rounds again', '2026-05-04', 'Sample Lung Group', [line('99232', 'Hospital care, a later day', '190.00', { coinsurance: '16.00', paid: '64.00' })]),
  // Days of claims.
  noor('clinic', '2026-02-10', 'Example Clinic', [line('99213', 'Office visit', '150.00', { copay: '25.00', paid: '75.00' })]),
  noor('clinic lab', '2026-02-10', 'Example Lab', [line('80048', 'Basic metabolic panel', '62.00', { paid: '11.00' })]),
  noor('by a person', '2026-02-24', 'B Sample', [line('99214', 'Office visit', '210.00', { copay: '25.00', paid: '110.00' })]),
  noor('thyroid', '2026-04-02', 'Example Lab', [line('84443', 'Thyroid test (TSH)', '80.00', { paid: '22.00' })]),
  noor('chest', '2026-04-02', 'Example Imaging', [line('71046', 'Chest X-ray', '140.00', { paid: '41.00' })]),
  noor('two offices', '2026-04-15', 'Example Clinic', [line('99213', 'Office visit', '150.00', { copay: '25.00', paid: '75.00' })]),
  noor('two offices, eyes', '2026-04-15', 'Example Eye Doctors', [line('99202', 'New patient visit', '190.00', { copay: '40.00', paid: '70.00' })]),
  noor('two offices, lab', '2026-04-15', 'Example Lab', [bloodCount]),
  noor('shot', '2026-05-20', 'Example Clinic', [line('90471', 'Vaccine given', '30.00', { paid: '20.00' }), line('90715', 'Tdap vaccine', '58.00', { paid: '43.00' })]),
  noor('capsules', '2026-06-02', 'Example Pharmacy', [line('00000-3333-28', 'Cephalexin 500 mg capsule', '31.00', { system: NDC, quantity: 28, copay: '8.00', paid: '2.00' })], { type: 'pharmacy' }),
];
const noorVisit = (what, start, more) => encounter(`noor ${what}`, { start: `${start}T15:00:00Z`, place: 'Example Clinic', clinician: 'Dr. Avery Placeholder', ...more });
R.noorChart = [
  noorVisit('travel', '2026-02-10', { type: 'Office visit', reason: 'Travel advice' }),
  result('noor', '2026-02-10', ['2951-2', 'Sodium', 139, 'mmol/L', '135-145 mmol/L', 'Normal']),
  noorVisit('medicines', '2026-02-24', { type: 'Office visit', reason: 'Medicine review' }),
  noorVisit('video', '2026-03-17', { type: 'Video visit', kind: 'virtual' }),
];
const dayText = (day) => day.replace(/(\d+)-(\d+)-(\d+)/, '$2/$3/$1');
/** A bill, for the care of a day when it says which. */
const statement = (file, date, org, lines, care = date) => ({ file: `Statement from ${org}, ${file}.pdf`, type: 'bill', date: care, org, bytes: pdf([`Statement from ${org}`, `Statement date: ${dayText(date)}`, ...lines]) });
const receipt = (file, date, org, amount) => ({ file: `Receipt from ${org}, ${file}.pdf`, type: 'receipt', date, org, bytes: pdf([`Payment receipt from ${org}`, `Payment date: ${dayText(date)}`, `Amount paid: $${amount}`]) });
export const PAPERS = {
  noor: [
    { file: 'Leaving the hospital.pdf', type: 'discharge_summary', date: '2026-01-21', org: 'Example Hospital', bytes: pdf(['Leaving the hospital', 'Example Hospital, 01/21/2026', 'Rest for two days. Drink plenty of water.']) },
    { file: 'Statement from Example Hospital.pdf', type: 'bill', date: '2026-03-02', org: 'Example Hospital', bytes: pdf(['Statement from Example Hospital', 'Statement date: 03/02/2026', 'Amount due: $840.00', 'Please pay by: 04/01/2026']) },
    { file: 'Receipt.pdf', type: 'receipt', date: '2026-04-02', org: 'Example Front Desk', bytes: pdf(['Payment receipt', 'Payment date: 04/02/2026', 'Amount paid: $15.00']) },
  ],
  val: [
    statement('april', '2026-04-02', 'Example Lab', ['Account number: L-2040']),
    statement('september', '2026-09-02', 'Example Lab', ['Account number: L-2040', 'Amount due: $90.00', 'Please pay by: 10/02/2026'], '2026-08-20'),
    // The same statement, scanned again with a word more.
    statement('september, again', '2026-09-02', 'Example Lab', ['Account number: L-2040', 'Amount due: $90.00', 'Please pay by: 10/02/2026', 'Copy'], '2026-08-20'),
    statement('august', '2026-08-11', 'Example Dental', ['Amount due: $120.00']),
    statement('july', '2026-07-20', 'Example Therapy', ['Amount due: $30.00']),
    receipt('lab', '2026-09-20', 'Example Lab', '40.00'),
    receipt('desk', '2026-07-01', 'Example Clinic', '45.00'),
  ],
};

// ---- Which practice a sign-in is ----

const ALL = 'Example Records (all practices)';
/** A visit its portal places at no one practice, in billing words. */
const through = (what, day, org) => resource('Encounter', `lee ${what}`, day, {
  status: 'finished',
  class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
  type: [{ text: what }],
  period: { start: `${day}T15:00:00Z` },
  ...(org ? { serviceProvider: who(org) } : {}),
});
const level = (what, day) => result('lee', day, [{ Count: '6690-2', Level: '2160-0', Rate: '30341-2' }[what], what, 5, 'unit']);

R.leeFoot = [through('RETURN VISIT LEVEL TWO', '2026-03-31', ALL)];
for (const s of ['leeHearing', 'leeUnnamed', 'leeEvery', 'leeChart', 'leeNorthAlone']) R[s] = [];
R.leeNorth = [through('Morning visit', '2026-04-21'), through('Later visit', '2026-04-30'), level('Count', '2026-04-21')];
R.leeSouth = [through('Afternoon visit', '2026-04-21'), level('Level', '2026-04-30')];
R.leeLake = [through('Lake visit', '2026-05-05'), through('Second lake visit', '2026-05-05'), level('Rate', '2026-05-05')];
for (const s of ['toniWest', 'toniEast']) R[s] = [];

// ---- What a claim says it paid for ----

const wyn = (what, date, provider, lines, more = {}) => claim(`wyn ${what}`, { date, provider, insurer: 'Example Health Plan', lines, cli: 'uhc', ...more });
/** A claim dated after the care it lists. */
const careOn = (c, day) => {
  for (const l of c.item) l.servicedDate = day;
  return c;
};
const linked = careOn(
  wyn('rash', '2026-03-06', 'Sample Physicians Group', [line('99213', 'Office visit', '165.00', { copay: '30.00', paid: '60.00' }), line('87220', 'Skin scraping test', '45.00', { coinsurance: '4.00', paid: '16.00' })], {
    diagnoses: [['B35.4', 'Ringworm'], ['R21', 'Rash']],
    prints: ['submitted', 'eligible', 'benefit', 'copay', 'coinsurance', 'owed'],
  }),
  '2026-03-04',
);
// The payer lists the rash first.
linked.diagnosis[0].sequence = 2;
linked.diagnosis[1].sequence = 1;
/** A claim whose payer gives only its totals. */
const totalsAlone = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'item'));
R.wynPlan = [
  linked,
  wyn('recheck', '2026-03-11', 'Example Clinic', [line('99212', 'Office visit, short', '120.00', { copay: '25.00', paid: '55.00' })], { prints: ['submitted', 'eligible', 'benefit', 'copay', 'owed'] }),
  totalsAlone(wyn('ultrasound', '2026-01-20', 'Example Imaging', [line('76700', 'Ultrasound of the belly', '400.00', { coinsurance: '60.00', paid: '140.00' })], { prints: ['submitted', 'owed'] })),
];
R.wynChart = [
  encounter('wyn rash', { start: '2026-03-04T15:00:00Z', type: 'Skin visit', place: 'Example Clinic', reason: 'Rash' }),
  encounter('wyn recheck', { start: '2026-03-11T15:00:00Z', type: 'Follow-up visit', place: 'Example Clinic' }),
  wordResult('wyn', '2026-03-04', ['6465-9', 'Fungus, skin scraping', 'Positive', 'Negative']),
  result('wyn', '2026-03-04', ['5763-8', 'Zinc', 88, 'ug/dL', '60-120 ug/dL', 'Normal']),
];

// ---- What is paid of a bill ----

R.valPlan = [
  claim('val lab', { date: '2026-08-20', provider: 'Example Lab', insurer: 'Example Health Plan', lines: [line('80053', 'Comprehensive metabolic panel', '130.00', { deductible: '64.00' })], cli: 'uhc' }),
  claim('val visit', { date: '2026-07-01', provider: 'Example Clinic', insurer: 'Example Health Plan', lines: [line('99213', 'Office visit', '150.00', { copay: '25.00', paid: '75.00' })], cli: 'uhc' }),
];

/** Payments marked at the Mac, on Val's bills by their amounts: [amount due, day, amount]. */
export const MARKED = [
  ['90.00', '2026-09-28', '10.00'],
  ['120.00', '2026-08-30', '120.00'],
];
/** And asked for in the folder: on a bill, in the currency given, and on one that is not theirs. */
export const ASKED = [
  { of: '90.00', on: '2026-09-29', amount: { amount: '8.00', currency: 'EUR' } },
  { of: null, on: '2026-09-29', amount: '5.00' },
];
/** And two medrec refuses: a file that is not named as a request, and one larger than the 4 KiB a request may be. */
export const MISNAMED = { file: 'everything.json', request: { scope: { all: true } } };
export const TOO_LARGE = { scope: { all: true }, note: '0123456789'.repeat(500) };
