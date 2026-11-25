// Builders for the sample's raw FHIR resources: what a portal, a lab, a plan
// or a pharmacy benefit would serve. Everything is invented. Nothing here is a
// field of medrec's: medrec's own release reads these streams and writes the
// records folder (scripts/demo-folder.mjs).

import { createHash } from 'node:crypto';

export const LOINC = 'http://loinc.org';
export const SNOMED = 'http://snomed.info/sct';
export const ICD10 = 'http://hl7.org/fhir/sid/icd-10-cm';
export const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
export const NDC = 'http://hl7.org/fhir/sid/ndc';
export const CVX = 'http://hl7.org/fhir/sid/cvx';
export const CPT = 'http://www.ama-assn.org/go/cpt';
export const NUBC = 'https://www.nubc.org/CodeSystem/RevenueCodes';
const NPI = 'http://hl7.org/fhir/sid/us-npi';
const UCUM = 'http://unitsofmeasure.org';
const HL7 = 'http://terminology.hl7.org/CodeSystem';
const CARIN = 'http://hl7.org/fhir/us/carin-bb/CodeSystem';

/** A resource id, the same on every run. */
export const rid = (type, what) => `${type.toLowerCase()}-${createHash('md5').update(`${type} ${what}`).digest('hex').slice(0, 8)}`;

/** One resource, served as last changed on `updated`. */
export const resource = (type, what, updated, body) => ({ resourceType: type, id: rid(type, what), meta: { lastUpdated: `${updated}T08:00:00Z` }, ...body });

const coded = (system, code, text, display) => ({ coding: [{ system, code, ...(display ? { display } : {}) }], text });
/** Someone or somewhere, by name and, where a source gives one, its NPI. */
export const who = (display, npi) => ({ display, ...(npi ? { identifier: { system: NPI, value: npi } } : {}) });

const INTERPRETATION = { High: 'H', Low: 'L', Normal: 'N' };

/** A lab result: a number with its range, and the lab's flag when it gives one. */
export function result(what, date, [code, text, value, unit, range, flag], { category = 'Laboratory', issued, updated = date, status = 'final' } = {}) {
  return resource('Observation', `${what} ${code} ${date}`, updated, {
    status,
    category: [{ coding: [{ system: `${HL7}/observation-category`, code: category === 'Laboratory' ? 'laboratory' : 'vital-signs', display: category }] }],
    code: coded(LOINC, code, text),
    effectiveDateTime: date,
    ...(issued ? { issued } : {}),
    valueQuantity: { value, unit, system: UCUM, code: unit },
    ...(flag ? { interpretation: [{ coding: [{ system: `${HL7}/v3-ObservationInterpretation`, code: INTERPRETATION[flag], display: flag }] }] } : {}),
    ...(range ? { referenceRange: [{ text: range }] } : {}),
  });
}

/** A lab result whose number came as text, with its range as numbers and no flag, as some labs send one. */
export function textResult(what, date, [code, text, value, unit, low, high]) {
  const bound = (n) => ({ value: n, unit, system: UCUM, code: unit });
  return resource('Observation', `${what} ${code} ${date}`, date, {
    status: 'final',
    category: [{ coding: [{ system: `${HL7}/observation-category`, code: 'laboratory', display: 'Laboratory' }] }],
    code: coded(LOINC, code, text),
    effectiveDateTime: date,
    valueString: String(value),
    referenceRange: [{ low: bound(low), high: bound(high) }],
  });
}

/** A result that is words, not a number. */
export function wordResult(what, date, [code, text, value, normal]) {
  return resource('Observation', `${what} ${code} ${date}`, date, {
    status: 'final',
    category: [{ coding: [{ system: `${HL7}/observation-category`, code: 'laboratory', display: 'Laboratory' }] }],
    code: coded(LOINC, code, text),
    effectiveDateTime: date,
    valueCodeableConcept: { text: value },
    referenceRange: [{ text: normal }],
  });
}

const CLASS = { ambulatory: 'AMB', 'inpatient encounter': 'IMP', virtual: 'VR' };

