// What the screens call each person: their first name, unless another
// person in the household shares it.
import { describe, expect, it } from 'vitest';
import { parseHousehold } from '../src/model/parse';
import { called, firstNames } from '../src/model/people';
import { demoJson } from './helpers';

describe('first names', () => {
  it('are each person’s first word, or their full name where two share it', () => {
    expect(firstNames([{ name: 'Robin Example' }, { name: 'Sam Example' }, { name: 'Drew' }])).toEqual(['Robin', 'Sam', 'Drew']);
    expect(firstNames([{ name: 'Robin Example' }, { name: 'robin Sample' }, { name: 'Sam Example' }])).toEqual(['Robin Example', 'robin Sample', 'Sam']);
  });

  it('come with the household, and a person built without one keeps their full name', () => {
    const household = parseHousehold(demoJson('household.json'));
    expect(household.people.map(called)).toEqual(['Robin', 'Sam', 'Alex', 'Drew']);
    expect(household.people.map((p) => p.name)).toEqual(['Robin Example', 'Sam Example', 'Alex Example', 'Drew Example']);
    expect(called({ name: 'Casey Example' })).toBe('Casey Example');
  });
});
