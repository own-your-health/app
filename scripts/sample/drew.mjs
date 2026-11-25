// Drew's records: a child who turns four soon after the sample's day, at the
// same practice as Alex. The vaccines follow the published childhood schedule
// up to the third birthday, so the next doses are the ones it gives at four.
// Invented.

import { encounter, paper, result, vaccine } from './fhir.mjs';
import { ccda, pdf } from './papers.mjs';

const DOCTOR = { clinician: 'Dr. Morgan Placeholder', npi: '0000000022', place: 'Example Pediatrics' };
const measured = (date, code, text, value, unit) => result('drew peds', date, [code, text, value, unit], { category: 'Vital signs' });

const SHOTS = [
  ...['2023-02-14', '2023-04-18', '2023-06-20'].flatMap((date) => [
    [date, '146', 'DTaP-IPV-Hib-HepB', 'Intramuscular'],
    [date, '215', 'Pneumococcal conjugate PCV 15', 'Intramuscular'],
    [date, '116', 'Rotavirus, pentavalent', 'Oral'],
  ]),
  ['2023-10-10', '140', 'Influenza, seasonal, preservative free', 'Intramuscular'],
  ['2023-11-14', '140', 'Influenza, seasonal, preservative free', 'Intramuscular'],
  ['2023-12-19', '03', 'MMR', 'Subcutaneous'],
  ['2023-12-19', '21', 'Varicella', 'Subcutaneous'],
  ['2023-12-19', '83', 'Hep A, ped/adol, 2 dose', 'Intramuscular'],
  ['2023-12-19', '215', 'Pneumococcal conjugate PCV 15', 'Intramuscular'],
  ['2024-03-19', '20', 'DTaP', 'Intramuscular'],
  ['2024-03-19', '48', 'Hib (PRP-T)', 'Intramuscular'],
  ['2024-06-25', '83', 'Hep A, ped/adol, 2 dose', 'Intramuscular'],
  ['2024-10-08', '140', 'Influenza, seasonal, preservative free', 'Intramuscular'],
  ['2025-10-07', '140', 'Influenza, seasonal, preservative free', 'Intramuscular'],
  ['2026-10-06', '140', 'Influenza, seasonal, preservative free', 'Intramuscular'],
];

export const PEDS = [
  [
    ...SHOTS.map(([date, cvx, text, route]) => vaccine('drew', { date, cvx, text, route, performer: 'Example Pediatrics' })),
    encounter('drew visit 2024-12-17', { ...DOCTOR, start: '2024-12-17T15:00:00Z', cpt: '99392', type: 'Well child visit, 2 years' }),
    measured('2024-12-17', '29463-7', 'Weight', 12.4, 'kg'),
    measured('2024-12-17', '8302-2', 'Height', 86.5, 'cm'),
    result('drew peds', '2024-12-17', ['5671-3', 'Lead, blood', 1.1, 'ug/dL', '<3.5 ug/dL', 'Normal']),
    encounter('drew visit 2025-12-16', { ...DOCTOR, start: '2025-12-16T15:00:00Z', cpt: '99392', type: 'Well child visit, 3 years' }),
    measured('2025-12-16', '29463-7', 'Weight', 14.6, 'kg'),
    measured('2025-12-16', '8302-2', 'Height', 95.8, 'cm'),
    ...paper('drew summary 2025-12-16', {
      date: '2025-12-16',
      kind: 'visit_summary',
      title: 'Visit summary',
      media: 'application/xml',
      bytes: ccda({
        title: 'Visit summary',
        code: '34133-9',
        person: 'Drew Example',
        born: '2022-12-14',
        on: '2025-12-16',
        from: 'Example Pediatrics',
        sections: [['Visit', ['Well child visit, 3 years, 12/16/2025', 'Dr. Morgan Placeholder']], ['Measurements', ['Weight 14.6 kg', 'Height 95.8 cm']], ['Plan', ['Next visit at 4 years, with the vaccines given at that age']]],
      }),
    }),
    ...paper('drew preschool form', { date: '2025-12-16', kind: 'letter', title: 'Preschool health form', media: 'application/pdf', bytes: pdf(['Preschool health form', 'Drew Example, born 12/14/2022', 'Seen 12/16/2025 at Example Pediatrics.', 'May take part in all activities.']) }),
  ],
];
