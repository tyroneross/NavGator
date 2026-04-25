# Plan — NavGator Run 1.6 (Defensive fixes + layout improvements)

Branch: `salvage/audit-improvements`
Builds on: Run 1 + Run 1.5 uncommitted work
Hard constraint: zero new runtime npm deps · bit-identical full-scan output (characterization snapshot enforces) · all 322 existing tests pass · atomic writes preserved.

## Verify-step decisions made during Assess

- **Item #2 — slash-command namespace:** plugin name in `.claude-plugin/plugin.json` is `navgator`. Slash command IS `/navgator:plan`. README and `commands/plan.md` body must align to this.
- **Item #6 — renames:** Current `pickCanonicalPath` enables path-disambiguation for 6 component types (`api-endpoint`, `db-table`, `prompt`, `worker`, `component`, `cron`). For `component` type the name = basename only (e.g. `index`), so collisions are real (`src/utils/index.ts` vs `src/lib/index.ts` would collapse). **Removing path-disambiguation would cause stable_id collisions in big repos.** The prompt's "name-only with optional FNV hash" doesn't apply here — the tradeoff is collisions vs rename-stability. **Plan: document the tradeoff in `pickCanonicalPath` docstring; rely on integrity-check + promote-to-full to keep renames correct (perf-suboptimal but correct). No code change to stable_id derivation.** Honest call per the prompt's "If any item turns out impossible or the right call differs from this prompt, return early with reasoning."
- **Item #7 — aliased imports:** `import-scanner.ts:399` calls `resolveImport` which at line 67-73 maps aliases to actual paths and at line 79 normalizes to project-relative resolved paths BEFORE constructing the connection. Confirmed `to.location.file` and `code_reference.file` always store resolved paths. **No fix needed. Add docstring comment + 1 test using a tsconfig-paths fixture.**

## Execution waves

### Wave A — single subagent (touch-and-go in scanner.ts/types.ts/README.md)
Items: 1, 2, 3, 5, 6.

**1. Trigger-list gaps** (`src/scanner.ts:112-124`):
- Extend `FULL_SCAN_TRIGGER_FILES` with `tsconfig.json`, `vercel.json`, `fly.toml`, `railway.json`, `.gitignore`. Skip `swift.config.swift` — not a real well-known filename (the user listed "if present" so a no-op when absent is fine).
- Also extend `manifestPatterns` at `src/scanner.ts:296-308` so these files are tracked for change detection.
- Update existing trigger test at `src/__tests__/scanner-incremental.test.ts:116` to also exercise `tsconfig.json` (1 new assertion in same test or a new sibling test).

**2. Slash-command namespace consistency:**
- Edit `commands/plan.md` body to use `/navgator:plan`.
- Edit `README.md` "Scan modes" section / slash-command row to use `/navgator:plan`.

**3. files_scanned metric clarity** (`src/scanner.ts:1189` and `:1381`):
- Change ternary to: `(scanType === 'incremental' || scanType === 'incremental→full') ? walkSet.size : sourceFiles.length`.
- Add 1 test in `scanner-incremental.test.ts` asserting that an `incremental→full` promotion reports `files_scanned === walkSet.size` (small) not `sourceFiles.length` — synthesize via mocked integrity failure or assert via observed walk-set on a fixture.

**5. New-file orphan in-edges** (`src/scanner.ts:162` `selectScanMode`):
- After the trigger-files loop, add: `if (fileChanges && fileChanges.added.length > 0) return { mode: 'full', reason: 'new-files' };`
- Update `ScanModeDecision.reason` union type to include `'new-files'`.
- Add a test: fixture with one new file in `fileChanges.added`, no triggers, prior index present → `decision.mode === 'full'` and `reason === 'new-files'`.

**6. Renames — verify only:**
- Add doc comment on `pickCanonicalPath` (`src/storage.ts:35`) explaining the collision-vs-rename tradeoff. No code change.

