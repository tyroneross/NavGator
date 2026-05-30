/**
 * R6 footprint fix — per-entity files are opt-in and the migration that
 * removes legacy per-entity files is idempotent + safe.
 *
 * Without the fix, every scan on atomize-ai (2,475 components +
 * 6,737 connections) wrote ~9,200 JSON files into `components/` and
 * `connections/`, totalling ~70MB on disk. The consolidated `graph.json`,
 * `index.json`, `connections.jsonl`, and `reverse-deps.json` carry the
 * same information.
 *
 * These tests lock the invariants the fix promises:
 *   1. Default config (perEntityFiles=false) → storeComponents +
 *      storeConnections write NOTHING to disk.
 *   2. Opt-in (perEntityFiles=true) → both writers behave the legacy way.
 *   3. migratePerEntityFiles deletes any legacy per-entity *.json files
 *      and the now-empty dirs, WITHOUT touching consolidated files in the
 *      same storage root.
 *   4. migratePerEntityFiles is idempotent (running it twice is fine).
 *   5. migratePerEntityFiles is a no-op when perEntityFiles=true.
 */
export {};
//# sourceMappingURL=per-entity-files-gate.test.d.ts.map