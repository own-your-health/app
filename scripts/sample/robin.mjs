// Robin's records: a primary-care system, a plan, a pharmacy benefit and a
// blood donor centre. Invented.

import { allergy, balance, claim, condition, coverage, encounter, fill, fillInfo, line, NDC, order, paper, result, textResult, vaccine } from './fhir.mjs';
import { pdf, scan } from './papers.mjs';

const DOCTOR = { clinician: 'Dr. Jordan Sample', npi: '0000000055', place: 'Example Health Main Clinic' };

// ---- The chart ----

const chart = [];
const labs = (date, rows) => chart.push(...rows.map((r) => result('robin chart', date, r, { issued: `${date}T15:00:00Z` })));

const LDL = (v) => ['13457-7', 'LDL cholesterol', v, 'mg/dL', '<130 mg/dL', v >= 130 ? 'High' : 'Normal'];
const lipids = ([total, triglycerides, hdl, ldl]) => [
  LDL(ldl),
  ['2093-3', 'Cholesterol, total', total, 'mg/dL', '<200 mg/dL', total >= 200 ? 'High' : 'Normal'],
  ['2571-8', 'Triglycerides', triglycerides, 'mg/dL', '<150 mg/dL', triglycerides >= 150 ? 'High' : 'Normal'],
  ['2085-9', 'HDL cholesterol', hdl, 'mg/dL', '>39 mg/dL', 'Normal'],
];
const K = (v) => ['2823-3', 'Potassium', v, 'mmol/L', '3.5-5.1 mmol/L', v > 5.1 ? 'High' : 'Normal'];
const CREATININE = (v) => ['2160-0', 'Creatinine', v, 'mg/dL', '0.6-1.2 mg/dL', 'Normal'];
const SODIUM = (v) => ['2951-2', 'Sodium', v, 'mmol/L', '136-145 mmol/L', 'Normal'];
const GLUCOSE = (v) => ['2345-7', 'Glucose', v, 'mg/dL', '70-99 mg/dL', v > 99 ? 'High' : 'Normal'];
const CALCIUM = (v) => ['17861-6', 'Calcium', v, 'mg/dL', '8.6-10.2 mg/dL', 'Normal'];

labs('2025-03-10', [...lipids([238, 168, 44, 162]), CALCIUM(9.4), K(4.4), CREATININE(0.8), SODIUM(140)]);
labs('2025-09-15', [...lipids([214, 152, 46, 141]), GLUCOSE(101), K(4.6), CREATININE(0.9)]);
// One number came as text, with a structured range and no flag.
chart.push(textResult('robin chart', '2025-09-15', ['2951-2', 'Sodium', 139, 'mmol/L', 136, 145]));
labs('2026-03-20', lipids([189, 128, 48, 118]));
labs('2026-10-01', [...lipids([176, 117, 51, 104]).slice(1), GLUCOSE(92), ['4548-4', 'Hemoglobin A1c', 5.4, '%', '4.0-5.6 %', 'Normal'], K(4.9), CREATININE(0.9), SODIUM(141)]);
// Served first as preliminary, then as final: the folder keeps both.
const newestLdl = (status, updated) => result('robin chart', '2026-10-01', LDL(104), { issued: '2026-10-01T15:00:00Z', status, updated });

// The portal names the 2025 physical by a billing descriptor, in capitals.
chart.push(
  encounter('robin visit 2025-03-10', { ...DOCTOR, start: '2025-03-10T14:00:00Z', end: '2025-03-10T14:40:00Z', cpt: '99396', type: 'YEARLY EXAM RETURNING ADULT', reason: 'Annual physical' }),
  encounter('robin visit 2025-09-15', { ...DOCTOR, start: '2025-09-15T14:00:00Z', end: '2025-09-15T14:40:00Z', cpt: '99213', type: 'Office visit', reason: 'Follow-up' }),
  encounter('robin visit 2026-10-01', { ...DOCTOR, start: '2026-10-01T14:00:00Z', end: '2026-10-01T14:40:00Z', cpt: '99396', type: 'Office visit', reason: 'Annual physical' }),
  condition('robin pressure', { since: '2025-03-10', code: 'I10', text: 'High blood pressure' }),
  condition('robin pollen', { since: '2019-05-01', until: '2024-06-01', code: 'J30.2', text: 'Seasonal allergies' }),
  allergy('robin latex', { since: '2016-08-01', code: '300916003', text: 'Latex', criticality: 'low', reactions: ['Itching'], active: false }),
  allergy('robin sulfa', { since: '2012-01-01', code: '91939003', text: 'Sulfa drugs', criticality: 'low', reactions: ['Rash'] }),
  vaccine('robin', { date: '2024-02-11', cvx: '115', text: 'Tdap', performer: DOCTOR.place, site: 'Left arm', lot: 'LOT4A91' }),
  vaccine('robin', { date: '2025-10-04', cvx: '141', text: 'Influenza, seasonal, injectable', performer: DOCTOR.place, site: 'Left arm', lot: 'LOT7C02' }),
  vaccine('robin', { date: '2025-10-04', cvx: '309', text: 'COVID-19 vaccine', declined: 'Patient declined' }),
  vaccine('robin', { date: '2026-10-01', cvx: '141', text: 'Influenza, seasonal, injectable', performer: DOCTOR.place, site: 'Left arm', lot: 'LOT1E58' }),
);

