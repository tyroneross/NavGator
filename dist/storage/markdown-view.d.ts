/**
 * Markdown view layer (T3, trimmed).
 *
 * Derives a human-readable markdown projection of each component into
 * `<storage>/components-md/<type>/<slug>.md`. JSON files remain the
 * canonical source of truth — these markdown files are pure derivatives,
 * regenerated on every scan.
 *
 * Why this exists:
 *   - Obsidian/Foam render YAML frontmatter + [[wikilinks]] natively
 *   - Git diffs of markdown components are far more readable than JSON
 *   - ripgrep targets for fuzzy search (`navgator find`) become trivial
 *
 * Why NOT a full migration to markdown-as-source:
 *   - storage.ts is 1500+ lines with 50+ consumers reading JSON
 *   - Schema-evolvable JSON is well understood; full markdown migration
 *     belongs in a dedicated session with a subagent owning storage.ts
 *   - Trimmed scope: deliver the visible value (readable, diffable,
 *     greppable) without the storage rewrite risk
 */
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
/**
 * Write markdown views for every component into `<storage>/components-md/<type>/<slug>.md`.
 * Wipes the directory first so renames/removals are reflected. Idempotent.
 *
 * Returns the absolute paths written.
 */
export declare function writeComponentMarkdownViews(storeDir: string, components: ArchitectureComponent[], connections: ArchitectureConnection[]): Promise<string[]>;
/**
 * Write `<storage>/connections.jsonl` — one JSON record per line.
 * Schema-evolvable, streamable, diffable. Replaces the per-connection JSON
 * files for downstream consumers willing to upgrade; the originals stay
 * untouched for backward compatibility.
 */
export declare function writeConnectionsJsonl(storeDir: string, components: ArchitectureComponent[], connections: ArchitectureConnection[]): Promise<string>;
//# sourceMappingURL=markdown-view.d.ts.map