/**
 * Where execution starts.
 *
 * Reachability is only as good as the set of roots it starts from, and the
 * original root set was written for an application: node types `api-endpoint` /
 * `worker` / `cron` / `xcode-target`, Apple names (`AppDelegate`, `ContentView`,
 * `SceneDelegate`), and a fallback that treats every `infra` or `external`
 * component as a root. A TypeScript CLI or library has none of those. Measured
 * on NavGator's own graph before this module existed: 12 roots, every one of
 * them from the `infra`/`external` fallback, with a combined out-degree of 17.
 * External package nodes are graph *sinks* — edges point at them, never out of
 * them — so the traversal reached 16 of 521 components and `transitively-dead`
 * reported 425 of 451 project components, about 94%. That is not a finding, it
 * is the rule failing to find the front door.
 *
 * So this module asks the package what its entry points are instead of guessing
 * from names. The npm manifest already declares them (`bin`, `main`, `module`,
 * `exports`, `browser`), the scripts block names every file the project's own
 * tooling runs, and the framework conventions the scanner already resolves
 * (Next.js `app/` and `pages/` routes) are entry points by definition. Tests and
 * config files are roots for the same structural reason: nothing imports them.
 *
 * **The bias is deliberate and one-directional.** A missed entry point poisons
 * an entire subtree — every transitive dependency of the real front door is
 * reported dead, which is exactly the failure above. A spurious entry point
 * costs at most one missed dead component. So when a signal is ambiguous this
 * module admits it as a root.
 *
 * Detection is pure with respect to the graph, except for reading `package.json`
 * files under the project root. No network, no child processes.
 */
import type { ArchitectureComponent } from './types.js';
/** Why a component was treated as a root. Reported so a root is auditable. */
export type EntryPointSource = 'component-type' | 'name-pattern' | 'tag' | 'infra-layer' | 'package-entry' | 'package-script' | 'package-file' | 'framework-route' | 'test-file' | 'tooling-config' | 'executable-dir';
export interface EntryPointResult {
    /** component_id of every root. */
    ids: Set<string>;
    /** component_id -> the source that admitted it. First match wins. */
    reasons: Map<string, EntryPointSource>;
    /** How many roots each source contributed. */
    counts: Partial<Record<EntryPointSource, number>>;
    /** package.json files actually read. */
    manifests: string[];
    /** Declared paths pulled out of those manifests, before resolution. */
    declared: string[];
}
export interface EntryPointOptions {
    /**
     * Root to resolve manifests against. Defaults to `process.cwd()`, matching
     * `loadCustomRules`. Manifest reading is skipped when the directory does not
     * exist, so a synthetic graph simply gets the graph-only sources.
     */
    projectRoot?: string;
    /** Skip filesystem access entirely (graph-derived roots only). */
    skipManifests?: boolean;
}
/** Every file path a component claims, normalised to project-relative POSIX form. */
export declare function entryCandidatePaths(component: ArchitectureComponent, projectRoot?: string): string[];
/**
 * Classify a path against the convention table. Exported so the conventions are
 * testable without constructing a component graph.
 */
export declare function classifyPathConvention(filePath: string): EntryPointSource | null;
interface DeclaredPath {
    target: string;
    source: EntryPointSource;
}
/**
 * Pull declared entry paths out of one parsed package.json. `dir` is the
 * manifest's directory relative to the project root, so a workspace manifest
 * yields project-relative targets.
 */
export declare function declaredEntryPaths(manifest: unknown, dir?: string): DeclaredPath[];
/**
 * Every path a declared target might be authored at. A manifest points at build
 * output (`dist/cli/index.js`); the graph holds source (`src/cli/index.ts`).
 */
export declare function resolveDeclaredTarget(target: string): string[];
/**
 * Resolve the root set for a component graph. Declared manifest entries are
 * matched first so their (more specific) reason survives on shared components.
 */
export declare function detectEntryPoints(components: ArchitectureComponent[], options?: EntryPointOptions): EntryPointResult;
export {};
//# sourceMappingURL=entry-points.d.ts.map