// The sample's household: four invented people, and where each one's records
// come from.

export const PEOPLE = {
  robin: { name: 'Robin Example', born: '1980-01-01', args: ['--adult', '--alias', 'Robin Q Example', '--huishouden-health-person', 'hh-demo-robin'] },
  sam: { name: 'Sam Example', born: '1980-07-01', args: ['--adult', '--huishouden-health-person', 'hh-demo-sam'] },
  alex: { name: 'Alex Example', born: '2018-01-01', args: ['--child', '--guardian', 'Robin Example', '--guardian', 'Sam Example', '--huishouden-health-person', 'hh-demo-alex'] },
  drew: { name: 'Drew Example', born: '2022-12-14', args: ['--child', '--guardian', 'Robin Example', '--guardian', 'Sam Example', '--huishouden-health-person', 'hh-demo-drew'] },
};

const HEALTH = { id: 'example-health', name: 'Example Health', fhir_base: 'https://fhir.example.org/r4', vendor: 'epic' };
const PEDIATRICS = { id: 'example-pediatrics', name: 'Example Pediatrics', fhir_base: 'https://api.example.net/fhir/r4', vendor: 'athena' };
const CARE_PLAN = { id: 'example-care-plan', name: 'Example Care Plan', fhir_base: 'https://fhir.example.com/r4', vendor: 'plan' };
const site = (id, name) => ({ id, name, fhir_base: `https://${id}.example`, vendor: 'site' });

/** Each source: the CLI that reads it, whose it is there, and how. A member site is read as one ("portal"). */
export const SOURCES = {
  robinChart: { cli: 'mychart', version: '0.7.1', person: 'robin', login: 'robin', org: HEALTH, patient: 'pat-1c5e70', relationship: 'self' },
  robinPlan: { cli: 'uhc', version: '0.3.6', person: 'robin', login: 'robin', org: site('example-health-plan', 'Example Health Plan'), patient: 'pat-82d4b9', relationship: 'self', method: 'portal' },
  robinBlood: { cli: 'oneblood', version: '0.1.1', person: 'robin', login: 'robin', org: site('example-blood-center', 'Example Blood Center'), patient: 'pat-0f93a6', relationship: 'self', method: 'portal' },
  robinRx: { cli: 'caremark', version: '1.2.0', person: 'robin', login: 'robin', org: site('example-pharmacy-benefits', 'Example Pharmacy Benefits'), patient: 'pat-5ab217', relationship: 'self', method: 'portal' },
  samChart: { cli: 'mychart', version: '0.7.1', person: 'sam', login: 'sam', org: HEALTH, patient: 'pat-e47d08', relationship: 'self' },
  samLab: { cli: 'labcorp', version: '0.2.1', person: 'sam', login: 'sam', org: site('example-lab', 'Example Lab'), patient: 'pat-36c1fa', relationship: 'self', method: 'portal' },
  samBilling: { cli: 'peryourhealth', version: '0.1.4', person: 'sam', login: 'sam', org: site('example-billing', 'Example Billing'), patient: 'pat-9b80d2', relationship: 'self', method: 'portal' },
  samPlan: { cli: 'kp', version: '0.4.0', person: 'sam', login: 'sam', org: CARE_PLAN, patient: 'pat-71f4e3', relationship: 'self' },
  alexPeds: { cli: 'athena', version: '0.6.1', person: 'alex', login: 'alex', org: PEDIATRICS, patient: 'pat-c20a95', relationship: 'child' },
  alexPlan: { cli: 'kp', version: '0.4.0', person: 'alex', login: 'sam', org: CARE_PLAN, patient: 'pat-71f4e4', relationship: 'child' },
  drewPeds: { cli: 'athena', version: '0.6.1', person: 'drew', login: 'drew', org: PEDIATRICS, patient: 'pat-d6583c', relationship: 'child' },
};
