/**
 * `navgator arch-diff [--base <ref>] [--record] [--json] [--agent]` —
 * pre-merge architecture diff (Living Architecture slice 4).
 *
 * Shows how the current branch's architecture differs from the canonical
 * (default-branch) baseline — or a named `--base` ref — BEFORE merging, so a
 * reviewer sees topology drift up front rather than discovering it after the
 * merge lands. Read-only unless `--record` is passed.
 *
 * Registration is C8's (docs/plans/2026-08-03-portfolio-remote-gitaware.md):
 * this module only exports `registerArchDiffCommand`.
 */
import { Command } from 'commander';
export declare function registerArchDiffCommand(program: Command): void;
//# sourceMappingURL=arch-diff.d.ts.map