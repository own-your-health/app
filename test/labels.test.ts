// medrec's labels for providers: which one an item's name has, what a shared
// screen may say of it, and which names it puts together.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/data/store';
import type { MedrecRule } from '../src/model/events';
import { withoutErrors } from '../src/model/inError';
import { FolderError, parseIndex } from '../src/model/parse';
import { labelOn, parseProviderLabels, saidOn, sharedLabel, type ProviderLabel } from '../src/model/providerLabels';
import type { ProviderField } from '../src/model/providers';
import type { PersonIndex } from '../src/model/types';
import { labelToCall, labelWords, saidText, whyWords } from '../src/next/labelView';
import { papersOf, sharedPaper, sharedPapers } from '../src/next/papers';
import { providerPage } from '../src/next/provider';
import { namedOn, Providers, providersNamed, saidApart, type Named } from '../src/next/providerNames';
import { demoFolderWith, demoJson, fixture, labelCase, manifestWith, privateCase, type Overlay } from './helpers';
import { ALEX, DREW, ROBIN, SAM } from './sample';

const TODAY = '2026-11-22';
const ME = 'p_robinaaaaaaaaaaaaaaa';

/** medrec's own fixture for readers of its labels, with the items its rules and marks make private. */
function medrecs(labels: string): PersonIndex {
  const idx = parseIndex(fixture('labels/medrec/index.json'), ME);
  const area = (ids: string[]) => new Map(ids.map((id) => [id, 'mental_health']));
  idx.privacy = { ...store.index(ROBIN)!.privacy!, kind: 'known', records: area(['r_talkaaaaaaaaaaaaaaaa', 'r_privatevisitaaaaaaaa', 'r_privatebothaaaaaaaaa']), documents: area(['d_counselingaaaaaaaaaa', 'd_counselingtwoaaaaaaa']), events: new Map() } as NonNullable<PersonIndex['privacy']>;
  idx.providerLabels = parseProviderLabels(fixture(`labels/medrec/${labels}`), ME);
  return idx;
}

async function load(overlay: Overlay = {}): Promise<Store> {
  const s = new Store(demoFolderWith(overlay));
  await s.load();
  return s;
}

const store = await load();
const SAID = await load(labelCase());
const index = (person: string, of = SAID) => of.index(person)!;
const printedAs = (idx: PersonIndex, field: string, printed: string) => idx.records.filter((r) => r.fields[field] === printed);
const says = (idx: PersonIndex, item: string, printed: string | undefined) => {
  const on = labelOn(idx, item, printed);
  return on && [on.label.name ?? on.label.practice, on.label.confidence, on.closed];
};

