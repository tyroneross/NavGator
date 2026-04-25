# Build Goal — NavGator Run 1: Incremental Scans + Smart Planner Agent

Created: 2026-04-25
Reference: `~/.claude/plans/does-navgator-maintain-a-merry-wombat.md`
Branch: `salvage/audit-improvements` (already checked out)

## Problem
NavGator scans every repo from scratch on every `/gator:scan` because `clearStorage()` at `src/scanner.ts:774` is unconditional. There is no signal when the cached graph is stale, no incremental path, no front-door for natural-language intent. This run lays the foundation for incremental scans plus a write-capable planner agent. Subsequent runs add SQC audit sampling, parallel/tiered workers, and SPC drift detection — those are explicitly out of scope here.

## Goal
Refactor the scan pipeline to support incremental + auto + full mode selection, add atomic writes and stable_id merging, ship a planner agent + slash command + CLI redirect, and lock today's full-scan output as a regression baseline. Pure TS, Node ≥20, **zero new runtime npm deps**, no external LLM API calls.

## Deliverables

### D1 — Foundation refactor
- `src/storage.ts`: add `clearForFiles(config, root, changedPaths: Set<string>)` that deletes only `components/COMP_*.json` and `connections/CONN_*.json` whose `source_files` overlap `changedPaths`. Keep existing `clearStorage()` for `--full` / `clearFirst`. Add atomic-write helpers: write to `<storagePath>.tmp/` then `fs.rename()` over `<storagePath>/`. Add `mergeByStableId(existing[], incoming[])`.
- `src/scanner.ts`: replace unconditional `clearStorage(config, root)` (~line 774) — call `clearStorage` only when `mode === 'full'`, otherwise `clearForFiles(walkSet)`. Wrap Phase 4 storage writes in atomic-rename.
- `src/types.ts`:
  - `ArchitectureIndex` gains optional `last_full_scan?: number`, `incrementals_since_full?: number`. Bump `schema_version` to `'1.1.0'`.
  - `TimelineEntry` gains optional `scan_type?: 'full' | 'incremental' | 'noop' | 'incremental→full'`, `files_scanned?: number`.
  - All new fields optional; read-time defaults preserve `1.0.0` archives.

### D2 — Mode selector + incremental walk
- `selectScanMode(fileChanges, index, options)` policy: `--full` → full; no prior scan or `schema_version` mismatch → full; any of `package.json | pnpm-lock.yaml | requirements*.txt | pyproject.toml | prisma/schema.prisma | package-lock.json` in changedFiles → full; `last_full_scan` > 7 days OR `incrementals_since_full >= 20` → full; else → incremental.
- `loadReverseDeps(changedFiles, config, root)`: load existing `connections/CONN_*.json`, return source files of edges whose target file is in `changedFiles`. Walk-set = `changedFiles ∪ reverseDeps`.
- For incremental: skip Phase 1 unless a manifest is in walk-set; Phase 2 (infra) re-runs only if its source files overlap walk-set; Phase 3 (connections) walks only walk-set files.
- `runIntegrityCheck(components, connections, walkSet)`: every connection endpoint exists, every `component.source_files` exists on disk, no orphan stable_ids. On failure: log `scan_type: 'incremental→full'`, fall through to full scan.
- `src/cli/scan.ts`: add `--incremental`, `--full`, `--auto` (default).

### D3 — Planner agent + slash command + CLI redirect
- `agents/architecture-planner.md`: new agent. Frontmatter follows existing `architecture-investigator.md` / `architecture-advisor.md`. `model: opus`. Description triggers on phrasing like "review architecture for X", "blast radius of changing Y", "is the graph fresh", "investigate auth flow". Body: read `index.json` + `hashes.json` → if scan needed, run `navgator scan --incremental --silent` (write-capable) → dispatch MCP read tools (`impact`, `trace`, `connections`, `review`, `dead`, `rules`) → aggregate report. **Constraint**: never auto-trigger a full scan; if state needs full, return that as a recommendation.
- `commands/plan.md`: `/gator:plan "intent"` invokes the planner agent with the user's argument.
- `src/cli/index.ts`: when first arg is non-empty, doesn't match a known subcommand, and looks like natural language (contains spaces or quotes), print: `navgator <intent> needs Claude Code. From a terminal use a subcommand directly (e.g. \`navgator scan\`, \`navgator impact <component>\`), or run /gator:plan "<intent>" from inside Claude Code.` Exit 0.

