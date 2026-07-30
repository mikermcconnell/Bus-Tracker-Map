const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'frontend/dist/**',
      'cache/**',
      'artifacts/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['frontend/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        L: 'readonly',
      },
    },
  },
  {
    files: [
      'api/**/*.js',
      'monitor/**/*.js',
      'scripts/**/*.js',
      'server/**/*.js',
      'shared/**/*.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['tests/**/*.js', 'e2e/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
];
