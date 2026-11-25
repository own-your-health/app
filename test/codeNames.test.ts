// medrec's names for codes (code-names.json, medrec 0.9.4 and later): what is
// read, which item a name may label, what is shown first, and what keeps the
// source's words.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { claimDiagnoses } from '../src/model/claims';
import { codeKey, conditionName, diagnosisName, diagnosisNames, nameList, parseCodeNames, recordedAs } from '../src/model/codeNames';
import { find } from '../src/model/search';
import type { JsonObject, MedRecord, PersonIndex } from '../src/model/types';
import { personNamed } from './demo-data';
import { demoFolderWith, demoJson, fixture, privateCase, type Overlay } from './helpers';

const ICD10CM = 'http://hl7.org/fhir/sid/icd-10-cm';

async function load(overlay: Overlay = {}, manifest?: Parameters<typeof demoFolderWith>[1]): Promise<Store> {
  const store = new Store(demoFolderWith(overlay, manifest));
  await store.load();
  return store;
}

const SAMPLE = await load();
const id = (name: string) => personNamed(SAMPLE.household, name).id;
const [robin, sam, alex, jamie] = ['Robin Example', 'Sam Example', 'Alex Example', 'Jamie Example'].map(id) as [string, string, string, string];
const index = (store: Store, person: string): PersonIndex => store.indexes.get(person)!;
const condition = (idx: PersonIndex, display: string): MedRecord => idx.records.find((r) => r.kind === 'condition' && r.display === display)!;
const coded = (idx: PersonIndex, code: string): { claim: MedRecord; d: ReturnType<typeof claimDiagnoses>[number] } => {
  for (const claim of idx.records.filter((r) => r.kind === 'claim')) {
    const d = claimDiagnoses(claim).find((x) => x.code === code);
    if (d) return { claim, d };
  }
  throw new Error(`no claim of ${idx.person}'s has ${code}`);
};

/** The views' entry for a person in views.json, as text with `change` made to it. */
function viewsWith(change: (views: { people: Record<string, { files: Record<string, string> }> }) => void): string {
  const views = demoJson<Parameters<typeof change>[0]>('views/views.json');
  change(views);
  return JSON.stringify(views);
}
const manifestFile = (kind: string, person: string) => demoJson<{ files: string[] }>('manifest.json').files.find((f) => f.startsWith(`views/${person}/${kind}.`))!;

describe('a code’s key', () => {
  it('is the same however the source writes the code', () => {
    for (const code of ['J309', 'j30.9', 'J30.9', ' J30.9 ']) expect(codeKey(ICD10CM, code)).toBe('icd10cm|J30.9');
    expect(codeKey(ICD10CM, 'i10')).toBe('icd10cm|I10');
    expect(codeKey(ICD10CM, 's93401a')).toBe('icd10cm|S93.401A');
    expect(codeKey(` ${ICD10CM.toUpperCase()}`, 'Z23')).toBe('icd10cm|Z23');
  });

  it('is none for another system’s code, or what is no code', () => {
    for (const system of ['http://hl7.org/fhir/sid/icd-10', 'http://www.cms.gov/Medicare/Coding/ICD10', 'http://hl7.org/fhir/sid/icd-9-cm', 'http://snomed.info/sct', undefined]) expect(codeKey(system, 'J30.9')).toBeUndefined();
    for (const code of [undefined, '', 'J3', '309.0', 'J30.90000', 'J30.9 J31.0 K21.9']) expect(codeKey(ICD10CM, code)).toBeUndefined();
  });
});

describe('reading code-names.json', () => {
  const raw = fixture<Record<string, unknown>>('code-names/odd.json');
  const person = raw.person as string;

  it('takes each name, and leaves out an entry without one', () => {
    const n = parseCodeNames(raw, person);
    expect([...n.codes]).toEqual([['icd10cm|J30.9', 'Allergic rhinitis, unspecified'], ['icd10cm|L50.9', 'Urticaria, unspecified']]);
    expect([...n.privateCodes]).toEqual([['icd10cm|F10.10', 'Alcohol abuse, uncomplicated']]);
  });

  it('refuses another person’s, a newer layout, and what is not one', () => {
    for (const odd of [null, [], {}, { ...raw, schema: 'medrec-code-names/v2' }, { ...raw, schema: 'medrec-private/v1' }, { ...raw, codes: undefined }, { ...raw, private_codes: [] }]) expect(() => parseCodeNames(odd, person)).toThrow();
    expect(() => parseCodeNames(raw, 'p_someoneelsexxxxxxxxxx')).toThrow();
  });
});

