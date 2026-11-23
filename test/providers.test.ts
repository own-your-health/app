import { describe, expect, it } from 'vitest';
import { sameProvider } from '../src/model/providers';

describe('providers', () => {
  it('match by name, ignoring case, punctuation, Inc and LLC, or one name inside the other', () => {
    expect(sameProvider('Example Health', 'EXAMPLE HEALTH, Inc.')).toBe(true);
    expect(sameProvider('Example Health', 'Example Health Main Clinic')).toBe(true);
    expect(sameProvider('Example Health', 'Example Lab')).toBe(false);
    expect(sameProvider('Example Health', 'Example Healthcare')).toBe(false);
    // One name, spelled with and without the space.
    expect(sameProvider('United Healthcare', 'UnitedHealthcare')).toBe(true);
    expect(sameProvider('UnitedHealthcare', 'United Healthcare Insurance Company')).toBe(true);
    expect(sameProvider('Example Health Plan', 'ExampleHealth')).toBe(true);
    expect(sameProvider('Example Health', 'Example Healthcare Plan')).toBe(false);
    expect(sameProvider(undefined, 'Example Health')).toBe(false);
  });
});
