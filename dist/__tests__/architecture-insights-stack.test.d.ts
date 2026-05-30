/**
 * Regression test for R6 stack-overflow on large/cyclic import graphs.
 *
 * Symptom (verified on atomize-ai 2026-05): scanning a project with ~2475
 * components and deep import chains caused `detectImportCycles` to throw
 * "Maximum call stack size exceeded" because its `visit()` helper recursed
 * once per import edge along the longest path. Node's default V8 stack tops
 * out around ~10–15k frames for this function's frame size; a single chain
 * of ~10k internal imports is enough to blow it (verified empirically with
 * `node -e` reproduction).
 *
 * The fix converts `visit()` to an explicit work-stack iteration. These tests
 * lock in the post-fix invariants:
 *   1. A 15,000-node deep linear import chain (well past the recursive limit)
 *      completes without throwing.
 *   2. A 15,000-node chain that closes into a cycle still detects exactly one
 *      cycle and reports it correctly.
 *   3. A graph mixing multiple cycles still respects the `limit` argument.
 */
export {};
//# sourceMappingURL=architecture-insights-stack.test.d.ts.map