describe('a name on an item', () => {
  const idx = medrecs('providers.json');

  it('has the label of the item, then that of the name wherever it is printed', () => {
    expect(says(idx, 'r_officevisitaaaaaaaaa', 'EXAMPLE PRIMARY CARE GROUP LLC')).toEqual(['Example Primary Care', 'sure', false]);
    expect(says(idx, 'r_namesakeaaaaaaaaaaaa', 'EXAMPLE PRIMARY CARE GROUP LLC')).toEqual(['Example Primary Care Group of Texas', 'sure', false]);
    expect(says(idx, 'r_imagingaaaaaaaaaaaaa', 'A TESTPERSON')).toEqual(['Avery Testperson, MD', 'likely', false]);
    expect(says(idx, 'r_therapyaaaaaaaaaaaaa', 'A TESTPERSON')).toBeUndefined();
  });

  it('is looked up by the exact text, and an event by its own id', () => {
    expect(says(idx, 'e_htj3bwwwzg3rteblhio7', 'A TESTPERSON')).toEqual(['Avery Testperson, MD', 'likely', false]);
    for (const other of ['a testperson', 'A TESTPERSON ', '', undefined]) expect(says(idx, 'r_imagingaaaaaaaaaaaaa', other)).toBeUndefined();
  });

  it('has what only private items say on a private item alone', () => {
    expect(says(idx, 'r_talkaaaaaaaaaaaaaaaa', 'C EXAMPLE')).toEqual(['Casey Example, PhD', 'sure', true]);
    expect(says(idx, 'r_markedaaaaaaaaaaaaaa', 'C EXAMPLE')).toBeUndefined();
    // One name with a label of each, by the item it is on.
    expect(says(idx, 'r_privatevisitaaaaaaaa', 'R PLACEHOLDER')).toEqual(['Riley Placeholder, FNP', 'likely', true]);
    expect(says(idx, 'r_onepaperaaaaaaaaaaaa', 'R PLACEHOLDER')).toEqual(['Riley Placeholder, FNP', 'likely', false]);
    expect(labelOn(idx, 'r_privatevisitaaaaaaaa', 'R PLACEHOLDER')!.label.practice).toBeUndefined();
    // A private item's may be an open label.
    expect(says(medrecs('reader.json'), 'r_talkaaaaaaaaaaaaaaaa', 'J SAMPLE')).toEqual(['Jordan Sample, MD', 'sure', true]);
    // A private event's too.
    const private_ = medrecs('reader.json');
    if (private_.privacy?.kind !== 'known') throw new Error('not known');
    private_.privacy.events.set('e_one', 'mental_health');
    expect([says(private_, 'e_one', 'C EXAMPLE'), says(private_, 'e_two', 'C EXAMPLE')]).toEqual([['Casey Example', 'sure', true], undefined]);
  });

  it('of a paper is judged as the paper is, and of an item not known to be private has no private label', () => {
    const idx = medrecs('reader.json');
    expect([says(idx, 'd_counselingaaaaaaaaaa', 'C EXAMPLE'), says(idx, 'd_summaryaaaaaaaaaaaaa', 'C EXAMPLE')]).toEqual([['Casey Example', 'sure', true], undefined]);
    const held = { ...idx, privacy: undefined } as unknown as PersonIndex;
    for (const item of ['r_talkaaaaaaaaaaaaaaaa', 'd_counselingaaaaaaaaaa', 'e_one']) expect([says(held, item, 'C EXAMPLE'), says(held, item, 'J SAMPLE')?.[2]]).toEqual([undefined, false]);
  });

  it('of an open item is the open label, where a private item’s of the same id says more', () => {
    const idx = medrecs('reader.json');
    const [id, label] = [...idx.providerLabels!.open.labels].find(([, l]) => l.name === 'Jordan Sample, MD')!;
    const more: ProviderLabel = { ...label, evidence: [...label.evidence, { from: 'paper', document: 'd_counselingaaaaaaaaaa' }] };
    idx.providerLabels!.closed.labels.set(id, more);
    expect([labelOn(idx, 'r_samplevisitaaaaaaaaa', 'J SAMPLE')!.label, labelOn(idx, 'r_talkaaaaaaaaaaaaaaaa', 'J SAMPLE')!.label]).toEqual([label, more]);
  });

  it('keeps what it does not know as likely, with a phone from nowhere it can name and no reason', () => {
    const later = labelOn(medrecs('reader.json'), 'r_samplevisitaaaaaaaaa', 'L FILLER')!.label;
    expect([later.confidence, later.phone, later.phoneFrom, later.evidence]).toEqual(['likely', '555-010-0177', { from: 'other' }, [{ from: 'other' }]]);
  });

  it('has what the household said of it, newest first, and what is private of it on a private item alone', () => {
    const said = medrecs('reader.json');
    expect(saidOn(said, 'r_talkaaaaaaaaaaaaaaaa', 'P DUMMY').map((s) => [s.kind, s.by])).toEqual([['set', 'Robin Example']]);
    expect(saidOn(said, 'r_samplevisitaaaaaaaaa', 'P DUMMY')).toEqual([]);
    const robin = index(ROBIN);
    const lab = printedAs(robin, 'provider', 'Example Lab')[0]!;
    expect([saidOn(robin, lab.id, 'Example Lab').map((s) => s.kind), labelOn(robin, lab.id, 'Example Lab')]).toEqual([['wrong'], undefined]);
    expect(saidOn(robin, lab.id, 'Example Health').map((s) => s.kind)).toEqual(['same']);
    // One of an item is of it alone.
    const one = { id: 'o_one', kind: 'wrong' as const, printed: ['Example Lab'], item: lab.id, at: '2026-11-23T00:00:00Z' };
    const with_ = { ...robin, providerLabels: { ...robin.providerLabels!, open: { ...robin.providerLabels!.open, said: [...robin.providerLabels!.open.said, one] } } };
    expect(saidOn(with_, lab.id, 'Example Lab').map((s) => s.id)).toEqual(['o_one', robin.providerLabels!.open.said[1]!.id]);
    expect(saidOn(with_, 'r_other', 'Example Lab').map((s) => s.id)).toEqual([robin.providerLabels!.open.said[1]!.id]);
  });

  it('is nobody’s where the item is entered in error, and says nothing of one that is not', () => {
    const robin = index(ROBIN);
    const lab = printedAs(robin, 'provider', 'Example Lab')[0]!;
    const wrong = (index: PersonIndex, id: string) => withoutErrors(index, new Set([id]));
    expect(labelOn(wrong(idx, 'r_imagingaaaaaaaaaaaaa'), 'r_imagingaaaaaaaaaaaaa', 'A TESTPERSON')).toBeUndefined();
    expect(says(wrong(idx, 'r_therapyaaaaaaaaaaaaa'), 'r_imagingaaaaaaaaaaaaa', 'A TESTPERSON')).toEqual(['Avery Testperson, MD', 'likely', false]);
    expect([saidOn(wrong(robin, lab.id), lab.id, 'Example Lab'), saidOn(wrong(robin, 'r_other'), lab.id, 'Example Lab').length]).toEqual([[], 1]);
  });
});

