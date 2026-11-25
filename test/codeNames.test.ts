// medrec's names for codes (code-names.json, medrec 0.9.4 and later): what is
// read, which item a title may label, whose words lead, and what keeps the
// source's words.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import { claimDiagnoses } from '../src/model/claims';
import { codeKey, conditionName, diagnosisName, diagnosisNames, inDetails, nameList, parseCodeNames, secondTitle } from '../src/model/codeNames';
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
  const HTN = 'Essential (primary) hypertension';
  const vitaminD = () => [index(SAMPLE, sam), condition(index(SAMPLE, sam), 'Vitamin D deficiency')] as const;

  it('leads with the source’s words when they are plain, its code’s title for Details', () => {
    const idx = index(SAMPLE, robin);
    const r = condition(idx, 'High blood pressure');
    expect(conditionName(idx, r)).toEqual({ name: 'High blood pressure', title: HTN });
    // The source's own words for its code are its words too.
    expect(conditionName(idx, { ...r, display: '', code: { ...r.code, display: 'Raised blood pressure' } })).toEqual({ name: 'Raised blood pressure', title: HTN });
    for (const display of ['Htn', 'Hypertension NOS', 'hypertension', 'HTN 2']) expect(conditionName(idx, { ...r, display })).toEqual({ name: display, title: HTN });
  });

  it('leads with the title for billing wording in capitals, and keeps it for Details', () => {
    const idx = index(SAMPLE, robin);
    const r = condition(idx, 'High blood pressure');
    for (const display of ['HYPERTENSION NOS', 'ICD-10-CM I10']) expect(conditionName(idx, { ...r, display })).toEqual({ name: HTN, source: display, title: HTN, titleLeads: true });
    expect(conditionName(idx, { ...r, display: 'ESSENTIAL (PRIMARY) HYPERTENSION' })).toEqual({ name: HTN, source: 'ESSENTIAL (PRIMARY) HYPERTENSION', titleLeads: true });
  });

  it('leads with the title for a bare code, its own or another system’s', () => {
    const idx = index(SAMPLE, robin);
    const r = condition(idx, 'High blood pressure');
    for (const display of ['I10', 'i10', 'I-10', '38341003', 'E11.9']) expect(conditionName(idx, { ...r, display })).toEqual({ name: HTN, source: display, title: HTN, titleLeads: true });
    const ankle = condition(index(SAMPLE, sam), 'Right ankle sprain');
    const named = (display: string) => conditionName(index(SAMPLE, sam), { ...ankle, display });
    expect(named('S93401A')).toMatchObject({ name: 'Sprain of unspecified ligament of right ankle, initial encounter', source: 'S93401A', titleLeads: true });
    // A code of letters is one too when it is the record's own.
    const lettered: PersonIndex = { ...idx, codeNames: { codes: new Map([['icd10cm|M1A.9XX0', 'Chronic gout, unspecified, without tophus (tophi)']]), privateCodes: new Map() } };
    const gout = { ...r, code: { system: ICD10CM, code: 'M1A.9XX0' } };
    expect(conditionName(lettered, { ...gout, display: 'M1A9XX0' }).source).toBe('M1A9XX0');
    expect(conditionName(lettered, { ...gout, display: 'Gout' }).name).toBe('Gout');
  });

  it('leads with the title for an abbreviation, which is beside it', () => {
    const idx = index(SAMPLE, robin);
    const r = condition(idx, 'High blood pressure');
    for (const display of ['HTN', 'E-HTN', 'HTNX1']) expect(conditionName(idx, { ...r, display })).toEqual({ name: `${HTN} (${display})`, source: display, title: HTN, titleLeads: true });
    const short = conditionName(idx, { ...r, display: 'HTN' });
    expect([inDetails(short), secondTitle(short)]).toEqual([{ words: 'HTN', title: HTN }, undefined]);
    // With no title, or one that says the same, it stands.
    expect(conditionName(idx, { ...r, display: 'HTN', code: undefined })).toEqual({ name: 'HTN' });
    const covid: PersonIndex = { ...idx, codeNames: { codes: new Map([['icd10cm|U07.1', 'COVID-19']]), privateCodes: new Map() } };
    expect(conditionName(covid, { ...r, display: 'COVID-19', code: { system: ICD10CM, code: 'U07.1' } })).toEqual({ name: 'COVID-19' });
  });

  it('leads with a longer word in capitals, in sentence case, its exact text for Details', () => {
    const idx = index(SAMPLE, robin);
    const r = condition(idx, 'High blood pressure');
    const named = conditionName(idx, { ...r, display: 'HYPERTENSION' });
    expect(named).toEqual({ name: 'Hypertension', title: HTN, source: 'HYPERTENSION' });
    expect([inDetails(named), secondTitle(named)]).toEqual([{ words: 'HYPERTENSION', title: HTN }, HTN]);
    const alone = conditionName(idx, { ...r, display: 'ASTHMA', code: undefined });
    expect([alone, inDetails(alone)]).toEqual([{ name: 'Asthma', source: 'ASTHMA' }, { words: 'ASTHMA', title: undefined }]);
    const same: PersonIndex = { ...idx, codeNames: { codes: new Map([['icd10cm|H53.60', 'Unspecified, asthma']]), privateCodes: new Map() } };
    expect(conditionName(same, { ...r, display: 'ASTHMA', code: { system: ICD10CM, code: 'H53.60' } })).toEqual({ name: 'Asthma', source: 'ASTHMA' });
    // A code in letters is no word.
    expect(conditionName(idx, { ...r, display: 'WHEEZING', code: { code: 'WHEEZING' } })).toEqual({ name: 'WHEEZING' });
    // Another kind of record is not changed.
    expect(conditionName(idx, { ...r, kind: 'procedure', display: 'ARTHROSCOPY' })).toEqual({ name: 'ARTHROSCOPY' });
  });

  it('leads with words in another script', () => {
    const idx = index(SAMPLE, robin);
    expect(conditionName(idx, { ...condition(idx, 'High blood pressure'), display: '高血圧' })).toEqual({ name: '高血圧', title: HTN });
  });

  it('leads with the title when the source gives no words', () => {
    const idx = index(SAMPLE, robin);
    const r = condition(idx, 'High blood pressure');
    expect(conditionName(idx, { ...r, display: '', code: { system: ICD10CM, code: 'I10' } })).toEqual({ name: HTN });
  });

  it('is in Details in the source’s words, with the title where it differs, and by the title where there are no words', () => {
    const idx = index(SAMPLE, robin);
    const r = condition(idx, 'High blood pressure');
    const shown = (over: Partial<MedRecord>) => inDetails(conditionName(idx, { ...r, ...over }));
    expect(shown({})).toEqual({ words: 'High blood pressure', title: HTN });
    expect(shown({ display: 'HYPERTENSION NOS' })).toEqual({ words: 'HYPERTENSION NOS', title: HTN });
    expect(shown({ display: '', code: { system: ICD10CM, code: 'I10' } })).toEqual({ words: HTN, title: undefined });
    expect(shown({ display: HTN })).toEqual({ words: HTN, title: undefined });
    expect(shown({ kind: 'procedure', display: 'Knee scope' })).toEqual({ words: 'Knee scope', title: undefined });
  });

  it('is said once when the source’s words are the title’s', () => {
    const [idx, r] = vitaminD();
    for (const display of ['Vitamin D deficiency', 'Vitamin D deficiency, unspecified', 'Vitamin D Deficiency  (Unspecified)']) expect(conditionName(idx, { ...r, display })).toEqual({ name: display });
    expect(conditionName(idx, { ...r, display: 'Low vitamin D' })).toEqual({ name: 'Low vitamin D', title: 'Vitamin D deficiency, unspecified' });
  });

  it('is the source’s words when its code has no title, or it has no code, whatever they are', () => {
    const [idx, r] = vitaminD();
    for (const code of [undefined, {}, { system: ICD10CM, code: 'E55.8' }, { system: 'http://snomed.info/sct', code: 'E55.9' }]) expect(conditionName(idx, { ...r, code })).toEqual({ name: 'Vitamin D deficiency' });
    expect(conditionName(idx, { ...r, display: 'LOW VITAMIN D', code: undefined })).toEqual({ name: 'LOW VITAMIN D' });
    const none = structuredClone(idx);
    delete none.codeNames;
    expect(conditionName(none, { ...r, display: 'LOW VITAMIN D' })).toEqual({ name: 'LOW VITAMIN D' });
  });

  it('is the only kind of record its own code names', () => {
    const [idx, r] = vitaminD();
    expect(conditionName(idx, { ...r, kind: 'procedure', display: 'LOW VITAMIN D' })).toEqual({ name: 'LOW VITAMIN D' });
  });
});

