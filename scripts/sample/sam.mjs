// Sam's records: the same primary-care system as Robin's, a lab, a billing
// site and an employer plan whose year starts in July. Invented.

import { allergy, balance, claim, condition, coverage, encounter, fill, line, order, paper, result, taking } from './fhir.mjs';
import { image } from './dicom.mjs';
import { pdf, rtf } from './papers.mjs';

const DOCTOR = { clinician: 'Dr. Casey Placeholder', npi: '0000000014', place: 'Example Health Orthopedics' };

// ---- The chart ----

const vitaminD = [['2026-04-02', 18], ['2026-07-09', 24], ['2026-10-12', 33]].map(([date, v]) =>
  result('sam chart', date, ['62292-8', 'Vitamin D, 25-hydroxy', v, 'ng/mL', '30-100 ng/mL', v < 30 ? 'Low' : 'Normal']),
);
const D3 = { text: 'Vitamin D3 2,000 unit capsule' };
const FAMOTIDINE = { rxnorm: '310273', text: 'Famotidine 20 mg tablet' };
const AT_NIGHT = 'Take 1 tablet by mouth at bedtime';
const PREP = { text: 'Emtricitabine-tenofovir 200-300 mg tablet' };
const ONCE = 'Take 1 tablet by mouth once a day';
const famotidine = order('sam famotidine', { date: '2026-08-03', med: FAMOTIDINE, dosage: AT_NIGHT, prescriber: DOCTOR.clinician, npi: DOCTOR.npi });
const prep = order('sam prep', { date: '2026-11-04', med: PREP, dosage: ONCE, prescriber: 'Dr. Avery Sample', npi: '0000000105' });
const visitNote = paper('sam sports note', {
  date: '2026-05-20',
  kind: 'visit_summary',
  title: 'Sports medicine visit note',
  media: 'application/pdf',
  bytes: pdf(['Sports medicine visit note', 'Example Health Orthopedics, 05/20/2026, Dr. Casey Placeholder.', 'Right ankle sprain while running.', 'X-ray of the ankle shows no fracture.'], ['Plan', 'Brace, ice and rest for two weeks, then physical therapy exercises.']),
});
// The practice writes its referrals as rich text.
const referral = paper('sam referral', {
  date: '2026-08-03',
  kind: 'referral',
  title: 'Referral to digestive health',
  media: 'application/rtf',
  bytes: rtf('Referral', ['08/03/2026', 'From Dr. Casey Placeholder to Example Digestive Health.', 'Heartburn most nights for two months. Famotidine started today.', 'Please see for an upper endoscopy.']),
});

const chart = [
  ...vitaminD.slice(0, 2),
  condition('sam vitamin d', { since: '2026-04-02', code: 'E55.9', text: 'Vitamin D deficiency' }),
  condition('sam ankle', { since: '2026-05-20', until: '2026-07-01', code: 'S93.401A', text: 'Right ankle sprain', category: 'Encounter diagnosis' }),
  allergy('sam peanuts', { since: '2001-03-01', code: '91935009', text: 'Peanuts', criticality: 'high', reactions: ['Hives', 'Swelling of the lips'] }),
  taking('sam ibuprofen', { date: '2026-05-20', med: { text: 'Ibuprofen 200 mg tablet' }, dosage: '2 tablets by mouth every 6 hours as needed for pain', status: 'completed' }),
  order('sam d3', { date: '2026-04-03', med: D3, dosage: 'Take 1 capsule by mouth once a day', prescriber: DOCTOR.clinician, npi: DOCTOR.npi }),
  encounter('sam sports', { ...DOCTOR, start: '2026-05-20T15:00:00Z', type: 'Sports medicine visit', reason: 'Ankle sprain' }),
  ...visitNote,
  famotidine,
  fill('sam famotidine 2026-09-28', { date: '2026-09-28', med: FAMOTIDINE, dosage: AT_NIGHT, amount: 30, unit: 'tablet', days: 30, pharmacy: 'Example Pharmacy', of: famotidine }),
  ...referral,
];
const autumn = [
  vitaminD[2],
  fill('sam famotidine 2026-10-29', { date: '2026-10-29', med: FAMOTIDINE, dosage: AT_NIGHT, amount: 30, unit: 'tablet', days: 30, pharmacy: 'Example Pharmacy', of: famotidine }),
];
// A visit whose clinic says its area, so medrec lists it, its result and its
// medicine as private to Sam.
const clinic = [
  encounter('sam clinic', { start: '2026-11-03T18:30:00Z', end: '2026-11-03T18:55:00Z', type: 'Clinic visit', place: 'Example Sexual Health Clinic', clinician: 'Dr. Avery Sample', npi: '0000000105', reason: 'Routine screening' }),
  prep,
  fill('sam prep 2026-11-04', { date: '2026-11-04', med: PREP, dosage: ONCE, amount: 30, unit: 'tablet', days: 30, pharmacy: 'Example Pharmacy', of: prep }),
];
export const CHART = [[...chart, ...autumn], [...chart, ...autumn, ...clinic]];

