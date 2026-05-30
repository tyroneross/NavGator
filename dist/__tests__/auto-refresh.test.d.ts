/**
 * R6 auto-refresh: read entrypoints should run an incremental scan when
 * the on-disk graph is stale.
 *
 * Verified-stale evidence (atomize-ai, 2026-05): graph last scanned
 * 2026-04-13 stayed stale across dozens of MCP read calls — callers got
 * a graph that didn't reflect any source change in 30+ days. The fix
 * wires `autoRefreshIfStale` into MCP `status` and CLI `status`; this
 * test locks in the helper's contract.
 */
export {};
//# sourceMappingURL=auto-refresh.test.d.ts.map