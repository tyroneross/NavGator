/**
 * NavGator Import Scanner
 * Fast regex-based file-level import graph builder.
 * Extracts import/require/export-from statements and resolves to actual file paths.
 */
import * as fs from 'fs';
import * as path from 'path';
import { generateComponentId, generateConnectionId, } from '../../types.js';
// Extensions to try when resolving bare imports (order matters)
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const INDEX_FILES = RESOLVE_EXTENSIONS.map(ext => `index${ext}`);
// Regex patterns — match relative imports AND path alias imports
const IMPORT_PATH = `(?:\\.\\.\\/[^'"]+|@\\/[^'"]+|~\\/[^'"]+)`;
const ES_IMPORT_RE = new RegExp(`(?:import\\s+(?:[\\s\\S]*?\\s+from\\s+)?['\"](${IMPORT_PATH})['\"])`, 'g');
const ES_REEXPORT_RE = new RegExp(`export\\s+(?:\\{[^}]*\\}|\\*)\\s+from\\s+['\"](${IMPORT_PATH})['\"]`, 'g');
const REQUIRE_RE = new RegExp(`require\\s*\\(\\s*['\"](${IMPORT_PATH})['\"]\\s*\\)`, 'g');
const DYNAMIC_IMPORT_RE = new RegExp(`import\\s*\\(\\s*['\"](${IMPORT_PATH})['\"]\\s*\\)`, 'g');
// Also match ./ imports (the original patterns)
const ES_IMPORT_REL_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"](\.\/[^'"]+)['"])/g;
const ES_REEXPORT_REL_RE = /export\s+(?:\{[^}]*\}|\*)\s+from\s+['"](\.\/[^'"]+)['"]/g;
const REQUIRE_REL_RE = /require\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_REL_RE = /import\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
// Bare specifier patterns — npm package imports (NOT relative, NOT alias).
// Captures anything not starting with ./ ../ @/ ~/ — includes @scope/name and bare names.
// Excludes node: protocol (built-ins) and data: / http: protocols.
const BARE_SPEC = `(?!\\.\\.?\\/|@\\/|~\\/|node:|data:|http:|https:|file:)([a-zA-Z0-9@][a-zA-Z0-9@_./-]*)`;
const ES_IMPORT_BARE_RE = new RegExp(`import\\s+(?:[\\s\\S]*?\\s+from\\s+)?['\"]${BARE_SPEC}['\"]`, 'g');
const ES_REEXPORT_BARE_RE = new RegExp(`export\\s+(?:\\{[^}]*\\}|\\*(?:\\s+as\\s+\\w+)?)\\s+from\\s+['\"]${BARE_SPEC}['\"]`, 'g');
const REQUIRE_BARE_RE = new RegExp(`require\\s*\\(\\s*['\"]${BARE_SPEC}['\"]\\s*\\)`, 'g');
const DYNAMIC_IMPORT_BARE_RE = new RegExp(`import\\s*\\(\\s*['\"]${BARE_SPEC}['\"]\\s*\\)`, 'g');
// Map .js/.jsx extensions to their TypeScript equivalents
// (TS convention: `import './foo.js'` resolves to `./foo.ts`)
const JS_TO_TS = [
    ['.js', '.ts'],
    ['.js', '.tsx'],
    ['.jsx', '.tsx'],
    ['.jsx', '.ts'],
];
/**
 * Resolve a relative import specifier to an actual file path.
 * Uses a known-files set for fast validation instead of fs.existsSync.
 */
