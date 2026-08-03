/**
 * Optional one-way mirror: gator-memory (`~/.navgator/memory/`) -> a
 * build-loop-memory tree, if and only if the user has one and opted in.
 *
 * Why this exists: a NavGator user's gator-memory store
 * (`src/memory/store.ts`) is fully self-contained under `~/.navgator/`. Some
 * users -- currently: this repo's owner -- ALSO keep a separate
 * `build-loop-memory` checkout, a durable cross-project knowledge store with
 * its own `projects/<slug>/<lane>/` convention. This module exports the
 * per-project gator-memory record into that tree so the two stores line up,
 * for the humans and agents who already read build-loop-memory and have
 * never heard of gator-memory.
 *
 * THIS IS THE OWNER'S MACHINE-SPECIFIC SETUP, NOT A GENERAL FEATURE. For
 * everyone else the target simply does not exist on disk, and that is the
 * NORMAL case, not an error: default off (`memory.mirror.enabled` in
 * `src/home-config.ts`), detected-never-assumed (`targetExists` is always a
 * live `fs.existsSync` check, never cached or inferred from config), and
 * silent when absent. A user who has never heard of build-loop-memory must
 * never see a warning, a log line, or a created directory from this module.
 *
 * Fail-open by construction, mirroring `src/memory/store.ts`'s posture
 * exactly: every exported function RETURNS rather than throws, including
 * when the feature is off, the target is missing, the record does not exist,
 * or the destination is unwritable. `mirrorProjectMemory` returning `false`
 * is the expected outcome in all of those cases, not a failure signal the
 * caller needs to handle specially.
 *
 * GUEST DISCIPLINE: build-loop's own tooling owns `snapshot.json`,
 * `graph.json`, `file_map.json`, `connections.jsonl`, and any `INDEX.jsonl`
 * inside the target (`scripts/architecture_snapshot.py` writes `snapshot.json`
 * with `provenance: "navgator"`, for instance). This module writes exactly two
 * files per project -- `navgator-memory.json` and `navgator-memory.md` under
 * `<target>/projects/<slug>/architecture/` -- and touches nothing else in the
 * target tree, ever. It is a guest in someone else's store.
 *
 * NEVER CREATE THE TARGET ROOT. The target's absence is the only signal this
 * module has that the user has no build-loop-memory tree; fabricating it here
 * would destroy that signal and make every future call believe the feature is
 * live when it never was opted into by having the tree in the first place.
 * `mirrorProjectMemory` checks `fs.existsSync(targetRoot)` and returns `false`
 * without any `mkdir` when it is absent -- see the early-return below.
 */
export interface MirrorStatus {
    /** Config says mirroring is on. */
    enabled: boolean;
    /** Resolved absolute path, `null` when not configured (empty target string). */
    target: string | null;
    /** Detected on disk, NEVER assumed -- see module header. */
    targetExists: boolean;
    /** mtime of the most recently written mirror file under the target, or `null`. */
    lastMirroredAt: number | null;
    /** Count of project directories under `<target>/projects/` carrying a mirror record. */
    projectsMirrored: number;
}
/**
 * Report the mirror's configured and detected state. Never throws; a status
 * probe that could crash a caller would be worse than no status at all.
 */
export declare function mirrorStatus(): MirrorStatus;
/**
 * Mirror one project's gator-memory record into the configured
 * build-loop-memory target. Returns `false` -- never throws -- when the
 * feature is off, the target is unconfigured or absent, the project has no
 * gator-memory record, or the write fails for any reason (permissions,
 * disk full, etc). `false` is the expected, silent outcome for the large
 * majority of NavGator installs; it is not an error signal.
 *
 * Called on significant events only (wiring lands in a separate chunk --
 * `src/projects.ts` and `src/scanner.ts` are owned elsewhere right now).
 */
export declare function mirrorProjectMemory(projectPath: string): Promise<boolean>;
/**
 * Mirror every known gator-memory project record. The on-demand path for a
 * later `doctor --mirror` flag; NOT wired to any automatic trigger by this
 * chunk. Sequential rather than concurrent -- the target tree is a single
 * shared destination, and there is no reader here that needs the speed of
 * parallel writes badly enough to risk racing on it.
 */
export declare function mirrorAll(): Promise<{
    mirrored: number;
    skipped: number;
}>;
//# sourceMappingURL=mirror.d.ts.map