describe('a claim’s diagnosis', () => {
  const OTITIS = 'Otitis media, unspecified, unspecified ear (H66.90)';

  it('goes by the same rule, with its code', () => {
    const idx = index(SAMPLE, alex);
    const { claim, d } = coded(idx, 'H66.90');
    expect(diagnosisName(idx, claim, d)).toEqual({ name: OTITIS });
    expect(diagnosisName(idx, claim, { ...d, display: 'Ear infection' })).toEqual({ name: 'Ear infection (H66.90)', title: OTITIS });
    expect(diagnosisName(idx, claim, { ...d, display: 'OTITIS MEDIA NOS' })).toEqual({ name: OTITIS, source: 'OTITIS MEDIA NOS (H66.90)', title: OTITIS, titleLeads: true });
    expect(diagnosisName(idx, claim, { ...d, display: 'H6690' })).toEqual({ name: OTITIS, source: 'H6690 (H66.90)', title: OTITIS, titleLeads: true });
    expect(diagnosisName(idx, claim, { ...d, display: undefined })).toEqual({ name: OTITIS });
    expect(diagnosisName(idx, claim, { ...d, display: 'AOM' })).toEqual({ name: 'Otitis media, unspecified, unspecified ear (AOM, H66.90)', source: 'AOM (H66.90)', title: OTITIS, titleLeads: true });
    expect(diagnosisName(idx, claim, { ...d, display: 'EARACHE' })).toEqual({ name: 'Earache (H66.90)', title: OTITIS, source: 'EARACHE (H66.90)' });
    expect(diagnosisName(idx, claim, { code: 'X1', display: 'EARACHE' })).toEqual({ name: 'Earache (X1)', source: 'EARACHE (X1)' });
    expect(diagnosisName(idx, claim, { code: 'X1', display: 'AOM' })).toEqual({ name: 'AOM (X1)' });
    expect(diagnosisName(idx, claim, { display: 'EARACHE' })).toEqual({ name: 'Earache', source: 'EARACHE' });
    expect(diagnosisName(idx, claim, { system: ICD10CM, code: 'H66.99', display: 'OTITIS MEDIA NOS' })).toEqual({ name: 'OTITIS MEDIA NOS (H66.99)' });
  });

  it('keeps the payer’s order', () => {
    const idx = index(SAMPLE, alex);
    const { claim } = coded(idx, 'H66.90');
    const two: MedRecord = { ...claim, fields: { ...claim.fields, diagnoses: [{ sequence: 2, code: { system: ICD10CM, code: 'Z23' } } as JsonObject, { sequence: 1, code: { system: ICD10CM, code: 'H6690', display: 'Ear infection' } }] } };
    expect(diagnosisNames(idx, two).map((n) => n.name)).toEqual(['Ear infection (H6690)', 'Encounter for immunization (Z23)']);
  });

  it('in the sample is in capitals on the pharmacy’s claims, and an abbreviation on the older', () => {
    const idx = index(SAMPLE, robin);
    const named = idx.records.filter((r) => r.kind === 'claim').flatMap((r) => diagnosisNames(idx, r).map((n) => [r.date, n.name, n.source]));
    expect(named.filter(([, name]) => name!.includes('I10')).sort()).toEqual([
      ['2026-08-14', 'Essential (primary) hypertension (HTN, I10)', 'HTN (I10)'],
      ['2026-11-12', 'Essential (primary) hypertension (I10)', 'HYPERTENSION NOS (I10)'],
    ]);
  });
});

