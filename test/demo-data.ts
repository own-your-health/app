import { parseHousehold, parseIndex, parseStatus } from '../src/model/parse';
import type { Household, PersonIndex, RefreshStatus, Source } from '../src/model/types';
import { useMedrecEvents } from '../src/next/load';
import { medrecEventsName, parseMedrecEvents } from '../src/next/medrecEvents';
import { demoJson } from './helpers';

/** The synthetic sample folder in public/demo/, parsed as the app reads it. */
export function demo(): { household: Household; indexes: Map<string, PersonIndex>; status: RefreshStatus } {
  const household = parseHousehold(demoJson('household.json'));
  const indexes = new Map<string, PersonIndex>();
  // Each person's events as medrec wrote them into the sample (views/), as the store reads them.
  const views = demoJson('views/views.json');
  for (const p of household.people) {
    const index = parseIndex(demoJson(`${p.folder}/index.json`), p.id);
    indexes.set(p.id, index);
    const name = medrecEventsName(views, p.id);
    if (name) useMedrecEvents(index, parseMedrecEvents(demoJson(`views/${p.id}/${name}`), p.id));
  }
  const read = parseStatus(demoJson('_status/status.json'));
  if (read.kind !== 'ok') throw new Error('demo status.json does not parse');
  return { household, indexes, status: read.status };
}

export function personNamed(h: Household, name: string) {
  const p = h.people.find((x) => x.name === name);
  if (!p) throw new Error(`no ${name}`);
  return p;
}

export function sourceOf(h: Household, person: string, cli: string): Source {
  const p = personNamed(h, person);
  const s = h.sources.find((x) => x.person === p.id && x.cli === cli);
  if (!s) throw new Error(`no ${cli} for ${person}`);
  return s;
}
