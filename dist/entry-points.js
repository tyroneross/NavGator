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
import * as fs from 'fs';
import * as path from 'path';
/** Component types that are entry points by their own definition. */
const ENTRY_POINT_TYPES = new Set([
    'api-endpoint',
    'worker',
    'cron',
    'xcode-target',
]);
/** Names that mean "application launch point" on Apple and Android platforms. */
const ENTRY_POINT_NAME_PATTERN = /App$|AppDelegate|@main|ContentView|SceneDelegate|(?:^|[/\\.:#\s_-])Main(?:$|[/\\.:#\s_-])/i;
const ENTRY_POINT_TAGS = new Set([
    'entrypoint',
    'route',
    'navigation-root',
]);
/**
 * Path shapes that are roots without anything importing them. Ordered: the
 * first match wins, so the more specific patterns come first.
 */
const PATH_CONVENTIONS = [
    // Test runners discover these; no source file imports them.
    ['test-file', /(^|\/)__tests__\//],
    ['test-file', /(^|\/)tests?\//],
    ['test-file', /\.(test|spec)\.[cm]?[jt]sx?$/],
    // Next.js app router: the framework routes to these files by convention.
    [
        'framework-route',
        /(^|\/)app\/(.*\/)?(page|layout|route|template|default|error|global-error|not-found|loading)\.[cm]?[jt]sx?$/,
    ],
    // Next.js pages router: every file under `pages/` is addressable.
    ['framework-route', /(^|\/)pages\/.*\.[cm]?[jt]sx?$/],
    // Next.js loads these by fixed name.
    ['framework-route', /(^|\/)(middleware|instrumentation)\.[cm]?[jt]s$/],
    // Loaded by a tool (vitest, next, tailwind, postcss, eslint), not imported.
    ['tooling-config', /(^|\/)[\w.-]*\.config\.[cm]?[jt]sx?$/],
    // Run directly by a human, a hook host, or CI.
    ['executable-dir', /(^|\/)(scripts|bin|tools|hooks)\//],
];
/** Extensions a declared `.js` path may actually be authored in. */
const SOURCE_EXTENSIONS = [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.jsx',
    '.js',
    '.mjs',
    '.cjs',
];
/** Compiled-output directories a declared path may point into. */
const OUTPUT_DIR_PATTERN = /^(dist|build|lib|out)\//;
const NESTED_OUTPUT_DIR_PATTERN = /^(.*?\/)(dist|build|lib|out)\/(.*)$/;
/** A token inside an npm script that looks like a path to a code file. */
const SCRIPT_PATH_TOKEN = /^[A-Za-z0-9_.@][A-Za-z0-9_.@/-]*\.[cm]?[jt]sx?$/;
/** Cap on manifests read, so a repo full of packages cannot turn this into a walk. */
const MAX_MANIFESTS = 32;
/** Nesting cap on the `exports` condition map. */
const EXPORTS_MAX_DEPTH = 8;
/** Every file path a component claims, normalised to project-relative POSIX form. */
export function entryCandidatePaths(component, projectRoot) {
    const raw = [...(component.source?.config_files ?? [])];
    const metaFile = component.metadata?.['file'];
    if (typeof metaFile === 'string')
        raw.push(metaFile);
    return raw.map((p) => normalizePath(p, projectRoot));
}
function normalizePath(filePath, projectRoot) {
    let out = filePath.replace(/\\/g, '/');
    if (projectRoot) {
        const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
        if (root && out.startsWith(`${root}/`))
            out = out.slice(root.length + 1);
    }
    return out.replace(/^\.\//, '').replace(/^\/+/, '');
}
/**
 * Classify a path against the convention table. Exported so the conventions are
 * testable without constructing a component graph.
 */
export function classifyPathConvention(filePath) {
    for (const [source, pattern] of PATH_CONVENTIONS) {
        if (pattern.test(filePath))
            return source;
    }
    return null;
}
/**
 * Pull declared entry paths out of one parsed package.json. `dir` is the
 * manifest's directory relative to the project root, so a workspace manifest
 * yields project-relative targets.
 */
export function declaredEntryPaths(manifest, dir = '') {
    if (!manifest || typeof manifest !== 'object')
        return [];
    const pkg = manifest;
    const out = [];
    const add = (value, source) => {
        if (typeof value !== 'string' || value.length === 0)
            return;
        if (value.includes('*'))
            return;
        const rel = value.replace(/^\.\//, '');
        if (rel.startsWith('/') || rel.split('/').includes('..'))
            return;
        out.push({ target: dir ? `${dir}/${rel}` : rel, source });
    };
    // The published API surface.
    add(pkg['main'], 'package-entry');
    add(pkg['module'], 'package-entry');
    add(pkg['browser'], 'package-entry');
    if (typeof pkg['bin'] === 'string')
        add(pkg['bin'], 'package-entry');
    else if (pkg['bin'] && typeof pkg['bin'] === 'object') {
        for (const value of Object.values(pkg['bin'])) {
            add(value, 'package-entry');
        }
    }
    // Depth-capped: `exports` is arbitrary nested JSON from a file this code did
    // not write, and an unbounded walk over it is a stack-overflow surface for no
    // benefit — real condition maps are two or three levels deep.
    const walkExports = (node, depth) => {
        if (depth > EXPORTS_MAX_DEPTH)
            return;
        if (typeof node === 'string')
            add(node, 'package-entry');
        else if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                // `types` points at a .d.ts; it declares no runtime entry.
                if (key === 'types')
                    continue;
                walkExports(value, depth + 1);
            }
        }
    };
    walkExports(pkg['exports'], 0);
    // Every file the project's own tooling runs. `npm run mcp` -> `node
    // dist/mcp/server.js` is the only declaration that `src/mcp/server.ts` is an
    // entry point at all; nothing imports it.
    if (pkg['scripts'] && typeof pkg['scripts'] === 'object') {
        for (const command of Object.values(pkg['scripts'])) {
            if (typeof command !== 'string')
                continue;
            for (const token of command.split(/[\s'"`;=(),]+/)) {
                if (SCRIPT_PATH_TOKEN.test(token))
                    add(token, 'package-script');
            }
        }
    }
    // Explicitly named files in the publish allowlist. A file listed there that
    // nothing imports still ships, so it is part of the package surface —
    // `web/server.cjs` is spawned as a child process, an edge no import graph
    // carries. Directory entries are skipped: they would admit whole trees.
    if (Array.isArray(pkg['files'])) {
        for (const entry of pkg['files']) {
            if (typeof entry !== 'string')
                continue;
            if (!/\.[A-Za-z0-9]+$/.test(entry))
                continue;
            add(entry, 'package-file');
        }
    }
    return out;
}
/**
 * Every path a declared target might be authored at. A manifest points at build
 * output (`dist/cli/index.js`); the graph holds source (`src/cli/index.ts`).
 */
export function resolveDeclaredTarget(target) {
    const bases = new Set([target]);
    bases.add(target.replace(OUTPUT_DIR_PATTERN, ''));
    bases.add(`src/${target.replace(OUTPUT_DIR_PATTERN, '')}`);
    const nested = target.match(NESTED_OUTPUT_DIR_PATTERN);
    if (nested) {
        bases.add(`${nested[1]}${nested[3]}`);
        bases.add(`${nested[1]}src/${nested[3]}`);
    }
    const out = new Set(bases);
    for (const base of bases) {
        const stem = base.replace(/\.[cm]?[jt]sx?$/, '');
        for (const ext of SOURCE_EXTENSIONS) {
            out.add(`${stem}${ext}`);
            out.add(`${stem}/index${ext}`);
        }
    }
    return [...out];
}
/**
 * Directories holding a package.json worth reading: the project root plus each
 * distinct `metadata.origin_root` the multi-stack scan recorded. Anything that
 * escapes the project root is dropped rather than followed.
 */
function manifestDirs(components, projectRoot) {
    const dirs = new Set(['']);
    for (const component of components) {
        const origin = component.metadata?.['origin_root'];
        if (typeof origin !== 'string' || origin.length === 0)
            continue;
        const rel = normalizePath(origin, projectRoot);
        if (rel.startsWith('/') || rel.split('/').includes('..'))
            continue;
        dirs.add(rel);
        if (dirs.size >= MAX_MANIFESTS)
            break;
    }
    return [...dirs];
}
function readManifest(projectRoot, dir) {
    const manifestPath = path.resolve(projectRoot, dir, 'package.json');
    const rootResolved = path.resolve(projectRoot);
    if (manifestPath !== rootResolved && !manifestPath.startsWith(`${rootResolved}${path.sep}`)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }
    catch {
        return null;
    }
}
/**
 * Resolve the root set for a component graph. Declared manifest entries are
 * matched first so their (more specific) reason survives on shared components.
 */
export function detectEntryPoints(components, options = {}) {
    const projectRoot = options.projectRoot ?? process.cwd();
    const reasons = new Map();
    const declared = [];
    const manifests = [];
    const idsByPath = new Map();
    for (const component of components) {
        for (const filePath of entryCandidatePaths(component, projectRoot)) {
            const list = idsByPath.get(filePath);
            if (list)
                list.push(component.component_id);
            else
                idsByPath.set(filePath, [component.component_id]);
        }
    }
    if (!options.skipManifests) {
        for (const dir of manifestDirs(components, projectRoot)) {
            const manifest = readManifest(projectRoot, dir);
            if (!manifest)
                continue;
            manifests.push(dir ? `${dir}/package.json` : 'package.json');
            for (const { target, source } of declaredEntryPaths(manifest, dir)) {
                declared.push(target);
                for (const candidate of resolveDeclaredTarget(target)) {
                    for (const id of idsByPath.get(candidate) ?? []) {
                        if (!reasons.has(id))
                            reasons.set(id, source);
                    }
                }
            }
        }
    }
    for (const component of components) {
        if (reasons.has(component.component_id))
            continue;
        if (ENTRY_POINT_TYPES.has(component.type)) {
            reasons.set(component.component_id, 'component-type');
            continue;
        }
        if (ENTRY_POINT_NAME_PATTERN.test(component.name)) {
            reasons.set(component.component_id, 'name-pattern');
            continue;
        }
        if (component.tags?.some((tag) => ENTRY_POINT_TAGS.has(tag))) {
            reasons.set(component.component_id, 'tag');
            continue;
        }
        let matched = null;
        for (const filePath of entryCandidatePaths(component, projectRoot)) {
            matched = classifyPathConvention(filePath);
            if (matched)
                break;
        }
        if (matched) {
            reasons.set(component.component_id, matched);
            continue;
        }
        // Kept from the original rule: infra and external nodes are not code this
        // project is asked to keep alive. They are sinks, so admitting them costs
        // almost nothing, but removing them would newly flag whatever they touch.
        if (component.role.layer === 'infra' || component.role.layer === 'external') {
            reasons.set(component.component_id, 'infra-layer');
        }
    }
    const counts = {};
    for (const source of reasons.values()) {
        counts[source] = (counts[source] ?? 0) + 1;
    }
    return { ids: new Set(reasons.keys()), reasons, counts, manifests, declared };
}
//# sourceMappingURL=entry-points.js.map