export function encounter(what, { start, end, kind = 'ambulatory', type, cpt, place, clinician, npi, reason, updated = start.slice(0, 10) }) {
  return resource('Encounter', what, updated, {
    status: 'finished',
    class: { system: `${HL7}/v3-ActCode`, code: CLASS[kind], display: kind },
    type: [cpt ? { coding: [{ system: CPT, code: cpt, display: type }], text: type } : { text: type }],
    period: { start, ...(end ? { end } : {}) },
    participant: [{ individual: who(clinician, npi) }],
    location: [{ location: { display: place } }],
    ...(reason ? { reasonCode: [{ text: reason }] } : {}),
  });
}

export function condition(what, { since, until, code, text, category = 'Problem list item', updated = since }) {
  return resource('Condition', what, updated, {
    clinicalStatus: { coding: [{ system: `${HL7}/condition-clinical`, code: until ? 'resolved' : 'active' }] },
    verificationStatus: { coding: [{ system: `${HL7}/condition-ver-status`, code: 'confirmed' }] },
    category: [{ text: category }],
    code: coded(ICD10, code, text),
    onsetDateTime: since,
    ...(until ? { abatementDateTime: until } : {}),
  });
}

const medicine = ({ rxnorm, ndc, text }) => ({ ...(rxnorm || ndc ? { coding: [...(rxnorm ? [{ system: RXNORM, code: rxnorm }] : []), ...(ndc ? [{ system: NDC, code: ndc }] : [])] } : {}), text });

export function order(what, { date, med, dosage, prescriber, npi, status = 'active', updated = date }) {
  return resource('MedicationRequest', what, updated, {
    status,
    intent: 'order',
    medicationCodeableConcept: medicine(med),
    authoredOn: date,
    ...(prescriber ? { requester: who(prescriber, npi) } : {}),
    dosageInstruction: [{ text: dosage }],
  });
}

export function taking(what, { date, med, dosage, status }) {
  return resource('MedicationStatement', what, date, { status, medicationCodeableConcept: medicine(med), effectiveDateTime: date, dosage: [{ text: dosage }] });
}

/** A pharmacy's fill; `of` is the prescription it fills. */
export function fill(what, { date, med, dosage, amount, unit, days, pharmacy, of, kind }) {
  return resource('MedicationDispense', what, date, {
    status: 'completed',
    ...(kind ? { type: { text: kind } } : {}),
    medicationCodeableConcept: medicine(med),
    performer: [{ actor: { display: pharmacy } }],
    ...(of ? { authorizingPrescription: [{ reference: `MedicationRequest/${of.id}` }] } : {}),
    quantity: { value: amount, unit },
    daysSupply: { value: days, unit: 'days' },
    whenHandedOver: date,
    dosageInstruction: [{ text: dosage }],
  });
}

export function allergy(what, { since, code, text, criticality, reactions, active = true }) {
  return resource('AllergyIntolerance', what, since, {
    clinicalStatus: { coding: [{ system: `${HL7}/allergyintolerance-clinical`, code: active ? 'active' : 'inactive' }] },
    code: coded(SNOMED, code, text),
    onsetDateTime: since,
    criticality,
    reaction: [{ manifestation: reactions.map((text) => ({ text })) }],
  });
}

export function vaccine(what, { date, cvx, text, performer, site, route, lot, declined }) {
  return resource('Immunization', `${what} ${cvx} ${date}`, date, {
    status: declined ? 'not-done' : 'completed',
    ...(declined ? { statusReason: { text: declined } } : {}),
    vaccineCode: coded(CVX, cvx, text),
    occurrenceDateTime: date,
    ...(lot ? { lotNumber: lot } : {}),
    ...(site ? { site: { text: site } } : {}),
    ...(route ? { route: { text: route } } : {}),
    ...(performer ? { performer: [{ actor: { display: performer } }] } : {}),
  });
}

