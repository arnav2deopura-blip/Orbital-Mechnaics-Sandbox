import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'archive', 'tools', '.agents', '.claude', '.codex', '.cursor'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // A leading underscore marks an argument or variable that is there on purpose and unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Tests and the worker boundary cast on purpose, to forge bad input; the source avoids `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
