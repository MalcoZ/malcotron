import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Musical timing must go through src/audio/clock.ts (M0 brief, task 7).
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'setInterval', message: 'Use the clock module for timing.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use the clock module for timing.' },
        { object: 'performance', property: 'now', message: 'Use the clock module for timing.' },
      ],
    },
  },
  {
    // End-to-end tests reach into the page's debug object, which is untyped there.
    files: ['tests/e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // The mic capture worklet runs in the audio thread, which has its own globals.
    files: ['public/capture-worklet.js'],
    languageOptions: { globals: { ...globals.audioWorklet } },
  },
  prettier,
);
