import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The stylesheet uses no CSS nesting, so a rule inside another rule is a
// missing brace: browsers with nesting would read it as a descendant
// selector, and the rule would silently not apply.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the stylesheet', () => {
  it('closes every rule, and nests rules only in at-rules', () => {
    const open: { atRule: boolean; selector: string }[] = [];
    let start = 0;
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (c === '{') {
        const selector = css.slice(start, i).split(/[;}]/).pop()!.trim();
        const parent = open[open.length - 1];
        if (parent && !parent.atRule) expect.fail(`"${selector}" opens inside "${parent.selector}"`);
        open.push({ atRule: selector.startsWith('@'), selector });
        start = i + 1;
      } else if (c === '}') {
        expect(open.length, 'a } with nothing open').toBeGreaterThan(0);
        open.pop();
        start = i + 1;
      }
    }
    expect(open.map((o) => o.selector)).toEqual([]);
  });
});
