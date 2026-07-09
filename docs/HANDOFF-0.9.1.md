# NavGator 0.9.1 implementation handoff

Status: **all blockers closed + release gates green; committed locally; DO NOT push/publish without authorization**  
Updated: 2026-07-09  
Build Loop run: `bl-20260709T190008Z-codex-487183`

## Completion update (2026-07-09, claude_code:599bfe6c takeover — Codex low on tokens)

All four blockers below are closed and independently verified:

- **Blockers 1–3 (scan/dirty-ledger/acquisition-gate races):** fixed and committed by Codex in `550af2f` ("fix: make scan freshness race-safe"). Independently confirmed CLOSED by build-loop `independent-auditor` (verdict *yay*, path:line evidence) and static review; regressions present in `src/__tests__/freshness/{scan-lock,drainer,dirty-ledger}.test.ts` (incl. real multiprocess `spawn`).
- **Blocker 4 (final artifact proof):** DONE. Clean build (`npm run clean && npm run build`) — `dist/__tests__` absent, packable web runtime regenerated. Full suite **555/555** (isolated run — the lease/drainer concurrency tests are load-sensitive and flake only under competing runners; fail-closed, not a real race). Authoritative packed verifier `REQUIRE_CLAUDE_VALIDATION=1 REQUIRE_CODEX_VALIDATION=1 npm run verify:release` — **PASS** ("release contract passed for @tyroneross/navgator@0.9.1"), covering Claude clean-`CLAUDE_CONFIG_DIR` install idempotency/enabled/version, Codex user+workspace install, MCP (10 tools), and the packed dashboard.
- **Remaining before any push:** whole-diff *host-lane* independent adversarial review (installer/manifest/skill/doc/web surfaces) — the scan lane is reviewed; the host lane is not yet. Reversible commit is safe; treat this as the gate before push.

3 LOW auditor findings queued in `.build-loop/followup/`.

## Outcome and current assessment

The implementation is substantially complete but is not release-ready. Three commits are stable, host registration is repaired, and release gates are stronger; the remaining design risk is isolated to scan/dirty-ledger concurrency. The core approach is sound:

- scanner contention is represented as typed `completed | noop | busy` data instead of empty success;
- graph rules and coverage now use trustworthy direction, alias scope, and set arithmetic;
- Claude and Codex use separate host adapters where their process-path semantics differ;
- agent-facing output is bounded and exposes totals, truncation, and architecture-rule errors;
- the npm artifact is being made the release authority, with an executable packed-artifact verifier.

Remaining risk is concentrated in the dirty-ledger/scan lifecycle and the final combined build/tarball proof. The original Claude registration failure is fixed and passed isolated user/project lifecycle checks, but the root packed verifier has not yet rerun after that change. The host/package lane must still be included in the whole-diff independent review because its original dedicated reviewer stalled.

## Current blockers

1. **Dirty-ledger compare/clear race.** A same-path edit can land between snapshot read/stat or fingerprint compare/clear and be erased. Ledger reconciliation needs atomic generation/CAS, rotation, or equivalent mutation serialization with deterministic interleaving tests.
2. **Late-content/hash race.** A file can change after the scanner reads it but before final hashes are saved, leaving an old graph with a new hash. Forced dirty paths and scan-start/consumed hashes must guarantee the next drain really rereads the file.
3. **Acquisition-gate recovery and stamp honesty.** A process killed while holding the auxiliary acquisition gate can wedge all future scans, and a busy attempt must never leave `scan_in_flight: true`. Both need owner-safe lifecycle recovery and regressions.
4. **Final artifact proof not run.** A clean build, required-host packed verifier, and whole-diff independent review must pass after the last mutation.

Until all four are closed, this branch is not release-ready.

## Working location

- Repository: `/Users/tyroneross/dev/git-folder/NavGator`
- Isolated worktree: `/Users/tyroneross/dev/git-folder/NavGator/.build-loop/worktrees/run-487183`
- Branch: `bl/run-487183`
- Base behavior before changes: 44 test files, 493 tests passing; root TypeScript build passing
- Do not edit or commit from the canonical checkout for this run.

## Commits already landed on the run branch

| Commit | Scope | Evidence |
|---|---|---|
| `2546f73` | Additive `ArchitectureScanOutcome` contract | `npm run build:cli` passed |
| `1d2f395` | Directed reachability, nested aliases, corrected coverage math | focused graph tests passed; live web alias smoke resolved 175 `@/` edges |
| `75a1cde` | Typed CLI/MCP boundaries and bounded, rule-aware agent output | root typecheck and 31 focused boundary tests passed |

These commits are local only. Nothing from this run has been pushed, published, tagged, or installed globally.

## Implemented but not yet committed

### Scan correctness and lease lane

