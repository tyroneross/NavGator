# Build Goal — NavGator 0.9.1

Produce and commit a release-ready patch that closes the audited correctness and dual-host packaging gaps without changing the public storage schema or enabling automatic hooks.

Done means:

1. Default incremental output is semantically equal to a subsequent full scan after removals.
2. One writer lease and a typed busy result protect every scan entrypoint.
3. Directed rules, nested aliases, coverage math, and bounded rule-aware agent output pass regression tests.
4. A built npm tarball contains every intended Claude/Codex surface, excludes compiled tests, initializes all 10 MCP tools, and launches the packaged dashboard.
5. Claude validation and isolated Codex marketplace/MCP checks pass against the packed artifact.
6. The full test, build, typecheck, and release-verifier gates pass after the final mutation.
