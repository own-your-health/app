// The ids medrec drew for the sample (public/demo/), by what they name: they
// change when the sample does.
import { demoJson } from './helpers';

const household = demoJson<{ people: { id: string; name: string }[]; sources: { id: string; person: string; cli: string }[] }>('household.json');

const person = (name: string): string => household.people.find((p) => p.name === name)!.id;
export const ROBIN = person('Robin Example');
export const SAM = person('Sam Example');
export const ALEX = person('Alex Example');
export const DREW = person('Drew Example');

/** A person's source, by the CLI that reads it. */
export const sourceId = (whose: string, cli: string): string => household.sources.find((s) => s.person === whose && s.cli === cli)!.id;

interface Item {
  id: string;
  kind?: string;
  date?: string;
  doc_type?: string;
  display?: string;
  title?: string;
  original_name?: string;
  organization?: string;
}

const indexes = new Map(household.people.map((p) => [p.id, demoJson<{ records: Item[]; documents: Item[]; studies: Item[] }>(`${p.name}/index.json`)]));

/** One of a person's records, papers or studies: the only one that fits. */
export function itemId(whose: string, list: 'records' | 'documents' | 'studies', fits: (x: Item) => boolean): string {
  const found = indexes.get(whose)![list].filter(fits);
  if (found.length !== 1) throw new Error(`${found.length} of the sample's ${list} fit, not 1`);
  return found[0]!.id;
}

/** The event on a person's day, as medrec made it: the only one that fits. */
export function eventId(whose: string, start: string, kind?: string): string {
  const views = demoJson<{ people: Record<string, { files: Record<string, string> }> }>('views/views.json');
  const md5 = views.people[whose]!.files['events.json']!;
  const { events } = demoJson<{ events: { id: string; kind: string; start: string }[] }>(`views/${whose}/events.${md5.slice(0, 12)}.json`);
  const found = events.filter((e) => e.start === start && (!kind || e.kind === kind));
  if (found.length !== 1) throw new Error(`${found.length} of the sample's events fit, not 1`);
  return found[0]!.id;
}
