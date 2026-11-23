import { describe, expect, it } from 'vitest';
import { planBasisText } from '../src/ui/views/costs';

describe('where the Costs screen says a plan year came from', () => {
  it('says it once when every plan shares it', () => {
    expect(planBasisText([{ insurer: 'Example Health Plan', basis: 'calendar' }])).toBe('Plan year assumed to be the calendar year; your plan’s records don’t say.');
    expect(planBasisText([{ insurer: 'Example Health Plan', basis: 'setting' }])).toBe('Plan year as set in Settings; your plan’s records don’t say.');
    expect(planBasisText([{ insurer: 'Example Health Plan', basis: 'claims' }])).toBe('Plan year from your plan’s claims.');
    expect(
      planBasisText([
        { insurer: 'Example Health Plan', basis: 'calendar' },
        { insurer: 'Example Pharmacy Benefits', basis: 'calendar' },
      ]),
    ).toBe('Plan year assumed to be the calendar year; your plans’ records don’t say.');
  });

  it('names the plans each sentence is for when they differ, in the same words', () => {
    expect(
      planBasisText([
        { insurer: 'Example Care Plan', basis: 'claims' },
        { insurer: 'Example Health Plan', basis: 'setting' },
        { insurer: 'Example Health Plan', basis: 'setting' },
      ]),
    ).toBe('Example Care Plan: plan year from your plan’s claims. Example Health Plan: plan year as set in Settings; your plan’s records don’t say.');
  });
});
