---
name: scan
description: Quick architecture scan — refresh component and connection tracking
arguments:
  - name: options
    description: "Optional: --quick (packages only), --prompts (AI prompts), --field-usage (DB fields), --typespec (type validation), --verbose"
    required: false
---

Run an architecture scan to refresh NavGator's tracking data.

**Options:** $ARGUMENTS

## What to do

1. Run the navgator `scan` MCP tool with the specified options
2. Report what changed since the last scan (new components, removed connections, etc.)
3. If significant changes detected, suggest running `/navgator:review` to check architectural integrity

**Default behavior:** Full scan with connection detection. Faster than `/navgator:map` — no status display or analysis, just the scan itself.
