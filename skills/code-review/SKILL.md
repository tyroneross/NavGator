---
name: code-review
description: This skill activates when the user asks to "review architecture", "check connections", "gator review", "architectural review", "what's the architectural impact", "review changes", "is this safe to merge", "what did I break", "check integrity", "review before push", or when NavGator scan detects architectural drift. Performs 5-phase architectural integrity review focusing on system flow, component communication, and accumulated lessons.
version: 0.3.0
user-invocable: true
---

# Architectural Integrity Review

Orchestrates NavGator's impact analysis, data flow tracing, rules engine, and lessons tracking into a repeatable architectural review workflow. This skill is an architectural integrity reviewer — not a linter, not a bug hunter.

## What This Skill IS vs. IS NOT

**IS:**
- System flow — how data moves from user input through the system to output
- Component communication — APIs, data formats, connection patterns between layers
- API contract validation — interface changes and whether consumers are updated
- LLM architecture — provider routing, prompt patterns, model selection logic
- Documentation drift — whether docs reflect what the code actually does
- Lessons learned — patterns that caused issues, tracked and matched over time
- Freshness validation — periodic research to avoid stale architectural knowledge

**IS NOT:**
- Code linter or style checker — formatting, naming conventions, indentation
- Individual function bug hunter — local logic errors, off-by-one mistakes
- Security vulnerability scanner — use dedicated security tools for that
- Test coverage auditor — use `navgator coverage` for that
- TypeScript type error detector — the compiler handles that
- Performance optimizer — not the scope of architectural review

## Scope Resolution

Determine what to review before starting:

| Invocation | Scope |
|------------|-------|
| Default (no flags) | `git diff origin/main..HEAD` — changed files since branch diverged |
| `--all` | Full architecture review across all components |
| `<component>` | Focused review on one component and its direct connections |
| `--validate` | Run Phase 5 freshness validation regardless of age |
| `learn "..."` | Record a manual lesson, skip full review |

When scope is ambiguous, default to `git diff origin/main..HEAD`. If the branch has no divergence from main, ask the user what they want to review.

## Prerequisites

Before starting any phase:

1. Check if `.navgator/architecture/index.json` exists. If not, stop and tell the user to run `/gator:scan` first.
2. Check the `generated_at` timestamp in `index.json`. If >24 hours old, warn: "Architecture data is N hours old — consider running `/gator:scan` first for accurate results."
3. Load `.navgator/architecture/file_map.json` for file-to-component resolution.
4. Load `.navgator/architecture/graph.json` for connection traversal.
5. Check for `.navgator/lessons/lessons.json`. If missing, create it:
   ```json
   { "schema_version": "1.0.0", "lessons": [] }
   ```

Do not proceed without architecture data. Proceeding on stale data is worse than pausing.

---

## Phase 1 — Structural Changes

**Goal:** Identify which components and layers were touched.

1. Run `git diff [scope] --stat` to get the list of changed files.
2. For each changed file, look it up in `file_map.json` to resolve to its parent component ID.
3. Look up that component ID in `index.json` to get its type and layer.
4. Classify each change:
   - **New component** — file belongs to a component not previously in the graph
   - **Modified connection** — file is a connection point (API route, service interface, adapter)
   - **Config change** — environment config, deploy config, package.json
   - **Documentation** — README, CLAUDE.md, skill files, comments only
5. Identify which layers were touched: frontend, backend, database, infra, external.
6. Flag any change that crosses more than one layer as **cross-layer** — these carry higher risk because they affect integration boundaries.
7. Note any new files that do not resolve to any component in `file_map.json` — these may be untracked additions.

Output:
```
═══ PHASE 1: STRUCTURAL CHANGES ═══
  N components touched across N layers
  Cross-layer: [ComponentA (frontend→backend), ComponentB (backend→database)]
  New components: [any new, unconnected components — needs scan to track]
  Layers: frontend(N) | backend(N) | database(N) | infra(N)
```

---

## Phase 2 — Connection & Flow Integrity

**Goal:** Verify that component connections are valid and data flows are intact.

For each component identified in Phase 1:

1. Call `navgator impact` MCP tool with the component name to get its blast radius (incoming and outgoing connections, severity).
2. Call `navgator trace` MCP tool (direction: "both") to follow data flow forward and backward through the architecture.
3. Call `navgator connections` MCP tool (direction: "both") to inspect the specific connection map.

Check for these architectural issues. For each finding, record: severity, file:line, what is wrong, and why it matters architecturally.

| Issue | Severity | Detection |
|-------|----------|-----------|
| Orphaned component | Important | New component with 0 incoming AND 0 outgoing connections |
| Broken reference | Critical | Connection points to a component not in `graph.json` |
| Layer violation | Critical | Frontend connects directly to database, bypassing backend |
| High fan-out | Important | Component has >8 outgoing dependencies — fragility indicator |
| Import cycle | Critical | Component A → B → A (circular dependency) |
| API contract mismatch | Critical | Component interface changed but connected consumers not updated |
| Self-referencing connection | Important | Component listed as its own dependency in graph output |

