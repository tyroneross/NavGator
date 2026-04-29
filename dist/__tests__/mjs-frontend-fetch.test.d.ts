/**
 * Regression tests for two scanner blind spots discovered in agent-studio
 * (NavGator lessons navg-mjs-skip + navg-fetch-miss).
 *
 *   1. The main file glob in `scanner.ts` and `import-scanner.ts` skipped
 *      `.mjs` and `.cjs` files entirely, so anything in `app/lib/*.mjs` was
 *      invisible to the architecture graph.
 *
 *   2. The fetch('/api/...') second pass in `import-scanner.ts` filtered with
 *      `file.includes('/app/')`, which never matches top-level `app/page.js`
 *      or `app/canvas/page.js` (no leading slash). Frontend pages at the
 *      project root were silently excluded from API-call detection,
 *      surfacing as false-positive orphan endpoints in `navgator dead`.
 *
 *   3. `resolveApiRoute` only considered `route.{ts,tsx,js}` route files,
 *      missing Next.js App Router routes authored as `route.mjs` / `route.cjs`.
 */
export {};
//# sourceMappingURL=mjs-frontend-fetch.test.d.ts.map