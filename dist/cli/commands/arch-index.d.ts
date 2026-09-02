/**
 * `navgator arch-index [--write] [--check] [--json] [--agent]` — generate the
 * committed, version-controlled architecture index.
 *
 * Unlike every other NavGator command, this one does NOT read
 * `.navgator/architecture/`. That store is a per-clone cache: gitignored,
 * timestamped, machine-specific. This command scans the tree directly so it
 * produces the same bytes on a developer laptop and on a clean CI checkout,
 * which is what makes `--check` a usable merge gate.
 *
 * Outputs (both committed):
 *   ARCHITECTURE.md              — answer-first entry point for a cold agent
 *   docs/architecture/index.json — machine-readable, per-file blast radius
 *
 * Exit codes follow src/cli/exit-codes.ts. `--check` exits NO_DATA (2) when
 * the committed copy is stale, which is a "regenerate and commit" signal, not
 * an internal error.
 */
import { Command } from 'commander';
export declare function registerArchIndexCommand(program: Command): void;
//# sourceMappingURL=arch-index.d.ts.map