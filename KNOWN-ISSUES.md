# NavGator — Known Issues

Track issues with known repro and clear remediation paths. Closed issues move to release notes.

---

## Closed

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