/** Someone's coverage under a plan, by the name the plan's card gives it. */
export function coverage(what, { name, start, end, payer, plan, group, relationship = 'self', status = 'active', updated = start }) {
  const part = (code, value, name) => ({ type: { coding: [{ system: `${HL7}/coverage-class`, code }] }, value, ...(name ? { name } : {}) });
  return resource('Coverage', what, updated, {
    status,
    type: coded(`${HL7}/v3-ActCode`, 'HIP', name),
    relationship: { coding: [{ system: `${HL7}/subscriber-relationship`, code: relationship }] },
    period: { start, ...(end ? { end } : {}) },
    payor: [{ display: payer }],
    class: [part('group', group), part('plan', plan, plan)],
  });
}

// ---- Claims ----

const usd = (cents) => ({ value: cents / 100, currency: 'USD' });
const cents = (x) => Math.round(Number(x) * 100);
const ADJUDICATION = {
  submitted: [`${HL7}/adjudication`, 'submitted', 'Submitted Amount'],
  eligible: [`${HL7}/adjudication`, 'eligible', 'Eligible Amount'],
  benefit: [`${HL7}/adjudication`, 'benefit', 'Benefit Amount'],
  deductible: [`${HL7}/adjudication`, 'deductible', 'Deductible'],
  copay: [`${HL7}/adjudication`, 'copay', 'Copay'],
  coinsurance: [`${CARIN}/C4BBAdjudication`, 'coinsurance', 'Coinsurance'],
  noncovered: [`${CARIN}/C4BBAdjudication`, 'noncovered', 'Not covered'],
  owed: [`${CARIN}/C4BBAdjudication`, 'memberliability', 'Member liability'],
  discount: [`${CARIN}/C4BBAdjudication`, 'discount', 'Discount'],
};
const category = (name) => {
  const [system, code, display] = ADJUDICATION[name];
  return { coding: [{ system, code, display }] };
};

/**
 * A line of a claim: what was done, what it was billed at, and the amounts the
 * plan gives in dollars (deductible, copay, coinsurance, paid). Allowed is what
 * the plan paid plus the member's share. `revenue` is a hospital's code for
 * the line, [code, what it is], and is all a line without a code of its own
 * has. `leftOut` is the plan's note on a line its
 * totals leave out: billed, not covered, not owed.
 */
export function line(code, text, billed, { system = CPT, deductible = 0, copay = 0, coinsurance = 0, paid = 0, revenue, leftOut, quantity = 1 } = {}) {
  const share = cents(deductible) + cents(copay) + cents(coinsurance);
  return { code, text, system, revenue, leftOut, quantity, billed: cents(billed), eligible: share + cents(paid), benefit: cents(paid), deductible: cents(deductible), copay: cents(copay), coinsurance: cents(coinsurance), owed: share };
}

/**
 * A plan's explanation of benefits. `prints` are the amounts its lines and
 * totals give, in order. A line left out of the totals is the billed line and
 * the plan's note on it, marked as this project's own CLI marks one
 * (medrec's data contract: an adjudication `not-counted` in its code system).
 */
