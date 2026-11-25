// Stands in for pdftotext, so the sample's papers read the same on every
// machine: the lines of a PDF that papers.mjs made, a form feed after each
// page. medrec runs it through a link named pdftotext.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('-v')) {
  console.error('pdftotext version sample');
} else {
  const pdf = readFileSync(args.at(-2), 'latin1');
  const pages = [...pdf.matchAll(/stream\n([\s\S]*?)endstream/g)].map(([, page]) => [...page.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map(([, text]) => text.replace(/\\(.)/g, '$1')));
  process.stdout.write(pages.map(([heading, ...lines]) => `${[heading, '', ...lines].join('\n')}\n\f`).join(''));
}
