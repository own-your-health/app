// The records' words as the screens show them: billing descriptors kept out
// of headlines, a store's number said once, and no portal platform as a place.
import { describe, expect, it } from 'vitest';
import { isDescriptor, placeName, plainWords, tidyName } from '../src/model/words';

describe('billing descriptors', () => {
  it('are two or more words in capitals, which a household never writes', () => {
    for (const text of ['FIRST APPOINTMENT TIER THREE', 'RETURN APPOINTMENT TIER THREE', 'TEST W/NOTES']) expect(isDescriptor(text)).toBe(true);
    for (const text of ['MRI', 'HbA1c', 'Office visit', 'Vitamin D3 2,000 unit capsule', 'COVID-19 vaccine']) expect(isDescriptor(text)).toBe(false);
  });

  it('give way to plain words', () => {
    expect([plainWords('FIRST APPOINTMENT TIER THREE'), plainWords('Sick visit'), plainWords(undefined)]).toEqual([undefined, 'Sick visit', undefined]);
  });
});

describe('places', () => {
  it('say a store’s number once', () => {
    expect([tidyName('Example Pharmacy #1234 1234'), tidyName('Example Pharmacy #1234'), tidyName('Example  Clinic '), tidyName(' ')]).toEqual(['Example Pharmacy #1234', 'Example Pharmacy #1234', 'Example Clinic', undefined]);
  });

  it('are never a portal platform’s name, which stands for a sign-in', () => {
    for (const name of ['athenahealth (all practices)', 'athenahealth', 'MyChart', 'MyChart (Example Health)', 'Patient Portal', 'Veradigm', 'Example Health (all locations)']) expect(placeName(name)).toBeUndefined();
    for (const name of ['Example Pediatrics', 'Epic Dermatology Example', 'Example Clinic (Main Street)']) expect(placeName(name)).toBe(name);
    expect(placeName('Example Pharmacy #1234 1234')).toBe('Example Pharmacy #1234');
  });
});
