import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Record content reaches the page only as text. These rules keep HTML
// parsing sinks and dynamic code out of the app.
const noHtmlSinks = {
  'no-restricted-properties': [
    'error',
    { property: 'innerHTML', message: 'Build nodes with ui/dom.ts; record content is text only.' },
    { property: 'outerHTML', message: 'Build nodes with ui/dom.ts; record content is text only.' },
    { property: 'insertAdjacentHTML', message: 'Build nodes with ui/dom.ts; record content is text only.' },
    { object: 'document', property: 'write', message: 'Not allowed.' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
    { selector: "NewExpression[callee.name='Function']", message: 'No Function constructor.' },
    {
      selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(on|style$|srcdoc$)/]",
      message: 'No inline handlers or styles: the Content-Security-Policy refuses them.',
    },
  ],
  'no-implied-eval': 'error',
};

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: noHtmlSinks,
  },
  {
    // Run in the PDF worker as it is (src/paper/pdf.ts).
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.worker },
    rules: noHtmlSinks,
  },
  {
    // Served as they are: public/theme.js runs in the page's head.
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
    rules: noHtmlSinks,
  },
  {
    files: ['test/**/*.ts', 'e2e/**/*.ts', 'scripts/**/*.{ts,mjs}', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
);
