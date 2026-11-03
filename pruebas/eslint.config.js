'use strict';
const path = require('path');
const base = '/opt/node-tools/node_modules/';
let recommended;
try { recommended = require(base + '@eslint/js').configs.recommended.rules; } catch (e) {
  const reglas = require(path.join(base, 'eslint', 'lib', 'rules')); recommended = {};
  for (const [k, v] of reglas.entries()) { if (v && v.meta && v.meta.docs && v.meta.docs.recommended) recommended[k] = 'error'; } }
const g = `window document console navigator location history screen alert confirm prompt setTimeout clearTimeout setInterval clearInterval requestAnimationFrame fetch localStorage sessionStorage crypto performance innerWidth innerHeight Blob File FileReader URL URLSearchParams MutationObserver Event Image Node Element HTMLElement getComputedStyle showSaveFilePicker GM_getValue GM_setValue GM_download unsafeWindow addEventListener`.split(/\s+/);
const globals = {}; g.forEach((x) => { globals[x] = 'readonly'; });
module.exports = [{ files: ['*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals }, rules: {
  ...recommended,
  'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }], eqeqeq: ['error', 'always', { null: 'ignore' }], 'no-var': 'error', 'prefer-const': 'error',
  'no-use-before-define': ['error', { functions: false, classes: true, variables: false }], 'no-shadow': 'error', 'no-implicit-globals': 'error', 'no-unused-expressions': 'error',
  'consistent-return': 'error', 'require-await': 'error', 'no-else-return': 'error', 'no-lonely-if': 'error', 'no-trailing-spaces': 'error', semi: ['error', 'always'],
  quotes: ['error', 'single', { avoidEscape: true }], indent: ['error', 2, { SwitchCase: 1 }],
  'max-len': ['error', { code: 200, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true, ignoreComments: true }],
  'max-lines-per-function': ['warn', { max: 40, skipBlankLines: true, skipComments: true, IIFEs: false }], complexity: ['warn', 10], 'max-depth': ['warn', 3] } }];
