import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { allergyList, conditionList, fold, isGiven, medicineList, recordsOf, saidOf, underHeadings, type ItemStanding, type ListItem, type MedicineItem } from '../src/model/lists';
import { parseIndex } from '../src/model/parse';
import { parsePrivate } from '../src/model/private';
import { parseStanding } from '../src/model/standing';
import { recentVisits } from '../src/model/visits';
import type { MedRecord, PersonIndex } from '../src/model/types';
import { careTeam, currentOf, doctorSheet, healthOf, openTo, privateOf } from '../src/next/health';
import { refillsDue } from '../src/next/needs';
import { fillText, inErrorText, isText, noProblemListText, saidLines, wordText } from '../src/ui/standing';

// The lists a person sees, made from medrec's own fixture for readers
// (tests/fixtures/standing/ in its repository, unmodified).
const read = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`./fixtures/standing/medrec/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const DAY = '2024-06-15';
const raw = read('standing.json');
const person = raw.person as string;
const idx: PersonIndex = { ...parseIndex(read('index.json'), person), standing: parseStanding(raw, person), privacy: privately() };
const id = (stem: string) => idx.records.find((r) => r.id.startsWith(`r_${stem}`))!.id;
const rec = (stem: string) => idx.records.find((r) => r.id === id(stem))!;

/** medrec's list of private items, with these records on it. */
function privately(...ids: string[]) {
  return parsePrivate({ schema: 'medrec-private/v1', person, records: Object.fromEntries(ids.map((x) => [x, { area: 'mental_health' }])), documents: {}, events: {} }, person, '0.9.9');
}
const hiding = (...stems: string[]): PersonIndex => ({ ...idx, privacy: privately(...stems.map(id)) });
const named = (xs: { name: string }[]) => xs.map((x) => x.name);
const find = <T extends { name: string }>(xs: T[], name: string) => xs.find((x) => x.name === name)!;
const said = (x: { standing?: ItemStanding }) => saidLines(x.standing!);

describe('conditions', () => {
  const c = conditionList(idx, DAY);

  it('are one line for each code, current while any source says so, in medrec’s order', () => {
    expect(named(c.active)).toEqual(['Sample stiffness', 'Sample ache', 'Sample rash', 'Sample cough', 'Sample itch', 'Sample tremor', 'Sample spasm', 'Sample strain', 'Sample swelling', 'Sample bruise', 'Sample graze']);
    expect(c.active.every((i) => i.isActive && i.standing!.group === 'current')).toBe(true);
    expect(new Set(c.active.map((i) => i.key)).size).toBe(c.active.length);
    // The same cough ended in 2019, and is current again: one line, and no source differs.
    expect(find(c.active, 'Sample cough')).toMatchObject({ records: [{ id: id('againaaaa') }], first: '2024-04-16', standing: { differs: false, against: [] } });
  });

  it('say what each source says, and what a record of another source says against it', () => {
    expect(find(c.active, 'Sample rash')).toMatchObject({ standing: { differs: true, against: [{ id: id('tworecordsot') }] } });
    expect(said(find(c.active, 'Sample rash'))).toEqual(['Example Health: active, read May 2, 2024', 'Sample Clinic East: resolved, read May 3, 2024']);
    expect(said(find(c.active, 'Sample stiffness'))).toEqual(['Example Health: active, read May 2, 2024']);
  });

  it('keep the ended apart from those ruled out and the diagnoses of visits, and all of them in all', () => {
    expect(c.ended.every((i) => i.standing!.of.is === 'ended')).toBe(true);
    expect(named(c.ended)).toEqual(['Sample rash', 'Sample chill', 'Sample knot', 'Sample blister', 'Sample lump', 'Sample cough']);
    expect(named(c.other)).toEqual(['Sample sprain', 'Sample itch', 'Sample fever', 'Sample hiccup']);
    expect(c.other.find((i) => i.name === 'Sample fever')!.refuted).toBe(true);
    expect(c.other.find((i) => i.name === 'Sample sprain')!.refuted).toBe(false);
    const all = idx.records.filter((r) => r.kind === 'condition' && idx.standing!.records.get(r.id)!.is !== 'error').map((r) => r.id);
    expect(c.all!.map((i) => i.latest.id).sort()).toEqual([...all].sort());
    expect(c.all!.every((i) => i.records.length === 1)).toBe(true);
    expect(named([...c.active, ...c.all!])).not.toContain('Sample burn');
    expect(c.notes).toEqual({ inError: 1, noProblemList: ['Example Walk-in'] });
  });

  it('are as if a record that may not be shown were not there', () => {
    const without = (...stems: string[]) => conditionList(idx, DAY, (x) => !stems.map(id).includes(x));
    expect(find(without('tworecordsot').active, 'Sample rash').standing).toMatchObject({ differs: false, against: [], said: [{ name: 'Example Health' }] });
    expect(named(without('tworecordsaa').active)).not.toContain('Sample rash');
    expect(without('erroraaa').notes!.inError).toBe(0);
    expect(without('tworecordsaa').all!.filter((i) => i.name === 'Sample rash').map((i) => i.latest.id)).toEqual([id('tworecordsot')]);
    expect(without('visitonly', 'onlistvisit', 'visitended').notes!.noProblemList).toEqual([]);
  });
});

describe('allergies', () => {
  it('are one line by name, whatever its case, and the rest is apart', () => {
    const a = allergyList(idx, DAY);
    const nut = find(a.current, 'Sample nut');
    expect(nut.records.map((r) => r.id)).toEqual([id('nutaaaa'), id('nutagain')]);
    expect(named(a.current)).toEqual(['Sample nut', 'Sample glue', 'Sample resin', 'Sample moss', 'Sample fern', 'Sample pollen']);
    expect(named(a.ended)).toEqual(['Sample dust', 'Sample latex', 'Sample fern']);
    expect(a.notes).toEqual({ inError: 1, noProblemList: [] });
    expect(named(a.all!)).not.toContain('Sample dye');
  });

  it('name the sources not heard', () => {
    const glue = find(allergyList(idx, DAY).current, 'Sample glue');
    expect([glue.standing!.unheard, said(glue)]).toEqual([['Example Health'], ['Sample Clinic East: inactive, read May 3, 2024', 'Example Health: not heard']]);
    expect(said(find(medicineList(idx, DAY).active, 'Sample balm'))).toEqual(['a source with no name: stopped', 'Example Health: not heard', 'Sample Clinic East: not heard']);
  });
});

describe('medicines', () => {
  const m = medicineList(idx, DAY);

  it('are each prescription by itself, on hold and ended by its date apart', () => {
    expect(named(m.onHold)).toEqual(['Sample patch']);
    expect(named(m.active)).toEqual(['Sample tablet', 'Sample tablet', 'Sample drops', 'Sample syrup', 'Sample cream', 'Sample spray', 'Sample powder', 'Sample balm', 'Sample rinse']);
    expect(named(m.endedByDate)).toEqual(['Sample capsule']);
    expect(named(m.past)).toEqual(['Sample gel', 'Sample lozenge']);
    expect(m.active.every((x) => x.active && x.standing!.group === 'current')).toBe(true);
    expect([...m.onHold, ...m.endedByDate, ...m.past].every((x) => !x.active)).toBe(true);
    expect([m.notes!.inError, named(m.all!).includes('Sample wafer')]).toEqual([2, false]);
  });

  it('put prescriptions of one medicine under its name', () => {
    const tablet = underHeadings(m.active).find((of) => of[0]!.name === 'Sample tablet')!;
    expect(tablet.map((x) => x.latest.id)).toEqual([id('noendaaaa'), id('noendtwice')]);
    expect(underHeadings(m.active).flat()).toHaveLength(m.active.length);
  });

  it('take the last fill given of the medicine, and none returned, entered in error or not to be shown', () => {
    const capsule = find(m.endedByDate, 'Sample capsule');
    expect([capsule.lastFill!.date, capsule.standing!.filled, capsule.known]).toEqual(['2024-05-02', '2024-05-02', expect.arrayContaining(['filled'])]);
    expect(capsule.records.map((r) => r.id)).toEqual([id('endsaaaa'), id('fillafter'), id('fillsoon'), id('fillbefore')]);
    const less = find(medicineList(idx, DAY, (x) => x !== id('fillafter')).endedByDate, 'Sample capsule');
    expect([less.lastFill!.date, less.standing!.filled]).toEqual(['2024-04-10', '2024-04-10']);
    // Its own date, not its fills'.
    expect([capsule.first, capsule.latest.id]).toEqual(['2024-02-18', id('endsaaaa')]);
  });

  it('take a fill of any status that says it was given, by its medicine’s code or name, and none entered in error by its verification alone', () => {
    const fill = (name: string, more: Partial<MedRecord>): MedRecord => ({ ...rec('fillafter'), id: `r_${name}`, ...more });
    const dates = (records: MedRecord[], wrong: string[] = []) => {
      const st = idx.standing!;
      const x = { ...idx, records: [...idx.records, ...records], standing: { ...st, inError: new Map([...st.inError, ['medication', [...st.inError.get('medication')!, ...wrong]]]) } };
      return find(medicineList(x, DAY).endedByDate, 'Sample capsule').records.slice(1).map((r) => r.date);
    };
    const usual = ['2024-05-02', '2024-04-10', '2024-03-05'];
    expect(dates([fill('none', { date: '2024-05-03', status: undefined }), fill('unknown', { date: '2024-05-04', status: 'unknown' }), fill('stopped', { date: '2024-05-05', status: 'stopped' })])).toEqual(['2024-05-04', '2024-05-03', ...usual]);
    expect(dates([fill('wrong', { date: '2024-05-06' })], ['r_wrong'])).toEqual(usual);
    expect(dates([fill('named', { date: '2024-05-07', code: undefined })])).toEqual(usual);
    const named = { ...idx, records: [...idx.records.map((r) => (r.id === id('endsaaaa') ? { ...r, code: undefined, display: 'Sample crème' } : r)), fill('accent', { date: '2024-05-08', code: undefined, display: 'SAMPLE CREME' })] };
    const st = idx.standing!;
    const byName = { ...named, standing: { ...st, records: new Map([...st.records, [id('endsaaaa'), { ...st.records.get(id('endsaaaa'))!, line: '~sample creme' }]]) } };
    expect(find(medicineList(byName, DAY).endedByDate, 'Sample crème').records.map((r) => r.date)).toEqual(['2024-02-18', '2024-05-08']);
  });

  it('are filled by what has the same name but for its punctuation, as medrec keys one', () => {
    const at = { ...rec('fillafter'), id: 'r_comma', date: '2024-05-08', code: undefined, display: 'Sample drops, 2,000-unit (b)' };
    const st = idx.standing!;
    const x = { ...idx, records: [...idx.records.map((r) => (r.id === id('endsaaaa') ? { ...r, code: undefined, display: 'Sample drops 2,000 unit/b' } : r)), at], standing: { ...st, records: new Map([...st.records, [id('endsaaaa'), { ...st.records.get(id('endsaaaa'))!, line: '~sample drops 2 000 unit b' }]]) } };
    expect(find(medicineList(x, DAY).endedByDate, 'Sample drops 2,000 unit/b').lastFill!.date).toBe('2024-05-08');
  });

  it('are keyed by a name in lowercase, without accents, and with one space for what is no letter or digit', () => {
    expect(['Vitamin D3 2,000 unit capsule', ' A-b  (2 %) ', 'Crème Ångström İı', 'Łøß Æther Đ', 'e\u0301clair', 'άλφα ½'].map(fold)).toEqual(['vitamin d3 2 000 unit capsule', 'a b 2', 'creme angstrom ii', 'loss aether d', 'eclair', 'άλφα ½']);
  });

  it('say of a fill that it was given, or what it is', () => {
    const st = idx.standing!;
    const wrong = { ...idx, standing: { ...st, inError: new Map([['medication', [id('fillafter')]]]) } };
    expect([fillText(idx, rec('fillafter')), fillText(idx, rec('fillreturned')), fillText(idx, rec('fillerror')), fillText(wrong, rec('fillafter'))]).toEqual(['Filled', 'Cancelled', 'Entered in error', 'Entered in error']);
    expect(['unknown', undefined, 'on-hold'].map((status) => fillText(idx, { ...rec('fillafter'), status }))).toEqual(['Filled', 'Filled', 'On hold']);
  });

  it('keep a medicine that only fills are known of as past, once', () => {
    const only = { ...idx, records: idx.records.filter((r) => r.id !== id('endsaaaa')) };
    const l = medicineList(only, DAY);
    const capsule = l.past.filter((x) => x.name === 'Sample capsule');
    expect(capsule.map((x) => [x.active, x.standing, x.records.length])).toEqual([[false, undefined, 3]]);
    expect(l.all!.at(-1)).toEqual(capsule[0]);
  });

  it('stay on the last day, and leave the day after', () => {
    const on = (day: string) => ['active', 'endedByDate'].filter((k) => named(medicineList(idx, day)[k as 'active']).includes('Sample capsule'));
    expect([on('2024-03-31'), on('2024-04-01')]).toEqual([['active'], ['endedByDate']]);
  });

  it('are known whole by their heading', () => {
    expect(recordsOf(idx, find(m.endedByDate, 'Sample capsule')).map((r) => r.id).sort()).toEqual(idx.records.filter((r) => r.display === 'Sample capsule').map((r) => r.id).sort());
    // The line is medrec's to say.
    const st = idx.standing!;
    const line = { ...idx, standing: { ...st, records: new Map([...st.records].map(([k, s]) => [k, k.startsWith('r_noend') ? { ...s, line: 'x' } : s])) } };
    expect(recordsOf(line, find(medicineList(line, DAY).active, 'Sample tablet')).map((r) => r.id)).toEqual([id('noendaaaa'), id('noendtwice')]);
  });
});

describe('in words', () => {
  it('a source’s word has its status, how sure it is, its end and the day it was read', () => {
    const w = (word: Partial<Parameters<typeof wordText>[0]['word']>) => wordText({ name: 'Example Health', word: { source: 0, is: 'current', ...word } });
    expect(w({ status: 'active', read: '2024-05-02' })).toBe('active, read May 2, 2024');
    expect(w({})).toBe('no status');
    expect(w({ verification: 'Unconfirmed' })).toBe('no status, unconfirmed');
    expect(w({ status: 'active', verification: 'confirmed' })).toBe('active');
    expect(w({ status: 'active', verification: 'refuted' })).toBe('active, ruled out');
    expect(w({ status: 'ENTERED_IN_ERROR', verification: 'entered-in-error' })).toBe('entered in error');
    expect(w({ status: 'on-hold' })).toBe('on hold');
    expect(w({ status: 'resolved', abatement: '2024-03-02' })).toBe('resolved, ended Mar 2, 2024');
    expect(w({ status: 'active', end: '2024-03-31', endOf: 'prescription' })).toBe('active, ends Mar 31, 2024 (prescription)');
    expect(w({ status: 'active', end: '2024-03' })).toBe('active, ends Mar 2024');
  });

  it('a record is what medrec’s rules make of it', () => {
    const is = (stem: string) => isText(idx.standing!.records.get(id(stem))!, DAY);
    expect(['plain', 'onhold', 'draft', 'bothended', 'refutedaaaa', 'visitonly', 'erroraaa'].map(is)).toEqual(['Current', 'On hold', 'Draft', 'Ended', 'Ruled out', 'Diagnosis from a visit', 'Entered in error']);
    const ends = idx.standing!.records.get(id('endsaaaa'))!;
    expect([isText(ends, DAY), isText(ends, DAY, '2024-05-02'), isText({ ...ends, untilOf: undefined }, DAY)]).toEqual([
      'Ended by its date, Mar 31, 2024 (prescription)',
      'Ended by its date, Mar 31, 2024 (prescription), filled May 2, 2024',
      'Ended by its date, Mar 31, 2024',
    ]);
  });

  it('a list says what medrec’s rules have it say', () => {
    expect([inErrorText(2), noProblemListText('Sample Clinic'), noProblemListText('Sample Clinic', 'not on this sheet')]).toEqual([
      '2 entered in error, not shown',
      'No problem list from Sample Clinic; diagnoses from visits are listed under All',
      'No problem list from Sample Clinic; diagnoses from visits are not on this sheet',
    ]);
  });

  it('one entered in error still says what each source says', () => {
    const error = idx.standing!.records.get(id('erroraaa'))!;
    expect(saidLines(saidOf(idx.standing!, { records: [id('erroraaa')], against: [], unheard: error.unheard }))).toEqual(['Example Health: no status, entered in error, read May 2, 2024']);
  });
});

describe('Health', () => {
  it('has what is current by every source’s word, and what is on hold or ended by its date apart', () => {
    const h = healthOf(idx, DAY);
    expect([named(h.conditions), named(h.onHold), named(h.endedByDate)]).toEqual([named(conditionList(idx, DAY).active), ['Sample patch'], named(medicineList(idx, DAY).endedByDate)]);
    expect(h.notes.conditions).toEqual(conditionList(idx, DAY).notes);
    expect(h.quiet.conditions).toHaveLength(conditionList(idx, DAY).ended.length + conditionList(idx, DAY).other.length);
  });

  it('marks what has a private record, beside its own or against it, and leaves that record out of a shared screen', () => {
    const p = hiding('tworecordsot', 'nutagain', 'fillafter');
    const h = healthOf(p, DAY);
    expect([privateOf(p, find(h.conditions, 'Sample rash')), privateOf(p, find(h.allergies, 'Sample nut')), privateOf(p, find(h.endedByDate, 'Sample capsule')), privateOf(p, find(h.conditions, 'Sample ache'))]).toEqual(['mental_health', 'mental_health', 'mental_health', undefined]);
    const shared = currentOf(p, DAY, openTo(p));
    expect(find(shared.conditions, 'Sample rash').standing!.differs).toBe(false);
    expect(find(shared.allergies, 'Sample nut').records.map((r) => r.id)).toEqual([id('nutaaaa')]);
    expect(find(shared.endedByDate, 'Sample capsule').lastFill!.date).toBe('2024-04-10');
  });

  it('shows nothing of a person whose private items are not known', () => {
    const held = { ...idx, privacy: undefined };
    const shared = currentOf(held, DAY, openTo(held));
    expect([shared.conditions, shared.medicines, shared.allergies, shared.onHold, shared.endedByDate]).toEqual([[], [], [], [], []]);
    expect(shared.notes.conditions).toEqual({ inError: 0, noProblemList: [] });
  });
});

describe('a doctor’s sheet', () => {
  it('is made of what may be shown, and counts what it leaves off', () => {
    const p = hiding('tworecordsot', 'onhold', 'fillafter', 'erroraaa');
    const off = doctorSheet(p, DAY, false);
    expect([off.notes.conditions!.inError, doctorSheet(p, DAY, true).notes.conditions!.inError]).toEqual([0, 1]);
    expect([off.privateLeft, off.onHold, find(off.problems, 'Sample rash').standing!.differs]).toEqual([3, [], false]);
    expect([...off.leftFrom].sort()).toEqual(['medicines', 'problems']);
    const on = doctorSheet(p, DAY, true);
    expect([on.privateLeft, named(on.onHold), find(on.problems, 'Sample rash').standing!.differs]).toEqual([0, ['Sample patch'], true]);
  });

  it('counts a medicine once, however many prescriptions of it are there beside a private fill', () => {
    const fill: MedRecord = { ...rec('fillafter'), id: 'r_tabletfill', display: 'Sample tablet', code: rec('noendaaaa').code };
    const more: PersonIndex = { ...idx, records: [...idx.records, fill], privacy: privately('r_tabletfill') };
    const off = doctorSheet(more, DAY, false);
    expect([off.privateLeft, off.medicines.filter((m) => m.name === 'Sample tablet').length, [...off.leftFrom]]).toEqual([1, 2, ['medicines']]);
    // One of them on hold is of the same medicine.
    const st = idx.standing!;
    const held = new Map(st.records).set(id('noendtwice'), { ...st.records.get(id('noendtwice'))!, is: 'on_hold' });
    const both = { ...more, standing: { ...st, records: held } };
    expect([named(healthOf(both, DAY).onHold), doctorSheet(both, DAY, false).privateLeft]).toEqual([['Sample tablet', 'Sample patch'], 1]);
  });

  it('names who prescribes what is current, by prescriptions that may be shown', () => {
    const prescribed = (x: PersonIndex, stem: string, prescriber: string): PersonIndex => ({ ...x, records: x.records.map((r): MedRecord => (r.id === id(stem) ? { ...r, fields: { ...r.fields, prescriber } } : r)) });
    const p = prescribed(prescribed(idx, 'noendaaaa', 'Dr. Sample One'), 'endsaaaa', 'Dr. Sample Two');
    expect(careTeam(p, DAY).map((m) => [m.name, m.prescribes])).toEqual([['Dr. Sample One', ['Sample tablet']]]);
    expect(careTeam(p, DAY, (r) => r.id !== id('noendaaaa'))).toEqual([]);
    // Whoever prescribed a fill may have done it for another prescription of the medicine.
    const fill: MedRecord = { ...rec('fillafter'), id: 'r_tabletfill', date: '2024-06-01', display: 'Sample tablet', code: rec('noendaaaa').code, fields: { source: 'dispense', prescriber: 'Dr. Sample Three' } };
    const filled = { ...p, records: [...p.records, fill] };
    expect(medicineList(filled, DAY).active.filter((m) => m.name === 'Sample tablet').map((m) => [m.prescriber, m.lastFill!.date])).toEqual([
      ['Dr. Sample One', '2024-06-01'],
      [undefined, '2024-06-01'],
    ]);
    expect(careTeam(filled, DAY).map((m) => m.name)).toEqual(['Dr. Sample One']);
    expect(medicineList({ ...filled, records: filled.records.filter((r) => r.display !== 'Sample tablet' || r.id === 'r_tabletfill') }, DAY).past.find((m) => m.name === 'Sample tablet')!.prescriber).toBe('Dr. Sample Three');
  });
});

describe('refills', () => {
  const supplied = (stems: [string, string, number][]): PersonIndex => ({
    ...idx,
    records: [...idx.records, ...stems.map(([name, date, days]): MedRecord => ({ ...rec('fillafter'), id: `r_supply${name}`, date, display: 'Sample tablet', code: rec('noendaaaa').code, fields: { source: 'dispense', days_supply: days } }))],
  });

  it('are asked for once for a medicine, however many prescriptions of it are current', () => {
    const due = refillsDue(supplied([['a', '2024-05-20', 30]]), DAY);
    expect(due.map((r) => [r.medicine.name, r.runsOut, r.private])).toEqual([['Sample tablet', '2024-06-19', undefined]]);
  });

  it('are private when any record of the medicine is: a fill that may not be shown can be the newest', () => {
    const p = supplied([['a', '2024-05-20', 30], ['b', '2024-06-10', 10]]);
    const due = (x: PersonIndex) => refillsDue(x, DAY).map((r) => [r.runsOut, r.private]);
    expect(due({ ...p, privacy: privately('r_supplyb') })).toEqual([['2024-06-20', 'mental_health']]);
    expect(due({ ...p, privacy: privately(id('noendtwice')) })).toEqual([['2024-06-20', 'mental_health']]);
  });

  it('are not asked for of a medicine ended by its date', () => {
    const p: PersonIndex = { ...idx, records: idx.records.map((r) => (r.id === id('fillafter') ? { ...r, date: '2024-06-01', fields: { ...r.fields, days_supply: 20 } } : r)) };
    expect(refillsDue(p, DAY)).toEqual([]);
  });
});

describe('without standing.json', () => {
  it('each list counts those of its kind that are entered in error, of what may be shown', () => {
    const wrong = (['condition', 'condition', 'allergy', 'medication'] as const).map((kind, i) => ({ ...idx.records[0]!, id: `r_wrong${i}`, kind }));
    const before = { ...idx, standing: undefined, inError: { records: wrong, documents: [] } };
    const counts = (may?: (id: string) => boolean) => [conditionList, allergyList, medicineList].map((list) => list(before, DAY, may).notes.inError);
    expect([counts(), counts((x) => x !== 'r_wrong1'), counts(() => false)]).toEqual([
      [2, 1, 1],
      [1, 1, 1],
      [0, 0, 0],
    ]);
  });

  it('a fill and a visit that stand are there, whatever their status says', () => {
    const fill = idx.records.find((r) => r.id === id('fillafter'))!;
    const visit = { ...fill, id: 'r_visit', kind: 'encounter' as const, date: '2024-06-01' };
    const is = (status: string | undefined, stands?: true) => {
      const as = (r: MedRecord) => ({ ...r, status, ...(stands ? { stands } : {}) });
      return [isGiven(as(fill)), recentVisits({ ...idx, records: [as(visit)] }, DAY).length];
    };
    expect([is('entered-in-error'), is('entered-in-error', true), is('cancelled'), is('planned'), is(undefined), is('completed')]).toEqual([
      [false, 0],
      [true, 1],
      [false, 0],
      [false, 0],
      [true, 1],
      [true, 1],
    ]);
  });

  it('lists go by each record’s own status, and nothing is said of sources', () => {
    const before = { ...idx, standing: undefined };
    const c = conditionList(before, DAY);
    expect([c.all, c.notes, c.active.some((i: ListItem) => i.standing)]).toEqual([undefined, { inError: 0, noProblemList: [] }, false]);
    expect(named(c.ended)).toContain('Sample knot');
    const m = medicineList(before, DAY);
    expect([m.onHold, m.endedByDate, m.all, m.active.some((i: MedicineItem) => i.standing)]).toEqual([[], [], undefined, false]);
    expect(recordsOf(before, m.active[0]!)).toBe(m.active[0]!.records);
    expect(named(conditionList(before, DAY, (x) => x !== id('plain')).active)).not.toContain('Sample stiffness');
    // All of an item, or none of it.
    expect([named(c.active), named(conditionList(before, DAY, (x) => x !== id('onlistvisit')).active)].map((xs) => xs.includes('Sample itch'))).toEqual([true, false]);
  });
});
