#!/usr/bin/env bash
# SessionStart hook — suggest a scan only when navgator data is missing or stale.
# Silent otherwise (exits 0 with no stdout).
set -u

project="${CLAUDE_PROJECT_DIR:-$PWD}"
index="$project/.navgator/architecture/index.json"

# Not a navgator-tracked project yet — stay silent. A user who wants tracking
# runs `/navgator:scan` explicitly; auto-nagging on every SessionStart across
# every project is noise.
[ -f "$index" ] || exit 0

# Tracked project: check freshness. Suggest refresh only if >24h old.
if [ "$(find "$index" -mtime +1 -print 2>/dev/null)" ]; then
  echo "NavGator data is >24h old. Consider running the navgator \`scan\` MCP tool to refresh."
fi

exit 0