For each changed component, construct the data flow trace showing the full chain from user input to response. Example format:
```
User → next/pages → /api/users → prisma.user.findMany → PostgreSQL → JSON response
```

Output:
```
═══ PHASE 2: CONNECTION INTEGRITY ═══
  Rules: N violations (N critical, N important, N minor)

  [CRITICAL] Layer violation: ComponentA (frontend) → ComponentB (database)
    File: src/pages/users.tsx:45
    Why: Frontend bypasses API layer, creating tight coupling to DB schema.
         Any schema change now requires frontend updates.

  [IMPORTANT] Orphaned component: NewService
    File: src/services/new-service.ts
    Why: Component has no connections — either integration is incomplete
         or this is dead code.

  Data flow for changed components:
    ComponentA: User → next/pages → /api/users → prisma.user.findMany → PostgreSQL → JSON response
    ComponentB: Worker → BullMQ → process() → db.write() → PostgreSQL
```

If no violations: report "No connection integrity issues found" — do not omit the section.

---

## Phase 3 — Documentation Drift

**Goal:** Verify that docs reflect what the code actually does.

1. Read `README.md`. For each CLI command or flag in the implementation, check that it appears in the README CLI Reference section. Run `node dist/cli/index.js --help` (or the equivalent for this project) and compare against what README documents.
2. Read `CLAUDE.md`. Verify the command table is complete — all `/gator:*` commands that exist in the implementation should be listed.
3. List all directories under `skills/`. For each capability NavGator has, verify a skill file exists.
4. Read `plugin.json` (or equivalent config). Verify all referenced directories and entry points exist on disk.
5. For each new or modified capability identified in Phase 1, check whether it appears in:
   - README (user-facing docs)
   - CLAUDE.md (agent-facing docs)
   - A skill file (agent discoverability)

An agent-invisible feature is one that exists in code but does not appear in any agent-readable file (CLAUDE.md or skill files). These are the highest-priority documentation gaps — they silently degrade agent capability.

Output:
```
═══ PHASE 3: DOCUMENTATION DRIFT ═══
  Undocumented: [capabilities not in README, CLAUDE.md, or skills/]
  Stale: [docs referencing behavior that no longer matches implementation]
  Agent-invisible: [features an agent would not discover from available context]

  [AGENT-INVISIBLE] --validate flag added to code-review but not in CLAUDE.md command table
  [STALE] README references `navgator check` but command was renamed to `/gator:check`
  [UNDOCUMENTED] navgator coverage --typespec — no skill file, not in CLAUDE.md
```

If no drift: report "Documentation matches implementation" — do not omit the section.

---

## Phase 4 — Lessons Check

**Goal:** Match current findings against known patterns, and record new ones.

### Matching Known Lessons

1. Read `.navgator/lessons/lessons.json`.
2. For each lesson in the file, check whether any changed file, component, or finding from Phases 1–3 matches the lesson's `signature` patterns (regex or string match against file paths, code patterns, or component names).
3. If a match is found, flag it with recurrence context. Do not silently skip matches.

### Recording New Lessons

After Phase 3 completes, for each NEW finding (not already in lessons.json), create a lesson entry and append it to lessons.json:

```json
{
  "id": "<deterministic hash — sha256 of category+pattern, truncated to 8 chars>",
  "category": "<layer-violation | orphaned-component | api-contract | doc-drift | import-cycle | triplicated-logic | other>",
  "pattern": "<human-readable description of the pattern>",
  "signature": ["<regex or code fragment that would match recurrence>"],
  "severity": "<critical | important | minor>",
  "context": {
    "first_seen": "<ISO 8601 date>",
    "last_seen": "<ISO 8601 date>",
    "occurrences": 1,
    "files_affected": ["<file paths where this was found>"],
    "resolution": "<how to fix this — specific, not generic>"
  },
  "example": {
    "bad": "<code or pattern that causes the issue>",
    "good": "<correct pattern>",
    "why": "<architectural reasoning — why this matters at the system level>"
  },
  "validation": {
    "last_validated": "<ISO 8601 date>",
    "source": "agent",
    "status": "unvalidated"
  }
}
```

If a lesson already exists for this pattern (matched by `id` or `signature`), update `last_seen`, increment `occurrences`, and merge `files_affected` — do not create a duplicate.

Write updated lessons.json back to `.navgator/lessons/lessons.json`.

Output:
```
═══ PHASE 4: LESSONS ═══
  Matched: N known patterns
  [MATCH] "Triplicated parser logic across scanners" (seen 3 times, last: 2026-03-15)
    Files: src/scanners/js.ts, src/scanners/ts.ts, src/scanners/py.ts
    Resolution: Extract shared utility — see src/parsers/shared-parser.ts

  New lessons recorded: N
  [NEW] "Self-referencing connection in graph output" → recorded (id: a3f9b21c)
  [NEW] "CLI flag undocumented in agent context" → recorded (id: 7d4e8f01)
```

