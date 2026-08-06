/**
 * Tier-0 input loader.
 *
 * Everything deep-map reasons about comes from artifacts the scanner already
 * wrote. This module is the single place that reads them, so the scoring and
 * partitioning code stays pure functions over in-memory data and can be tested
 * without touching disk.
 *
 * A missing artifact is not an error here: `metrics.json` is absent on small
 * graphs by design, and `file_map.json` may lag a partial scan. Callers get
 * nulls and empty maps and decide what that means.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getConfig, getStoragePath } from '../config.js';
import { loadAllComponents, loadAllConnections } from '../storage.js';
import { checkRules, getBuiltinRules, loadCustomRules } from '../rules.js';
import { listProjects } from '../projects.js';
import { normalizeFileMap } from './escalate.js';
function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
export async function loadTier0(config, projectRoot) {
    const cfg = config || getConfig();
    const archPath = getStoragePath(cfg, projectRoot);
    const components = await loadAllComponents(cfg, projectRoot);
    const connections = await loadAllConnections(cfg, projectRoot);
    const metrics = readJsonSafe(path.join(archPath, 'metrics.json'));
    const fileMap = normalizeFileMap(readJsonSafe(path.join(archPath, 'file_map.json')));
    // Rule violations feed the escalation `violations` signal. Custom rules are
    // included so a project's own architectural constraints can escalate a
    // component, not just the builtins.
    // A project's own architectural constraints should be able to escalate a
    // component, so custom rules run alongside the builtins.
    const violations = components.length > 0
        ? checkRules(components, connections, [
            ...getBuiltinRules(projectRoot),
            ...loadCustomRules(projectRoot),
        ])
        : [];
    return {
        components,
        connections,
        metrics,
        fileMap,
        violations,
        empty: components.length === 0,
    };
}
/**
 * Invert `file_map.json` into component_id -> file paths, sorted so packet
 * contents stay byte-stable across runs.
 */
export function buildComponentFileIndex(fileMap) {
    const index = new Map();
    for (const [filePath, componentId] of Object.entries(fileMap)) {
        const list = index.get(componentId);
        if (list)
            list.push(filePath);
        else
            index.set(componentId, [filePath]);
    }
    for (const list of index.values())
        list.sort();
    return index;
}
/** `fs.realpathSync`, falling back to `path.resolve` when the path doesn't exist (or isn't readable). */
function safeRealOrResolve(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return path.resolve(p);
    }
}
/**
 * Where the scanned project came from. A repo fetched by `scan-remote` was
 * authored by someone else, so its component names and file paths are untrusted
 * strings that will be embedded in packet prompts — the packet builder carries a
 * warning when this says so.
 *
 * Fails closed, not open: any error reading the registry returns `origin:
 * 'unknown', untrusted: true` rather than silently reporting `local`. A
 * registry read failure is exactly the kind of ambiguity the untrusted-source
 * warning exists to surface, not suppress.
 */
export async function resolveProvenance(projectPath) {
    const resolvedProjectPath = safeRealOrResolve(projectPath);
    try {
        const entries = await listProjects();
        const match = entries.find((p) => p.path && safeRealOrResolve(p.path) === resolvedProjectPath);
        if (match?.origin?.kind === 'remote') {
            return {
                project_path: projectPath,
                origin: 'remote',
                ...(match.origin.url ? { origin_url: match.origin.url } : {}),
                untrusted: true,
            };
        }
    }
    catch {
        return { project_path: projectPath, origin: 'unknown', untrusted: true };
    }
    return { project_path: projectPath, origin: 'local', untrusted: false };
}
//# sourceMappingURL=load.js.map