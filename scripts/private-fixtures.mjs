// Writes test/fixtures/private/: what medrec writes about the sample's private
// items when a household has marked some, and when its marks don't read
// (scripts/cases.mjs). Run it after scripts/demo-folder.mjs, and commit the
// result.
//
// - marked: the household marked items private and not.
// - unreadable: Sam's marks.json does not read.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO, only, writeCase } from './cases.mjs';

const household = JSON.parse(readFileSync(join(DEMO, 'household.json'), 'utf8'));
const person = (name) => household.people.find((p) => p.name === name);

/** The event one of a person's records or papers is in. */
function eventWith(name, item) {
  const views = join(DEMO, 'views', person(name).id);
  const file = readdirSync(views).find((f) => /^events\.[0-9a-f]{12}\.json$/.test(f));
  const event = JSON.parse(readFileSync(join(views, file), 'utf8')).events.find((e) => e.members.some((m) => (m.record ?? m.document) === item));
  if (!event) throw new Error(`no event of ${name}'s holds ${item}`);
  return event.id;
}

const afterward = only('Sam Example', 'documents', (d) => d.doc_type === 'discharge_summary', 'the after-procedure instructions');
const clinic = only('Sam Example', 'records', (r) => r.kind === 'encounter' && r.display === 'Clinic visit', 'the clinic visit');

writeCase('private/marked', [
  // A procedure marked private takes its claims and papers with it; one paper of it is marked not private.
  ['private', 'mark', eventWith('Sam Example', afterward)],
  ['private', 'unmark', afterward],
  // A visit the rules make private, marked not private. Its records stay private.
  ['private', 'unmark', eventWith('Sam Example', clinic)],
  // One record, and one paper, marked by themselves.
  ['private', 'mark', only('Robin Example', 'records', (r) => r.kind === 'allergy' && r.status === 'active', 'the current allergy')],
  ['private', 'mark', only('Robin Example', 'documents', (d) => d.doc_type === 'bill' && d.organization === 'Example Lab', 'the lab’s statement')],
]);
writeCase('private/unreadable', [], (root) => writeFileSync(join(root, 'Sam Example', 'marks.json'), '{"schema": "medrec-marks/v1", "person": '));
