# Living Architecture

NavGator's living architecture subsystem keeps the architecture graph honest
while agents edit the codebase. Slice 1 adds a dirty-set ledger, background
drainer, and freshness stamp. It does not guarantee every read is fully current;
it makes every read explicit about whether changes are still waiting to be
drained.

## Slice 1 Pipeline

1. An edit hook records changed files in `.navgator/dirty.json`.
2. The dirty ledger stores a deduped, sorted set of paths changed since the last
   clean drain.
3. A background drainer takes `.navgator/scan.lock`, reads the dirty set, runs
   NavGator's existing `scan()`, clears only the drained paths, and releases the
   lock.
4. The drainer writes `.navgator/architecture/freshness.json` with the scan
   timestamp, git branch, commit sha, outstanding dirty files, dirty count, and
   whether a scan is in flight.

The lock is a single-writer guard with PID and heartbeat stale detection. If a
drainer crashes, a later drainer can steal the lock after the heartbeat expires
or when the owner PID is gone.

## Triggers

- Hook: `hooks/mark-dirty.sh` runs after `Write` and `Edit`. It records the file
  and asks the CLI to spawn a detached drain, then exits immediately.
- Session start: agents can call `navgator drain` at the start of a session to
  refresh the graph before architecture reads.
- Orchestrator: build or review flows can call `navgator drain` before relying on
  graph data, then read `navgator freshness` to decide how trustworthy the view
  is.

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

## Slice Roadmap

- Slice 2, not yet built: `context <target>` command for targeted, freshness-aware
  architecture context.
- Slice 3, not yet built: canonical-main plus worktree-delta storage, so agents
  can separate committed architecture from local changes.
- Slice 4, not yet built: pre-merge architecture diff for reviewing topology
  changes before integration.