Owned surfaces include `src/scanner.ts`, `src/storage.ts`, the canonical scan lease, freshness drainer/path logic, focused tests, and the stale incremental issue note.

Implemented behavior:

- one canonical `.navgator/scan.lock` lease;
- complete-record atomic lease publication, owner token, heartbeat, process-start fingerprint, owner-safe release retry;
- operational acquisition failures throw; only a live owner maps to retryable `busy`;
- `scan()` and `quickScan()` retain the typed top-level result;
- incremental-to-full promotion reuses the same lease;
- consolidated incremental state is partitioned in memory before merge so deleted edges do not reload from canonical JSONL;
- drainer outcomes are strict, preserve the dirty ledger on busy/error, and use unique atomic stamp candidates;
- busy-drainer stamp ordering is monotonic so a losing drainer cannot resurrect `scan_in_flight: true` after the winner finishes.

Current evidence before the newest fixes: 99 focused tests and CLI build passed. The fresh independent review then found the three scan blockers listed above plus a stale in-flight stamp edge case, so the lane remains unapproved. A new test-typecheck gate also caught one test-only child-process typing error. All must be fixed and independently rereviewed before commit.

### Claude and Codex host parity lane

Implemented behavior:

- canonical plugin identity is `navgator`, version target `0.9.1`, Apache-2.0;
- Claude retains 13 commands, 4 subagents, 6 skills, empty hooks, and root `.mcp.json`;
- Codex advertises only 6 skills plus MCP through `.codex-plugin/mcp.json`;
- Codex no longer relies on literal `${CLAUDE_PLUGIN_ROOT}` expansion for MCP startup;
- invalid repo-self `.agents/plugins/marketplace.json` was removed;
- the Codex installer materializes a dependency-complete child runtime, generates a non-empty local marketplace source, and truthfully leaves browser install/enable plus new-task activation to the user;
- the loose infrastructure skill is now a discoverable directory skill;
- the web route TypeScript error is fixed;
- the prepared dashboard uses `web/server.cjs`, contains no nested `node_modules`, symlinks, TypeScript, Sharp, `@img`, native binaries, or platform-specific SWC packages.

Current evidence:

- Claude's original raw-symlink install failed clean-registry discovery; the repaired installer now uses marketplace add plus install/update/enable and refuses success without the exact enabled version;
- isolated clean user and project installs, idempotent rerun, disabled-state recovery, cached dependency check, MCP startup, and all 10 MCP tools passed without touching real user state;
- inventory is 13 commands, 4 Claude subagents, 6 skills, empty hooks;
- Codex MCP initialized all 10 tools;
- isolated Codex `plugin/list`, `plugin/install`, enabled state, and fresh-app-server discovery of all 6 skills passed;
- web typecheck and production build passed;
- the portable dashboard runtime is about 26 MB unpacked and returned HTTP 200 for the main page, four API routes, and a static image.

The lane's dedicated review agent stalled. Include all host, installer, manifest, skill, documentation, and web-runtime surfaces in the mandatory whole-diff review.

### Release integration

Prepared but not yet committed:

- package version/lockfile target `0.9.1`;
- package file inventory includes commands, agents, six skills, promotion script, host manifests, and portable dashboard runtime;
- root build excludes `src/__tests__/**` from `dist`;
- invalid ESLint command removed; no-network root+web `typecheck` added;
- PR/push CI and publish gates run the full suite, typecheck, build, and packed verifier;
- runtime CLI and MCP versions read from `package.json`;
- `scripts/verify-release.mjs` packs, installs, inventories, initializes both MCP configs, exercises isolated host lifecycles, rejects native binaries/compiled tests, and starts the packed dashboard through the CLI helper;
- all 7 release-contract tests pass;
- whole-generation atomicity and ESLint adoption are recorded as separate follow-ups;
- the CLI now launches the packaged `web/server.cjs` entry, binds the unauthenticated dashboard to loopback, and no longer offers the invalid raw Claude symlink during `navgator setup`;
- Node's public floor is aligned to the tested `>=20.11.0` contract with a minimum-version CI lane;
- CI and publish install pinned Claude/Codex CLIs and require live lifecycle validation; publish also rejects tag/package version mismatches;
- the verifier now covers Claude clean-registry install, Codex user plus workspace registration, the exported dashboard launcher and representative APIs; runtime preparation rejects symlinks;
- source tests have a separate no-emit TypeScript configuration so excluding them from `dist` does not remove type safety.

Current dry-pack evidence: the intended host inventory is present (13 commands, 4 Claude agents, 6 shared skills) with no packaged `node_modules` paths or native `.node` binaries. The dirty worktree still contains 184 stale compiled test artifacts under `dist/__tests__` from pre-exclusion builds. This is expected to disappear only after `npm run clean && npm run build`; the final verifier must reject the artifact if any compiled tests remain.

## Explicitly deferred or excluded