// ---- The lab ----

const counts = [['2026-07-09', 11.2, 6.1, 245], ['2026-10-12', 11.8, 5.8, 260]].map(([date, hemoglobin, white, platelets]) =>
  [
    ['718-7', 'Hemoglobin', hemoglobin, 'g/dL', '12.0-15.5 g/dL', hemoglobin < 12 ? 'Low' : 'Normal'],
    ['6690-2', 'White blood cells', white, '10*3/uL', '4.5-11.0 10*3/uL', 'Normal'],
    ['777-3', 'Platelets', platelets, '10*3/uL', '150-400 10*3/uL', 'Normal'],
  ].map((row) => result('sam lab', date, row)),
);
const tsh = result('sam lab', '2026-07-09', ['3016-3', 'TSH', 2.1, 'mIU/L', '0.4-4.0 mIU/L', 'Normal']);
export const LAB = [[...counts.flat(), tsh]];

// ---- The plan ----

/** The July year a date is in, as this plan's claims print it. */
export function julyYear(date) {
  const y = Number(date.slice(0, 4)) - (date.slice(5) < '07-01' ? 1 : 0);
  return { start: `${y}-07-01`, end: `${y + 1}-06-30` };
}
const carePlan = (what, more) => claim(`sam plan ${what}`, { insurer: 'Example Care Plan', period: julyYear(more.date), cli: 'kp-cli', ...more });
const LAB_NPI = '0000000071';
const REFLUX = ['K21.9', 'Gastro-esophageal reflux disease without esophagitis'];
const upTo = (deductible, outOfPocket) => balance(['750.00', deductible], ['3000.00', outOfPocket]);
export { upTo as careBalance };

