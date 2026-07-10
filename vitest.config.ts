import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './src',
    include: ['**/__tests__/**/*.test.ts'],
    environment: 'node',
    // Pin process-isolated forks. The scanner subsystem keeps module-level
    // state (config cache, audit-plan defaults, incremental-walk maps); the
    // threads pool shares a module registry across test files in one worker,
    // so that state leaks and poisons sibling scanner tests. Forks give each
    // test file a fresh process. Vitest's default pool has drifted between
    // versions (4.0 vs 4.1), so this must be explicit for CI determinism.
    pool: 'forks',
  },
  resolve: {
    alias: {
      // Strip .js extension from imports for vitest
    },
  },
});