describe('the sample', () => {
  it('has a name for every ICD-10-CM code its conditions and claims use', () => {
    const keys = [...SAMPLE.indexes.values()].flatMap((idx) =>
      idx.records.flatMap((r) => {
        const codes = r.kind === 'condition' ? [r.code] : r.kind === 'claim' ? claimDiagnoses(r) : [];
        return codes.flatMap((c) => {
          const key = codeKey(c?.system, c?.code);
          return key ? [[idx, key] as const] : [];
        });
      }),
    );
    expect(keys.length).toBeGreaterThan(10);
    for (const [idx, key] of keys) expect(idx.codeNames?.codes.has(key) || idx.codeNames?.privateCodes.has(key), key).toBe(true);
  });

  it('gives someone with no coded condition or claim no names', () => {
    expect(index(SAMPLE, jamie).codeNames).toBeUndefined();
  });
});

describe('a condition', () => {
  it('leads with its code’s name, and keeps the source’s words', () => {
    const idx = index(SAMPLE, robin);
    const n = conditionName(idx, condition(idx, 'High blood pressure'));
    expect(n).toEqual({ name: 'Essential (primary) hypertension', source: 'High blood pressure' });
    expect(recordedAs(n)).toBe('recorded as “High blood pressure”');
  });

  it('is said once when the source’s words are the name’s', () => {
    const idx = index(SAMPLE, sam);
    const r = condition(idx, 'Vitamin D deficiency');
    for (const display of ['Vitamin D deficiency', 'Vitamin D deficiency, unspecified', 'VITAMIN D DEFICIENCY  (UNSPECIFIED)']) expect(conditionName(idx, { ...r, display })).toEqual({ name: display });
    expect(recordedAs(conditionName(idx, r))).toBeNull();
    expect(conditionName(idx, { ...r, display: 'Low vitamin D' })).toEqual({ name: 'Vitamin D deficiency, unspecified', source: 'Low vitamin D' });
  });

  it('is the source’s words when its code has no name, or it has none', () => {
    const idx = index(SAMPLE, sam);
    const r = condition(idx, 'Vitamin D deficiency');
    for (const code of [undefined, {}, { system: ICD10CM, code: 'E55.8' }, { system: 'http://snomed.info/sct', code: 'E55.9' }]) expect(conditionName(idx, { ...r, code })).toEqual({ name: 'Vitamin D deficiency' });
    const bare = structuredClone(idx);
    delete bare.codeNames;
    expect(conditionName(bare, r)).toEqual({ name: 'Vitamin D deficiency' });
  });

  it('is the only kind of record its own code names', () => {
    const idx = index(SAMPLE, sam);
    const r = condition(idx, 'Vitamin D deficiency');
    expect(conditionName(idx, { ...r, kind: 'procedure', display: 'Low vitamin D' })).toEqual({ name: 'Low vitamin D' });
  });
});

describe('a claim’s diagnosis', () => {
  it('is its code’s name with the code, and the claim’s words beside it where they differ', () => {
    const idx = index(SAMPLE, alex);
    const { claim, d } = coded(idx, 'H66.90');
    expect(diagnosisName(idx, claim, d)).toEqual({ name: 'Otitis media, unspecified, unspecified ear (H66.90)' });
    expect(diagnosisName(idx, claim, { ...d, display: 'Ear infection' })).toEqual({ name: 'Otitis media, unspecified, unspecified ear (H66.90)', source: 'Ear infection (H66.90)' });
    expect(diagnosisName(idx, claim, { ...d, display: undefined })).toEqual({ name: 'Otitis media, unspecified, unspecified ear (H66.90)' });
    expect(diagnosisName(idx, claim, { system: ICD10CM, code: 'H66.99', display: 'Ear infection' })).toEqual({ name: 'Ear infection (H66.99)' });
  });

  it('keeps the payer’s order', () => {
    const idx = index(SAMPLE, alex);
    const { claim } = coded(idx, 'H66.90');
    const two: MedRecord = { ...claim, fields: { ...claim.fields, diagnoses: [{ sequence: 2, code: { system: ICD10CM, code: 'Z23' } } as JsonObject, { sequence: 1, code: { system: ICD10CM, code: 'H6690', display: 'Ear infection' } }] } };
    expect(diagnosisNames(idx, two).map((n) => n.name)).toEqual(['Otitis media, unspecified, unspecified ear (H6690)', 'Encounter for immunization (Z23)']);
  });
});

