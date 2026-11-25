import { describe, expect, it } from 'vitest';
import { offText, unsaidText } from '../src/next/moneyYear';

describe('the network discount’s words', () => {
  it('gives what was taken off what was charged, or that nothing was', () => {
    expect(offText(213570, 388500)).toBe('$2,135.70 off $3,885.00 charged, 55%');
    expect(offText(0, 8500)).toBe('Nothing off the $85.00 charged');
  });

  it('counts the visits and fills the discount order leaves off, apart', () => {
    expect(unsaidText(0, 0)).toBeNull();
    expect(unsaidText(1, 0)).toBe('1 visit has no network discount to show: a claim does not say what was charged, or the charges are below the network price. It is left off this order.');
    expect(unsaidText(2, 1)).toBe('2 visits and 1 prescription fill have no network discount to show: a claim does not say what was charged, or the charges are below the network price. They are left off this order.');
    expect(unsaidText(0, 2)).toMatch(/^2 prescription fills have /);
  });
});
