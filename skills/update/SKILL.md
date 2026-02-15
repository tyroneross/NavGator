---
description: Update NavGator to the latest version from npm
user-invocable: true
allowed-tools: Bash
---

# /gator:update

Update NavGator to the latest version.

## Instructions

1. Check current version:
   ```bash
   npx @tyroneross/navgator --version
   ```

2. Check latest version on npm:
   ```bash
   npm view @tyroneross/navgator version
   ```

3. Compare versions. If already up to date, tell the user.

4. If update available, install:
   ```bash
   npm install -g @tyroneross/navgator@latest
   ```

5. Verify installation:
   ```bash
   npx @tyroneross/navgator --version
   ```

6. Report: "Updated NavGator from X.X.X to Y.Y.Y"
