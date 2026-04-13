#!/usr/bin/env bash
# PostToolUse (Write|Edit) — suggest a scan only after touching architecture-critical files.
# (The original "3+ files modified" heuristic would need persistent state across
# hook invocations and produced noise anyway. Pattern-matching on the edited
# path alone is silent by default and still catches the cases that matter.)
set -u

project="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -f "$project/.navgator/architecture/index.json" ] || exit 0

path=$(python3 -c '
import sys, json
try:
  print(json.loads(sys.stdin.read()).get("tool_input", {}).get("file_path", ""))
except Exception:
  pass
' 2>/dev/null)

[ -z "$path" ] && exit 0

case "$path" in
  *schema.prisma|*/migrations/*|*/drizzle/*|\
  */api/*/route.ts|*/api/*/route.js|*/app/api/*|*/pages/api/*|\
  *Package.swift|*.pbxproj|*Podfile|*.entitlements|*Info.plist)
    echo "Architecture-critical file changed — consider running the navgator \`scan\` MCP tool to keep tracking fresh."
    ;;
  *) exit 0 ;;
esac
exit 0
