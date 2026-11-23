// Where a person can read more about a test, medicine, condition, allergy,
// procedure or vaccine: a link they tap, never a request the app makes (its
// connect-src reaches only Google). MedlinePlus Connect takes a code in one
// of six systems and opens the page for it; a vaccine opens CDC's Vaccine
// Information Statement for its CVX code. A record without such a code
// searches MedlinePlus by its name, which the page shows beside the link.
// The link carries a code, a name from this app's own table, or that one
// name, never a value, a date, a person or an id. The record's name is the
// only text from the records that can leave, so it goes only when it reads as
// the name of a thing (`searchable`) and the page says the exact words.

import { labTest } from './labtests';
import type { MedRecord } from './types';

export interface LearnMore {
  url: string;
  /** Who runs the page: said beside the link, since it leaves the app. */
  site: 'MedlinePlus' | 'CDC';
  /** What the link carries: a vaccine's code, a code, a code with this app's name for it, or the words searched for. */
  carries: { code: true; named: boolean; vaccine?: true } | { search: string };
}

const MAX_SEARCH = 60;

/**
 * Whether a record's name can go to a search as it is: short, one line, one
 * phrase, and nothing like a date, a long number, an address or a link. A
 * clinic or a person may have written it, so anything else stays home.
 */
export function searchable(name: string): boolean {
  const t = name.trim();
  if (!t || t.length > MAX_SEARCH || /[\n\r]/.test(t)) return false;
  if (t.split(/\s+/).length > 8) return false;
  // A second sentence, a date, five digits in a row, an email or a link.
  if (/[.!?;:]\s|\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|\d{5,}|@|https?:|www\./i.test(t)) return false;
  return true;
}

/** MedlinePlus Connect's page for a code (medlineplus.gov/medlineplus-connect/web-application/). */
const CONNECT = 'https://connect.medlineplus.gov/application';
const SEARCH = 'https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta';

/** The code systems Connect accepts, by their FHIR URI, with the OID it takes. */
const CONNECT_SYSTEMS: Record<string, string> = {
  'http://loinc.org': '2.16.840.1.113883.6.1',
  'http://www.nlm.nih.gov/research/umls/rxnorm': '2.16.840.1.113883.6.88',
  'http://hl7.org/fhir/sid/ndc': '2.16.840.1.113883.6.69',
  'http://hl7.org/fhir/sid/icd-10-cm': '2.16.840.1.113883.6.90',
  'http://hl7.org/fhir/sid/icd-9-cm': '2.16.840.1.113883.6.103',
  'http://snomed.info/sct': '2.16.840.1.113883.6.96',
  'http://www.ama-assn.org/go/cpt': '2.16.840.1.113883.6.12',
};
const CONNECT_OIDS = new Set(Object.values(CONNECT_SYSTEMS));

/** The OID Connect takes for a code system, from its FHIR URI or a `urn:oid:` form. */
export function connectOid(system: string | undefined): string | undefined {
  const s = system?.trim().toLowerCase().replace(/\/+$/, '');
  if (!s) return undefined;
  if (Object.hasOwn(CONNECT_SYSTEMS, s)) return CONNECT_SYSTEMS[s];
  const oid = s.startsWith('urn:oid:') ? s.slice(8) : undefined;
  return oid && CONNECT_OIDS.has(oid) ? oid : undefined;
}

const CVX = 'http://hl7.org/fhir/sid/cvx';
const VIS = 'https://www.cdc.gov/vaccines/hcp/current-vis/';

/**
 * CDC's current Vaccine Information Statement page for a CVX code, from CDC's
 * CVX-to-VIS mapping and VIS URL table. A combination vaccine opens the
 * statement for several childhood vaccines; a flu shot whose own statement
 * is retired opens the current one for flu shots. A code with no current
 * statement (the older COVID-19 vaccines) is not here, and searches
 * MedlinePlus instead.
 */
export const VIS_BY_CVX: Record<string, string> = {
  '03': 'mmr',
  '08': 'hepatitis-b',
  '10': 'polio',
  '20': 'dtap',
  '21': 'varicella',
  '33': 'pneumococcal-polysaccharide',
  '43': 'hepatitis-b',
  '48': 'hib',
  '52': 'hepatitis-a',
  '83': 'hepatitis-a',
  '110': 'childs-first',
  '111': 'influenza-live-intranasal',
  '113': 'td',
  '114': 'meningococcal-acwy',
  '115': 'tdap',
  '119': 'rotavirus',
  '120': 'childs-first',
  '133': 'pneumococcal-conjugate',
  '135': 'influenza-inactivated',
  '136': 'meningococcal-acwy',
  '140': 'influenza-inactivated',
  '141': 'influenza-inactivated',
  '150': 'influenza-inactivated',
  '153': 'influenza-inactivated',
  '155': 'influenza-inactivated',
  '158': 'influenza-inactivated',
  '162': 'meningococcal-b',
  '163': 'meningococcal-b',
  '165': 'hpv',
  '168': 'influenza-inactivated',
  '171': 'influenza-inactivated',
  '185': 'influenza-inactivated',
  '186': 'influenza-inactivated',
  '187': 'shingles',
  '189': 'hepatitis-b',
  '197': 'influenza-inactivated',
  '203': 'meningococcal-acwy',
  '205': 'influenza-inactivated',
  '215': 'pneumococcal-conjugate',
  '216': 'pneumococcal-conjugate',
  '303': 'rsv',
  '305': 'rsv',
  '306': 'rsv-iis',
  '307': 'rsv-iis',
  '309': 'covid-19',
  '312': 'covid-19',
  '320': 'influenza-inactivated',
  '326': 'rsv',
  '327': 'pneumococcal-conjugate',
  '333': 'influenza-live-intranasal',
  '334': 'covid-19',
};

/** Where to read about a record, or undefined for a kind with nothing to read (a visit, a claim). */
export function learnMore(r: Pick<MedRecord, 'kind' | 'code' | 'display'>, name: string): LearnMore | undefined {
  if (!['result', 'medication', 'condition', 'allergy', 'immunization', 'procedure'].includes(r.kind)) return undefined;
  const code = r.code?.code?.trim();
  const system = r.code?.system?.trim().toLowerCase().replace(/\/+$/, '');
  if (r.kind === 'immunization' && code && system === CVX) {
    const slug = Object.hasOwn(VIS_BY_CVX, code.padStart(2, '0')) ? VIS_BY_CVX[code.padStart(2, '0')] : undefined;
    if (slug) return { url: `${VIS}${slug}.html`, site: 'CDC', carries: { code: true, named: false, vaccine: true } };
  }
  const oid = connectOid(r.code?.system);
  if (oid && code) {
    const q = new URLSearchParams({ 'mainSearchCriteria.v.cs': oid, 'mainSearchCriteria.v.c': code });
    // Only this app's own name for the code: the source's display text may be a clinic's or a person's words.
    const dn = labTest(r.code)?.name;
    if (dn) q.set('mainSearchCriteria.v.dn', dn);
    q.set('informationRecipient.languageCode.c', 'en');
    return { url: `${CONNECT}?${q.toString()}`, site: 'MedlinePlus', carries: { code: true, named: Boolean(dn) } };
  }
  const term = name.trim().replace(/\s+/g, ' ');
  if (!searchable(term)) return undefined;
  return { url: `${SEARCH}?${new URLSearchParams({ 'v:project': 'medlineplus', query: term }).toString()}`, site: 'MedlinePlus', carries: { search: term } };
}