describe('a private item’s title', () => {
  const anxiety = 'Generalized anxiety disorder (F41.1)';

  it('is given to a private record alone', () => {
    const idx = index(SAMPLE, sam);
    const { claim, d } = coded(idx, 'F41.1');
    expect(idx.codeNames!.codes.has('icd10cm|F41.1')).toBe(false);
    expect(diagnosisName(idx, claim, { ...d, display: 'Anxiety' })).toEqual({ name: 'Anxiety (F41.1)', title: anxiety });
    expect(diagnosisName(idx, claim, { ...d, display: undefined })).toEqual({ name: anxiety });
    const open = coded(idx, 'Z13.29').claim;
    expect(diagnosisName(idx, open, { ...d, display: 'Anxiety' })).toEqual({ name: 'Anxiety (F41.1)' });
    expect(diagnosisName(idx, open, { ...d, display: undefined })).toEqual({ name: 'F41.1' });
  });

  it('follows the household’s own marks', async () => {
    const idx = index(await load(privateCase('marked')), sam);
    const { claim, d } = coded(idx, 'S83.241A');
    expect([idx.codeNames!.codes.has('icd10cm|S83.241A'), idx.codeNames!.privateCodes.has('icd10cm|S83.241A')]).toEqual([false, true]);
    expect(diagnosisName(idx, claim, { ...d, display: 'Knee' }).title).toBe('Other tear of medial meniscus, current injury, right knee, initial encounter (S83.241A)');
    const open = coded(idx, 'Z13.29').claim;
    expect(diagnosisName(idx, open, { ...d, display: 'Knee' })).toEqual({ name: 'Knee (S83.241A)' });
  });

  it('is every title of a person whose marks do not read, whose items are all held back', async () => {
    const idx = index(await load(privateCase('unreadable')), sam);
    expect(idx.codeNames!.codes.size).toBe(0);
    expect(conditionName(idx, condition(idx, 'Right ankle sprain')).title).toBe('Sprain of unspecified ligament of right ankle, initial encounter');
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
  expect(conditionName(only, bare).title).toBe('Essential (primary) hypertension');
  expect(find([{ ...scope[0]!, index: only }], 'essential').hits).toEqual([]);
  expect(find([{ ...scope[0]!, index: only }], 'high blood pressure').hits.map((x) => x.title)).toEqual(['High blood pressure']);
});

it('lists names apart when one holds a comma', () => {
  expect(nameList(['Gout', 'Hay fever'])).toBe('Gout, Hay fever');
  expect(nameList(['Otitis media, unspecified', 'Hay fever'])).toBe('Otitis media, unspecified; Hay fever');
  expect(nameList([])).toBe('');
});
