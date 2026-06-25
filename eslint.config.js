import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config covering the TS side of the monorepo.
 *
 * Intentionally NOT type-checked (no `parserOptions.project`) so CI can lint
 * without building first. `templates/**` is ignored because it contains token
 * placeholders, not real source.
 */
export default tseslint.config(
  {
    // Build output, dependencies, the Python virtualenv (bundles third-party JS),
    // and token-placeholder templates are not lintable source.
    ignores: [
      '**/dist/**',
      '**/dist-renderer/**',
      '**/node_modules/**',
      '**/.venv/**',
      'templates/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
