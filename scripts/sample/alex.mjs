// Alex's records: a child at a pediatric practice, on Sam's plan. Invented.

import { claim, condition, coverage, encounter, line, order, paper, result, vaccine } from './fhir.mjs';
import { html, pdf, scan } from './papers.mjs';
import { careBalance, julyYear } from './sam.mjs';

const DOCTOR = { clinician: 'Dr. Morgan Placeholder', npi: '0000000022', place: 'Example Pediatrics' };
const PRACTICE = ['Example Pediatrics', '0000000030'];

// ---- The practice ----

const weights = [['2024-01-08', 20.4], ['2025-01-13', 22.6], ['2026-01-12', 25.1]].map(([date, kg]) => result('alex peds', date, ['29463-7', 'Weight', kg, 'kg'], { category: 'Vital signs' }));
const SHOTS = [
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
];
const shots = SHOTS.map(([date, cvx, text]) => vaccine('alex', { date, cvx, text, performer: 'Example Pediatrics', route: 'Intramuscular' }));
const history = [
  ...weights,
  ...shots,
  ...[['2024-01-08', 'Well child visit, 6 years'], ['2025-01-13', 'Well child visit, 7 years'], ['2026-01-12', 'Well child visit, 8 years']].map(([date, type]) => encounter(`alex visit ${date}`, { ...DOCTOR, start: `${date}T13:00:00Z`, cpt: '99393', type })),
  ...paper('alex immunizations', { date: '2025-10-20', kind: 'immunization_record', title: 'Immunization history', media: 'application/pdf', bytes: pdf(['Immunization history', 'Alex Example', 'DTaP, IPV, MMR 01/10/2022.', 'Influenza 10/20/2025.']) }),
];
const sick = [
  encounter('alex visit 2026-11-20', { ...DOCTOR, start: '2026-11-20T16:00:00Z', type: 'Sick visit', reason: 'Ear pain' }),
  condition('alex ear', { since: '2026-11-20', code: 'H66.90', text: 'Ear infection', category: 'Encounter diagnosis' }),
  order('alex amoxicillin', { date: '2026-11-20', med: { rxnorm: '308189', text: 'Amoxicillin 400 mg/5 mL suspension' }, dosage: 'Take 7 mL by mouth twice a day for 10 days', prescriber: DOCTOR.clinician, npi: DOCTOR.npi }),
  // This practice's portal gives its visit summaries as web pages.
  ...paper('alex care instructions', {
    date: '2026-11-20',
    kind: 'visit_summary',
    title: 'Care instructions',
    media: 'text/html',
    bytes: html('Care instructions', [['p', 'Alex Example, seen 11/20/2026 at Example Pediatrics.'], ['h2', 'Ear pain'], ['ul', '<li>Give the antibiotic for all ten days.</li><li>Call if there is fever after three days.</li>']]),
  }),
];
export const PEDS = [history, [...history, ...sick]];

// ---- Sam's plan, with Alex on it ----

const plan = (date, more) => claim(`alex plan ${date}`, { date, provider: PRACTICE[0], npi: PRACTICE[1], insurer: 'Example Care Plan', period: julyYear(date), cli: 'kp-cli', ...more });
const year = [
  coverage('alex plan', { name: 'Example Care Plan HMO (dependent)', start: '2025-07-01', payer: 'Example Care Plan', plan: 'HMO Family', group: 'GRP-111111', relationship: 'child' }),
  plan('2025-10-20', { diagnoses: [['Z23', 'Encounter for immunization']], lines: [line('90686', 'Flu vaccine', '55.00', { paid: '32.00' }), line('90471', 'Vaccine given', '28.00', { paid: '18.00' })] }),
];
const sickVisit = plan('2026-11-20', {
  diagnoses: [['H66.90', 'Otitis media, unspecified, unspecified ear']],
  lines: [line('99214', 'Office visit', '215.00', { copay: '30.00', paid: '104.50' }), line('92567', 'Eardrum movement test', '52.00', { paid: '18.60' })],
  balances: careBalance('0.00', '30.00'),
});
export const PLAN = [year, [...year, sickVisit]];

// ---- Papers kept by hand ----

// A note from the sick visit: it carries only the practice's name.
export const LATER_PAPERS = {
  school: { file: 'School note.jpg', type: 'letter', date: '2026-11-20', org: 'Example Pediatrics', bytes: scan('school-note.jpg') },
};
