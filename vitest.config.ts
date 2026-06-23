import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config shared by every TS package.
 *
 * Each package's `test` script runs `vitest run`, which inherits this config.
 * Place spec files next to sources as `*.test.ts` or under a package `test/` dir.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'core/**/*.test.ts',
      'apps/**/*.test.ts',
      'services/**/*.test.ts',
      'adapters/**/*.test.ts',
      'core/**/test/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    passWithNoTests: true,
  },
});
