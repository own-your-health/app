// Invented providers for medrec to load from, and what a person at the Mac
// does with their records and papers. Each provider's CLI is a stand-in
// (sample/stand-in.sh) that answers from files put here: what a provider
// serves is raw FHIR, and medrec writes every record, paper and view itself.

import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { iso, scratchMachine } from './medrec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const put = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
};

/** A scratch machine whose medrec finds `sources`' CLIs and nothing else: no other provider, and no text reader but a stand-in for pdftotext. It is the sample's release, or `release`. */
export function machineWith(people, sources, release) {
  const { home, bin, root, medrec: at } = scratchMachine(undefined, { alone: true, ...(release ? { release } : {}) });
  const served = join(home, 'served');
  for (const tool of ['cat', 'basename', 'dirname']) symlinkSync([`/usr/bin/${tool}`, `/bin/${tool}`].find(existsSync), join(bin, tool));
  put(join(bin, 'pdftotext'), `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, 'sample', 'pdftotext.mjs')}" "$@"\n`);
  chmodSync(join(bin, 'pdftotext'), 0o755);

  /** A login's state, as the provider's own `auth status` gives it. */
  const signedIn = (s, state) => put(join(served, s.cli, `auth-${s.login}.json`), JSON.stringify({ schema: 'auth-status/v1', required: true, authenticated: true, ...state }));

  for (const cli of new Set(Object.values(sources).map((s) => s.cli))) {
    const mine = Object.values(sources).filter((s) => s.cli === cli);
    symlinkSync(join(HERE, 'sample', 'stand-in.sh'), join(bin, cli));
    put(
      join(served, cli, 'info.json'),
      JSON.stringify({
        schema: 'cli-info/v1',
        name: cli,
        version: mine[0].version,
        repository: `https://example.org/${cli}`,
        auth: { required: true, method: mine[0].method === 'portal' ? 'session' : 'oauth', login_hint: `${cli} auth login --profile <NAME>` },
        capabilities: ['login-profiles'],
        profiles: ['health-records/v1'],
      }),
    );
    put(join(served, cli, 'profiles.json'), JSON.stringify({ schema: 'profile-list/v1', profiles: [...new Set(mine.map((s) => s.login))].sort().map((name) => ({ name })) }));
    for (const s of mine) signedIn(s, { session_valid: true });
  }

  /** What a source's export serves from now on: its resources, pulled `before` the anchor. */
  const serves = (s, before, resources, skipped = []) => {
    const person = people[s.person];
    const [given, family] = person.name.split(' ');
    const patient = { resourceType: 'Patient', id: s.patient, meta: { lastUpdated: '2025-01-02T08:00:00Z' }, name: [{ family, given: [given] }], birthDate: person.born };
    const all = [patient, ...resources];
    const counts = {};
    for (const r of all) counts[r.resourceType] = (counts[r.resourceType] ?? 0) + 1;
    const header = {
      schema: 'records-stream/v1',
      source: { cli: s.cli, version: s.version },
      organization: s.org,
      patient: { id: s.patient, organization: s.org.id, label: person.name, relationship: s.relationship },
      ...(s.method ? { method: s.method } : {}),
      pulled_at: iso(before),
      fhir_version: '4.0.1',
    };
    const end = { schema: 'records-stream-end/v1', complete: true, counts, skipped, finished_at: iso(before) };
    put(join(served, s.cli, `${s.patient}.ndjson`), [header, ...all, end].map((line) => `${JSON.stringify(line)}\n`).join(''));
  };

  return {
    home,
    root,
    at,
    signedIn,
    serves,
    /** From now on a source's export fails. */
    fails: (s, exit, says) => {
      put(join(served, s.cli, `${s.patient}.exit`), String(exit));
      put(join(served, s.cli, `${s.patient}.failure`), says);
    },
    imports: (s, before, resources, skipped) => {
      serves(s, before, resources, skipped);
      at(before, 'import', '--from', s.cli, '--from-profile', s.login, '--patient', s.patient, '--person', people[s.person].name);
    },
    files: (person, before, papers) => {
      for (const p of papers) {
        const path = join(home, 'papers', person, p.file);
        put(path, p.bytes);
        at(before, 'intake', '--person', people[person].name, '--type', p.type, '--date', p.date, '--org', p.org, path);
      }
    },
    /** The id medrec gave a source. */
    idOf: (s) => {
      const household = JSON.parse(readFileSync(join(root, 'household.json'), 'utf8'));
      const person = household.people.find((p) => p.name === people[s.person].name).id;
      return household.sources.find((x) => x.cli === s.cli && x.person === person && x.patient_id === s.patient).id;
    },
  };
}
