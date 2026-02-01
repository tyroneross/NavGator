#!/usr/bin/env bash
# NavGator: Load architecture context on session start

# Read stdin (hook input JSON) but we don't need it for SessionStart
cat > /dev/null

SUMMARY_PATH="${CLAUDE_PROJECT_DIR}/.claude/architecture/SUMMARY.md"
INDEX_PATH="${CLAUDE_PROJECT_DIR}/.claude/architecture/index.json"

if [ ! -f "$SUMMARY_PATH" ]; then
  # No architecture data — exit silently
  exit 0
fi

# Check staleness from index.json
STALENESS="FRESH"
if [ -f "$INDEX_PATH" ]; then
  LAST_SCAN=$(python3 -c "import json; print(json.load(open('$INDEX_PATH')).get('last_scan', 0))" 2>/dev/null || echo "0")
  NOW=$(python3 -c "import time; print(int(time.time() * 1000))" 2>/dev/null || echo "0")
  if [ "$LAST_SCAN" != "0" ] && [ "$NOW" != "0" ]; then
    DIFF=$(( (NOW - LAST_SCAN) / 3600000 ))
    if [ "$DIFF" -gt 24 ]; then
      STALENESS="STALE"
    fi
  fi
fi

if [ "$STALENESS" = "STALE" ]; then
  echo "NavGator: Architecture context available but stale (>24h). Read .claude/architecture/SUMMARY.md for context. Consider running /navgator:scan to refresh." >&2
else
  echo "NavGator: Architecture context available. Read .claude/architecture/SUMMARY.md for project architecture overview (components, connections, AI/LLM routing, file paths)." >&2
fi

exit 0
