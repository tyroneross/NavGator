/**
 * NavGator Architecture Diff Engine
 * Computes structured diffs between architecture snapshots and manages timeline
 */
import * as fs from 'fs';
import * as path from 'path';
import { getConfig, getTimelinePath, getSnapshotsPath, getHistoryLimit } from './config.js';
// =============================================================================
// DIFF COMPUTATION
// =============================================================================
/**
 * Match components by name|type (not by component_id which is non-deterministic)
 */
function componentKey(c) {
    return `${c.name}|${c.type}`;
}
/**
 * Match connections by from_name|to_name|type
 */
function connectionKey(c) {
    return `${c.from_name}|${c.to_name}|${c.type}`;
}
/**
 * Compute a structured diff between two snapshots.
 * Returns added/removed/modified components and added/removed connections.
 */
export function computeArchitectureDiff(previous, current) {
    const prevComponents = new Map();
    const currComponents = new Map();
    const prevConnections = new Map();
    const currConnections = new Map();
    if (previous) {
        for (const c of previous.components) {
            prevComponents.set(componentKey(c), c);
        }
        for (const c of previous.connections) {
            prevConnections.set(connectionKey(c), c);
        }
    }
    for (const c of current.components) {
        currComponents.set(componentKey(c), c);
    }
    for (const c of current.connections) {
        currConnections.set(connectionKey(c), c);
    }
    // Components: added, removed, modified
    const addedComponents = [];
    const removedComponents = [];
    const modifiedComponents = [];
    for (const [key, curr] of currComponents) {
        const prev = prevComponents.get(key);
        if (!prev) {
            addedComponents.push({
                name: curr.name,
                type: curr.type,
                layer: curr.layer,
                version: curr.version,
            });
        }
        else {
            const changes = [];
            if (prev.version !== curr.version && (prev.version || curr.version)) {
                changes.push(`version: ${prev.version || '—'} → ${curr.version || '—'}`);
            }
            if (prev.status !== curr.status) {
                changes.push(`status: ${prev.status} → ${curr.status}`);
            }
            if (prev.layer !== curr.layer) {
                changes.push(`layer: ${prev.layer} → ${curr.layer}`);
            }
            if (changes.length > 0) {
                modifiedComponents.push({
                    name: curr.name,
                    type: curr.type,
                    changes,
                });
            }
        }
    }
    for (const [key, prev] of prevComponents) {
        if (!currComponents.has(key)) {
            removedComponents.push({
                name: prev.name,
                type: prev.type,
                layer: prev.layer,
                version: prev.version,
            });
        }
    }
    // Connections: added, removed
    const addedConnections = [];
    const removedConnections = [];
    for (const [key, curr] of currConnections) {
        if (!prevConnections.has(key)) {
            addedConnections.push({
                from_name: curr.from_name,
                to_name: curr.to_name,
                type: curr.type,
                file: curr.file,
            });
        }
    }
    for (const [key, prev] of prevConnections) {
        if (!currConnections.has(key)) {
            removedConnections.push({
                from_name: prev.from_name,
                to_name: prev.to_name,
                type: prev.type,
                file: prev.file,
            });
        }
    }
    const totalChanges = addedComponents.length +
        removedComponents.length +
        modifiedComponents.length +
        addedConnections.length +
        removedConnections.length;
    return {
        components: {
            added: addedComponents,
            removed: removedComponents,
            modified: modifiedComponents,
        },
        connections: {
            added: addedConnections,
            removed: removedConnections,
        },
        stats: {
            total_changes: totalChanges,
            components_before: previous?.components.length ?? 0,
            components_after: current.components.length,
            connections_before: previous?.connections.length ?? 0,
            connections_after: current.connections.length,
        },
    };
}
// =============================================================================
// SIGNIFICANCE CLASSIFICATION
// =============================================================================
/**
 * Classify the significance of a diff.
 * Major: database/infra layer changes, >20% components changed, new layer introduced
 * Minor: new packages, connection changes, major semver bumps
 * Patch: everything else (version patches, status changes)
 */
