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
    // The fork pool also gives every test file its own process-level $HOME,
    // which is what lets `setupFiles` below install one fake home per file
    // with no cross-file interference.
    pool: 'forks',
    // Redirects $HOME (and USERPROFILE, NAVGATOR_HOME) to a per-file tmp
    // directory before any test module imports, so tests that build a tmp
    // project and call scan()/registerProject() never write the developer's
    // real ~/.navgator. See the file header for the full mechanism and the
    // measured drift this closes (+42 registry entries per `npm test` run).
    setupFiles: ['./__tests__/setup/home-redirect.ts'],
  },
  resolve: {
    alias: {
      // Strip .js extension from imports for vitest
    },
  },
});
