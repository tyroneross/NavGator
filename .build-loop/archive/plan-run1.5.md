# Build Plan — NavGator Run 1.5 (walk-set plumbing)

Created: 2026-04-25
Branch: `salvage/audit-improvements`
Reference goal: trailing follow-up to Run 1 (`.build-loop/goal.md` + `.build-loop/issues/run1-incremental-phase-skipping-deferred.md`)

## Problem

Run 1 made storage incremental-aware (`clearForFiles`, `mergeByStableId`) but did NOT plumb the `walkSet` through scanner modules. So on incremental, every scanner still runs `glob('**/*')` over every TS/JS/Swift/Py file, walking the full tree. Result: incremental at 433 ms vs full at 299 ms on the NavGator self-scan.

## Strategy

Add an optional `walkSet?: Set<string>` parameter to each scanner's exported entry function. When provided, the scanner restricts its file enumeration to walk-set members. When `undefined`, behavior is bit-identical to today (full-scan path is the regression lock).

Plumb `walkSet` from `scanner.ts` only when `decision.mode === 'incremental'`. Full scans pass `undefined` so the characterization snapshot is untouched.

## Scanners — what each does + treatment

| Scanner | Walks files? | Treatment |
|---|---|---|
| `connections/ast-scanner.ts` (`scanWithAST`) | YES — `**/*.{ts,tsx,js,jsx}` | Add `walkSet` param; filter the glob result |
| `connections/ast-scanner.ts` (`scanDatabaseOperations`) | YES — `**/*.{ts,tsx}` | Add `walkSet` param; filter the glob result |
| `connections/import-scanner.ts` (`scanImports`) | Already accepts `sourceFiles` | Plumb `walkSet` from scanner.ts by filtering `sourceFiles` before passing in. No scanner-side change needed |
| `connections/service-calls.ts` (`scanServiceCalls`) | YES — `**/*.{ts,tsx,js,jsx,py}` | Add `walkSet` param; filter glob result |
| `connections/service-calls.ts` (`scanPromptLocations`) | YES, but unused at call sites | Skip — not invoked from scanner.ts active path |
| `connections/llm-call-tracer.ts` (`traceLLMCalls`) | YES — `**/*.{ts,tsx,js,jsx,py}` | Add `walkSet` param; filter glob result |
| `connections/prisma-calls.ts` (`scanPrismaCalls`) | YES — `**/*.{ts,tsx,js,jsx}` | Add `walkSet` param; filter glob result |
| `infrastructure/env-scanner.ts` (`scanEnvVars` → `findEnvReferences`) | YES — `**/*.{ts,tsx,js,jsx,mjs,cjs}` | Add `walkSet` param to `scanEnvVars`, propagate to `findEnvReferences`. NB: also reads `.env*` files, those are not source-file walks — leave as-is |
| `infrastructure/queue-scanner.ts` (`scanQueues` → `findQueueDefinitions`) | YES — `**/*.{ts,tsx,js,jsx,mjs,cjs}` | Add `walkSet` param; filter glob result |
| `infrastructure/cron-scanner.ts` (`scanCronJobs` → `findCronJobs`) | YES — `**/*.{ts,tsx,js,jsx,mjs}` (only after package detection) | Add `walkSet` param; filter glob result |
| `infrastructure/deploy-scanner.ts` (`scanDeployConfig`) | NO — only reads `vercel.json`, `railway.json`, etc. | Skip; manifest-driven, mode selector forces full when these change |
| `infrastructure/prisma-scanner.ts` (`scanPrismaSchema`) | NO — only reads `prisma/schema.prisma` | Skip; mode selector forces full on `prisma/schema.prisma` change |
| `infrastructure/field-usage-analyzer.ts` (`scanFieldUsage`) | YES — `**/*.{ts,tsx,js,jsx}` | Add `walkSet` param; filter glob result. Note: opt-in feature flag (`fieldUsage`); usually skipped on incremental |
| `infrastructure/typespec-validator.ts` (`scanTypeSpecValidation`) | YES — `**/*.{ts,tsx}` | Skip — opt-in flag (`typeSpec`) and very rarely used; document and defer |
| `swift/code-scanner.ts` (`scanSwiftCode`) | YES — `**/*.swift` | Add `walkSet` param; filter glob result |
| `prompts/index.ts` (`scanPrompts`) → `prompts/detector.ts` (`scanProject`) | YES — recursive walk inside detector | Add `walkSet` param to `scanPrompts`, propagate to `DetectorOptions.walkSet`, filter inside detector |
| `packages/npm.ts`, `pip.ts`, `swift.ts` | NO — read manifest files | Skip — mode selector forces full on `package.json` / `requirements.txt` / `pyproject.toml` / lockfile changes |
| `infrastructure/index.ts` (`scanInfrastructure`) | NO — runs other manifest detectors | Skip |
| Xcode `pbxproj-parser`, `storyboard-scanner` | NO — iterate over Xcode project file membership | Skip — bound by Xcode project content, not source-file walk |
| SCIP runner | Compiler-driven | Skip — out of scope; behind `NAVGATOR_SCIP=1` flag |