export function classifySignificance(diff) {
    const triggers = [];
    // Check for database/infra layer changes
    const criticalLayers = new Set(['database', 'infra']);
    const hasCriticalLayerChange = diff.components.added.some((c) => criticalLayers.has(c.layer)) ||
        diff.components.removed.some((c) => criticalLayers.has(c.layer));
    if (hasCriticalLayerChange) {
        triggers.push('layer-change');
    }
    // Check for high churn (>20% components changed)
    const totalBefore = diff.stats.components_before || 1;
    const changedCount = diff.components.added.length +
        diff.components.removed.length +
        diff.components.modified.length;
    if (changedCount / totalBefore > 0.2) {
        triggers.push('high-churn');
    }
    // Check for new layers
    const addedLayers = new Set(diff.components.added.map((c) => c.layer));
    // A "new layer" means a layer was added that wasn't present before
    // We check if any added component is in a layer that no removed/modified component was in
    if (addedLayers.size > 0 && diff.stats.components_before > 0) {
        const existingLayers = new Set([
            ...diff.components.removed.map((c) => c.layer),
        ]);
        for (const layer of addedLayers) {
            if (!existingLayers.has(layer)) {
                triggers.push('new-layer');
                break;
            }
        }
    }
    // Check for new packages
    const packageTypes = new Set(['npm', 'pip', 'spm', 'cargo', 'go', 'gem', 'composer']);
    if (diff.components.added.some((c) => packageTypes.has(c.type))) {
        triggers.push('new-package');
    }
    // Check for connection changes
    if (diff.connections.added.length > 0 || diff.connections.removed.length > 0) {
        triggers.push('connection-change');
    }
    // Check for major semver bumps
    const hasMajorBump = diff.components.modified.some((m) => m.changes.some((ch) => {
        const match = ch.match(/^version: (\d+)\.\d+\.\d+ → (\d+)\.\d+\.\d+/);
        return match && match[1] !== match[2];
    }));
    if (hasMajorBump) {
        triggers.push('version-bump');
    }
    // If nothing else, it's metadata-only
    if (triggers.length === 0 && diff.stats.total_changes > 0) {
        triggers.push('metadata-only');
    }
    // Determine significance level
    let significance;
    const majorTriggers = ['layer-change', 'high-churn', 'new-layer'];
    const minorTriggers = ['new-package', 'connection-change', 'version-bump'];
    if (triggers.some((t) => majorTriggers.includes(t))) {
        significance = 'major';
    }
    else if (triggers.some((t) => minorTriggers.includes(t))) {
        significance = 'minor';
    }
    else {
        significance = 'patch';
    }
    return { significance, triggers };
}
// =============================================================================
// TIMELINE MANAGEMENT
// =============================================================================
/**
 * Load the timeline from disk
 */
export async function loadTimeline(config, projectRoot) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    const timelinePath = getTimelinePath(cfg, root);
    try {
        const content = await fs.promises.readFile(timelinePath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return {
            version: '1.0',
            project_path: root,
            entries: [],
        };
    }
}
/**
 * Append a timeline entry and prune to history limit
 */
export async function saveTimelineEntry(entry, config, projectRoot) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    const timelinePath = getTimelinePath(cfg, root);
    const timeline = await loadTimeline(cfg, root);
    timeline.entries.push(entry);
    // Prune to history limit
    const limit = getHistoryLimit();
    if (timeline.entries.length > limit) {
        timeline.entries = timeline.entries.slice(-limit);
    }
    timeline.project_path = root;
    await fs.promises.writeFile(timelinePath, JSON.stringify(timeline, null, 2), 'utf-8');
}
// =============================================================================
// SNAPSHOT HELPERS
// =============================================================================
/**
 * Load the most recent snapshot from the snapshots directory
 */
export async function loadLatestSnapshot(config, projectRoot) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    const snapshotsPath = getSnapshotsPath(cfg, root);
    try {
        const files = await fs.promises.readdir(snapshotsPath);
        const snapFiles = files
            .filter((f) => f.startsWith('SNAP_') && f.endsWith('.json'))
            .sort()
            .reverse();
        if (snapFiles.length === 0)
            return null;
        const content = await fs.promises.readFile(path.join(snapshotsPath, snapFiles[0]), 'utf-8');
        const raw = JSON.parse(content);
        // Handle v1 snapshots (no snapshot_version field)
        if (!raw.snapshot_version) {
            return upgradeV1Snapshot(raw);
        }
        return raw;
    }
    catch {
        return null;
    }
}
/**
 * Upgrade a v1 snapshot to v2 format (best-effort — missing layer/critical/names)
 */
