# Living Architecture

NavGator's living architecture subsystem keeps the architecture graph honest
while agents edit the codebase. Slice 1 adds a dirty-set ledger, background
drainer, and freshness stamp. It does not guarantee every read is fully current;
it makes every read explicit about whether changes are still waiting to be
drained.

## Current pipeline

1. `navgator mark-dirty <paths...>` writes one immutable event under
   `.navgator/dirty.d/`. `dirty.json` is retained only as a migration surface
   for older installs.
2. A drain captures the exact event filenames and normalized paths that existed
   at its start, then asks the scanner to run in `auto` mode. Configuration and
   manifest changes can therefore promote the work to a full scan.
3. The scanner acquires the one canonical `.navgator/scan.lock` lease. Every
   scan entrypoint uses this same owner-tokened lease, including incremental to
   full promotion.
4. Before releasing the lease, the scanner reconciles only the captured event
   files and writes `.navgator/architecture/freshness.json`. Events created
   during the scan—including another edit to the same source path—remain for
   the next drain.
5. Freshness reads overlay the durable event ledger on the persisted stamp, so
   a failed advisory stamp refresh cannot report a dirty workspace as clean.

The single-writer lease records a PID, random owner token, heartbeat, and a
best-effort process-start fingerprint. A successor can reclaim it when the PID
is gone or the fingerprint proves PID reuse. Heartbeat age is diagnostic only:
a valid live PID is not fenced merely because it is suspended or slow. Release
removes only the current owner's lease.

## Triggers

- Explicit CLI: `navgator mark-dirty <paths...> --drain` records work and starts
  a detached trailing-edge drain. `navgator drain --until-clean` can also be run
  directly.
- Architecture reads: the MCP `status` path can auto-refresh a stale graph; it
  uses the same ledger snapshot and scanner-owned lease.
- Orchestration: build or review flows can run `navgator drain`, then inspect
  `navgator freshness` before relying on graph data.
- Hooks: `hooks/hooks.json` is intentionally empty. NavGator does not install a
  Write/Edit hook or change host trust automatically.

## Honesty Stamp

`navgator freshness` prints the current stamp. If no persisted stamp exists, it
computes a transient stamp from git state and the dirty ledger.

The stamp fields are:

- `generated_at`: epoch milliseconds when the last clean drain completed.
- `commit_sha`: short git commit that the graph was generated against.
- `branch`: git branch for the graph.
- `dirty_files`: paths changed since the last clean drain.
- `dirty_count`: count of outstanding dirty files.
- `scan_in_flight`: true while a drain is running.

Consumers should treat `dirty_count: 0` and `scan_in_flight: false` as the clean
read state. Non-zero dirty files or an in-flight scan means the graph may lag
behind the working tree.

The lease and individual architecture-file writes are atomic, but the complete
multi-file architecture generation is not yet transactional. An interrupted
generation can still require a later full refresh.

## Slice Roadmap

- Slice 2, not yet built: `context <target>` command for targeted, freshness-aware
  architecture context.
- Slice 3, built: canonical-main plus branch-delta snapshot storage, so agents
  can separate committed architecture from local changes. Storage is strictly
  additive to the layout above: `.navgator/architecture/canonical/snapshot.json`
  holds the default branch's snapshot, and `.navgator/architecture/branches/<slug>/snapshot.json`
  holds one per non-default ref (`<slug>` sanitizes the ref name and appends an
  8-character hash of the original whenever sanitization or truncation changed
  the string, so two refs that sanitize alike cannot collide). The existing
  working-view files (`components.full.jsonl`, `graph.json`, etc.) are
  untouched — this is a second, parallel view, not a replacement.
- Slice 4, built: pre-merge architecture diff (`navgator arch-diff`) for
  reviewing topology changes before integration. It reads the canonical (or a
  named `--base` ref's) snapshot and the current branch's snapshot, then
  delegates to the existing diff engine (`computeArchitectureDiff()` /
  `classifySignificance()`) — no second diff implementation. A missing
  snapshot on either side returns `available: false` with an actionable
  reason, never an empty diff that would read as "no changes."

**Snapshots are written on demand, not maintained by `scan()`.** `navgator
arch-diff --record` (or the MCP `arch_diff` tool with `record: true`) is what
writes `canonical/` and `branches/<slug>/` snapshots — a plain `scan()` call
never touches them. Treat them as an explicit, human- or agent-triggered
checkpoint rather than a byproduct of every scan.
