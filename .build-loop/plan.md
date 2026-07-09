# Plan — NavGator 0.9.1 dual-host reliability

⚠ Plan gaps: 2 — CI activation pending (surfaced; workflow-contract test before Report), lease-heartbeat activation pending (surfaced; fake-timer/cross-process tests before Report). All critic and caller-scope findings are resolved.

Status: accepted for execution
Run: `bl-20260709T190008Z-codex-487183`
North star: one release artifact, trustworthy graph semantics, honest host capabilities.

parallel_batch: scan-correctness, graph-trust, host-package-parity

## Research Context

- Depth: standard
- Packet: `.build-loop/research/2026-07-09-implement-audited-navgator-correctness-packaging-installation-cross-host.md` — exists
- Source policy: live repository and host CLIs first; official OpenAI documentation for current Codex plugin behavior; local official Claude plugin-dev guidance for Claude behavior.
- Final claims blocked until the packed-artifact and current-host probes pass.

## Approach Lenses

### Clean-sheet best approach

Use immutable scan generations behind an atomic `current.json` pointer. Keep one engine and two thin host adapters: Claude exposes commands, subagents, skills, and MCP; Codex exposes skills and MCP through a marketplace. Every mutating scan returns a discriminated result and runs under one owner-tokened lease.

### Current-constraints approach

Preserve schema `1.0.0`, current file locations, CLI names, and the 493-test behavior baseline. Fix consolidated incremental semantics in memory, replace both lock implementations with one lease, add an additive scan status, and use separate MCP config files where the hosts resolve process paths differently.

### Bridge/backcast

This release introduces the typed scan outcome, single writer lease, semantic incremental parity, and packed-artifact verifier. A separate storage migration will stage complete generations and atomically move a pointer; until then, documentation will say individual files are atomic and will not claim transaction-level atomicity.

### Recommendation

Execute the current-constraints patch now. It closes user-visible correctness and installation failures without coupling a high-risk storage migration to the host-parity release.

## Depends-on (reads-from)

- `src/scanner.ts` scan phases, walk-set, promotion path, and derived-write order — verified
- `src/storage.ts` canonical consolidated readers and stable-id merge — verified
- `.navgator/architecture/components.full.jsonl` and `connections.full.jsonl` as default canonical entity stores — verified
- `src/freshness/dirty-ledger.ts` late-arrival-preserving clear contract — verified
- `src/rules.ts` connection direction `from -> to` — verified
- nearest `tsconfig.json`/`jsconfig.json` `compilerOptions.baseUrl` and `paths` — verified by `web/tsconfig.json` and fixtures
- file-map keys as project-relative or absolute file paths — verified by storage builder and live output
- Claude default discovery under `commands/`, `agents/`, `skills/`, `hooks/hooks.json`, `.mcp.json` — verified by official local plugin-dev guidance and live validation
- Codex manifest, marketplace, MCP, and new-task activation contract — verified by official current docs and live CLI
- npm packed-file inventory as the release source of truth — verified by `npm pack --dry-run --json`

## Activation Map

- Packed-artifact release verifier — trigger: existing `.github/workflows/publish.yml` `push.tags: v*` or `workflow_dispatch` job step — verified-live: yes (the existing publish trigger shipped 0.9.0; a manifest-contract test will assert the job invokes `npm run verify:release`).
- Pull-request release contract — trigger: new `.github/workflows/ci.yml` `pull_request` and `push` to `main` jobs — verified-live: pending (workflow-contract test must prove both host events reach the full test, typecheck, build, and packed-artifact verifier steps before Report).
- Scan lease heartbeat — trigger: successful canonical lease acquisition inside `scan()` — verified-live: pending (fake-timer and cross-process tests must prove periodic owner-token refresh, no refresh after release/error, and no stale-owner unlink before Report).
- Plugin runtime hooks — trigger: none; `hooks/hooks.json` remains empty — verified-live: yes (release verifier asserts the empty hook object).

## Capability Gap Map

