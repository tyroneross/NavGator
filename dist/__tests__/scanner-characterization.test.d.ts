/**
 * Characterization tests for the three connection scanners (Wave 2 T9).
 *
 * These tests SNAPSHOT the current output of each scanner against the
 * `__tests__/fixtures/bench-repo` fixture. They are NOT correctness tests —
 * they lock the current behavior (including known imperfections) so that
 * subsequent SCIP integration work (T10/T11) reveals exactly what changed.
 *
 * If a scanner's output legitimately changes (e.g., a new heuristic catches
 * a previously-missed pattern), update the snapshot deliberately:
 *     vitest run -u src/__tests__/scanner-characterization.test.ts
 *
 * If a snapshot diff appears unintentionally, treat it as a regression.
 */
export {};
//# sourceMappingURL=scanner-characterization.test.d.ts.map