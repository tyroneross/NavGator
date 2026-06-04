#!/usr/bin/env bash
# Stop hook — suggest a scan only if the architecture index is clearly stale
# relative to tracked source files. Silent otherwise.
#
# "Clearly stale" = index.json exists and is older than any file in common
# source dirs within the last 24h.
set -u

emit_empty() {
  printf '{}\n'
}

emit_context() {
  python3 - "$1" <<'PY' || emit_empty
import json
import sys

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "Stop",
        "additionalContext": sys.argv[1],
    }
}))
PY
}

project="${CLAUDE_PROJECT_DIR:-$PWD}"
index="$project/.navgator/architecture/index.json"
[ -f "$index" ] || {
  emit_empty
  exit 0
}

# If anything under typical source dirs is newer than index.json, suggest refresh.
# find -newer is POSIX; errors silenced for dirs that don't exist.
newer=$(find \
  "$project/src" "$project/app" "$project/lib" "$project/core" \
  "$project/server" "$project/api" "$project/packages" \
  -type f -newer "$index" -not -path "*/node_modules/*" -not -path "*/.next/*" \
  -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.turbo/*" \
  -print -quit 2>/dev/null)

if [ -n "$newer" ]; then
  emit_context "Source files have changed since the last navgator scan — consider running the navgator \`scan\` MCP tool before ending the session."
else
  emit_empty
fi

exit 0