### Wave B — Concurrency lock (item #4) — own subagent
- New file `src/scan-lock.ts` (~80 LOC):
  - `acquireLock(storeDir): Promise<{ ok: true, release: () => void } | { ok: false, message: string }>`
  - Lock file at `<storeDir>/scan.lock`, JSON `{pid, started_at, scan_type}`.
  - On entry: check existence; if exists, parse, then check `(now - started_at) < 600_000` AND `process.kill(pid, 0)` does not throw → return `{ok:false, message:"Scan already in progress (pid N, started Xs ago)"}`. Otherwise stale-clear (unlink) and proceed.
  - Atomic write via `fs.openSync(path, 'wx')` (fail-fast on race) + `fs.writeFileSync` + close.
  - `release` deletes the lock file (idempotent — wraps in try/catch for ENOENT).
- Integration in `src/scanner.ts:scan()`: acquire lock right after `ensureStorageDirectories`. If `!ok`, `console.log(message)` and `return` an empty-shape result early (matching the existing noop shape — preserves CLI exit 0).
- Wrap the rest of `scan()` body in `try { ... } finally { release(); }` so the lock releases on errors too.
- Test in `scanner-incremental.test.ts`: stub a held lock file (current pid, current ts), call `scan()`, assert it returns the empty-shape result and prints the message; clean up.

### Wave C — Aliased-import verification (item #7) — own subagent
- Add doc comment on `loadReverseDeps` (`src/storage.ts:1735`) noting: connection target paths are resolved at write time by `resolveImport`, so reading `code_reference.file` and matching against `changedFiles` is correct without further normalization.
- Add a test fixture: `src/__tests__/fixtures/aliased-imports/` with `tsconfig.json` containing `"paths": { "@/*": ["src/*"] }`, a `src/utils/foo.ts`, and a `src/index.ts` that does `import { x } from '@/utils/foo';`. Test asserts:
  - After scan, the connection's `to.location.file === 'src/utils/foo.ts'` (resolved, not `@/utils/foo`).
  - `loadReverseDeps(new Set(['src/utils/foo.ts']))` returns a set including `src/index.ts`.

### Wave D — Reverse-deps index (item #8) — own subagent (HEADLINE PERF WIN)
- New file at scan end: `.navgator/architecture/reverse-deps.json`:
  ```ts
  {
    schema_version: '1.0.0',
    generated_at: <number>,
    edges: { [target_file: string]: string[] }  // target → list of source files that import it
  }
  ```
- Build in-memory at end of scan from `finalConnections`. For each connection where the target has a file location (`to.location.file`), push `c.code_reference.file` into `edges[to_file]`. Dedupe via `Set` → `Array`.
- Write atomically via `atomicWriteJSON` at scan end (after `buildIndex/buildGraph/buildFileMap`).
- Update `loadReverseDeps` in `src/storage.ts:1735`:
  - First try to read `reverse-deps.json`. If present and `schema_version` matches: for each `f in changedFiles`, return union of `edges[f]` lookups. Single file open total.
  - Fallback: if file missing or parse fails → existing per-edge JSON walk (retained, renamed `loadReverseDepsLegacy` if cleaner, or kept inline as the else branch).
- Test: assert file exists after scan; assert shape; assert both new-path and legacy-path return the same set on a fixture.

### Wave E — Manifest of derived artifacts (item #9) — own subagent
- New file: `.navgator/architecture/manifest.json`:
  ```ts
  {
    schema_version: '1.0.0',
    generated_at: <number>,
    files: {
      'reverse-deps.json': { generated_at, source_count: <connection count> },
      'graph.json': { generated_at },
      'index.json': { generated_at },
      'file_map.json': { generated_at }
    }
  }
  ```
- Write at scan end, after all other artifacts. Atomic write.
- Reading is optional. No consumer changes required this run.
- Test: assert file exists after scan; assert shape.

## Phase 4 Review plan

- A. Critic — sonnet-critic on full diff
- B. Validate — `npm test`, `npm run build:cli`, e2e timing recipe on atomize-ai (FULL + INCREMENTAL with touch), assert `reverse-deps.json` + `manifest.json` exist
- D. Fact-check — fact-checker + mock-scanner in parallel; verify zero new deps
- E. Simplify — `/simplify` on changed files
- F. Report — scorecard + state.json append

## Out of scope (rejected per prompt)
- SQC audit / AQL / SPRT (Run 2)
- Stratified parallel workers (Run 3)
- EWMA / SPC drift (Run 4)
- Phase 5/6 architecture diff + hash optimizations
- New MCP tools / agents / slash commands
- Mirror sync
- Planner agent runtime smoke test