| Capability | Current source of truth | Target | Gap | Build action | Owner/files | Validation |
|---|---|---|---|---|---|---|
| Incremental deletion | scanner + consolidated JSONL | Removed code removes graph state | Per-entity deletion is a no-op in default mode | Partition prior in-memory state by walk-set before merge | scan-correctness | mutation parity tests in both modes |
| Writer exclusion | two lock modules | One owner-safe lease | Different paths and unsafe stale/release behavior | Canonical lease with O_EXCL, heartbeat, owner token, lease reuse | scan-correctness | contention/heartbeat/promotion tests |
| Busy behavior | empty successful result | Explicit retryable busy | Callers clear ledgers and report zero graph | Add discriminated scan status and handle at every boundary | scan-correctness + integration | CLI/MCP/auto-refresh/drainer tests |
| Dead reachability | undirected BFS | Directed reachability | Reverse traversal hides dead nodes | Traverse forward only; tighten entrypoint matching | graph-trust | chain and disconnected-cycle tests |
| TS aliases | root config only | nearest config and arbitrary paths | `web/@/*` produces no edges | Config discovery/cache and config-relative targets | graph-trust | nested/arbitrary alias tests + live probe |
| Coverage | raw file-map key count | discovered-source intersection | Non-source keys inflate numerator | Normalize and intersect once | graph-trust | hermetic mixed-key fixture |
| Agent orientation | full graph, package health only | bounded, rule-aware view | Errors hidden; 200KB payload | Rule-health totals/top items and bounded entity samples | integration | synthetic size/total tests |
| Claude package | npm files list | 13 commands + 4 agents + 6 skills + MCP | commands and script omitted | Correct package inventory and namespace/metadata | host-package-parity | packed inventory + Claude validation |
| Codex package | shared Claude MCP path + invalid root marketplace | 6 skills + ready MCP via supported marketplace | path expansion, root source, and install claims fail | Codex MCP config, valid marketplace/installer semantics | host-package-parity | isolated marketplace/MCP smoke |
| Dashboard | stripped standalone dependencies | packed HTTP-ready runtime | npm strips nested node_modules | Normalize traced runtime modules to package-safe directory | host-package-parity | install tarball, start, probe, stop |
| Release gate | tests/build scattered | one reproducible verifier | source tree can pass while tarball fails | `verify:release` plus publish-workflow integration | integration | clean verifier run |

## Single-Shot Build Guardrails

| Guardrail | Prevents | Evidence |
|---|---|---|
| Semantic parity before persistence | stale edges and partial default merges | F1 regression compares incremental and full normalized graphs |
| One lease, one owner token | concurrent writers and stolen releases | lock race, heartbeat, owner-safe release tests |
| Busy is data, not emptiness | dirty-ledger loss and false success | busy CLI/MCP/drainer/auto-refresh tests |
| Additive typed contracts | silent caller breakage | TypeScript caller audit and full build |
| Host capabilities stay truthful | advertising Claude-only surfaces in Codex | manifest contract test and docs assertions |
| Verify the tarball | source-only success | isolated install, MCP initialize/tools-list, dashboard HTTP probe |
| Verify host discovery | MCP process-only success | packed Claude inventory plus isolated Codex `plugin/list`, install/enable, new-task skills, and MCP-ready probes under existing permission_tier T3 |
| No runtime dependency addition | supply-chain drift | package diff and locked-dependency inventory |
| Hooks remain empty | surprise session behavior | `hooks/hooks.json` assertion |
| No whole-generation atomicity claim | misleading durability promise | docs grep and explicit follow-up issue |

## Threat Model

- Assets: source repository, `.navgator/` architecture data, user-level plugin configuration, and the installed npm/plugin cache.
- Trust boundaries: host -> stdio MCP process; marketplace -> installed plugin cache; scanner -> selected project root; installer -> user marketplace JSON.
- Threats: path traversal outside the selected project, shell interpolation through MCP args, unsafe concurrent writes, untrusted automatic hooks, dependency omission/substitution in the package, and installer prose causing users to trust a plugin that is only registered.
- Mitigations: fixed argv with no shell, project-root normalization and existing sandbox/approval enforcement, one owner-tokened writer lease, empty hooks, packed dependency/runtime inventory checks, manifest path validation, and truthful registration/install messaging.
- Permission tier: T3 for the existing local scan write; read-only MCP tools remain T0-T2. No network, authentication, secrets, external communication, or destructive repository operation is added.
- Residual risk: plugin code runs with the host's granted filesystem permissions. The release verifier proves expected package contents and MCP startup but cannot replace host sandbox policy or user trust review.

## Read-Before-Edit Map