function resolveImport(specifier, importerDir, projectRoot, knownFiles, pathAliases) {
    let resolvedSpecifier = specifier;
    // Resolve path aliases (@/, ~/, or tsconfig paths)
    if (pathAliases) {
        for (const [alias, target] of pathAliases) {
            if (specifier.startsWith(alias)) {
                resolvedSpecifier = specifier.replace(alias, target);
                break;
            }
        }
    }
    // For alias-resolved paths, resolve from project root
    const absTarget = resolvedSpecifier.startsWith('.')
        ? path.resolve(importerDir, resolvedSpecifier)
        : path.resolve(projectRoot, resolvedSpecifier);
    const relTarget = path.relative(projectRoot, absTarget);
    // Don't resolve outside project
    if (relTarget.startsWith('..'))
        return null;
    // Try exact path
    if (knownFiles.has(relTarget))
        return relTarget;
    // Try .js → .ts mapping (TS convention: import './foo.js' → ./foo.ts)
    for (const [jsExt, tsExt] of JS_TO_TS) {
        if (relTarget.endsWith(jsExt)) {
            const candidate = relTarget.slice(0, -jsExt.length) + tsExt;
            if (knownFiles.has(candidate))
                return candidate;
        }
    }
    // Try adding extensions
    for (const ext of RESOLVE_EXTENSIONS) {
        const candidate = relTarget + ext;
        if (knownFiles.has(candidate))
            return candidate;
    }
    // Try as directory with index file
    for (const indexFile of INDEX_FILES) {
        const candidate = path.join(relTarget, indexFile);
        if (knownFiles.has(candidate))
            return candidate;
    }
    return null;
}
/**
 * Load path aliases from tsconfig.json.
 * Handles: @/* → src/*, @/* → ./* (Next.js convention), ~/* → src/*
 */
function loadPathAliases(projectRoot) {
    const aliases = new Map();
    // Try tsconfig.json
    for (const configFile of ['tsconfig.json', 'jsconfig.json']) {
        const configPath = path.join(projectRoot, configFile);
        try {
            const raw = fs.readFileSync(configPath, 'utf-8');
            // Parse JSON — try as-is first (handles standard tsconfig),
            // fall back to stripping full-line comments only (not // inside strings)
            let config;
            try {
                config = JSON.parse(raw);
            }
            catch {
                const stripped = raw
                    .replace(/^\s*\/\/.*$/gm, '') // full-line comments only
                    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
                    .replace(/,\s*([}\]])/g, '$1'); // trailing commas
                config = JSON.parse(stripped);
            }
            const paths = config?.compilerOptions?.paths;
            const baseUrl = config?.compilerOptions?.baseUrl || '.';
            if (paths) {
                for (const [alias, targets] of Object.entries(paths)) {
                    if (!Array.isArray(targets) || targets.length === 0)
                        continue;
                    const target = targets[0];
                    // Convert: "@/*" → "@/", "./src/*" → "src/"
                    const aliasPrefix = alias.replace(/\*$/, '');
                    const targetPrefix = target.replace(/\*$/, '');
                    // Resolve relative to baseUrl
                    const resolvedTarget = path.join(baseUrl, targetPrefix).replace(/^\.\//, '');
                    aliases.set(aliasPrefix, resolvedTarget);
                }
            }
            break; // Use first config found
        }
        catch {
            // Config doesn't exist or can't be parsed
        }
    }
    // Fallback: if no aliases found, add common Next.js convention
    if (aliases.size === 0) {
        // Check if this looks like a Next.js project
        const nextConfigExists = fs.existsSync(path.join(projectRoot, 'next.config.js')) ||
            fs.existsSync(path.join(projectRoot, 'next.config.mjs')) ||
            fs.existsSync(path.join(projectRoot, 'next.config.ts'));
        if (nextConfigExists) {
            aliases.set('@/', './');
        }
    }
    return aliases;
}
/**
 * Extract import specifiers from file content.
 * Captures ./ ../ @/ ~/ imports — skips bare node_modules packages.
 */
function extractImports(content) {
    const specifiers = [];
    const patterns = [
        ES_IMPORT_RE, ES_REEXPORT_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE,
        ES_IMPORT_REL_RE, ES_REEXPORT_REL_RE, REQUIRE_REL_RE, DYNAMIC_IMPORT_REL_RE,
    ];
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            if (match[1])
                specifiers.push(match[1]);
        }
    }
    return [...new Set(specifiers)];
}
/**
 * Extract bare package specifiers from file content.
 * Returns raw specifiers before subpath stripping (e.g. "react/jsx-runtime").
 */
