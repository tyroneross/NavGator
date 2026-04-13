#!/usr/bin/env bash
# PostToolUse (Bash) — suggest a scan only after dep/migration/Xcode commands.
# Silent otherwise.
set -u

project="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -f "$project/.navgator/architecture/index.json" ] || exit 0

cmd=$(python3 -c '
import sys, json
try:
  print(json.loads(sys.stdin.read()).get("tool_input", {}).get("command", ""))
except Exception:
  pass
' 2>/dev/null)

[ -z "$cmd" ] && exit 0

case "$cmd" in
  *"npm install"*|*"npm i "*|*"npm uninstall"*|*"npm remove"*|\
  *"yarn add"*|*"yarn remove"*|*"pnpm add"*|*"pnpm remove"*|\
  *"pip install"*|*"pip uninstall"*|*"uv add"*|*"uv remove"*|*"uv pip install"*|\
  *"cargo add"*|*"cargo remove"*|*"go get"*|*"go mod tidy"*|\
  *"prisma migrate"*|*"drizzle-kit push"*|*"drizzle push"*|*"alembic upgrade"*|*"alembic downgrade"*|\
  *"swift package update"*|*"swift package resolve"*|*"pod install"*|*"pod update"*|*"xcodebuild"*)
    echo "Dependency/migration/build change detected — consider running the navgator \`scan\` MCP tool to refresh architecture tracking."
    ;;
  *) exit 0 ;;
esac
exit 0
