// What the app hears pdf.js say as it leaves a part of a page out is what the
// pinned version says.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LEFT_OUT } from '../src/paper/leftOut';

it('is in the words of the pdf.js that is built in', () => {
  const worker = readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'utf8');
  const before = 'Warning: ';
  expect(worker).toContain(`console.warn(\`${before}${'${msg}'}\`)`);
  for (const words of LEFT_OUT) expect(worker, words).toContain(words.startsWith(before) ? `new ${words.slice(before.length)}("Unsupported ShadingType` : words);
  // Any other warning that something is ignored is of how a page is drawn, its words to select, or a form's field that has an appearance.
  const said = [...worker.matchAll(/warn\(`((?:\w+ - ignoring|Unable to decode)[^`$]*)/g)].map((m) => m[1]!.replace(/[\s:"(]+$/, ''));
  expect([...new Set(said.filter((s) => !LEFT_OUT.some((x) => s.includes(x))))].sort()).toEqual([
    '_handleColorSpace - ignoring ColorSpace',
    'extractDataStructures - ignoring CIDToGIDMap data',
    'getAnnotationsData - ignoring textContent during',
    'getHexString - ignoring invalid character',
    'getOperatorList - ignoring ExtGState',
    'getOperatorList - ignoring beginMarkedContentProps',
    'getOperatorList - ignoring operator',
    'getTextContent - ignoring ExtGState',
    'getTextContent - ignoring XObject',
    'getTextContent - ignoring errors during',
    'parseAppearanceStream - ignoring errors',
    'parseDefaultAppearance - ignoring errors',
    'readToUnicode - ignoring ToUnicode data',
  ]);
});