describe('a label on a screen the household shares', () => {
  const idx = medrecs('reader.json');
  const open = (id: string) => id !== 'd_closedaaaaaaaaaaaaaa';
  const on = (printed: string) => labelOn(idx, 'r_samplevisitaaaaaaaaa', printed)!.label;
  const shared = (printed: string) => sharedLabel(idx, on(printed), open);

  it('is there with what is not of a private paper, and not when it was likely by that alone', () => {
    expect(shared('R PLACEHOLDER')).toBeUndefined();
    const both = shared('M TEMPLATE')!;
    expect([both.practice, both.phone, both.phoneFrom, both.evidence.map((e) => e.document ?? e.from)]).toEqual(['Sample Health Partners', undefined, undefined, ['only_match', 'd_openaaaaaaaaaaaaaaaa']]);
    expect(sharedLabel(idx, on('M TEMPLATE'), () => true)).toEqual(on('M TEMPLATE'));
    expect(shared('J SAMPLE')).toEqual(on('J SAMPLE'));
  });

  it('says nothing the household said of private items', () => {
    const said = shared('P DUMMY')!;
    expect([said.name, said.confidence, said.phone, said.evidence]).toEqual(['Pat Dummy', 'household', undefined, []]);
  });

  it('that gives no reason is there all the same', () => {
    expect(shared('L FILLER')!.phone).toBe('555-010-0177');
    expect(sharedLabel(idx, { ...on('R PLACEHOLDER'), evidence: [] }, open)?.practice).toBe('Sample Health Partners');
  });
});

describe('a label’s words', () => {
  const label = (over: Partial<ProviderLabel>): ProviderLabel => ({ id: 'v_one', confidence: 'sure', evidence: [], ...over });

  it('are what the printed name does not say', () => {
    expect(labelWords(label({ name: 'Jordan Sample, MD', role: 'family doctor', practice: 'Example Health' }), 'Dr. Jordan Sample')).toBe('Jordan Sample, MD · family doctor · Example Health');
    expect(labelWords(label({ name: 'Example Pediatrics', role: 'primary care clinic' }), 'EXAMPLE PEDIATRICS')).toBe('Primary care clinic');
    expect(labelWords(label({ name: 'Example Lab', practice: 'Example Lab' }), 'Example Billing')).toBe('Example Lab');
    expect(labelWords(label({ name: 'Example Lab', phone: '555-010-0101' }), 'Example Lab')).toBeUndefined();
  });
});

