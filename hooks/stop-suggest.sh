#!/usr/bin/env bash
# Stop hook — suggest a scan only if the architecture index is clearly stale
# relative to tracked source files. Silent otherwise.
#
# "Clearly stale" = index.json exists and is older than any file in common
# source dirs within the last 24h.
set -u

project="${CLAUDE_PROJECT_DIR:-$PWD}"
index="$project/.navgator/architecture/index.json"
[ -f "$index" ] || exit 0

# If anything under typical source dirs is newer than index.json, suggest refresh.
# find -newer is POSIX; errors silenced for dirs that don't exist.
newer=$(find \
  "$project/src" "$project/app" "$project/lib" "$project/core" \
  "$project/server" "$project/api" "$project/packages" \
  -type f -newer "$index" -not -path "*/node_modules/*" -not -path "*/.next/*" \
  -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.turbo/*" \
  -print -quit 2>/dev/null)

if [ -n "$newer" ]; then
  echo "Source files have changed since the last navgator scan — consider running the navgator \`scan\` MCP tool before ending the session."
fi

exit 0
