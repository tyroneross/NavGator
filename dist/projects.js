/**
 * NavGator Project Registry
 * Manages ~/.navgator/projects.json with enhanced per-project context
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteJSON } from './storage.js';
// =============================================================================
// REGISTRY I/O
// =============================================================================
function getRegistryDir() {
    return path.join(os.homedir(), '.navgator');
}
function getRegistryPath() {
    return path.join(getRegistryDir(), 'projects.json');
}
/**
 * Load the project registry with v1→v2 auto-migration
 */
export async function loadRegistry() {
    const registryPath = getRegistryPath();
    try {
        const content = await fs.promises.readFile(registryPath, 'utf-8');
        const raw = JSON.parse(content);
        // v1→v2 migration: add missing fields
        if (raw.version === 1) {
            raw.version = 2;
            for (const p of raw.projects) {
                if (p.scanCount === undefined)
                    p.scanCount = p.lastScan ? 1 : 0;
            }
        }
        return raw;
    }
    catch {
        return { version: 2, projects: [] };
    }
}
/**
 * Save the project registry.
 *
 * Uses `atomicWriteJSON` (write-to-temp + rename) so a reader never observes
 * a partially-written file. This does NOT by itself prevent the
 * read-modify-write race between concurrent callers within this process —
 * see `withRegistryLock` below, which serializes the load-mutate-save body
 * of `registerProject`/`updateProjectMeta` so writers never clobber each
 * other's in-memory mutations.
 */
export async function saveRegistry(registry) {
    await atomicWriteJSON(getRegistryPath(), registry);
}
// =============================================================================
// CONCURRENCY
// =============================================================================
/**
 * In-process mutex for registry read-modify-write sections.
 *
 * `scanPortfolio` runs N concurrent workers in a single process
 * (src/portfolio/scan.ts), each of which calls `registerProject` via
 * `scan()`. Without serialization, two workers finishing close together
 * both `loadRegistry()` the same pre-image, mutate their own in-memory copy,
 * and `saveRegistry()` — the last writer wins and the other worker's
 * registration is silently lost (measured: 6 workers registered only 2 of 6
 * entries at concurrency 4). Chaining every load-mutate-save body onto a
 * single promise queue makes them run one at a time, so each sees the
 * previous writer's result.
 *
 * This is an in-process mutex ONLY. It does nothing for cross-process
 * contention (two separate `navgator` invocations writing projects.json at
 * the same time) — that is a separate, pre-existing concern, out of scope
 * here.
 */
let registryLock = Promise.resolve();
function withRegistryLock(fn) {
    const result = registryLock.then(fn, fn);
    // Swallow rejections in the chain itself so one failed writer doesn't
    // permanently wedge the queue for everyone after it; the real result
    // (including its rejection) is still returned to this call's caller.
    registryLock = result.catch(() => undefined);
    return result;
}
// =============================================================================
// REGISTRATION
// =============================================================================
/**
 * Register or update a project after scan.
 * Replaces the inline registry code previously in cli/index.ts.
 */
