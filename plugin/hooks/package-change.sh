#!/usr/bin/env bash
# NavGator: Detect package manager changes and warn about stale architecture

# Read tool input from stdin
INPUT=$(cat)

# Extract the command from the tool input JSON
COMMAND=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_input', {}).get('command', ''))
except:
    print('')
" 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Check if the command matches package manager install/add/remove patterns
if echo "$COMMAND" | grep -qE '(npm (install|i|add|remove|uninstall)|yarn (add|remove)|pnpm (add|remove|install)|bun (add|remove|install)|pip install|pip3 install|pip uninstall|cargo (add|remove)|gem install|composer (require|remove))'; then
  echo "NavGator: Dependencies changed. Architecture data may be stale. Run /navgator:scan to update component tracking." >&2
fi

exit 0