export function claim(what, { date, end = date, type = 'professional', provider, npi, facility, insurer, lines, prints = ['submitted', 'eligible', 'benefit', 'deductible', 'copay', 'coinsurance', 'owed'], period, diagnoses = [], balances, papers = [], info = [], cli, updated = date }) {
  const counted = lines.filter((l) => !l.leftOut);
  const sum = (name) => counted.reduce((t, l) => t + amount(l, name), 0);
  const amount = (l, name) => (name === 'submitted' ? l.billed : name === 'discount' ? l.billed - l.eligible : l[name]);
  const notes = lines.filter((l) => l.leftOut);
  const typeName = type[0].toUpperCase() + type.slice(1);
  return resource('ExplanationOfBenefit', what, updated, {
    status: 'active',
    type: { coding: [{ system: `${HL7}/claim-type`, code: type, display: typeName }] },
    use: 'claim',
    billablePeriod: { start: date, end },
    ...(period ? { benefitPeriod: period } : {}),
    created: date,
    insurer: { display: insurer },
    provider: who(provider, npi),
    ...(facility ? { facility: { display: facility } } : {}),
    outcome: 'complete',
    ...(diagnoses.length ? { diagnosis: diagnoses.map(([code, display], i) => ({ sequence: i + 1, diagnosisCodeableConcept: { coding: [{ system: ICD10, code, ...(display ? { display } : {}) }] } })) } : {}),
    ...(papers.length || info.length ? { supportingInfo: [...papers.map((p, i) => ({ sequence: i + 1, valueReference: { reference: `DocumentReference/${p.id}` } })), ...info.map((x, i) => ({ sequence: papers.length + i + 1, ...x }))] } : {}),
    ...(notes.length ? { processNote: notes.map((l, i) => ({ number: i + 1, text: l.leftOut })) } : {}),
    item: lines.map((l, i) => ({
      sequence: i + 1,
      ...(l.revenue ? { revenue: { coding: [{ system: NUBC, code: l.revenue[0], display: l.revenue[1] }] } } : {}),
      ...(l.code ? { productOrService: { coding: [{ system: l.system, code: l.code, display: l.text }] } } : {}),
      servicedDate: date,
      quantity: { value: l.quantity },
      net: usd(l.billed),
      ...(l.leftOut
        ? {
            noteNumber: [notes.indexOf(l) + 1],
            adjudication: [
              { category: category('submitted'), amount: usd(l.billed) },
              { category: category('noncovered'), amount: usd(l.billed) },
              { category: { coding: [{ system: `https://github.com/own-your-health/${cli}/fhir/adjudication`, code: 'not-counted' }] } },
            ],
          }
        : { adjudication: prints.map((name) => ({ category: category(name), amount: usd(amount(l, name)) })) }),
    })),
    total: prints.map((name) => ({ category: category(name), amount: usd(sum(name)) })),
    payment: { amount: usd(sum('benefit')) },
    ...(balances ? { benefitBalance: balances } : {}),
  });
}

/** What a claim prints of the year so far: the deductible and the out-of-pocket limit, as [limit, used]. */
export function balance(deductible, outOfPocket) {
  const of = (text, [allowed, used]) => ({ type: { text }, allowedMoney: usd(cents(allowed)), usedMoney: usd(cents(used)) });
  return [
    {
      category: { text: 'Health Benefit Plan Coverage' },
      network: { coding: [{ system: `${HL7}/benefit-network`, code: 'in' }] },
      unit: { coding: [{ system: `${HL7}/benefit-unit`, code: 'individual' }] },
      term: { coding: [{ system: `${HL7}/benefit-term`, code: 'annual' }] },
      financial: [of('Deductible', deductible), of('Out-of-pocket limit', outOfPocket)],
    },
  ];
}

/** What a pharmacy claim says of its fill (CARIN supportingInfo). */
export function fillInfo({ days, refill, refills, brand }) {
  const of = (code, value) => ({ category: { coding: [{ system: `${CARIN}/C4BBSupportingInfoType`, code }] }, ...value });
  return [
    of('dayssupply', { valueQuantity: { value: days } }),
    of('refillnum', { valueQuantity: { value: refill } }),
    of('refillsauthorized', { valueQuantity: { value: refills } }),
    of('brandgenericindicator', { code: { text: brand } }),
  ];
}

// ---- Papers a source serves ----

const PAPER_LOINC = { visit_summary: '34133-9', lab_report: '11502-2', immunization_record: '11369-6', discharge_summary: '18842-5' };

/** A paper: the resource that names it, and its bytes. */
export function paper(what, { date, kind, title, media, bytes, updated = date }) {
  const binary = resource('Binary', what, updated, { contentType: media, data: bytes.toString('base64') });
  const reference = resource('DocumentReference', what, updated, {
    status: 'current',
    type: PAPER_LOINC[kind] ? coded(LOINC, PAPER_LOINC[kind], title) : { coding: [{ system: 'urn:pk-med:doc-type', code: kind }], text: title },
    date: `${date}T12:00:00Z`,
    description: title,
    content: [{ attachment: { contentType: media, url: `Binary/${binary.id}`, title } }],
  });
  return [reference, binary];
}
