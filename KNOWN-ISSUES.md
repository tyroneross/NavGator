# NavGator — Known Issues

Track issues with known repro and clear remediation paths. Closed issues move to release notes.

---

## Closed

### `npm test` registered tmp scan fixtures into the developer's real `~/.navgator`

**Status:** closed 2026-08-03 (commit `35dfb99`)
**Reported:** 2026-08-03 · **Pre-existing**, not introduced by the registry-journal work — that work only made it *visible*, which is the journal doing its job.

`scan()` calls `registerProject()` (`src/scanner.ts:2131`), which writes
`~/.navgator/projects.json`. Test files that built a tmp project and called
`scan()` without redirecting `$HOME` wrote the developer's real registry.
Measured drift on clean HEAD: **+42 entries per full `npm test` run**, which had
accumulated to **1,433 tmp-fixture entries** (723 pointing at paths that no
longer existed) and grown the registry from ~425 KB to ~503 KB.

**Fix:** a vitest `setupFiles` hook (`src/__tests__/setup/home-redirect.ts`)
redirects `HOME`, `USERPROFILE`, and `NAVGATOR_HOME` to a per-file `mkdtemp`
before any test module imports. `pool: 'forks'` was already pinned, so each
test file gets its own process and its own fake home.

The audit found exactly one test with a legitimate dependency on the real home
— `registry-concurrency-oracle.test.ts`'s attribution assertion, which captured
`os.homedir()` at module scope and would have silently started checking the
*fake* home, reporting green while proving nothing. It now reads
`NAVGATOR_TEST_REAL_HOME`, captured once by the hook before it redirects.

**Closure proof** (mutation-verified, run against a scratch `HOME` so proving
the fix did not itself pollute the registry):

```
full suite, real registry before -> after:  2 -> 2   (821/821 pass)
hook removed, scratch HOME:                 26 entries from ONE test file
hook active,  scratch HOME:                  0 entries, no registry created
```

Residual cleanup of the 1,433 accumulated entries is available to any user via
`navgator doctor --fix`, which backs up first and removes only entries that are
both tmp-rooted and no longer on disk.

---

### llm-map: Apple FoundationModels `@Generable` types not detected

**Status:** closed
**Reported:** 2026-05-01
**Closed:** 2026-08-03
**Reporter:** FlowDoro tech-debt audit
**Severity:** signal-quality (false-negative)

**Resolution:** the FoundationModels patterns were not previously undetected —
`code-scanner.ts` already had an `import FoundationModels` → `Apple
Intelligence` mapping plus a zero-arg-only `LanguageModelSession()` pattern,
`.respond(to:`, and `@Generable`. The prior state was *partial and
untagged*: (1) `LanguageModelSession()` matched only Apple's non-existent
zero-arg initializer, so it matched nothing real (T1 Apple docs,
developer.apple.com symbol JSON, 2026-08-03: `instructions:`/`transcript:` is
always required); (2) `.respond(to:` and `@Generable` were registered as
standalone, ungated patterns, which both under-counted (any file lacking
those exact substrings was missed) and risked false-positiving on unrelated
Swift APIs (URLSession delegates, custom `respond` methods) since they were
never gated on `import FoundationModels`; (3) no `provider`/`kind` tagging or
`@Generable` schema-name capture existed.

Fixed with a dedicated, import-gated detection pass
(`scanFoundationModelsUsage` in `src/scanners/swift/code-scanner.ts`) that:
- requires `import FoundationModels` in the same file before anything else
  fires (closes the false-positive risk);
- matches `LanguageModelSession(` with any arguments plus the
  trailing-closure construction form (there is no zero-arg initializer);
- captures `@Generable`-annotated `struct`/`enum` names (bare,
  `(description:)`, and `(name:description:)` forms; annotation may sit on
  the preceding line);
- treats `respond(to:`, `respond(generating:`, `streamResponse(`,
  `SystemLanguageModel`, and `@Guide(` as confirming-only signals.

Emits a single `Apple Foundation Models` component (`type: 'llm'`,
`role.layer: 'external'`) tagged `metadata.provider: 'apple-on-device'`,
`metadata.kind: 'foundation-models'`, and `metadata.generable_schemas:
string[]`. `LLMUseCase` (`src/llm-dedup.ts`) gained optional `providerTag`,
`kind`, and `structuredOutput`, surfaced in `navgator llm-map` and `navgator
status`. Also fixed two pre-existing orphan-id bugs in the Swift LLM
connection emission (`code-scanner.ts:462-501`) that produced dangling
connection endpoints on every Swift LLM call, including this new pass had it
reused the old pattern.

Tests: `src/__tests__/swift-foundation-models.test.ts` (new),
`src/__tests__/llm-dedup.test.ts` (appended).

**Original symptom (for reference):** `navgator llm-map` on
`~/dev/git-folder/FlowDoro` reported a single LLM use case
(`TaskDecomposer`), missing the FoundationModels-driven
`Shared/Services/PlanCoachService.swift` flow entirely. Repro at the time:

```bash
cd ~/dev/git-folder/FlowDoro
navgator llm-map
# observed single TaskDecomposer hit
grep -rln "FoundationModels\|@Generable\|LanguageModelSession" Shared/ | sort -u
# observed additional files: PlanCoachService.swift, EstimationCoachInferring.swift,
# any *.swift with @Generable types
```

---
