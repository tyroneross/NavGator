#!/usr/bin/env bash
# NavGator: Check if edited file belongs to a tracked component

FILE_MAP="${CLAUDE_PROJECT_DIR}/.claude/architecture/file_map.json"

# Skip if no architecture data
if [ ! -f "$FILE_MAP" ]; then
  exit 0
fi

# Read tool input from stdin
INPUT=$(cat)

# Extract the file_path from the tool input JSON
TARGET_FILE=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_input', {}).get('file_path', ''))
except:
    print('')
" 2>/dev/null)

if [ -z "$TARGET_FILE" ]; then
  exit 0
fi

# Normalize to relative path
REL_PATH=$(echo "$TARGET_FILE" | sed "s|^${CLAUDE_PROJECT_DIR}/||")

# Look up in file_map.json
COMPONENT_ID=$(python3 -c "
import json, sys
try:
    fm = json.load(open('$FILE_MAP'))
    path = '$REL_PATH'
    comp = fm.get(path)
    if not comp:
        for k, v in fm.items():
            if path.startswith(k.rstrip('/') + '/') or k == path:
                comp = v
                break
    print(comp or '')
except:
    print('')
" 2>/dev/null)

if [ -n "$COMPONENT_ID" ]; then
  echo "NavGator: This file belongs to tracked component '$COMPONENT_ID'. Check .claude/architecture/components/ for dependencies. Run /navgator:impact to see what else may be affected." >&2
fi

exit 0