### D4 — Tests
- Extend `src/__tests__/scanner-characterization.test.ts`: add a snapshot of today's full-scan output (component/connection counts + key fields, stripped of timestamps and component_id random suffixes) on the existing `bench-repo` fixture.
- New `src/__tests__/scanner-incremental.test.ts`:
  1. **edit-one-file**: full baseline → edit one TS file → scan → mode='incremental', integrity passes, `timelineEntry.scan_type === 'incremental'`, `0 < files_scanned < total`, end-state graph matches baseline diff.
  2. **lockfile-trigger**: edit `package.json` → mode='full'.
  3. **stale-trigger**: `last_full_scan` 8 days ago → mode='full'.
  4. **incremental-cap**: `incrementals_since_full = 20` → mode='full'.
  5. **integrity-auto-promote**: corrupt one connection's `source_files` → next incremental promotes to 'incremental→full'.
  6. **noop**: no changed files → `scan_type === 'noop'`, `last_scan` updated, no other state mutated.
- All existing tests in `src/__tests__/*.test.ts` must continue to pass.

### D5 — Docs
- `README.md`: add "Scan modes" section (`--auto` / `--full` / `--incremental`) and document the auto-mode policy. Add a row for `/gator:plan "intent"` in the slash-command table.

## Out of scope (reject scope creep)
- SQC audit layer (AQL/SPRT sampling) — Run 2.
- Stratified parallel workers + per-stratum model tiering — Run 3.
- EWMA/SPC drift chart across runs — Run 4.
- Hook auto-invocation upgrades, build-loop bridge changes.
- New MCP tools beyond what already exists.
- Python AST helper.
- Mermaid/SVG caching, watch daemon, cross-repo `~/.navgator/projects.json`.

## Constraints
- Pure TypeScript. Node ≥20. **Zero new runtime npm deps.** Optional `ts-morph` unchanged.
- "Claude Code is the LLM" — NavGator does NOT call any external LLM API. Planner agent runs inside Claude Code via MCP round-trips.
- Plugin-dev skills (`plugin-dev:agent-development`, `plugin-dev:command-development`) authoritative for agent + command files — load before writing.
- Agent model frontmatter: valid alias (`opus`, `sonnet`, `haiku`, `inherit`) or full ID (`claude-opus-4-7`). Never invalid like `opus-4-7`.
- Atomic writes: a crashed scan must leave `.navgator/architecture/` in a valid prior state.
- Bit-identical full-scan output on bench-repo (excepting timestamps and random component_id suffixes) — characterization snapshot enforces.
- Target: `~/dev/git-folder/NavGator/` only. Do NOT edit `RossLabs-AI-Toolkit/plugins/navgator` mirror or `~/.claude/plugins/cache/...`.
- Per memory: don't reference `~/Desktop/git-folder/...` paths (stale).

## Scoring criteria

| # | Criterion | Method | Pass condition |
|---|---|---|---|
| C1 | Existing tests pass | `npm test` | exit 0, all pre-existing suites pass |
| C2 | New incremental tests pass | `npm test` | all 6 scenarios in scanner-incremental.test.ts pass |
| C3 | Characterization snapshot locked | code-grader | snapshot present, test passes |
| C4 | TypeScript build passes | `npm run build:cli` | exit 0, no type errors |
| C5 | Lint passes | `npm run lint` | exit 0 |
| C6 | Atomic write integrity | test simulates crash | prior `.navgator/architecture/` survives |
| C7 | Mode selector correctness | unit tests | all 4 selector cases return expected mode |
| C8 | E2E sanity on real repo | manual run | full → edit → incremental shows scan_type='incremental' in timeline.json, materially faster |
| C9 | Planner agent valid | frontmatter parse | YAML valid, model=`opus`, description triggers |
| C10 | Slash command valid | code-grader | `commands/plan.md` follows plugin-dev:command-development |
| C11 | CLI redirect works | command output | `node dist/cli/index.js "review my auth flow"` prints redirect, exit 0 |
| C12 | README updated | LLM-judge | "Scan modes" section + /gator:plan row present |
| C13 | No new runtime deps | `git diff package.json` | `dependencies` unchanged |
| C14 | Schema migration safe | reads 1.0.0 fixture | no crash, defaults applied |

## Verification recipe (orchestrator runs at end)

```bash
cd ~/dev/git-folder/NavGator
npm test                                 # C1, C2, C3, C6, C7, C14
npm run build:cli                        # C4
npm run lint                             # C5
node dist/cli/index.js "review my auth"  # C11

# E2E sanity (C8)
node dist/cli/index.js scan --full
echo "// touch" >> src/types.ts
time node dist/cli/index.js scan
cat .navgator/architecture/timeline.json | tail -1
git checkout src/types.ts
```

## Notes for orchestrator
- This is Run 1 of a multi-run sequence. Reject scope creep into SQC, parallel workers, SPC drift.
- Build-loop must consult `plugin-dev:agent-development` for the agent file and `plugin-dev:command-development` for the slash command.
- Phase 4 sub-step D fact-check: confirm no LLM API SDK was imported, no new runtime deps in package.json.
- Phase 4 sub-step E simplify: keep additions in existing scanner.ts patterns; resist over-engineering.
- The planner agent is opus-tier per "wrong spec is catastrophic" — getting the decision wrong causes scans to run when they shouldn't or skip when they should.