const LISINOPRIL = { rxnorm: '314076', text: 'Lisinopril 10 mg tablet' };
const DAILY = 'Take 1 tablet by mouth once a day';
const lisinopril = order('robin lisinopril', { date: '2025-03-12', med: LISINOPRIL, dosage: DAILY, prescriber: DOCTOR.clinician, npi: DOCTOR.npi });
const lisinoprilFill = (date) => fill(`robin lisinopril ${date}`, { date, med: LISINOPRIL, dosage: DAILY, amount: 90, unit: 'tablet', days: 90, pharmacy: 'Example Pharmacy', of: lisinopril });
chart.push(
  lisinopril,
  order('robin cetirizine', { date: '2023-04-02', med: { rxnorm: '1014678', text: 'Cetirizine 10 mg tablet' }, dosage: 'Take 1 tablet daily as needed', status: 'stopped' }),
  lisinoprilFill('2026-08-14'),
  ...paper('robin after visit 2026-10-01', {
    date: '2026-10-01',
    kind: 'visit_summary',
    title: 'After visit summary',
    media: 'application/pdf',
    bytes: pdf(
      ['After visit summary', 'Example Health Main Clinic, 10/01/2026', 'Annual physical with Dr. Jordan Sample.', 'Discussed home blood pressure readings and continuing lisinopril.'],
      ['Results and vaccines', 'LDL cholesterol is lower than last year.', 'Influenza vaccine given today.'],
      ['Next steps', 'Return in twelve months.'],
    ),
  }),
  ...paper('robin lipids 2026-10-01', {
    date: '2026-10-01',
    kind: 'lab_report',
    title: 'Lipid panel',
    media: 'application/pdf',
    bytes: pdf(
      ['Lipid panel', 'Collected 10/01/2026, fasting 12 hours.', 'LDL cholesterol 104 mg/dL.', 'Total cholesterol 176 mg/dL.', 'HDL 51 mg/dL.', 'Triglycerides 117 mg/dL.'],
      ['Reference ranges', 'LDL cholesterol under 130 mg/dL.', 'Total cholesterol under 200 mg/dL.', 'HDL over 39 mg/dL.', 'Triglycerides under 150 mg/dL.'],
    ),
  }),
);

/** The chart on each of its loads: what each adds to the one before. */
export const CHART = [
  [...chart, newestLdl('preliminary', '2026-10-01')],
  [...chart, newestLdl('final', '2026-11-13'), lisinoprilFill('2026-11-12')],
  [
    ...chart,
    newestLdl('final', '2026-11-13'),
    lisinoprilFill('2026-11-12'),
    encounter('robin visit 2026-11-18', { ...DOCTOR, start: '2026-11-18T19:30:00Z', end: '2026-11-18T19:50:00Z', type: 'Established patient visit', reason: 'Cholesterol and potassium recheck' }),
    result('robin chart', '2026-11-18', K(5.4), { issued: '2026-11-19T16:00:00Z' }),
    result('robin chart', '2026-11-18', CREATININE(0.9), { issued: '2026-11-19T16:00:00Z' }),
    ...paper('robin metabolic 2026-11-18', { date: '2026-11-18', kind: 'lab_report', title: 'Basic metabolic panel', media: 'application/pdf', bytes: pdf(['Basic metabolic panel', 'Collected 11/18/2026.', 'Potassium 5.4 mmol/L (high).', 'Creatinine 0.9 mg/dL.']) }),
  ],
];

// ---- The plan ----

// These claims print no copay.
const plain = ['submitted', 'eligible', 'benefit', 'deductible', 'coinsurance', 'owed'];
const planClaim = (date, provider, npi, lines, more = {}) => claim(`robin plan ${date}`, { date, provider, npi, insurer: 'Example Health Plan', lines, prints: plain, ...more });
const CLINIC = ['Example Health', '0000000063'];
const LAB = ['Example Lab', '0000000071'];

const eob = paper('robin eob 2026-10-01', {
  date: '2026-10-20',
  kind: 'eob',
  title: 'Explanation of Benefits',
  media: 'application/pdf',
  bytes: pdf(['Explanation of Benefits', 'This is not a bill.', 'Example Health, office visit 10/01/2026.', 'Amount billed $412.00.', 'Plan paid $214.72.', 'You may owe the provider $53.68.'], ['How this was worked out', 'Your plan covers 80% after the deductible.']),
});