describe('a private item’s name', () => {
  const anxiety = 'Generalized anxiety disorder';

  it('is given to a private record alone', () => {
    const idx = index(SAMPLE, sam);
    const { claim, d } = coded(idx, 'F41.1');
    expect(idx.codeNames!.codes.has('icd10cm|F41.1')).toBe(false);
    expect(diagnosisName(idx, claim, { ...d, display: 'Anxiety' })).toEqual({ name: `${anxiety} (F41.1)`, source: 'Anxiety (F41.1)' });
    const open = coded(idx, 'Z13.29').claim;
    expect(diagnosisName(idx, open, { ...d, display: 'Anxiety' })).toEqual({ name: 'Anxiety (F41.1)' });
    expect(diagnosisName(idx, open, { ...d, display: undefined })).toEqual({ name: 'F41.1' });
  });

  it('follows the household’s own marks', async () => {
    const idx = index(await load(privateCase('marked')), sam);
    const { claim, d } = coded(idx, 'S83.241A');
    expect([idx.codeNames!.codes.has('icd10cm|S83.241A'), idx.codeNames!.privateCodes.has('icd10cm|S83.241A')]).toEqual([false, true]);
    expect(diagnosisName(idx, claim, { ...d, display: 'Knee' }).source).toBe('Knee (S83.241A)');
    const open = coded(idx, 'Z13.29').claim;
    expect(diagnosisName(idx, open, { ...d, display: 'Knee' })).toEqual({ name: 'Knee (S83.241A)' });
  });

  it('is every name of a person whose marks do not read, whose items are all held back', async () => {
    const idx = index(await load(privateCase('unreadable')), sam);
    expect(idx.codeNames!.codes.size).toBe(0);
    expect(conditionName(idx, condition(idx, 'Right ankle sprain')).name).toBe('Sprain of unspecified ligament of right ankle, initial encounter');
  });
});

describe('names that can’t be used leave the source’s words, and say nothing', () => {
  const plain = (store: Store) => {
    const idx = index(store, robin);
    return [conditionName(idx, condition(idx, 'High blood pressure')), idx.codeNames, store.viewsError, store.eventsNotes.size, idx.privacy?.kind];
  };
  const usual = [{ name: 'High blood pressure' }, undefined, null, 0, 'known'];
  const file = manifestFile('code-names', robin);
  const text = JSON.stringify(demoJson(file));

  it('when medrec wrote none', async () => {
    expect(plain(await load({ 'views/views.json': viewsWith((v) => void delete v.people[robin]!.files['code-names.json']) }))).toEqual(usual);
  });

  it('when the file is not there yet, or another one is', async () => {
    expect(plain(await load({ [file]: null }))).toEqual(usual);
    expect(plain(await load({ [file]: `${text} ` }))).toEqual(usual);
  });

  it('until the file arrives, which a later read then shows as new', async () => {
    const [before, after] = [await load({ [file]: null }), await load()];
    expect(before.snapshot).not.toBe(after.snapshot);
    expect((await load()).snapshot).toBe(after.snapshot);
  });

  it('when it does not read, or is newer', async () => {
    for (const body of ['{', text.replace('code-names/v1', 'code-names/v2')]) {
      // Drive gives the MD5 medrec wrote: what it holds is another file's text.
      expect(plain(await load({ [file]: body }, (m) => void (m.md5![file] = demoJson<{ md5: Record<string, string> }>('manifest.json').md5[file]!)))).toEqual(usual);
    }
  });

  it('when the records, or the household’s marks, are newer than it', async () => {
    const folder = personNamed(SAMPLE.household, 'Robin Example').folder;
    const marks = `${folder}/marks.json`;
    const later = index(await load({ [marks]: privateCase('marked')[marks]! }), robin);
    expect([later.codeNames, later.events !== undefined, later.privacy?.kind]).toEqual([undefined, true, 'held']);
    const path = `${folder}/index.json`;
    const idx = index(await load({ [path]: `${JSON.stringify(demoJson(path))} ` }), robin);
    expect([idx.codeNames, conditionName(idx, condition(idx, 'High blood pressure'))]).toEqual([undefined, { name: 'High blood pressure' }]);
  });
});

it('does not find an item by its code’s name', () => {
  const scope = [{ person: robin, index: index(SAMPLE, robin), text: null }];
  const bare: MedRecord = { ...condition(index(SAMPLE, robin), 'High blood pressure'), code: { system: ICD10CM, code: 'I10' } };
  const only: PersonIndex = { ...index(SAMPLE, robin), records: [bare] };
  expect(conditionName(only, bare).name).toBe('Essential (primary) hypertension');
  expect(find([{ ...scope[0]!, index: only }], 'essential').hits).toEqual([]);
  expect(find([{ ...scope[0]!, index: only }], 'high blood pressure').hits.map((x) => x.title)).toEqual(['High blood pressure']);
});

it('lists names apart when one holds a comma', () => {
  expect(nameList(['Gout', 'Hay fever'])).toBe('Gout, Hay fever');
  expect(nameList(['Otitis media, unspecified', 'Hay fever'])).toBe('Otitis media, unspecified; Hay fever');
  expect(nameList([])).toBe('');
});
