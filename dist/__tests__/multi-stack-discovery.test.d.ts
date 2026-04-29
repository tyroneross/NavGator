/**
 * B3: multi-stack root discovery.
 *
 * Builds a temp dir tree to mirror common shapes:
 *   1. Single-root project — root has package.json. Should return `.`.
 *   2. Frontend/Backend split — no manifest at root, frontend/package.json,
 *      backend/pyproject.toml. Should return both subroots.
 *   3. Mixed real/junk — extra subdirs without manifests are ignored.
 */
export {};
//# sourceMappingURL=multi-stack-discovery.test.d.ts.map