---

## Phase 5 — Freshness Validation

**Goal:** Ensure lessons referencing external APIs or libraries still reflect current best practice.

Only run Phase 5 when one of these conditions is true:
- User passed `--validate` flag
- A lesson references an external API, library, or version-specific behavior
- More than 30 days have passed since `validation.last_validated` on any matched lesson

For each lesson that needs validation:
1. Use WebSearch to look up the referenced API, library, or pattern.
2. Verify it is still the current recommended approach.
3. Update the lesson entry:
   - `validation.last_validated` → today's ISO date
   - `validation.status` → `"current"` or `"stale"`
   - `validation.source` → `"web-search"`
4. If stale, add a `validation.note` field explaining what changed.

Write the updated lessons.json back.

Output:
```
═══ PHASE 5: FRESHNESS ═══
  Validated: N lessons confirmed current
  Stale: N lessons need update
  Skipped: N (not due for validation)

  [CURRENT] "BullMQ Worker API" — confirmed current as of BullMQ v5 docs
  [STALE] "Next.js API routes pattern" — App Router is now preferred, Pages Router deprecated in v16
    Update: Detection signature should flag Pages Router /api/ usage
```

If Phase 5 was not triggered: report "Freshness validation skipped (use --validate to force)" — do not omit the section.

---

## Manual Lesson Entry

When the user runs a review with `learn "..."`:

1. Parse the lesson text from the quoted argument.
2. Infer category from content. If ambiguous, ask: "What category fits best? (layer-violation / orphaned-component / api-contract / doc-drift / import-cycle / triplicated-logic / other)"
3. Create a lesson entry with:
   - `source: "manual"`
   - `status: "unvalidated"`
   - `occurrences: 1`
   - `first_seen` and `last_seen` set to today
4. Write to `.navgator/lessons/lessons.json`.
5. Confirm: "Lesson recorded (id: XXXXXXXX). Run `/gator:review --validate` to verify it against current best practice."

Do not run the full 5-phase review for manual lesson entry — just record and confirm.

---

## What to Ignore

This skill explicitly does NOT review:

- **Individual function logic** — off-by-one errors, business rule correctness, algorithm bugs. Use a debugger.
- **Code style and formatting** — indentation, naming conventions, blank lines. Use a linter.
- **Test coverage** — missing tests, untested branches. Use `navgator coverage`.
- **Performance** — slow queries, rendering bottlenecks, memory usage. Use profiling tools.
- **Security vulnerabilities** — SQL injection, XSS, auth bypasses. Use dedicated security tools.
- **TypeScript type errors** — the compiler catches those before review.
- **Spelling and grammar** — in comments or docs. Not the scope here.

If a finding falls into one of the above categories, note it briefly and redirect: "This looks like a linter issue — outside architectural review scope." Then move on.

---

## Examples

These are real architectural findings this skill is designed to surface:

**Example 1 — Triplicated logic (pattern: shared utility violated)**
```
[IMPORTANT] Phase 2: Prisma result parser duplicated across 3 scanners
  Files: src/scanners/js-scanner.ts:88, src/scanners/ts-scanner.ts:112, src/scanners/py-scanner.ts:67
  Why: Three components implement identical result normalization logic independently.
       Any fix to the parsing behavior must be applied in three places — high maintenance risk.
       This also signals that the scanner abstraction boundary is leaking implementation.
  Resolution: Extract shared utility at src/parsers/prisma-result-parser.ts,
              import from all three scanners.
```

**Example 2 — Self-referencing connection (pattern: component communication contract broken)**
```
[IMPORTANT] Phase 2: graph.json shows NavGatorCore → NavGatorCore (self-reference)
  File: .navgator/architecture/graph.json (generated output)
  Why: A component listed as its own dependency indicates the connection detection
       logic matched internal calls as external connections. The graph output contract
       is broken — consumers relying on this graph for impact analysis will see
       inflated blast radius and incorrect dependency chains.
  Resolution: Add self-reference filter in graph builder before writing graph.json.
```

**Example 3 — Agent-invisible capability (pattern: doc drift)**
```
[AGENT-INVISIBLE] Phase 3: navgator coverage --typespec added to CLI but absent from CLAUDE.md
  File: src/cli/index.ts:203 (flag defined), CLAUDE.md (missing)
  Why: Claude Code reads CLAUDE.md to discover available commands. A capability not
       listed there will never be suggested or invoked by an agent, regardless of
       how useful it is. The feature exists but is unreachable in agent-driven workflows.
  Resolution: Add `navgator coverage --typespec` row to CLAUDE.md command table
              with a one-line description of what it validates.
```

---

*gator — architecture tracker*