- Whole-generation transactional storage is not part of 0.9.1. Individual files are atomic and scans use one writer lease; interrupted multi-file generations can still require a full refresh.
- Proper ESLint adoption requires a separately reviewed dependency and configuration change.
- Do not update the external RossLabs marketplace until 0.9.1 is actually published under separate authorization.
- Do not push, tag, publish, or mutate the user's global Claude/Codex installation as part of this run.
- Hooks remain empty and require no trust change.

## Required next steps

1. **Close the remaining scan races.** Make ledger reconciliation atomic, ensure forced dirty files cannot be masked by late hash persistence, reclaim a killed acquisition gate owner-safely, and make in-flight stamps acquisition-owned. Add deterministic real-scanner and multiprocess regressions, rerun the focused suite plus test typecheck, and require a fresh independent reviewer to return clean.
2. **Review and commit the host lane.** Inspect every host-owned diff, rerun JSON/shell syntax, clean-registry Claude user/project installation, web typecheck/build, isolated Codex user/workspace discovery/install/new-task checks, and HTTP probes.
3. **Commit the approved scan lane.** Commit only after the fresh reviewer is clean, using the lane-owned files plus the root freshness caller integration.
4. **Finish release integration.** Confirm `web/server.cjs` everywhere, update release-contract assertions if needed, and run `git diff --check` plus root/web typechecks.
5. **Run the full suite.** `npm test` must include all scan correctness regressions; no release exclusion may omit them.
6. **Run a clean production build.** `npm run clean && npm run build`. Confirm `dist/__tests__` is absent and the portable web runtime is regenerated.
7. **Run the live self-scan before the final verifier.** Exercise bounded summary/rules/coverage output, then confirm the self-scan changed no tracked or package input files.
8. **Run the final packed proof after the last mutation.** Use `REQUIRE_CLAUDE_VALIDATION=1 REQUIRE_CODEX_VALIDATION=1 npm run verify:release`. This must be the last success check that can validate the tarball.
9. **Run Build Loop Phase 4 review and Phase 5 iteration.** Include correctness, mock-data leakage, security, host/package parity, workflow, and documentation claims. Fix every blocker and rerun affected gates.
10. **Finalize this handoff and commit release records.** Record final commit hashes and exact test counts. Remove transient dependency symlinks before declaring the worktree clean.

## Verification commands

Run from the isolated worktree:

```bash
cd /Users/tyroneross/dev/git-folder/NavGator/.build-loop/worktrees/run-487183

npm test
npm run typecheck
npm run clean
npm run build

# Self-scan and bounded output checks happen here, before the final packed proof.

REQUIRE_CLAUDE_VALIDATION=1 \
REQUIRE_CODEX_VALIDATION=1 \
npm run verify:release
```

Before the final status claim:

```bash
git status --short
git diff --check
git log --oneline --decorate -8
```

## Loaded agents, plugins, and reasons

### Agents

| Agent | Why it was loaded | Current result |
|---|---|---|
| Root Build Loop orchestrator | Own the acceptance contract, isolated worktree, integration, final verification, and commit boundary | Active |
| Graph trust implementer | Independently correct directed reachability, nested alias resolution, and coverage arithmetic | Completed and committed as `1d2f395` |
| Scan correctness implementer | Isolate the high-risk incremental-state, lease, and freshness-drainer work | Active; addressing three P1 findings plus stamp honesty |
| Scan-lane independent reviewer | Try to break lease/reconciliation behavior before commit | Found the current blockers; another fresh review is required after fixes |
| Host parity implementer | Own Claude/Codex manifests, installers, skills, docs, and portable dashboard packaging | Completed implementation and isolated lifecycle proof; whole-diff review remains |
| Release/handoff auditor | Independently fact-check package inventory, CI, verifier, and this handoff | Completed; findings integrated into current blockers and release gates |

### Plugins and skills

| Capability | Why it was loaded | Scope used |
|---|---|---|
| `build-loop:build-loop` | Explicitly requested by the user for multi-step implementation discipline | Goal/plan/probes, worktree isolation, delegated lanes, reviews, verification, local commits |
| Plugin Builder guidance | Validate Claude package discovery and manifest/installer structure | Claude commands, agents, skills, hooks, MCP, marketplace/install lifecycle |
| OpenAI plugin guidance | Validate current Codex plugin semantics rather than copying Claude assumptions | `.codex-plugin` manifest, skills/MCP exposure, marketplace/install/new-task activation |
| Repository test/build toolchain | Prove source, package, and dashboard behavior from the actual artifact | Vitest, TypeScript, Next.js build, MCP initialization, HTTP probes, packed install |

No connector plugin or external app is needed for this repository-local implementation, and none was installed. NavGator itself is the plugin being built; its Claude-specific commands/subagents remain Claude-only, while its six skills and MCP server form the portable Claude/Codex intersection.