| Work item | Read first | Why | Then edit |
|---|---|---|---|
| Scan correctness | `src/scanner.ts`, both lock modules, storage readers/writers, drainer and auto-refresh tests | Preserve promotion, dirty-ledger, and storage-mode contracts | scanner/storage/lock/freshness sources and targeted tests |
| Graph trust | rules, import scanner, `web/tsconfig.json`, coverage builder/tests | Verify edge direction, config ownership, and numerator inputs | rules/import/coverage sources and tests |
| Host/package | official host docs, manifests, installers, `package.json`, web standalone output, skills, identity docs | Target real discovery/package semantics | manifests/installers/package/build script/skill path/web type fix/docs |
| Agent integration | `types.ts`, agent-output, CLI rules/coverage/scan, MCP handlers, all call sites | Keep additions compatible and bound every machine-facing path | types/agent output/CLI/MCP/tests |
| Release verification | `npm pack` JSON, MCP JSON-RPC protocol, publish workflow | Make final evidence consume the built tarball | verifier script/package scripts/publish workflow |

## Dependency graph and integration points

```text
typed-contract-seed -> scan-correctness ----\
                       graph-trust ----------> agent-and-boundary-integration -> release-verification -> independent-review
                       host-package-parity --/
```

- Root first seeds the additive `ArchitectureScanOutcome` in `src/types.ts`; the same root owner later adds ExecutiveSummary fields in that file.
- Scan lane consumes that type and publishes the canonical lease API. `scan()` is the sole lease owner; freshness drains do not pre-acquire and instead preserve the ledger when the scan callback returns `busy`.
- Graph lane publishes directed rules, alias resolver behavior, and corrected coverage totals without editing shared output types or the scan orchestrator. The scan lane owns nested-config hash discovery in `src/scanner.ts`.
- Host lane publishes manifests/build artifacts/install messaging without editing engine code.
- Root integration owns `src/types.ts`, `package.json`, `package-lock.json`, root `tsconfig.json`, CLI/MCP version constants, machine-facing adapters, workflows, and the final verifier. Host/package parity owns host manifests, marketplaces, installers, skills, web-runtime preparation, and identity documentation.

## Implementation tasks and commit plan

### Prerequisite — Seed the typed scan contract

- Owner: root integration
- Intent: give every scan caller one additive, discriminated contract without repurposing the widely shared per-scanner `ScanResult`.
- Files: `src/types.ts` only.
- Design: define a dedicated top-level architecture scan result/status type while preserving the existing component, connection, warning, and stats fields.
- modifies_api: yes — additive public type only.
- Acceptance: TypeScript build before parallel dispatch.

### Commit 1 — Fix scan state and writer semantics

- Owner: scan-correctness lane
- Intent: graph mutations must never retain deleted state or lose dirty work under contention.
- Files: `src/scanner.ts` (including nested tsconfig/jsconfig change discovery), `src/storage.ts`, `src/scan-lock.ts`, `src/freshness/scan-lock.ts`, `src/freshness/paths.ts`, `src/freshness/drainer.ts`, scanner/consolidated/auto-refresh/freshness-lock/freshness-path/freshness-drainer tests, and the stale incremental issue note.
- Design: typed Path B contract — `completed | noop | busy`; `scan()` alone acquires the canonical `.navgator/scan.lock`; drainer callbacks interpret status without pre-acquiring; reuse one lease through incremental-to-full promotion. The integration owner wires boundary presentation after this lane lands.
- modifies_api: yes — `scan()`, lock acquisition, and drainer scan callback result.
- Acceptance: F1-F3, Q2.

### Commit 2 — Correct graph trust signals

- Owner: graph-trust lane
- Intent: architecture advice must reflect actual dependency direction, config scope, and source coverage.
- Files: `src/rules.ts`, `src/scanners/connections/import-scanner.ts`, `src/coverage.ts`, and focused tests. This lane does not edit `src/scanner.ts`.
- modifies_api: no — observable results change; public function signatures stay compatible.
- Acceptance: F4-F6.

### Commit 3 — Make host adapters real on both hosts

- Owner: host-package-parity lane
- Intent: the released bytes, not the checkout, must load the supported host surfaces.
- Files: Claude/Codex manifests and marketplaces, `.mcp.json`, Codex-specific MCP config, installers, package-safe web-runtime build helper, skill path, command namespace text, web type error, README/CLAUDE/AGENTS/VERSIONING. This lane does not edit `package.json`, `package-lock.json`, root `tsconfig.json`, CLI/MCP version constants, workflows, or release-verifier files.
- Design: host adapter Path B contract — explicit Claude and Codex config plus a package doctor, not shared-path assumptions or install-success prose.
- modifies_api: no — packaging and host adapters only.
- Acceptance: F8-F9, Q1, Q4-Q6.

