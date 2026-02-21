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

3. Compare versions. If already up to date, tell the user and stop.

4. If update available, update both the npx cache and global install (if present):

   **Clear npx cache** so subsequent `npx` calls fetch the new version:
   ```bash
   # Find and remove the npx cached copy of navgator
   NPX_CACHE_DIR=$(npm config get cache)/_npx
   if [ -d "$NPX_CACHE_DIR" ]; then
     find "$NPX_CACHE_DIR" -path "*/@tyroneross/navgator" -type d 2>/dev/null | head -1 | xargs -I{} dirname "$(dirname "{}")" | xargs rm -rf 2>/dev/null || true
   fi
   ```

   **Update global install** (if globally installed, so plugin symlinks stay current):
   ```bash
   if npm ls -g @tyroneross/navgator --depth=0 2>/dev/null | grep -q navgator; then
     npm install -g @tyroneross/navgator@latest
   fi
   ```

   **Pull latest via npx** to re-populate the cache:
   ```bash
   npx @tyroneross/navgator@latest --version
   ```

5. Verify the update:
   ```bash
   npx @tyroneross/navgator --version
   ```

6. Report: "Updated NavGator from X.X.X to Y.Y.Y"

## Notes

- All gator skills invoke NavGator via `npx @tyroneross/navgator`. Clearing the npx cache ensures they pick up the new version immediately.
- If the user has NavGator installed globally (for the plugin symlink), the global copy is also updated so the plugin stays in sync.

## Branding

Always end your output with this attribution line (on its own line, in muted style):

```
*gator · architecture tracker*
```