const october = planClaim(
  '2026-10-01',
  ...CLINIC,
  [line('99396', 'Preventive visit', '320.00', { coinsurance: '42.00', paid: '168.00' }), line('90686', 'Flu vaccine', '62.00', { coinsurance: '7.68', paid: '30.72' }), line('90471', 'Vaccine given', '30.00', { coinsurance: '4.00', paid: '16.00' })],
  { balances: balance(['1500.00', '1120.40'], ['4000.00', '1356.10']), papers: [eob[0]], updated: '2026-10-18' },
);
const planStart = [
  coverage('robin plan 2025', { name: 'Example Health Plan', start: '2025-01-01', end: '2025-12-31', payer: 'Example Health Plan', plan: 'Choice Silver 2025', group: 'GRP-440000' }),
  coverage('robin plan 2026', { name: 'Example Health Plan', start: '2026-01-01', end: '2026-12-31', payer: 'Example Health Plan', plan: 'Choice Silver 2026', group: 'GRP-440000' }),
  planClaim('2025-03-10', ...CLINIC, [line('99214', 'Office visit', '290.00', { coinsurance: '38.00', paid: '152.00' }), line('85025', 'Blood cell test', '108.00', { coinsurance: '13.18', paid: '52.72' })]),
  planClaim('2025-09-15', ...CLINIC, [line('99213', 'Office visit', '189.00', { paid: '121.10' })]),
  october,
  ...eob,
];
const labClaim = planClaim('2026-10-03', ...LAB, [line('80061', 'Cholesterol tests', '180.00', { coinsurance: '15.68', paid: '62.72' }), line('36415', 'Blood draw', '40.00', { coinsurance: '3.60', paid: '14.40' })]);
const november = planClaim('2026-11-18', ...CLINIC, [line('99213', 'Office visit', '180.00', { coinsurance: '25.00', paid: '87.50' })]);
export const PLAN = [planStart, [...planStart, labClaim], [...planStart, labClaim, november]];

// ---- The pharmacy benefit ----

const ATORVASTATIN = { rxnorm: '617310', ndc: '00000-2222-30', text: 'Atorvastatin 20 mg tablet' };
const NIGHTLY = 'Take 1 tablet by mouth at bedtime';
const atorvastatin = order('robin atorvastatin', { date: '2026-04-06', med: ATORVASTATIN, dosage: NIGHTLY, prescriber: DOCTOR.clinician, npi: DOCTOR.npi });
const monthly = (date, refill, words) => [
  fill(`robin atorvastatin ${date}`, { date, med: ATORVASTATIN, dosage: NIGHTLY, amount: 30, unit: 'tablet', days: 30, pharmacy: 'Example Pharmacy', of: atorvastatin, kind: 'Refill' }),
  claim(`robin atorvastatin claim ${date}`, {
    date,
    type: 'pharmacy',
    provider: 'Example Pharmacy',
    insurer: 'Example Pharmacy Benefits',
    prints: ['submitted', 'discount', 'eligible', 'benefit', 'deductible', 'copay', 'coinsurance', 'owed'],
    diagnoses: [['E78.00', words]],
    lines: [line('00000-2222-30', 'Atorvastatin 20 mg tablet, 30 days', '46.20', { system: NDC, quantity: 30, copay: '5.00', paid: '6.35' })],
    info: fillInfo({ days: 30, refill, refills: 5, brand: 'Generic' }),
  }),
];
const rxStart = [atorvastatin, ...monthly('2026-09-08', 4, 'HLD'), ...monthly('2026-10-08', 5, 'HIGH CHOLESTEROL')];
export const RX = [rxStart, [...rxStart, ...monthly('2026-11-07', 0, 'HYPERCHOLESTEROLEMIA NOS')]];

// ---- The blood donor centre ----

const donations = [['2025-06-01', 13.9], ['2025-12-02', 14.2], ['2026-06-05', 14.0]].map(([date, v]) => result('robin blood', date, ['718-7', 'Hemoglobin', v, 'g/dL']));
export const BLOOD = [donations, donations];

// ---- Papers kept by hand ----

/** Scanned or saved, and filed with what the household knew of each. */
export const PAPERS = [
  { file: 'Statement from Example Health, April.pdf', type: 'bill', date: '2025-04-02', org: 'Example Health', bytes: pdf(['Statement from Example Health', 'Statement date: 04/02/2025', 'Account number: ****0000', 'Amount due: $51.18', 'Please pay by: 05/02/2025']) },
  { file: 'Payment receipt.pdf', type: 'receipt', date: '2025-04-20', org: 'Example Health', bytes: pdf(['Payment receipt', 'Example Health', 'Payment date: 04/20/2025', 'Account number: ****0000', 'Amount paid: $51.18', 'Thank you.']) },
  { file: 'scan_0007.png', type: 'immunization_record', date: '2024-02-11', org: 'Example Health', bytes: scan('vaccination-card.png') },
];
export const LATER_PAPERS = {
  october: { file: 'Statement from Example Health.pdf', type: 'bill', date: '2026-10-01', org: 'Example Health', bytes: pdf(['Statement from Example Health', 'Service date: 10/01/2026', 'Statement date: 10/20/2026', 'Account number: ****0000', 'Amount due: $53.68', 'Please pay by: 11/19/2026', 'Questions? Call 555-010-0155']) },
  lab: { file: 'Statement from Example Lab.pdf', type: 'bill', date: '2026-10-28', org: 'Example Lab', bytes: pdf(['Statement from Example Lab', 'Statement date: 10/28/2026', 'Account number: ****1111', 'Balance due: $19.28', 'Due date: 11/27/2026']) },
};
