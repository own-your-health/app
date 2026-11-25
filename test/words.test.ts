// The records' words as the screens show them: billing descriptors kept out
// of headlines, a store's number said once, and no portal platform as a place.
import { describe, expect, it } from 'vitest';
import { capitalWord, isDescriptor, placeName, plainWords, sentenceCase, tidyName } from '../src/model/words';

describe('billing descriptors', () => {
  it('are two or more words in capitals, which a household never writes', () => {
    for (const text of ['NEW VISIT LEVEL FOUR', 'RETURN VISIT LEVEL TWO', 'TEST W/NOTES']) expect(isDescriptor(text)).toBe(true);
    for (const text of ['MRI', 'HbA1c', 'Office visit', 'Vitamin D3 2,000 unit capsule', 'COVID-19 vaccine']) expect(isDescriptor(text)).toBe(false);
  });

  it('give way to plain words', () => {
    expect([plainWords('NEW VISIT LEVEL FOUR'), plainWords('Sick visit'), plainWords(undefined)]).toEqual([undefined, 'Sick visit', undefined]);
  });
});

describe('one word in capitals', () => {
  it('is an abbreviation when it has 5 letters or fewer, and a word when it has more', () => {
    for (const text of ['HTN', 'GERD', 'COVID-19', 'T2DM', 'ANGST']) expect(capitalWord(text), text).toBe('abbreviation');
    for (const text of ['ASTHMA', 'HEPATITIS-B', 'ÉCZÉMA', ' ASTHMA ']) expect(capitalWord(text), text).toBe('word');
  });

  it('is neither with a small letter, a space or a second word, nor with no capitals', () => {
    for (const text of ['Asthma', 'HbA1c', 'PVCs', 'McARDLE', 'HTN 2', 'PRE-ECLAMPSIA', 'SEASONAL ASTHMA', 'I10', 'J', '高血圧', '']) expect(capitalWord(text), text).toBeUndefined();
  });

  it('reads in sentence case, a letter that stands alone as it was', () => {
    expect(['ASTHMA', 'HEPATITIS-B', 'ÉCZÉMA', 'ASTHMA-COPD'].map(sentenceCase)).toEqual(['Asthma', 'Hepatitis-B', 'Éczéma', 'Asthma-copd']);
  });
});

describe('places', () => {
  it('say a store’s number once', () => {
    expect([tidyName('Example Pharmacy #1234 1234'), tidyName('Example Pharmacy #1234'), tidyName('Example  Clinic '), tidyName(' ')]).toEqual(['Example Pharmacy #1234', 'Example Pharmacy #1234', 'Example Clinic', undefined]);
  });

  it('are never a portal platform’s name, which stands for a sign-in', () => {
    for (const name of ['Example Records (all practices)', 'athenahealth', 'MyChart', 'MyChart (Example Health)', 'Patient Portal', 'Veradigm', 'Example Health (all locations)']) expect(placeName(name)).toBeUndefined();
    for (const name of ['Example Pediatrics', 'Epic Dermatology Example', 'Example Clinic (Main Street)']) expect(placeName(name)).toBe(name);
    expect(placeName('Example Pharmacy #1234 1234')).toBe('Example Pharmacy #1234');
  });
});
