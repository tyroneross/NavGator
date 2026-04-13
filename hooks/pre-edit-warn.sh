#!/usr/bin/env bash
# PreToolUse (Edit|Write) — warn only when editing an architecture-critical file.
# Silent otherwise.
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
  *schema.prisma|*/migrations/*|*/drizzle/*|*/prisma/*|\
  */api/*/route.ts|*/api/*/route.js|*/app/api/*|*/pages/api/*|\
  */workers/*|*/queues/*|*/jobs/*|\
  *Package.swift|*.pbxproj|*Podfile|*.entitlements|*Info.plist)
    echo "Architecture-critical file. Consider running the navgator \`explore\` MCP tool first to check downstream impact."
    ;;
  *) exit 0 ;;
esac
exit 0
