# NavGator — Known Issues

Track issues with known repro and clear remediation paths. Closed issues move to release notes.

---

## llm-map: Apple FoundationModels `@Generable` types not detected

**Status:** open
**Reported:** 2026-05-01
**Reporter:** FlowDoro tech-debt audit
**Severity:** signal-quality (false-negative)

### Symptom

Running `navgator llm-map` on `~/dev/git-folder/FlowDoro` reports a single LLM use case (`TaskDecomposer`). FlowDoro actually has at least two LLM-driven flows:

1. **Phase 1: TaskDecomposer** — caught correctly (uses Groq + on-device routing).
2. **Phase 2: PlanCoachService** — *not detected*. Calls Apple FoundationModels via a typed `@Generable` request shape (`Shared/Services/PlanCoachService.swift`), routed through `AppleOnDeviceCoachInferrer` and `EstimationCoachInferring`.

The `llm-map` heuristic appears to scan for HTTP-style cloud-provider call patterns (URL string → `URLRequest` → `URLSession`) and on-device adapter classes that explicitly name a provider. It misses the `@Generable` / `LanguageModelSession.respond(to:)` shape that Apple FoundationModels apps adopt.

### Why this matters

Apple FoundationModels is the on-device-first path for any iOS 26+ / macOS 26+ app, and the `@Generable` typed-output shape is the canonical Apple pattern (per WWDC 2024 + 2025 sessions). An `llm-map` that misses it will under-count LLM surface area on every Apple-native app that follows Apple's own guidance — exactly the apps most likely to be on the leading edge.

### Suggested heuristic addition

Detect any Swift file matching at least one of:

1. `import FoundationModels` AND a type annotated with `@Generable`
2. A call site that constructs `LanguageModelSession(...)` (any initializer)
3. A call site invoking `.respond(to:)`, `.respond(to:generating:)`, or any
   `respond(...)` overload on a `LanguageModelSession` value

Each match should register an LLM use case tagged `provider: apple-on-device`, `kind: foundation-models`, with the `@Generable` schema name surfaced (when present) as the structured-output contract.

### Repro

```bash
cd ~/dev/git-folder/FlowDoro
navgator llm-map
# observe single TaskDecomposer hit
grep -rln "FoundationModels\|@Generable\|LanguageModelSession" Shared/ | sort -u
# observe additional files: PlanCoachService.swift, EstimationCoachInferring.swift,
# any *.swift with @Generable types
```

### Workaround until fix lands

For Apple-native apps, supplement `navgator llm-map` output with:

```bash
grep -rln "@Generable\|LanguageModelSession\|import FoundationModels" \
     <repo>/Shared <repo>/iOS <repo>/macOS 2>/dev/null
```

Treat each unique file as a candidate use case; reconcile by hand.

---
