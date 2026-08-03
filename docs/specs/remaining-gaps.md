# NavGator Remaining Gaps (Post-0.4.2)

Retriaged 2026-08-03 against 0.9.1 code (build-loop run `bl-navgator-20260803-portfolio`, chunk C1).
Every item below carries a verdict — `already-fixed`, `partly-fixed`, `still-open`, or `superseded`
— with a `file:line` or test citation. This session's own fix (component-identity extraction,
alias-aware `resolveComponent()`, FILE: pass-through resolution in `traceDataflow()`) is recorded
inline where it applies.

## Resolved This Session (pre-0.9.1, kept for history)
- Queue-consumes: 0 → 17 (Worker detection with variable resolution)
- Deploy entry points: Dockerfile CMD parsing, Procfile worker linking
- LLM dedup: 154 → 9 use cases (purpose inference, generic symbol filtering)
- NAVSUMMARY quality: production-first sorting, runtime topology section
- CWD mismatch warning in list command

## Verdict Table

| # | Gap | Verdict | Citation |
|---|---|---|---|
| 1 | Cross-component path tracing (FILE: pass-through) | **partly-fixed → now further fixed by this chunk** | Pre-existing: `src/trace.ts:75-94` (this session, formerly ~`:75-94`) merges FILE: adjacency into owning-component incoming/outgoing maps; `:225-251` (formerly `:205-218`) synthesizes a component so BFS continues even without an owner. A 2026-08-03 probe (A → FILE:src/x.ts → B, forward, maxDepth 5) reached B — gap description ("finds 0 paths") was already stale. **Residual fixed here:** when a FILE: id names a path a real component owns via `source.config_files`, trace now resolves to that owner (`src/trace.ts` new `fileOwnerMap`, built when `resolveFileNodes` — new `TraceOptions` field, default `true` — is set) instead of always rendering a synthetic node. `resolveFileNodes: false` / CLI `--raw-file-nodes` restores the pre-existing always-synthesize behavior. Regression locked by `src/__tests__/trace-file-nodes.test.ts`. |
| 2 | Component naming inconsistency (aliases) | **partly-fixed → now further fixed by this chunk** | Pre-existing: `src/cli/commands/list.ts:50-73` (pre-refactor) already normalized base names and merged aliases, keeping the higher-connection-count component — but only on the human-readable output path; `--json` (`list.ts:34`, now `:34`) and `--agent` (`:29`) return before reaching that logic, and `resolveComponent()` had no alias awareness at all. **Fixed here:** extracted `componentBaseName` / `identityKey` / `mergeComponentAliases` into new `src/component-identity.ts`; `list.ts` now calls `mergeComponentAliases` (human output unchanged, verified byte-for-byte against the pre-refactor logic — see implementer notes). Added a base-name alias step to `resolveComponent()` between the existing partial-name-match step and the file-path-substring step, so "Railway", "Railway Config", and "Railway (infra)" resolve to the same component via `navgator trace`/`explore`/etc. **Residual, not closed:** `list --json` / `list --agent` still bypass `mergeComponentAliases` (unchanged from before this chunk — out of the "human output must be byte-identical" mandate for this chunk; a follow-up should thread the same dedup through those two paths). Tests: `src/__tests__/component-identity.test.ts`, appended cases in `src/__tests__/resolve.test.ts`. |
| 3 | Connection count inflation | **already-fixed** | `src/cli/commands/status.ts:81-103` splits `connections_by_type` into an `ARCHITECTURE CONNECTIONS (N)` bucket (queue/cron/schema/service/etc.) and a `CODE CONNECTIONS (N)` bucket (`imports`, `env-dependency`), printed separately — the exact "Architecture: N | Code: imports N | Config: env N" shape the gap asked for. |
| 4 | Env var warning noise | **already-fixed** | `src/scanners/infrastructure/env-scanner.ts:493-505` skips a `skipPatterns` allowlist of framework/runtime-injected prefixes (`NODE_`, `VERCEL`, `NEXT_RUNTIME`, `NEXT_PHASE`, `__NEXT_`, `TURBOPACK`, `BASE_URL`, etc.) before emitting a "referenced but undefined" warning. |
| 5 | Dead code detection | **already-fixed** | `src/rules.ts:33-46` defines the `orphan-component` rule; `src/cli/commands/status.ts:228-252` surfaces a `POTENTIAL DEAD CODE (N orphaned components)` section directly in `status` output; `src/cli/commands/dead.ts` is a dedicated command listing orphans by type with `--json`/`--agent` support. |
| 6 | Schema-to-code mapping | **already-fixed** | `src/scanners/connections/prisma-calls.ts` detects `prisma.{modelName}.{operation}()` call sites and emits `api-calls-db` connections from the calling source file to the matching Prisma model component (`:148-178`), including snake_case/table-name fallback matching (`:200-241`) — the exact `prisma.article.findMany → articles table` mapping the gap called "significant new scanner work." |
| 7 | Dashboard testing | **still-open** | `web/package.json:5-10` has `build`/`dev`/`lint`/`start` scripts but no `test` script, and no test file exists under `web/` outside `node_modules`. Out of scope for this chunk (C1 owns CLI-side identity/trace files only; `web/` has no test runner per plan finding #17, and standing that up is C3-or-later scope, not C1's). Left explicitly open rather than silently dropped. |
| 8 | Temporal awareness | **already-fixed** | `src/cli/commands/misc.ts:384-463` registers `history` and `diff` (via `loadTimeline`/`formatDiffSummary` in `src/diff.ts`), and `src/cli/commands/temporal.ts` adds `first-seen`, `changes --since`, and `snapshots` on top of `src/temporal/git-store.ts` — full integration, not just command existence. |

## Falsifier check (this chunk)

- Every gap above carries a citation. None marked fixed without one.
- Gap #7 is the one still-valid-and-unimplemented item; reason given above (out of C1's owned-file
  scope, and the underlying capability — a `web/` test runner — doesn't exist yet for anything to
  hook into).
- No existing assertion in `src/__tests__/resolve.test.ts` or `src/__tests__/trace.test.ts` was
  edited — new cases were appended only.
