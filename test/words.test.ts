// The records' words as the screens show them: billing descriptors kept out
// of headlines, a store's number said once, and no portal platform as a place.
import { describe, expect, it } from 'vitest';
import { capitalWord, isDescriptor, placeName, plainWords, sentenceCase, tidyName } from '../src/model/words';

describe('billing descriptors', () => {
  it('are two or more words in capitals, which a household never writes', () => {
    for (const text of ['EYE EXAM DILATED', 'THERAPY SESSION EXTENDED', 'FITTING W/ADJUSTMENT']) expect(isDescriptor(text)).toBe(true);
    for (const text of ['DXA', 'SpO2', 'Home visit', 'Fish oil 1,200 mg softgel', 'SPF-50 sunscreen']) expect(isDescriptor(text)).toBe(false);
  });

  it('give way to plain words', () => {
    expect([plainWords('EYE EXAM DILATED'), plainWords('Hearing check'), plainWords(undefined)]).toEqual([undefined, 'Hearing check', undefined]);
  });
});

describe('one word in capitals', () => {
  it('is an abbreviation when it has 5 letters or fewer, and a word when it has more', () => {
    for (const text of ['TMJ', 'DVT', 'TOOTH-14', 'L5OA', 'MUMPS']) expect(capitalWord(text), text).toBe('abbreviation');
    for (const text of ['BUNION', 'INFLUENZA-A', 'ÉCORCHÉ', ' BUNION ']) expect(capitalWord(text), text).toBe('word');
  });

  it('is neither with a small letter, a space or a second word, nor with no capitals', () => {
    for (const text of ['Bunion', 'SpO2', 'TMJs', 'McBURNEY', 'TMJ 2', 'CROSS-BITE', 'FROZEN SHOULDER', 'J00', 'K', '白内障', '']) expect(capitalWord(text), text).toBeUndefined();
  });

  it('reads in sentence case, a letter that stands alone as it was', () => {
    expect(['BUNION', 'INFLUENZA-A', 'ÉCORCHÉ', 'BUNION-TMJ'].map(sentenceCase)).toEqual(['Bunion', 'Influenza-A', 'Écorché', 'Bunion-tmj']);
  });
});

describe('places', () => {
  it('say a store’s number once', () => {
    expect([tidyName('Example Optical #602 602'), tidyName('Example Optical #602'), tidyName('Example  Clinic '), tidyName(' ')]).toEqual(['Example Optical #602', 'Example Optical #602', 'Example Clinic', undefined]);
  });

  it('are never a portal platform’s name, which stands for a sign-in', () => {
    for (const name of ['Example Records (all practices)', 'athenahealth', 'MyChart', 'MyChart (Example Health)', 'Patient Portal', 'Veradigm', 'Example Health (all locations)']) expect(placeName(name)).toBeUndefined();
    for (const name of ['Example Dental Studio', 'Epic Eyewear Example', 'Example Clinic (Placeholder Lane)']) expect(placeName(name)).toBe(name);
    expect(placeName('Example Optical #602 602')).toBe('Example Optical #602');
  });
});
