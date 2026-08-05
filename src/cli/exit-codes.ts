/**
 * CLI exit-code contract (Ops Center 38533730).
 *
 * `navgator <cmd> --agent` is the default agent surface (see CLAUDE.md's
 * "Agent interface policy"). An agent shelling out to it relies on the exit
 * code alone to decide what happened, so the code has to carry real meaning
 * — not just "zero is fine, nonzero is bad."
 *
 *   0  SUCCESS     command ran, produced its result
 *   1  OPERATIONAL unexpected failure — exception, unreadable/unwritable
 *                  state, spawn failure
 *   2  NO_DATA     ran fine, but there is nothing to report yet: no scan
 *                  data, stale index, lock busy, nothing to diff. NOT an
 *                  error; the caller should scan/retry.
 *   3  NOT_FOUND   the named entity does not exist: unknown component,
 *                  unregistered project, missing lesson id, unknown model
 *   4  USAGE       the invocation itself was wrong: bad/missing arguments,
 *                  mutually exclusive flags, or a request this surface
 *                  cannot serve (the natural-language redirect)
 *
 * `0`, `1`, and `2` keep their pre-existing meanings across every command —
 * `2` in particular is already load-bearing in `scan`, `arch-diff`,
 * `remote`, and `misc`'s welcome-menu scan path, and callers may already
 * depend on it. `3` and `4` are additive.
 *
 * Always reference the named constant at the call site — a bare numeric
 * literal is how this drifts back into inconsistency. Prefer
 * `process.exitCode = EXIT_CODES.X; return;` over `process.exit(X)` so a
 * command can unwind normally and flush pending stdout before the process
 * exits; `process.exit()` is reserved for genuine hard aborts mid-stream
 * (e.g. a long-lived dashboard process reacting to SIGINT) where letting the
 * event loop drain is not an option.
 */

export const EXIT_CODES = {
  SUCCESS: 0,
  OPERATIONAL: 1,
  NO_DATA: 2,
  NOT_FOUND: 3,
  USAGE: 4,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
