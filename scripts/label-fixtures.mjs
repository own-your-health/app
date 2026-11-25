// Writes test/fixtures/labels/said/: the sample as medrec labels its providers
// from a directory, once the household has said who some of them are
// (scripts/cases.mjs). Run it after scripts/demo-folder.mjs, and commit the
// result.
//
// The directory is invented, in the form medrec keeps one in its cache. Every
// NPI in it begins with 0, which no real one does, every city is Exampleton
// and every phone is a 555-01xx number: none of it is a row of CMS's file.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO, writeCase } from './cases.mjs';

const person = (npi, last, first, taxonomy, phone) => ({ npi, last, first, credential: 'MD', city: 'EXAMPLETON', phone, taxonomy });
const place = (npi, organization, business_name, taxonomy, phone) => ({ npi, organization, business_name, city: 'EXAMPLETON', phone, taxonomy });

const PROVIDERS = [
  person('0000000014', 'PLACEHOLDER', 'CASEY', '207X00000X', '5550100123'),
  person('0000000022', 'PLACEHOLDER', 'MORGAN', '208000000X', '5550100122'),
  place('0000000030', 'EXAMPLE PEDIATRICS PLACEHOLDER LLC', 'EXAMPLE PEDIATRICS', '261QP2300X', '5550100126'),
  person('0000000055', 'SAMPLE', 'JORDAN', '207Q00000X', '5550100121'),
  place('0000000063', 'EXAMPLE HEALTH PLACEHOLDER LLC', 'EXAMPLE HEALTH PARTNERS', '261QP2300X', '5550100125'),
  place('0000000071', 'EXAMPLE LAB PLACEHOLDER LLC', 'EXAMPLE LAB', '291U00000X', '5550100127'),
  place('0000000097', 'EXAMPLE SEXUAL HEALTH PLACEHOLDER LLC', 'EXAMPLE SEXUAL HEALTH CLINIC', '261QH0100X', '5550100130'),
  person('0000000105', 'SAMPLE', 'AVERY', '207RI0200X', '5550100124'),
];

/** Puts the directory where medrec keeps one for this folder. */
function withDirectory(root, home) {
  const id = JSON.parse(readFileSync(join(DEMO, 'household.json'), 'utf8')).folder_id;
  const rows = PROVIDERS.map((p) => `${JSON.stringify(p)}\n`).join('');
  const about = { schema: 'medrec-nppes/v2', url: 'https://example.invalid/', month: '2026-11', date: '2026-11-08', bytes: 1, sha256: '', rows: PROVIDERS.length, fetched_at: '2026-11-10T12:00:00Z', wanted_sha256: '', npis: PROVIDERS.map((p) => p.npi), states: [], people: [], kept: PROVIDERS.length, kept_sha256: createHash('sha256').update(rows).digest('hex') };
  const dir = join(home, '.cache', 'medrec', 'directory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `nppes-${id}.jsonl`), `${JSON.stringify(about)}\n${rows}`);
}

const of = (name, ...printed) => ['--person', name, ...printed.flatMap((p) => ['--printed', p])];

writeCase(
  'labels/said',
  [
    // Two names of one provider, and two that are not one.
    ['labels', 'same', ...of('Robin Example', 'Example Health', 'Example Health Main Clinic')],
    ['labels', 'different', ...of('Sam Example', 'Example Health', 'Example Health Orthopedics')],
    // Who a biller with no phone on its bill is, and a label that is wrong.
    ['labels', 'set', ...of('Sam Example', 'Example Billing'), '--practice', 'Example Lab', '--phone', '555-010-0140'],
    ['labels', 'wrong', ...of('Robin Example', 'Example Lab')],
  ],
  withDirectory,
);