## Scanners updated (10)

1. `src/scanners/connections/ast-scanner.ts` — `scanWithAST` + `scanDatabaseOperations`
2. `src/scanners/connections/service-calls.ts` — `scanServiceCalls`
3. `src/scanners/connections/llm-call-tracer.ts` — `traceLLMCalls`
4. `src/scanners/connections/prisma-calls.ts` — `scanPrismaCalls`
5. `src/scanners/infrastructure/env-scanner.ts` — `scanEnvVars` (+ internal `findEnvReferences`)
6. `src/scanners/infrastructure/queue-scanner.ts` — `scanQueues` (+ internal `findQueueDefinitions`)
7. `src/scanners/infrastructure/cron-scanner.ts` — `scanCronJobs` (+ internal `findCronJobs`)
8. `src/scanners/infrastructure/field-usage-analyzer.ts` — `scanFieldUsage`
9. `src/scanners/swift/code-scanner.ts` — `scanSwiftCode`
10. `src/scanners/prompts/index.ts` + `src/scanners/prompts/detector.ts` — `scanPrompts` propagates walkSet to detector's project walk

`import-scanner.ts` already accepts `sourceFiles[]` — handled at call site by filtering before passing in.

## Plumb-through in scanner.ts

For every scanner call inside `scan()`, pass `mode === 'incremental' ? walkSet : undefined`. Define a helper at the top of `scan()`:

```ts
const incWalkSet = decision.mode === 'incremental' ? walkSet : undefined;
```

Update every call site to add this trailing arg. Where the scanner's signature isn't ready yet, make the arg optional so adding it is non-breaking on the call site if a scanner change isn't merged yet.

## Filter helper

Each scanner that walks files will use this pattern (inline, not extracted — we want zero new files):

```ts
const sourceFiles = await glob(...);
const filtered = walkSet
  ? sourceFiles.filter(f => walkSet.has(f))
  : sourceFiles;
```

Note: `walkSet` contains project-relative paths (matching `glob`'s default cwd-relative output). When `glob` is called with `absolute: true` (ast-scanner), normalize before checking — convert each absolute path back to relative via `path.relative(projectRoot, file)`.

## Tests

1. New unit test in `scanner-incremental.test.ts`: assert that when `scanServiceCalls` is called with a `walkSet` of size 1, only that file is read. Use `vi.spyOn(fs.promises, 'readFile')` to count reads. The control case (no walkSet) reads all sourceFiles.
2. Existing characterization snapshot must not change (regression lock for full-scan output).
3. All 320 existing tests must still pass.

## Bit-identical full-scan check

When `walkSet` is `undefined`, the only difference vs today is the addition of the optional parameter — no behavior change. The filter clause `walkSet ? ... : sourceFiles` short-circuits to the unmodified list.

## Verification

```bash
cd ~/dev/git-folder/NavGator
npm test                   # 320+ pass
npm run build:cli          # exit 0

# E2E timing
rm -rf .navgator/architecture
node dist/cli/index.js scan --full         # FULL_BASELINE
echo "// touch" >> src/types.ts
time node dist/cli/index.js scan           # INCREMENTAL
git checkout src/types.ts
# Compute speedup
```

## Out of scope

- Refactoring the glob ignore lists.
- Caching scanner outputs across runs.
- Promoting deferred-doc into Run 2.
- Any change to scanner output schema.

## Risks

- **`absolute: true` in ast-scanner**: glob returns absolute paths but walkSet entries are relative. Risk of zero matches. Mitigation: normalize via `path.relative(projectRoot, file)` before checking.
- **`shouldExcludeFile` in service-calls**: walkSet may include paths the existing exclusion list rejects. The filter is additive (walkSet ∩ glob result), so exclusions still apply downstream — no regression.
- **Detector internal walk** in prompts: detector does its own walk inside `scanProject`. Need to propagate walkSet into detector options and filter inside the walk routine. Risk of touching detector logic — mitigated by minimal change (filter at the recursion entry point on relative path).
- **`scanWithAST` ts-morph** loads full project regardless of file list. Filtering input file list reduces ts-morph's memory + parse time, which is the dominant cost. Big win expected here.

## Wave plan

Wave A (parallel — no dependency graph between them):
- A1: ast-scanner.ts (both functions)
- A2: service-calls.ts (`scanServiceCalls` only)
- A3: llm-call-tracer.ts
- A4: prisma-calls.ts
- A5: env-scanner.ts (+ internal helper)
- A6: queue-scanner.ts (+ internal helper)
- A7: cron-scanner.ts (+ internal helper)
- A8: field-usage-analyzer.ts
- A9: swift/code-scanner.ts
- A10: prompts/index.ts + prompts/detector.ts

Wave B (after A — single agent, depends on A):
- B1: scanner.ts plumb-through at all call sites + 1 new test in scanner-incremental.test.ts.

Wave C (after B):
- C1: build, run all tests, run E2E timing measurement.