export async function registerProject(projectRoot, stats, significance, gitInfo) {
    await withRegistryLock(async () => {
        try {
            const registry = await loadRegistry();
            const existing = registry.projects.find((p) => p.path === projectRoot);
            if (existing) {
                existing.lastScan = Date.now();
                existing.scanCount = (existing.scanCount || 0) + 1;
                if (stats)
                    existing.stats = stats;
                if (significance && significance !== 'patch') {
                    existing.lastSignificantChange = Date.now();
                    existing.lastSignificance = significance;
                }
                if (gitInfo) {
                    existing.git = { branch: gitInfo.branch, commit: gitInfo.commit };
                }
            }
            else {
                const dirName = projectRoot.split(path.sep).pop() || 'project';
                const name = dirName
                    .replace(/[-_]/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())
                    .trim();
                registry.projects.push({
                    path: projectRoot,
                    name,
                    addedAt: Date.now(),
                    lastScan: Date.now(),
                    scanCount: 1,
                    stats,
                    lastSignificantChange: significance && significance !== 'patch' ? Date.now() : undefined,
                    lastSignificance: significance && significance !== 'patch' ? significance : undefined,
                    git: gitInfo ? { branch: gitInfo.branch, commit: gitInfo.commit } : undefined,
                });
            }
            // Intentionally NOT wrapped in a try/catch that also swallows this:
            // a save failure must not be reported as a silent success. The outer
            // catch below still keeps registerProject itself non-fatal to the
            // scan, but it no longer pretends the write succeeded when it didn't.
            await saveRegistry(registry);
        }
        catch (err) {
            // Non-critical to the caller's scan — but surface it so it isn't
            // completely invisible (was a bare `catch {}` before this fix).
            console.error(`navgator: failed to register project ${projectRoot} in ~/.navgator/projects.json: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
/**
 * Read-modify-write a project's metadata, preserving every field the caller
 * doesn't name in `patch`. Used by the remote-scan chunk (C7) to record a
 * remote origin without disturbing scan stats, git info, or portfolio data
 * a sibling writer already set.
 *
 * Serialized through `withRegistryLock` for the same reason as
 * `registerProject` — see that function's comment.
 */
export async function updateProjectMeta(root, patch) {
    await withRegistryLock(async () => {
        const registry = await loadRegistry();
        const existing = registry.projects.find((p) => p.path === root);
        if (existing) {
            Object.assign(existing, patch);
        }
        else {
            const dirName = root.split(path.sep).pop() || 'project';
            const name = dirName
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase())
                .trim();
            registry.projects.push({
                path: root,
                name,
                addedAt: Date.now(),
                lastScan: null,
                scanCount: 0,
                ...patch,
            });
        }
        await saveRegistry(registry);
    });
}
// =============================================================================
// LISTING
// =============================================================================
/**
 * List all registered projects
 */
export async function listProjects() {
    const registry = await loadRegistry();
    return registry.projects;
}
/**
 * Format the project list for CLI display
 */
export function formatProjectsList(projects, json) {
    if (json) {
        return JSON.stringify(projects, null, 2);
    }
    if (projects.length === 0) {
        return 'No projects registered yet. Run `navgator scan` in a project to register it.';
    }
    const lines = [];
    lines.push('Registered Projects');
    lines.push('─'.repeat(60));
    for (const p of projects) {
        const lastScan = p.lastScan
            ? timeSince(p.lastScan)
            : 'never';
        const stale = p.lastScan && (Date.now() - p.lastScan) > 24 * 60 * 60 * 1000;
        const staleIndicator = stale ? ' (stale)' : '';
        lines.push('');
        lines.push(`  ${p.name}${staleIndicator}`);
        lines.push(`  ${p.path}`);
        lines.push(`  Scans: ${p.scanCount || 0} | Last: ${lastScan}`);
        if (p.stats) {
            lines.push(`  Components: ${p.stats.components} | Connections: ${p.stats.connections} | Prompts: ${p.stats.prompts}`);
        }
        if (p.git) {
            lines.push(`  Branch: ${p.git.branch} @ ${p.git.commit}`);
        }
        if (p.origin) {
            const detail = p.origin.kind === 'remote' && p.origin.url ? ` (${p.origin.url})` : '';
            lines.push(`  Origin: ${p.origin.kind}${detail}`);
        }
        if (p.portfolio) {
            lines.push(`  Portfolio: ${p.portfolio.root}`);
        }
        if (p.lastSignificance && p.lastSignificantChange) {
            lines.push(`  Last significant change: ${p.lastSignificance.toUpperCase()} (${timeSince(p.lastSignificantChange)})`);
        }
    }
    return lines.join('\n');
}
function timeSince(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60)
        return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
//# sourceMappingURL=projects.js.map