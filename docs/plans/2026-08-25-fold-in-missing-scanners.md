# Folding the missing scanners into NavGator

Written 2026-08-25. No new npm dependencies at any phase.

## How the existing scanners actually work

Verified by reading each implementation on disk today, not from memory. **None of them
is an LLM.** Every one is a deterministic pattern matcher, which is why folding them in
is a porting problem rather than an integration problem.

| Scanner | Language | Mechanism | Portable into NavGator? |
|---|---|---|---|
| `build-loop/scripts/transcript_pattern_miner/secrets_scan.py` | Python | 9 named `re.compile` patterns + a keyword-gated generic | Yes — plain regex literals |
| `build-loop/scripts/security_scan.py` | Python | 44 `re.compile`, plus `_PEM_RE` and `_GENERIC_SECRET_RE` | Yes |
| `secrets-vault/src/server/services/secret-patterns.ts` | TypeScript | The same 9 patterns, ported verbatim from the Python | Already in the target language |
| `secrets-vault/.../Clipboard/SecretPatternMatcher.swift` | Swift | Same set + Shannon-entropy fallback | Read for reference; already ported |
| `navgator/src/secrets/engines/native.ts` | TypeScript | 20 classes, regex + Shannon entropy | This is ours |
| **TruffleHog** | **Compiled Go binary** (Mach-O arm64) | ~800 detectors compiled in; optional live HTTP verification against each issuer | **No.** Nothing can be copied out of a binary. |

The line that matters: everything except TruffleHog is a regex list, and a regex list moves
between languages by retyping it. TruffleHog is the only engine that does something no
regex can do — ask the issuer whether the credential still works — and that capability
cannot be absorbed at any price.

## The actual problem

`secret-patterns.ts` opens with this claim:

> Pay-it-forward: this module is the single source of truth for secret patterns. The Swift
> detector reads the same set via a generated JSON artifact (Resources/secret-patterns.json).

**That artifact does not exist.** `find` across the repo and the built `.app` returns nothing,
and the Swift file describes its own patterns as mirroring the TypeScript rather than loading
it. So the same regex list is hand-maintained in four places, and they have already drifted:

| Source | Named classes |
|---|---|
| `secrets_scan.py` (miner) | 9 |
| `secret-patterns.ts` (vault) | 9 |
| `security_scan.py` (pre-push gate) | 44 patterns, different list |
| `native.ts` (NavGator) | 20 |

NavGator is not missing a scanner. There is one pattern corpus copied four ways, and adding
a fifth copy without addressing that is how the drift continues.

## Goal

Every credential class NavGator declares is detectable by an engine that ships with NavGator,
so that removing the external binary degrades coverage instead of erasing it — and the pattern
list stops being maintained in parallel.

## Deliverables

1. `native.ts` covers every class in `SecretClass` except those that genuinely require liveness.
2. One machine-readable pattern file that the other consumers can adopt, replacing the artifact
   the vault's comment already promises.
3. A tenth diagnostic, `engine_degraded`, for an engine that is present, invoked, and silent.
4. A written statement of what NavGator can never do alone.

## Approach

### Phase 1 — Close the blind classes (no dependencies, ~1 session)

Add regex patterns to `native.ts` for the four classes NavGator currently cannot see without
TruffleHog installed, plus the one nothing sees at all:

| Class | Today | Format to match |
|---|---|---|
| `azure_key` | **nothing covers it** | Storage account keys (88-char base64 + `AccountKey=`), SAS tokens, `AZURE_*` client secrets |
| `gcp_key` | TruffleHog only | Service-account JSON (`"type": "service_account"` + `private_key`) |
| `sendgrid_key` | TruffleHog only | `SG.` + 22 chars + `.` + 43 chars |
| `twilio_key` | TruffleHog only | `SK` + 32 hex, and `AC` + 32 hex account SIDs |

Each pattern ships with a test that plants a format-valid but fabricated credential and asserts
detection, plus a negative case. Set `specificity` honestly — these are fixed vendor prefixes,
so `structured` is correct for all four.

**Acceptance:** `uncovered_class` and the four `single_engine_class` diagnostics stop firing
with TruffleHog uninstalled.

### Phase 2 — Reconcile against build-loop's 44 (~1 session)

`security_scan.py` has 44 patterns; NavGator has 20 classes. Diff the two lists, port anything
NavGator lacks, and record anything deliberately not ported with the reason. This is where the
pre-push gate's accumulated knowledge lives, and it is the list most likely to contain a class
nobody has thought about since the day it was added.

**Acceptance:** a written diff table, in this file, with a disposition for every unported pattern.

### Phase 3 — One pattern file, four consumers (~1 session)

Emit `src/secrets/patterns.json` from NavGator's pattern table via a build step — a data file
checked into the repo, not a package. Each entry: `id`, `class`, `pattern`, `flags`,
`specificity`, `source` (which scanner it came from).

Then make it consumable:
- NavGator loads it at build time (already TypeScript, no runtime cost).
- The vault's `secret-patterns.ts` can import it, retiring the hand-copy and fulfilling the
  claim its own header already makes.
- The Swift matcher can read it from `Resources/`, which is exactly what the comment says
  happens today and does not.
- `security_scan.py` can load it with `json.load` — Python stdlib, no dependency.

JSON is the right interchange because all four languages parse it with no library. This adds
no dependency to anything; it removes three hand-maintained copies.

**Acceptance:** deleting a pattern from the JSON makes it disappear from NavGator's scan, proven
by a test.

### Phase 4 — Name what cannot be folded in

TruffleHog stays an optional external engine. Two capabilities are not portable:

- **Liveness verification.** Detection proves shape. Only a live call to the issuer proves the
  key opens anything. No regex will ever do this, and 209 candidates currently sit unverified,
  including 103 private-key headers.
- **Detector breadth maintained by someone else.** ~800 detectors tracked against vendors'
  changing formats is ongoing work NavGator is not going to do.

Write this into `types.ts` beside the engine contract, so the next person to ask "why do we
still shell out to a binary" finds the answer.

## Risks

**Absorbing TruffleHog's classes into `native` raises coverage but lowers independence.**
NavGator's patterns were written *from* what TruffleHog and the vault were missing, so the two
engines are correlated by construction. When they agree, that agreement is weaker evidence than
two independently-built detectors agreeing. After Phase 1 the coverage matrix will look better
while cross-checking gets slightly worse. Keep the external engine installed; the matrix is not
the whole picture.

**A regex ported without its context is a regex that fires wrong.** `security_scan.py`'s generic
assignment pattern is tuned for a git push range; the vault's generic pattern requires a
credential keyword within 30 characters specifically to suppress high-entropy false positives.
Port the guard conditions, not just the expression.

**Phase 3 changes files in two other repos.** The vault and build-loop both have active work.
Land NavGator's side first, publish the JSON, and let the other two adopt it when their owners
choose. Do not push edits into a repo mid-flight to satisfy this plan.

## Not doing

- Vendoring TruffleHog's detector definitions. They live in a compiled binary; there is nothing
  to vendor.
- Adding an npm dependency for pattern matching. JavaScript's `RegExp` is sufficient and the
  entropy fallback is thirty lines.
- Making NavGator store credential values. The boundary in `types.ts` holds: Secrets Vault
  remains the system of record for values and rotation.
