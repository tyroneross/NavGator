---
name: dead
description: Find dead code — orphaned components with no connections, unused packages, unused database models
arguments: []
---

Detect dead code and unused components in this project.

## What to do

1. Run `navgator dead` CLI command to list orphaned components
2. Group findings by type: unused packages, unused DB models, unused queues, unused infra
3. For significant findings (unused infra like Heroku/Render, unused queues), investigate if they should be removed
4. Suggest cleanup actions for clearly dead components

**What counts as dead:**
- Components detected by NavGator but with zero incoming AND zero outgoing connections
- Only meaningful types are checked (packages, queues, services, infra, database models)
- Internal code files are NOT flagged (too many to be useful)