### Commit 4 — Bound agent output and integrate typed boundaries

- Owner: root integration
- Intent: agents see the highest-risk truth first within a predictable payload.
- permission_tier: T3 — the existing MCP scan tool writes only the selected project's `.navgator/` data under the host sandbox/approval policy; read-only tools remain lower privilege. No new tool or external action is added.
- Files: `src/types.ts`, `src/index.ts`, `src/setup.ts`, `src/agent-output.ts`, `src/cli/index.ts`, `src/mcp/server.ts`, `src/cli/commands/scan.ts`, `src/cli/commands/rules.ts`, `src/cli/commands/coverage.ts`, `src/cli/commands/freshness.ts`, `src/cli/commands/status.ts`, `src/cli/commands/misc.ts`, `src/mcp/tools.ts`, `src/__tests__/setup.test.ts`, `src/__tests__/freshness/cli-freshness.test.ts`, `src/__tests__/agent-output.test.ts`, and new CLI/MCP/agent-boundary execution tests. Auto-refresh and drainer behavior tests stay with the scan-correctness owner.
- modifies_api: yes — additive result status, rule-health, and truncation metadata.
- Acceptance: F2, F7, Q2-Q3.

### Commit 5 — Enforce the release contract

- Owner: root integration
- Intent: make every future release prove both host surfaces from the packed artifact.
- Files: `package.json`, `package-lock.json`, root `tsconfig.json`, release verifier, new PR/push CI workflow, existing publish workflow, manifest/workflow contract tests, `.build-loop/issues/atomic-scan-generation.md`, and `.build-loop/issues/eslint-adoption.md`.
- Release behavior: remove the invalid `eslint`-based `lint` script (ESLint is not installed), add a no-network `typecheck` script, and record proper ESLint adoption as a dependency-governed follow-up. CI/publish run the full suite including F1-F7; no release-specific exclusion may omit scan correctness tests.
- Identity behavior: compare package/lockfile, Claude/Codex manifests and marketplaces, CLI `--version`, and MCP `serverInfo.version` from one 0.9.1 source of truth.
- modifies_api: no.
- Acceptance: all F and Q criteria plus full suite/build/typecheck.

## F/Q acceptance criteria

The binding criteria are `.build-loop/acceptance-probes.md` F1-F9 and Q1-Q6. No task is complete from narrative evidence alone; each row maps to a deterministic test or runtime probe.

## Scope exclusions and follow-up

- Immutable generation directories plus atomic `current.json` pointer are excluded from 0.9.1 because they require every reader and writer to migrate together. Record the complete design and failure-injection acceptance test in `.build-loop/issues/atomic-scan-generation.md`.
- No npm/GitHub publish, tag, push, or global plugin mutation.
- No hook activation.

## Verification sequence

1. Focused tests per lane.
2. Root TypeScript build and web typecheck.
3. Full 493+ test suite, with F1-F7 present in the non-excluded release path.
4. Full production build.
5. Packed Claude discovery/inventory smoke plus isolated Codex marketplace `plugin/list`, install/enable, new-task skill discovery, and MCP-ready smoke under the existing permission_tier T3 host policy.
6. Live self-scan and bounded summary/rules/coverage probes.
7. Confirm the self-scan changed no tracked/package inputs; then run `npm run verify:release` against a freshly packed tarball as the final post-mutation success check.
8. Independent read-only review of the final diff and evidence.

## Plan verification record

- plan-verify: clean — zero deterministic findings after the activation-map revision.
- plan-critic: six WARNs plus a second fast-pass three WARNs; package ownership, full CI/release coverage, lease activation, lint-command disposition, host discovery depth, and final post-scan verification are resolved above.
- scope-auditor: `scope_clear` after all named production callers, boundary tests, and ownership conflicts were absorbed.

## Caller Audit (Scope Auditor)

```json
{
  "initial_verdict": "scope_gap_found",
  "resolved_in_plan": [
    "src/setup.ts busy setup behavior",
    "src/cli/commands/misc.ts runScan, summary, and setup messaging",
    "src/cli/commands/status.ts refresh-busy behavior",
    "src/index.ts public type exports",
    "src/scanner.ts quickScan and autoRefreshIfStale",
    "setup, MCP, CLI, freshness, auto-refresh, and agent-boundary execution tests",
    "single owner for src/types.ts and src/cli/commands/misc.ts",
    "scan-only lock ownership to prevent drainer self-contention"
  ],
  "remaining": "none; independent re-audit returned scope_clear"
}
```