function extractBareImports(content) {
    const specifiers = [];
    const patterns = [
        ES_IMPORT_BARE_RE, ES_REEXPORT_BARE_RE, REQUIRE_BARE_RE, DYNAMIC_IMPORT_BARE_RE,
    ];
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            if (match[1])
                specifiers.push(match[1]);
        }
    }
    return [...new Set(specifiers)];
}
/**
 * Strip subpath from a bare specifier to get the package root.
 *   "react"                       → "react"
 *   "react/jsx-runtime"           → "react"
 *   "@radix-ui/react-dialog"      → "@radix-ui/react-dialog"
 *   "@radix-ui/react-dialog/Root" → "@radix-ui/react-dialog"
 */
function stripSubpath(specifier) {
    if (specifier.startsWith('@')) {
        // Scoped package: keep first two segments
        const parts = specifier.split('/');
        if (parts.length < 2)
            return specifier;
        return `${parts[0]}/${parts[1]}`;
    }
    // Unscoped: keep first segment
    const idx = specifier.indexOf('/');
    return idx === -1 ? specifier : specifier.slice(0, idx);
}
/**
 * Find the line number where a specifier appears in the content.
 */
function findImportLine(content, specifier) {
    const idx = content.indexOf(specifier);
    if (idx === -1)
        return 1;
    // Count newlines before the match
    let line = 1;
    for (let i = 0; i < idx; i++) {
        if (content[i] === '\n')
            line++;
    }
    return line;
}
function componentNameFromFile(file) {
    const normalized = file.replace(/\\/g, '/');
    const withoutExtension = normalized.replace(/\.[^.]+$/, '');
    const segments = withoutExtension.split('/').filter(Boolean);
    if (segments[0] === 'src' || segments[0] === 'app' || segments[0] === 'lib') {
        segments.shift();
    }
    if (segments[segments.length - 1] === 'index' && segments.length > 1) {
        segments.pop();
    }
    return segments.join('/') || path.basename(withoutExtension);
}
function inferLayerFromFile(file) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    if (/(^|\/)(ui|components|views|pages|frontend|web)(\/|$)/.test(normalized))
        return 'frontend';
    if (/(^|\/)(db|database|prisma|drizzle|migrations)(\/|$)/.test(normalized))
        return 'database';
    if (/(^|\/)(queue|queues|jobs|workers)(\/|$)/.test(normalized))
        return 'queue';
    if (/(^|\/)(infra|infrastructure|terraform|k8s|docker)(\/|$)/.test(normalized))
        return 'infra';
    return 'backend';
}
function buildFileComponent(file, timestamp) {
    const name = componentNameFromFile(file);
    return {
        component_id: generateComponentId('component', name),
        name,
        type: 'component',
        role: {
            purpose: `Internal module at ${file}`,
            layer: inferLayerFromFile(file),
            critical: false,
        },
        source: {
            detection_method: 'auto',
            config_files: [file],
            confidence: 0.95,
        },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: ['internal', 'module'],
        metadata: {
            file,
            kind: 'source-file',
        },
        timestamp,
        last_updated: timestamp,
    };
}
/**
 * Scan source files and build file-level import connections.
 * Accepts the already-discovered source file list from the main scanner
 * to avoid redundant glob and ensure consistent file coverage.
 *
 * When `knownPackages` is provided, bare imports (e.g. `import X from "react"`)
 * are emitted as `uses-package` edges from the source file component to the
 * matching npm package component. Bare specifiers with no matching known
 * package are skipped silently (no ghost nodes).
 */
