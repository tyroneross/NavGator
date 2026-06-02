#!/usr/bin/env bash
# Non-blocking PostToolUse hook: record the edited file in NavGator's dirty
# ledger and kick a detached background drain. Returns immediately -- it never
# delays the edit. Coalescing + the single-writer lock live in the drainer.
set -euo pipefail

# Claude Code passes tool input as JSON on stdin; extract the file path.
INPUT="$(cat 2>/dev/null || true)"
FILE="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# Only act inside a project that has a NavGator graph.
if [ -z "$FILE" ] || [ ! -d ".navgator" ]; then
  exit 0
fi

# `mark-dirty --drain` appends to the ledger and self-spawns a detached drain.
if command -v navgator >/dev/null 2>&1; then
  navgator mark-dirty "$FILE" --drain >/dev/null 2>&1 || true
fi
exit 0