function upgradeV1Snapshot(raw) {
    const components = (raw.components || []).map((c) => ({
        component_id: c.component_id,
        name: c.name,
        type: c.type,
        version: c.version,
        status: c.status || 'active',
        layer: 'external', // unknown — use external as fallback
        critical: false,
    }));
    const componentIdToName = new Map();
    for (const c of components) {
        componentIdToName.set(c.component_id, c.name);
    }
    const connections = (raw.connections || []).map((c) => ({
        connection_id: c.connection_id,
        from: c.from,
        to: c.to,
        type: c.type,
        from_name: componentIdToName.get(c.from) || '?',
        to_name: componentIdToName.get(c.to) || '?',
    }));
    return {
        snapshot_id: raw.snapshot_id,
        snapshot_version: '2.0',
        timestamp: raw.timestamp,
        reason: raw.reason,
        components,
        connections,
        stats: raw.stats,
    };
}
/**
 * Build a v2 snapshot from freshly-stored scan data (components + connections on disk)
 */
export async function buildCurrentSnapshot(config, projectRoot) {
    // Dynamic import to avoid circular dependency (storage imports types, diff imports storage)
    const { loadAllComponents, loadAllConnections } = await import('./storage.js');
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    const components = await loadAllComponents(cfg, root);
    const connections = await loadAllConnections(cfg, root);
    const componentIdToName = new Map();
    for (const c of components) {
        componentIdToName.set(c.component_id, c.name);
    }
    const timestamp = Date.now();
    const snapshotId = `SNAP_${new Date(timestamp).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
    return {
        snapshot_id: snapshotId,
        snapshot_version: '2.0',
        timestamp,
        reason: 'post-scan',
        components: components.map((c) => ({
            component_id: c.component_id,
            name: c.name,
            type: c.type,
            version: c.version,
            status: c.status,
            layer: c.role.layer,
            critical: c.role.critical,
        })),
        connections: connections.map((c) => ({
            connection_id: c.connection_id,
            from: c.from.component_id,
            to: c.to.component_id,
            type: c.connection_type,
            from_name: componentIdToName.get(c.from.component_id) || '?',
            to_name: componentIdToName.get(c.to.component_id) || '?',
            file: c.code_reference?.file,
        })),
        stats: {
            total_components: components.length,
            total_connections: connections.length,
        },
    };
}
// =============================================================================
// CLI FORMATTERS
// =============================================================================
/**
 * Generate a timeline entry ID
 */
export function generateTimelineId() {
    const now = new Date();
    return `TL_${now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
}
/**
 * Format timeline for CLI display
 */
export function formatTimeline(timeline, options) {
    let entries = [...timeline.entries].reverse(); // newest first
    if (options?.significance) {
        entries = entries.filter((e) => e.significance === options.significance);
    }
    if (options?.limit) {
        entries = entries.slice(0, options.limit);
    }
    if (options?.json) {
        return JSON.stringify(entries, null, 2);
    }
    if (entries.length === 0) {
        return 'No timeline entries found. Run `navgator scan` to start tracking changes.';
    }
    const lines = [];
    lines.push('Architecture Timeline');
    lines.push('─'.repeat(60));
    for (const entry of entries) {
        const date = new Date(entry.timestamp).toLocaleString();
        const sig = significanceBadge(entry.significance);
        const changes = entry.diff.stats.total_changes;
        const gitTag = entry.git ? ` [${entry.git.branch}@${entry.git.commit}]` : '';
        lines.push('');
        lines.push(`${sig}  ${date}  [${entry.id}]${gitTag}`);
        lines.push(`   ${changes} change${changes !== 1 ? 's' : ''}: ` +
            `+${entry.diff.components.added.length} components, ` +
            `-${entry.diff.components.removed.length} components, ` +
            `~${entry.diff.components.modified.length} modified, ` +
            `+${entry.diff.connections.added.length}/-${entry.diff.connections.removed.length} connections`);
        if (entry.triggers.length > 0) {
            lines.push(`   triggers: ${entry.triggers.join(', ')}`);
        }
    }
    return lines.join('\n');
}
/**
 * Format a single diff entry for detailed CLI display
 */
export function formatDiffSummary(entry, json) {
    if (json) {
        return JSON.stringify(entry, null, 2);
    }
    const lines = [];
    const date = new Date(entry.timestamp).toLocaleString();
    const sig = significanceBadge(entry.significance);
    lines.push(`${sig}  ${date}  [${entry.id}]`);
    if (entry.git) {
        lines.push(`Branch: ${entry.git.branch} @ ${entry.git.commit}`);
    }
    lines.push(`Triggers: ${entry.triggers.join(', ') || 'none'}`);
    lines.push(`Components: ${entry.diff.stats.components_before} → ${entry.diff.stats.components_after}`);
    lines.push(`Connections: ${entry.diff.stats.connections_before} → ${entry.diff.stats.connections_after}`);
    lines.push('');
    // Added components
    if (entry.diff.components.added.length > 0) {
        lines.push('Added Components:');
        for (const c of entry.diff.components.added) {
            const ver = c.version ? ` v${c.version}` : '';
            lines.push(`  + ${c.name}${ver} (${c.type}, ${c.layer})`);
        }
        lines.push('');
    }
    // Removed components
    if (entry.diff.components.removed.length > 0) {
        lines.push('Removed Components:');
        for (const c of entry.diff.components.removed) {
            lines.push(`  - ${c.name} (${c.type}, ${c.layer})`);
        }
        lines.push('');
    }
    // Modified components
    if (entry.diff.components.modified.length > 0) {
        lines.push('Modified Components:');
        for (const m of entry.diff.components.modified) {
            lines.push(`  ~ ${m.name} (${m.type})`);
            for (const ch of m.changes) {
                lines.push(`      ${ch}`);
            }
        }
        lines.push('');
    }
    // Added connections
    if (entry.diff.connections.added.length > 0) {
        lines.push('Added Connections:');
        for (const c of entry.diff.connections.added) {
            const file = c.file ? ` (${c.file})` : '';
            lines.push(`  + ${c.from_name} → ${c.to_name} [${c.type}]${file}`);
        }
        lines.push('');
    }
    // Removed connections
    if (entry.diff.connections.removed.length > 0) {
        lines.push('Removed Connections:');
        for (const c of entry.diff.connections.removed) {
            const file = c.file ? ` (${c.file})` : '';
            lines.push(`  - ${c.from_name} → ${c.to_name} [${c.type}]${file}`);
        }
        lines.push('');
    }
    if (entry.diff.stats.total_changes === 0) {
        lines.push('No changes detected.');
    }
    return lines.join('\n');
}
/**
 * Format a diff result as markdown for NAVSUMMARY.md
 */
export function formatDiffForSummary(entry) {
    const lines = [];
    const sig = entry.significance.toUpperCase();
    lines.push('## Changes Since Last Scan');
    lines.push(`> Significance: **${sig}** | Triggers: ${entry.triggers.join(', ') || 'none'}`);
    lines.push('');
    if (entry.diff.components.added.length > 0) {
        for (const c of entry.diff.components.added) {
            lines.push(`- Added: \`${c.name}\` (${c.layer})`);
        }
    }
    if (entry.diff.components.removed.length > 0) {
        for (const c of entry.diff.components.removed) {
            lines.push(`- Removed: \`${c.name}\` (${c.layer})`);
        }
    }
    if (entry.diff.components.modified.length > 0) {
        for (const m of entry.diff.components.modified) {
            lines.push(`- Modified: \`${m.name}\` — ${m.changes.join(', ')}`);
        }
    }
    if (entry.diff.connections.added.length > 0) {
        for (const c of entry.diff.connections.added) {
            lines.push(`- New connection: ${c.from_name} → ${c.to_name} (${c.type})`);
        }
    }
    if (entry.diff.connections.removed.length > 0) {
        for (const c of entry.diff.connections.removed) {
            lines.push(`- Removed connection: ${c.from_name} → ${c.to_name} (${c.type})`);
        }
    }
    if (entry.diff.stats.total_changes === 0) {
        lines.push('No changes detected.');
    }
    lines.push('');
    return lines;
}
function significanceBadge(sig) {
    switch (sig) {
        case 'major': return '[MAJOR]';
        case 'minor': return '[MINOR]';
        case 'patch': return '[PATCH]';
    }
}
//# sourceMappingURL=diff.js.map