export async function scanImports(projectRoot, sourceFiles, knownPackages) {
    const components = [];
    const connections = [];
    // Filter to TS/JS files only
    let files;
    if (sourceFiles) {
        files = sourceFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx') ||
            f.endsWith('.js') || f.endsWith('.jsx'));
        // Exclude .d.ts files
        files = files.filter(f => !f.endsWith('.d.ts'));
    }
    else {
        // Fallback: use glob (shouldn't happen in normal flow)
        const { glob } = await import('glob');
        files = await glob('**/*.{ts,tsx,js,jsx}', {
            cwd: projectRoot,
            ignore: [
                '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**',
                '**/.git/**', '**/*.d.ts', '**/coverage/**',
            ],
        });
    }
    // Load path aliases from tsconfig.json (Next.js @/ convention, etc.)
    const pathAliases = loadPathAliases(projectRoot);
    // Build a Set of known files for O(1) resolution lookups
    const knownFiles = new Set(files);
    const now = Date.now();
    const componentIdByFile = new Map();
    // Build a Map<packageName, component_id> for O(1) bare-import resolution.
    // Only populated when caller provided knownPackages; otherwise bare-import
    // edges are not emitted (backwards-compatible with callers that don't pass
    // the package list).
    const packageIdByName = new Map();
    if (knownPackages) {
        for (const pkg of knownPackages) {
            packageIdByName.set(pkg.name, pkg.component_id);
        }
    }
    for (const file of files) {
        const component = buildFileComponent(file, now);
        components.push(component);
        componentIdByFile.set(file, component.component_id);
    }
    // Read files in batches
    const batchSize = 100;
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (file) => {
            try {
                const content = await fs.promises.readFile(path.join(projectRoot, file), 'utf-8');
                return { file, content };
            }
            catch {
                return null;
            }
        }));
        for (const result of results) {
            if (!result)
                continue;
            const { file, content } = result;
            const importerDir = path.dirname(path.join(projectRoot, file));
            const specifiers = extractImports(content);
            for (const spec of specifiers) {
                const resolved = resolveImport(spec, importerDir, projectRoot, knownFiles, pathAliases);
                if (!resolved)
                    continue;
                const line = findImportLine(content, spec);
                connections.push({
                    connection_id: generateConnectionId('imports'),
                    from: {
                        component_id: componentIdByFile.get(file) || `FILE:${file}`,
                        location: { file, line },
                    },
                    to: {
                        component_id: componentIdByFile.get(resolved) || `FILE:${resolved}`,
                        location: { file: resolved, line: 1 },
                    },
                    connection_type: 'imports',
                    code_reference: {
                        file,
                        symbol: spec,
                        symbol_type: 'import',
                        line_start: line,
                    },
                    detected_from: 'import-scanner',
                    confidence: 1.0,
                    timestamp: now,
                    last_verified: now,
                });
            }
            // Bare-package edges: `import X from "react"` → file uses-package react.
            // Only emitted when the caller provided a knownPackages set; bare
            // specifiers that don't match a known package are skipped silently
            // (no ghost nodes).
            if (packageIdByName.size > 0) {
                const bareSpecs = extractBareImports(content);
                const emitted = new Set(); // dedupe per-file: one edge per package
                for (const rawSpec of bareSpecs) {
                    const pkgName = stripSubpath(rawSpec);
                    const targetId = packageIdByName.get(pkgName);
                    if (!targetId)
                        continue;
                    if (emitted.has(pkgName))
                        continue;
                    emitted.add(pkgName);
                    const line = findImportLine(content, rawSpec);
                    connections.push({
                        connection_id: generateConnectionId('uses-package'),
                        from: {
                            component_id: componentIdByFile.get(file) || `FILE:${file}`,
                            location: { file, line },
                        },
                        to: {
                            component_id: targetId,
                        },
                        connection_type: 'uses-package',
                        code_reference: {
                            file,
                            symbol: pkgName,
                            symbol_type: 'import',
                            line_start: line,
                        },
                        description: `${file} uses ${pkgName}`,
                        detected_from: 'import-scanner (bare)',
                        confidence: 1.0,
                        timestamp: now,
                        last_verified: now,
                    });
                }
            }
        }
    }
    // Second pass: detect fetch('/api/...') patterns — Next.js runtime data flow
    // Matches: fetch('/api/graph'), fetch(`/api/${path}`), fetchWithTimeout('/api/...')
    const FETCH_API_RE = /fetch\s*\(\s*['"`](\/api\/[^'"`\s?]+)/g;
    const FETCH_TEMPLATE_RE = /fetch\s*\(\s*`(\/api\/[^`]*)`/g;
    const FETCH_WRAPPER_RE = /(?:fetchWith\w+|apiFetch|fetchJSON|fetcher)\s*\(\s*['"`](\/api\/[^'"`\s?]+)/g;
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (file) => {
            try {
                const content = await fs.promises.readFile(path.join(projectRoot, file), 'utf-8');
                return { file, content };
            }
            catch {
                return null;
            }
        }));
        for (const result of results) {
            if (!result)
                continue;
            const { file, content } = result;
            // Only scan frontend files (pages, components, app/ routes)
            if (!file.includes('/app/') && !file.includes('/pages/') && !file.includes('/components/') && !file.includes('hooks/'))
                continue;
            // Run all fetch patterns
            const fetchPatterns = [FETCH_API_RE, FETCH_TEMPLATE_RE, FETCH_WRAPPER_RE];
            const foundApiPaths = new Set();
            for (const pattern of fetchPatterns) {
                pattern.lastIndex = 0;
                let fetchMatch;
                while ((fetchMatch = pattern.exec(content)) !== null) {
                    let apiPath = fetchMatch[1];
                    // For template literals, extract the static prefix: /api/graph/${id} → /api/graph
                    if (apiPath.includes('$')) {
                        apiPath = apiPath.split('$')[0].replace(/\/+$/, '');
                    }
                    if (apiPath.startsWith('/api/') && apiPath.length > 5) {
                        foundApiPaths.add(apiPath);
                    }
                }
            }
            for (const apiPath of foundApiPaths) {
                // Resolve to Next.js route file
                const routeFile = resolveApiRoute(apiPath, knownFiles);
                if (!routeFile)
                    continue;
                const line = findImportLine(content, `'${apiPath}'`) || findImportLine(content, `"${apiPath}"`) || findImportLine(content, apiPath);
                connections.push({
                    connection_id: generateConnectionId('frontend-calls-api'),
                    from: {
                        component_id: componentIdByFile.get(file) || `FILE:${file}`,
                        location: { file, line },
                    },
                    to: {
                        component_id: componentIdByFile.get(routeFile) || `FILE:${routeFile}`,
                        location: { file: routeFile, line: 1 },
                    },
                    connection_type: 'frontend-calls-api',
                    code_reference: {
                        file,
                        symbol: `fetch('${apiPath}')`,
                        symbol_type: 'function',
                        line_start: line,
                    },
                    description: `${file} fetches ${apiPath}`,
                    detected_from: 'import-scanner (fetch)',
                    confidence: 0.9,
                    timestamp: now,
                    last_verified: now,
                });
            }
        }
    }
    return {
        components,
        connections,
        warnings: [],
    };
}
/**
 * Resolve a Next.js API path to its route file.
 * /api/graph → app/api/graph/route.ts or pages/api/graph.ts
 */
function resolveApiRoute(apiPath, knownFiles) {
    // App Router: /api/graph → app/api/graph/route.ts
    const appRouterCandidates = [
        `app${apiPath}/route.ts`,
        `app${apiPath}/route.tsx`,
        `app${apiPath}/route.js`,
        `src/app${apiPath}/route.ts`,
        `src/app${apiPath}/route.tsx`,
    ];
    for (const candidate of appRouterCandidates) {
        if (knownFiles.has(candidate))
            return candidate;
    }
    // Pages Router: /api/graph → pages/api/graph.ts
    const pagesRouterCandidates = [
        `pages${apiPath}.ts`,
        `pages${apiPath}.tsx`,
        `pages${apiPath}.js`,
        `src/pages${apiPath}.ts`,
    ];
    for (const candidate of pagesRouterCandidates) {
        if (knownFiles.has(candidate))
            return candidate;
    }
    return null;
}
//# sourceMappingURL=import-scanner.js.map