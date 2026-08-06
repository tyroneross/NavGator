/**
 * `navgator deep-map` — tiered repo-mapping pipeline.
 *
 * Tier 0 is the existing deterministic scan. Tiers 1-3 are LLM passes run by
 * the CALLING agent (Claude Code / Codex), never by NavGator: this CLI emits
 * work packets, the host fans them out to subagents, and this CLI ingests +
 * validates + reports on what comes back. No LLM SDK, no model call, no
 * network — see `src/deep-map/types.ts`'s module header.
 *
 * Four subcommands, one pipeline stage each:
 *   plan    — partition the graph, optionally score escalation, write packets
 *   ingest  — validate `*.result.json` files the calling agent wrote back
 *   report  — join manifest + ingest accounting + findings at read time
 *   status  — is a fan-out actually done, or silently un-run?
 */
import { Command } from 'commander';
export declare function registerDeepMapCommand(program: Command): void;
//# sourceMappingURL=deep-map.d.ts.map