const eachYear = [
  coverage('sam plan', { name: 'Example Care Plan HMO', start: '2025-07-01', payer: 'Example Care Plan', plan: 'HMO Family', group: 'GRP-111111' }),
  carePlan('2026-05-20', {
    date: '2026-05-20',
    provider: 'Example Health',
    npi: '0000000063',
    diagnoses: [['S93.401A', 'Sprain of unspecified ligament of right ankle, initial encounter']],
    lines: [line('99214', 'Office visit', '260.00', { copay: '40.00', paid: '128.00' }), line('73610', 'X-ray of the ankle', '145.00', { coinsurance: '16.40', paid: '65.60' })],
  }),
  // The payer gives no figure for what Sam owes of this one, only its parts.
  carePlan('2026-07-09', {
    date: '2026-07-09',
    provider: 'Example Lab',
    npi: LAB_NPI,
    prints: ['submitted', 'eligible', 'benefit', 'deductible', 'copay', 'coinsurance'],
    diagnoses: [['Z13.29', 'Encounter for screening for other suspected endocrine disorder']],
    lines: [line('84443', 'Thyroid test (TSH)', '95.00', { deductible: '41.20' }), line('36415', 'Blood draw', '25.00', { deductible: '9.50' })],
  }),
  // A day at an endoscopy center: its own claim, the doctor's, and the lab's
  // for the biopsy. The doctor billed the look as well as the biopsy; the plan
  // pays the two as one, and leaves the look's line out of its totals.
  carePlan('2026-09-16 center', {
    date: '2026-09-16',
    type: 'institutional',
    provider: 'Example Endoscopy Center',
    npi: '0000000113',
    diagnoses: [REFLUX],
    lines: [line('43239', 'Upper endoscopy with biopsy', '2480.00', { coinsurance: '90.50', paid: '814.50', revenue: ['0750', 'Gastrointestinal services'] })],
  }),
  carePlan('2026-09-16 doctor', {
    date: '2026-09-16',
    provider: 'Example Digestive Health',
    npi: '0000000089',
    facility: 'Example Endoscopy Center',
    diagnoses: [REFLUX],
    lines: [
      line('43239', 'Upper endoscopy with biopsy', '690.00', { deductible: '100.00', coinsurance: '16.20', paid: '145.80' }),
      line('43235', 'Upper endoscopy, look only', '410.00', { leftOut: 'B2 -- Included in the payment for another procedure of the same day.' }),
    ],
  }),
  carePlan('2026-09-16 lab', {
    date: '2026-09-16',
    provider: 'Example Lab',
    npi: LAB_NPI,
    diagnoses: [REFLUX],
    lines: [line('88305', 'Biopsy read under a microscope', '210.00', { coinsurance: '7.20', paid: '64.80' })],
  }),
  carePlan('2026-10-12', {
    date: '2026-10-12',
    provider: 'Example Lab',
    npi: LAB_NPI,
    diagnoses: [['E55.9', 'Vitamin D deficiency, unspecified']],
    lines: [line('85025', 'Blood cell test', '98.00', { deductible: '31.40' }), line('82306', 'Vitamin D test', '150.00', { deductible: '38.90' })],
    balances: upTo('221.00', '334.90'),
  }),
];
// Private, like the visit it is for, and the newest to print Sam's balances: a
// shared view must neither date nor link what it says of them.
const clinicClaim = carePlan('2026-11-03', {
  date: '2026-11-03',
  provider: 'Example Sexual Health Clinic',
  npi: '0000000097',
  diagnoses: [['Z11.4', 'Encounter for screening for human immunodeficiency virus [HIV]']],
  lines: [line('99213', 'Office visit', '170.00', { copay: '20.00', paid: '92.00' }), line('87389', 'HIV screening test', '64.00', { paid: '33.10' })],
  balances: upTo('221.00', '354.90'),
});
export const PLAN = [eachYear, [...eachYear, clinicClaim]];

// ---- The billing site ----

// It has nothing but the account's own bills, which Sam files by hand.
export const BILLING = [[result('sam billing', '2026-07-09', ['718-7', 'Hemoglobin', 11.2, 'g/dL', '12.0-15.5 g/dL', 'Low'])]];

// ---- Papers and images kept by hand ----

export const PAPERS = [
  { file: 'Statement from Example Billing.pdf', type: 'bill', date: '2026-07-09', org: 'Example Billing', bytes: pdf(['Statement from Example Billing', 'Service date: 07/09/2026', 'Statement date: 08/01/2026', 'Guarantor account #: EX-000000', 'Balance due: $120.00', 'Due date: 08/31/2026']) },
];
export const LATER_PAPERS = {
  endoscopy: { file: 'After your upper endoscopy.pdf', type: 'discharge_summary', date: '2026-09-16', org: 'Example Endoscopy Center', bytes: pdf(['After your upper endoscopy', 'Example Endoscopy Center, 09/16/2026', 'Soft foods today. Do not drive until tomorrow.'], ['Call us if', 'You have a fever, or pain that does not ease.', 'The biopsy result takes about a week.']) },
  center: { file: 'Statement from Example Endoscopy Center.pdf', type: 'bill', date: '2026-09-16', org: 'Example Endoscopy Center', bytes: pdf(['Statement from Example Endoscopy Center', 'Service date: 09/16/2026', 'Statement date: 10/05/2026', 'Account number: ****3333', 'Amount due: $90.50', 'Please pay by: 11/04/2026', 'Questions? Call 555-010-0188']) },
};

/** The ankle's X-ray: three views, as a CD has them. */
export const ANKLE = ['AP', 'Lateral', 'Oblique'].map((view, i) => ({
  file: `IMG${i + 1}.dcm`,
  bytes: image({ study: '2.25.100000000000000000000000000000001', series: `2.25.20000000000000000000000000000000${i + 1}`, instance: `2.25.30000000000000000000000000000000${i + 1}`, person: 'Example^Sam', born: '1980-07-01', date: '2026-05-20', description: 'XR ankle, 3 views', accession: 'ACC4D19E2', facility: 'Example Imaging', bodyPart: 'ANKLE', number: i + 1, view }),
}));
