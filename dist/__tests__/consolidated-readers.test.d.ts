/**
 * R6 consolidated-readers regression — with per-entity files off (the new
 * default), the rest of NavGator (MCP tools, CLI commands, audit) MUST
 * still be able to read full ArchitectureComponent/Connection objects.
 *
 * The bug this locks down: without these fallbacks, the first atomize-ai
 * end-to-end validation produced an `index.json` with `total_components: 0`
 * and `graph.json` with 0 nodes — even though the in-memory scan saw
 * 2,471 components. `buildIndex` / `buildGraph` / `buildFileMap` were
 * implicitly going through `loadAllComponents` which read per-entity files.
 *
 * The fix has two prongs:
 *  1. `buildIndex` / `buildGraph` / `buildFileMap` / `buildSummary` accept
 *     an in-memory `data` parameter so the scanner can hand them the
 *     final state directly.
 *  2. `loadAllComponents` / `loadAllConnections` fall back to
 *     `components.full.jsonl` / `connections.full.jsonl` when the
 *     per-entity dirs are missing or empty.
 *
 * These tests cover both prongs in isolation.
 */
export {};
//# sourceMappingURL=consolidated-readers.test.d.ts.map