describe('why a label is given', () => {
  const all = medrecs('providers.json').providerLabels!;
  const named = (name: string) => [...all.open.labels.values(), ...all.closed.labels.values()].find((l) => l.name === name)!;

  it('is said in a sentence for each reason', () => {
    expect(whyWords(named('Example Primary Care'), [], 'EXAMPLE PRIMARY CARE GROUP LLC')).toBe('By the provider number these records give.');
    expect(whyWords(named('Avery Testperson, MD'), [], 'A TESTPERSON')).toBe('The only one of that name in the provider directory for FL.');
    const only: ProviderLabel = { id: 'v_one', confidence: 'likely', evidence: [{ from: 'only_match' }, { from: 'only_match' }, { from: 'other' }, { from: 'paper', document: 'd_one' }] };
    expect(whyWords(only, [], 'A TESTPERSON')).toBe('The only one of that name in the provider directory.');
  });

  it('is a text’s own first name, and each one’s for a text that has none', () => {
    const first: ProviderLabel = {
      id: 'v_one',
      confidence: 'likely',
      evidence: [
        { from: 'first_name', printed: 'DREW SPECIMEN', state: 'FL', city: 'Exampleton' },
        { from: 'first_name', printed: 'Drew Specimen, MD', state: 'TX' },
        { from: 'first_name', printed: 'Specimen, Drew' },
      ],
    };
    const why = (place: string) => `Of several of that name in the provider directory, the only one with that first name${place}.`;
    expect(whyWords(first, [], 'DREW SPECIMEN')).toBe(why(', in Exampleton, FL'));
    expect(whyWords(first, [], 'Drew Specimen, MD')).toBe(why(', in TX'));
    expect(whyWords(first, [], 'Specimen, Drew')).toBe(why(''));
    expect(whyWords(first, [], 'D SPECIMEN')).toBe([why(', in Exampleton, FL'), why(', in TX'), why('')].join(' '));
  });

  it('is the household’s word, once', () => {
    const by: ProviderLabel = { id: 'v_one', confidence: 'household', evidence: [{ from: 'household', id: 'o_one', by: 'Robin Example', at: '2026-11-22T20:00:00Z' }] };
    const same = { id: 'o_one', kind: 'same' as const, printed: ['A', 'B', 'C'], by: 'Robin Example', at: '2026-11-22T20:00:00Z' };
    expect(whyWords(by, [], 'A')).toBe('Robin Example said so on Nov 22, 2026.');
    expect(whyWords(by, [same], 'A')).toBe('');
    expect(whyWords(by, [{ ...same, id: 'o_two' }], 'A')).toBe('Robin Example said so on Nov 22, 2026.');
    // A correction that says nothing of itself leaves it to the label.
    expect(whyWords(by, [{ ...same, kind: 'set' }], 'A')).toBe('Robin Example said so on Nov 22, 2026.');
    expect(whyWords({ ...by, evidence: [{ from: 'household' }] }, [], 'A')).toBe('The household said so.');
  });

  it('and what they said of a name that is no label’s reason is said of itself', () => {
    const said = { id: 'o_one', printed: ['A', 'B', 'C'], by: 'Robin Example', at: '2026-11-22T20:00:00Z' };
    expect(saidText({ ...said, kind: 'same' })).toBe('Robin Example said on Nov 22, 2026 that A, B and C are one provider.');
    expect(saidText({ ...said, kind: 'different', printed: ['A', 'B'] })).toBe('Robin Example said on Nov 22, 2026 that A and B are not one provider.');
    expect(saidText({ id: 'o_two', kind: 'wrong', printed: ['A'] })).toBe('The household said that the label here was wrong.');
    expect([saidText({ ...said, kind: 'set' }), saidText({ ...said, kind: 'same', printed: ['A'] })]).toEqual([null, null]);
  });

  it('is dated by the day where this is read', () => {
    const zone = process.env.TZ;
    const days = (at: string, where: string) => {
      process.env.TZ = where;
      return [saidText({ id: 'o', kind: 'wrong', printed: ['A'], at }), whyWords({ id: 'v', confidence: 'household', evidence: [{ from: 'household', at }] }, [], 'A')];
    };
    try {
      expect(days('2026-11-23T02:00:00Z', 'America/New_York')).toEqual(['The household said on Nov 22, 2026 that the label here was wrong.', 'The household said so on Nov 22, 2026.']);
      expect(days('2026-11-22T20:00:00Z', 'Asia/Tokyo')).toEqual(['The household said on Nov 23, 2026 that the label here was wrong.', 'The household said so on Nov 23, 2026.']);
      expect(days('2026-11-22', 'America/New_York')[0]).toContain('on Nov 22, 2026 ');
      expect(days('Tuesday', 'America/New_York')[0]).toContain('on Tuesday ');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe('a number to call about a bill that gives none', () => {
  const sam = index(SAM);
  const bill = sam.documents.find((d) => d.organization === 'Example Billing')!;
  const withLabel = (change: (l: ProviderLabel) => ProviderLabel, idx = sam): PersonIndex => {
    const of = idx.providerLabels!;
    const id = of.open.byName.get('Example Billing')!;
    return { ...idx, providerLabels: { ...of, open: { ...of.open, labels: new Map([...of.open.labels, [id, change(of.open.labels.get(id)!)]]) } } };
  };

  it('is its organization’s, the same on a shared screen while nothing private gives it', () => {
    const none = () => false;
    expect([labelToCall(sam, bill)?.phone, labelToCall(sam, bill, none)?.phone]).toEqual(['555-010-0140', '555-010-0140']);
    const paper = withLabel((l) => ({ ...l, phoneFrom: { from: 'paper', document: 'd_one' } }));
    expect([labelToCall(paper, bill)?.phone, labelToCall(paper, bill, (id) => id === 'd_one')?.phone, labelToCall(paper, bill, none)]).toEqual(['555-010-0140', '555-010-0140', undefined]);
  });

  it('is from no paper that everyone’s Papers does not list', () => {
    const robin = index(ROBIN);
    if (robin.privacy?.kind !== 'known') throw new Error('not known');
    const may = (idx: PersonIndex) => sharedPaper(SAID.household, new Map([...SAID.indexes, [ROBIN, idx]]), TODAY);
    const listed = new Set(sharedPapers(SAID.household, SAID.indexes, TODAY).map((p) => p.doc.id));
    for (const idx of SAID.indexes.values()) for (const d of idx.documents) expect(may(robin)(d.id), d.id).toBe(listed.has(d.id));
    // One of its own area, one that could be part of a private visit, and one in nobody's records.
    const doc = papersOf(robin, SAID.household, TODAY, SAID.indexes).find((p) => p.with === undefined && !p.private)!.doc;
    const secret = { ...robin, privacy: { ...robin.privacy, documents: new Map([...robin.privacy.documents, [doc.id, 'household']]) } };
    const visit = robin.events!.events[0]!.id;
    const pending = { ...robin, events: { ...robin.events!, pending: [{ ...robin.events!.pending[0], document: doc.id, could_join: [visit], rule: 'D4' as MedrecRule }] }, privacy: { ...robin.privacy, events: new Map([...robin.privacy.events, [visit, 'household']]) } };
    const gone = { ...robin, documents: robin.documents.filter((d) => d.id !== doc.id) };
    expect([robin, secret, pending, gone].map((idx) => may(idx)(doc.id))).toEqual([true, false, false, false]);
    expect(may(robin)('d_one')).toBe(false);
    const theirs = index(SAM).documents.find((d) => listed.has(d.id))!.id;
    expect(sharedPaper(SAID.household, new Map([...SAID.indexes].filter(([id]) => id !== ROBIN)), TODAY)(theirs)).toBe(true);
    const held: PersonIndex = { ...robin, privacy: { kind: 'held', text: 'x' } as unknown as PersonIndex['privacy'] & object };
    expect(may(held)(doc.id)).toBe(false);
  });

  it('is none of a likely label’s, nor of one with no number, nor of a paper that names nobody', () => {
    expect(labelToCall(withLabel((l) => ({ ...l, confidence: 'likely' })), bill)).toBeUndefined();
    const silent = withLabel((l) => {
      const out = { ...l };
      delete out.phone;
      return out;
    });
    expect(labelToCall(silent, bill)).toBeUndefined();
    const nobody = { ...bill };
    delete nobody.organization;
    expect(labelToCall(sam, nobody)).toBeUndefined();
  });
});

describe('a folder’s labels', () => {
  const file = demoJson<{ files: string[] }>('manifest.json').files.find((f) => f.startsWith(`views/${SAM}/providers.`))!;

  it('are read for each person the folder has them of', () => {
    expect([ROBIN, SAM, ALEX, DREW].map((p) => index(p).providerLabels?.open.labels.size)).toEqual([2, 4, 2, 1]);
    expect(index(SAM).providerLabels!.closed.labels.size).toBe(2);
    expect([ROBIN, SAM, ALEX, DREW].map((p) => !!index(p, store).providerLabels)).toEqual([true, true, false, true]);
  });

  it('are none when the file is missing, stale, another person’s or newer, with nothing said and everything else read', async () => {
    const text = JSON.stringify(demoJson(file));
    for (const over of [{ [file]: null }, { [file]: text.replace('medrec-providers/v1', 'medrec-providers/v2') }, { [file]: text.replaceAll(SAM, ROBIN) }, { [file]: '[]' }, { 'Sam Example/provider-state.json': '{}' }] as Overlay[]) {
      const read = await load(over);
      expect([Object.keys(over), read.index(SAM)!.providerLabels, read.index(SAM)!.events !== undefined, read.indexErrors.size]).toEqual([Object.keys(over), undefined, true, 0]);
    }
    const ok = { schema: 'medrec-providers/v1', person: SAM };
    for (const raw of [{ ...ok, person: ROBIN }, { ...ok, schema: 'medrec-providers/v2' }, [], null, 'labels']) expect(() => parseProviderLabels(raw, SAM), JSON.stringify(raw)).toThrow(FolderError);
    const odd = parseProviderLabels({ ...ok, labels: { v_a: 'odd', v_b: { name: ' ', role: 'clinic', phone: 5 } }, by_name: { A: 'v_b', B: 7 }, by_item: { r_a: 'odd' }, overrides: [{ id: 'o_a', kind: 'later', printed: ['A'] }, { kind: 'wrong', printed: ['A'] }, { id: 'o_b', kind: 'wrong' }, 'odd'], private: 'odd' }, SAM);
    expect([...odd.open.labels]).toEqual([['v_b', { id: 'v_b', role: 'clinic', confidence: 'likely', evidence: [] }]]);
    expect([[...odd.open.byName], [...odd.open.byItem], odd.open.said, odd.closed.labels.size]).toEqual([[['A', 'v_b']], [['r_a', new Map()]], [{ id: 'o_b', kind: 'wrong', printed: [] }], 0]);
  });

  it('are part of what a read is compared by, so one that comes later is drawn', async () => {
    expect((await load({ [file]: null })).snapshot).not.toBe((await load()).snapshot);
  });

  it('are waited for while they may still come, and not when they are refused', async () => {
    const manifest = JSON.parse(manifestWith({ [file]: null })) as { files: string[] };
    expect(manifest.files).not.toContain(file);
    expect((await load({ [file]: null })).mayBring()).toBe(true);
    expect((await load()).mayBring()).toBe(false);
  });

  it('are the private items’ own when the household’s marks don’t read', async () => {
    const unread = index(SAM, await load(privateCase('unreadable')));
    expect([unread.providerLabels?.open.labels.size, unread.providerLabels?.closed.labels.size]).toEqual([0, 1]);
  });
});

describe('names a label puts together', () => {
  const named = (idx: PersonIndex) => providersNamed(idx, SAID.household);
  const find = (idx: PersonIndex, field: ProviderField, name: string): Named => named(idx).find((n) => n.field === field && n.name === name)!;
  const one = (all: Named[], a: Named, b: Named, apart = saidApart(index(a.person), true)) => {
    const p = new Providers(all, apart);
    return p.idOf(a) === p.idOf(b);
  };

  it('are those the household said are one provider', () => {
    const robin = index(ROBIN);
    const [bills, clinic] = [find(robin, 'provider', 'Example Health'), find(robin, 'location', 'Example Health Main Clinic')];
    expect(one(named(robin), bills, clinic)).toBe(true);
    const was = { ...robin, providerLabels: undefined };
    expect(one(providersNamed(was, SAID.household), bills, clinic)).toBe(false);
    const page = providerPage({ household: SAID.household, indexes: SAID.indexes, today: TODAY, marks: [] }, bills, false)!;
    expect([page.also, page.labels.map((l) => [l.label?.name, l.said.map((s) => s.kind)])]).toEqual([['Example Health Main Clinic'], [['Example Health Partners', ['same']]]]);
    // Their word holds whatever NPIs the records give.
    const other = named(robin).map((n) => (n.name === 'Example Health Main Clinic' ? { ...n, npi: '0000000071' } : n));
    expect(one(other, other.find((n) => n.id === bills.id && n.field === 'provider')!, other.find((n) => n.id === clinic.id && n.field === 'location')!)).toBe(true);
  });

  it('are those of one sure label, unless two NPIs go by it', () => {
    const sam = index(SAM);
    const [visit, rx] = [find(sam, 'practitioner', 'Dr. Casey Placeholder'), find(sam, 'prescriber', 'Dr. Casey Placeholder')];
    const strip = (n: Named, npi: string | undefined, source: string): Named => {
      const out: Named = { ...n, inSource: source };
      if (npi) out.npi = npi;
      else delete out.npi;
      return out;
    };
    const without = [strip(visit, undefined, 'a'), strip(rx, undefined, 'b')];
    expect(one(without, without[0]!, without[1]!)).toBe(true);
    const half = [strip(visit, '0000000014', 'a'), strip(rx, undefined, 'b')];
    expect(one(half, half[0]!, half[1]!)).toBe(true);
    const two = [strip(visit, '0000000014', 'a'), strip(rx, '0000000022', 'b')];
    expect(one(two, two[0]!, two[1]!)).toBe(false);
    // Never of a likely one.
    const likely = without.map((n) => ({ ...n, label: { ...n.label!, label: { ...n.label!.label, confidence: 'likely' as const } } }));
    expect(one(likely, likely[0]!, likely[1]!)).toBe(false);
  });

  it('are those of one sure label by whichever of them has an NPI, and two NPIs stay two whatever else shares a label', () => {
    const base = find(index(SAM), 'practitioner', 'Dr. Casey Placeholder');
    const as = (npi: string | undefined, source: string, id: string): Named => {
      const out: Named = { ...base, inSource: source, label: { ...base.label!, label: { ...base.label!.label, id } } };
      if (npi) out.npi = npi;
      else delete out.npi;
      return out;
    };
    const all = [as(undefined, 'a', 'v_1'), as('1', 'b', 'v_1'), as('1', 'c', 'v_2'), as('2', 'd', 'v_2')];
    const p = new Providers(all);
    expect(all.map((n) => all.findIndex((m) => p.idOf(m) === p.idOf(n)))).toEqual([0, 0, 0, 3]);
    // The household put two NPIs together: a sure label of one of them joins both, and of a third none.
    const theirs = (n: Named): Named => ({ ...n, label: { ...n.label!, label: { ...n.label!.label, id: 'v_theirs', confidence: 'household' } } });
    const said = [theirs(as('1', 'a', '')), theirs(as('2', 'b', '')), as('2', 'c', 'v_1'), as(undefined, 'd', 'v_1'), as('3', 'e', 'v_2'), as('1', 'f', 'v_2')];
    const q = new Providers(said);
    expect(said.map((n) => said.findIndex((m) => q.idOf(m) === q.idOf(n)))).toEqual([0, 0, 0, 0, 4, 0]);
  });

  it('are those of one sure label by one NPI, though the household said two others of it are apart', () => {
    const base = find(index(SAM), 'practitioner', 'Dr. Casey Placeholder');
    const as = (person: string, printed: string, npi: string | undefined, label: string | undefined): Named => {
      const out: Named = { ...base, person, printed, inSource: `${person}|${printed}` };
      if (npi) out.npi = npi;
      else delete out.npi;
      if (label) out.label = { ...base.label!, label: { ...base.label!.label, id: label } };
      else delete out.label;
      return out;
    };
    const all = [as(SAM, 'A', '1', 'v_1'), as(SAM, 'B', '1', 'v_1'), as(ROBIN, 'C', '1', 'v_1'), as(ROBIN, 'D', undefined, 'v_1')];
    const apart = [{ person: SAM, printed: ['A', 'B'] }];
    const groups = (names: Named[]) => {
      const p = new Providers(names, apart);
      return names.map((n) => names.findIndex((m) => p.idOf(m) === p.idOf(n)));
    };
    expect([groups(all), groups(all.map((n, i) => (i === 1 ? as(SAM, 'B', '1', undefined) : n)))]).toEqual([
      [0, 1, 0, 0],
      [0, 1, 0, 0],
    ]);
    // One that could go with either is the one's the records give the NPI for.
    expect(groups([as(SAM, 'B', undefined, 'v_1'), as(SAM, 'A', '1', 'v_1'), as(ROBIN, 'C', undefined, 'v_1')])).toEqual([0, 1, 1]);
  });

  it('that a source gives an NPI is another’s where the household said so of an item that gives none', () => {
    const base = find(index(SAM), 'practitioner', 'Dr. Casey Placeholder');
    const theirs: Named = { ...base, id: 'r_theirs', label: { ...base.label!, label: { ...base.label!.label, id: 'v_theirs', confidence: 'household' } } };
    const none: Named = { ...base, id: 'r_none' };
    delete theirs.npi;
    delete none.npi;
    delete none.label;
    const all = [{ ...base, npi: '1' }, theirs, none];
    const p = new Providers(all);
    expect(all.map((n) => all.findIndex((m) => p.idOf(m) === p.idOf(n)))).toEqual([0, 1, 0]);
  });

  it('that several labels go by in one source are each its label’s, and one with none is neither’s', () => {
    const idx = medrecs('reader.json');
    const base = find(index(SAM), 'practitioner', 'Dr. Casey Placeholder');
    const at = (id: string): Named => {
      const label = labelOn(idx, id, 'J SAMPLE');
      const out: Named = { ...base, id, printed: 'J SAMPLE', inSource: 'a', ...(label ? { label } : {}) };
      delete out.npi;
      return out;
    };
    const all = [at('r_otheraaaaaaaaaaaaaaa'), at('r_samplevisitaaaaaaaaa'), { ...at('r_none'), label: undefined } as unknown as Named];
    const p = new Providers(all);
    expect(new Set(all.map((n) => p.idOf(n))).size).toBe(3);
    const oneLabel = new Providers(all.slice(1));
    expect(oneLabel.idOf(all[1]!)).toBe(oneLabel.idOf(all[2]!));
  });

  it('are apart when the household said so, whatever else they share, and are not said to be alike', () => {
    const sam = index(SAM);
    const health = find(sam, 'provider', 'Example Health');
    const apart = saidApart(sam, false);
    expect(apart).toEqual([{ person: SAM, printed: ['Example Health', 'Example Health Orthopedics'] }]);
    const alike = (idx: PersonIndex) => providerPage({ household: SAID.household, indexes: new Map([...SAID.indexes, [SAM, idx]]), today: TODAY, marks: [] }, health, false)!.alike.flatMap((a) => a.names);
    expect(alike(sam)).not.toContain('Example Health Orthopedics');
    expect(alike({ ...sam, providerLabels: { ...sam.providerLabels!, open: { ...sam.providerLabels!.open, said: [] } } })).toContain('Example Health Orthopedics');
    // Two names the records give one NPI.
    const ortho = { ...find(sam, 'location', 'Example Health Orthopedics'), npi: health.npi! };
    const third: Named = { ...health, id: 'r_third', printed: 'Example Health Northside' };
    delete third.label;
    const elsewhere = { ...ortho, id: 'r_elsewhere', person: ROBIN };
    const all = [health, ortho, third, elsewhere];
    expect([one(all, health, ortho), one(all, health, ortho, [])]).toEqual([false, true]);
    expect([one(all, third, elsewhere), one(all, third, health), one(all, third, ortho)]).toEqual([true, false, false]);
    // Only in that person's records, and no name from itself.
    expect(one([health, elsewhere], health, elsewhere)).toBe(true);
    const p = new Providers(all, apart);
    expect([p.saidApart(health, ortho), p.saidApart(ortho, health), p.saidApart(health, elsewhere), p.saidApart(health, { ...health, inSource: 'z' })]).toEqual([true, true, false, false]);
    expect(saidApart(sam, true)).toEqual(apart);
  });

  it('are apart when the household said so, though a third name shares a label with each', () => {
    const sam = index(SAM);
    const health = find(sam, 'provider', 'Example Health');
    const as = (printed: string, over: Partial<Named>, id: string, confidence: 'sure' | 'household' = 'sure'): Named => {
      const out: Named = { ...health, id: `r_${printed}`, printed, inSource: printed, ...over, label: { closed: false, label: { id, confidence, evidence: [] } } };
      if (!over.npi) delete out.npi;
      return out;
    };
    const [a, b] = [as('A', {}, 'v_1'), as('B', {}, 'v_2')];
    const thirds = [as('C', { person: ROBIN, inSource: 'C1', npi: '1' }, 'v_1'), as('C', { person: ROBIN, inSource: 'C2', npi: '1' }, 'v_2')];
    const said = [{ person: SAM, printed: ['A', 'B'] }];
    expect([one([a, b, ...thirds], a, b, []), one([a, b, ...thirds], a, b, said)]).toEqual([true, false]);
    // The first of them has the third name, and neither is apart from one printed the same.
    expect([one([a, b, ...thirds], a, thirds[0]!, said), one([a, b, ...thirds], b, thirds[1]!, said)]).toEqual([true, false]);
    const again = as('A', { id: 'r_again', inSource: 'A2' }, 'v_1');
    expect(one([a, b, again, ...thirds], a, again, said)).toBe(true);
    // The household's own label comes before a sure one.
    const [theirs, hers] = [as('B', {}, 'v_2', 'household'), as('C', { person: ROBIN, inSource: 'C2', npi: '1' }, 'v_2', 'household')];
    const all = [a, theirs, thirds[0]!, hers];
    expect([one(all, theirs, hers, said), one(all, a, hers, said)]).toEqual([true, false]);
    // And what they said is one provider joins the names of a sure label two NPIs would keep apart.
    const two = [as('D', { npi: '1' }, 'v_h', 'household'), as('E', { npi: '2' }, 'v_h', 'household'), as('F', { npi: '1', inSource: 'F' }, 'v_s'), as('G', { npi: '2', inSource: 'G' }, 'v_s'), as('H', {}, 'v_s')];
    expect([one(two, two[0]!, two[1]!, []), one(two, two[4]!, two[3]!, [])]).toEqual([true, true]);
  });

  it('are put apart on everyone’s page only by what is not private', () => {
    const sam = index(SAM);
    const secret = { ...sam, providerLabels: { open: { ...sam.providerLabels!.open, said: [] }, closed: { ...sam.providerLabels!.closed, said: sam.providerLabels!.open.said } } };
    expect([saidApart(secret, false).length, saidApart(secret, true).length]).toEqual([0, 1]);
  });
});

describe('a provider’s page', () => {
  const page = (person: string, field: ProviderField, name: string, everyone: boolean, of: Store = SAID) => {
    const n = providersNamed(index(person, of), of.household).find((x) => x.field === field && x.name === name)!;
    return providerPage({ household: of.household, indexes: of.indexes, today: TODAY, marks: [] }, n, everyone);
  };

  it('has one label that says the same once, and what was said in each person’s records', () => {
    const all = page(ROBIN, 'provider', 'Example Health', true)!;
    expect(all.labels.map((l) => [l.label?.name, l.said.map((s) => s.kind)])).toEqual([['Example Health Partners', ['same', 'different']]]);
    expect(page(ALEX, 'practitioner', 'Dr. Morgan Placeholder', true)!.labels).toHaveLength(1);
    expect(page(ROBIN, 'provider', 'Example Lab', false)!.labels.map((l) => [l.label, l.said.map((s) => s.kind)])).toEqual([[undefined, ['wrong']]]);
    // One that is only likely in someone's records is not the same as a sure one.
    const alex = index(ALEX);
    const likely = { ...alex, providerLabels: { ...alex.providerLabels!, open: { ...alex.providerLabels!.open, labels: new Map([...alex.providerLabels!.open.labels].map(([id, l]) => [id, { ...l, confidence: 'likely' as const }])) } } };
    const n = providersNamed(likely, SAID.household).find((x) => x.field === 'practitioner' && x.name === 'Dr. Morgan Placeholder')!;
    expect(providerPage({ household: SAID.household, indexes: new Map([...SAID.indexes, [ALEX, likely]]), today: TODAY, marks: [] }, n, true)!.labels.map((l) => l.label?.confidence)).toEqual(['likely', 'sure']);
  });

  it('for everyone has no private label, nor what a private paper says of an open one', async () => {
    expect(page(SAM, 'provider', 'Example Sexual Health Clinic', true)).toBeUndefined();
    expect(page(SAM, 'provider', 'Example Sexual Health Clinic', false)!.labels.map((l) => l.label?.role)).toEqual(['clinic']);
    // The sample's one label by a paper.
    const casey = page(SAM, 'practitioner', 'Dr. Casey Placeholder', true, store)!;
    const paper = casey.labels[0]!.label!.evidence[0]!.document!;
    expect(casey.labels[0]!.label).toMatchObject({ practice: 'Example Health', confidence: 'likely' });
    const idx = index(SAM, store);
    if (idx.privacy?.kind !== 'known') throw new Error('not known');
    const secret: PersonIndex = { ...idx, privacy: { ...idx.privacy, documents: new Map([...idx.privacy.documents, [paper, 'household']]) } };
    const at = { person: SAM, id: casey.named.id, field: casey.named.field };
    const of = (everyone: boolean) => providerPage({ household: store.household, indexes: new Map([...store.indexes, [SAM, secret]]), today: TODAY, marks: [] }, at, everyone)!.labels;
    expect([of(true), of(false).map((l) => l.label?.practice)]).toEqual([[], ['Example Health']]);
    // Nor what a paper says that is in nobody's records.
    const nowhere = providerPage({ household: store.household, indexes: new Map([...store.indexes, [SAM, { ...idx, documents: idx.documents.filter((d) => d.id !== paper) }]]), today: TODAY, marks: [] }, at, true)!;
    expect(nowhere.labels).toEqual([]);
  });

  it('is read by the text an item prints, before it is tidied', () => {
    const sam = index(SAM);
    const r = printedAs(sam, 'practitioner', 'Dr. Casey Placeholder')[0]!;
    expect(namedOn(sam, SAID.household, r.id, 'practitioner')!.label?.label.role).toBe('orthopedic surgeon');
    const spaced = { ...sam, records: sam.records.map((x) => (x.id === r.id ? { ...x, fields: { ...x.fields, practitioner: 'Dr. Casey  Placeholder' } } : x)) };
    const n = namedOn(spaced, SAID.household, r.id, 'practitioner')!;
    expect([n.name, n.printed, n.label]).toEqual(['Dr. Casey Placeholder', 'Dr. Casey  Placeholder', undefined]);
  });
});
