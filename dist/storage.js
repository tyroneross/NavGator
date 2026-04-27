/**
 * NavGator Storage System
 * File-based persistence for components and connections
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { generateStableId, } from './types.js';
/**
 * Pick the most stable path-like identifier from a component.
 * Prefer the first config_file (e.g. "prisma/schema.prisma" for Prisma models),
 * else fall back to a documentation/repository URL component.
 * Returns undefined if nothing path-like is available.
 *
 * RENAME BEHAVIOR (Run 1.6 — item #6):
 * For path-disambiguated types (api-endpoint, db-table, prompt, worker,
 * component, cron) the resulting stable_id includes the canonical path. This
 * prevents collisions when two components share a name in different files
 * (e.g. `src/utils/index.ts` vs `src/lib/index.ts` — both named `index` for
 * the `component` type). The tradeoff: when a file is RENAMED or MOVED its
 * stable_id changes, so the merge step treats the renamed file as a brand-new
 * component and the old stable_id falls out of the surviving set.
 *
 * Correctness is preserved by the integrity check (`runIntegrityCheck`):
 * after merge, missing connection endpoints or orphan components trigger
 * `scan_type='incremental→full'` (full rebuild). Renames thus stay correct
 * but pay the full-scan cost. Not optimal, but keeping path in stable_id is
 * the simpler and safer default.
 */
function pickCanonicalPath(c) {
    if (c.source?.config_files?.length) {
        return c.source.config_files[0];
    }
    return undefined;
}
/**
 * Backfill stable_id on a component if missing.
 * Idempotent — returns the same component reference (mutated in place).
 * Path-disambiguation is opt-in per-type: types where (type,name) is
 * naturally unique (npm/pip packages, frameworks, services, llm providers,
 * databases, infra, queues, configs) use name-only. Types that can repeat
 * the same name across different files (api-endpoint, db-table, prompt,
 * worker, component, cron) include canonical_path.
 */
/**
 * Public re-export of ensureStableId. Callers (e.g. the scanner during
 * incremental merge) need to populate stable_ids on freshly-scanned
 * in-memory components BEFORE merging with disk-loaded survivors.
 */
export function ensureStableIdPublic(c) {
    return ensureStableId(c);
}
function ensureStableId(c) {
    if (c.stable_id)
        return c;
    const PATH_DISAMBIGUATED = new Set([
        'api-endpoint',
        'db-table',
        'prompt',
        'worker',
        'component',
        'cron',
    ]);
    const canonical = PATH_DISAMBIGUATED.has(c.type) ? pickCanonicalPath(c) : undefined;
    c.stable_id = generateStableId(c.type, c.name, canonical);
    return c;
}
import { getConfig, getComponentsPath, getConnectionsPath, getIndexPath, getGraphPath, getSnapshotsPath, getHashesPath, getStoragePath, getSummaryPath, getSummaryFullPath, getFileMapPath, getPromptsPath, ensureStorageDirectories, isValidComponentId, isValidConnectionId, SCHEMA_VERSION, } from './config.js';
import { detectImportCycles, detectLayerViolations, getTopFanOut, getTopHotspots, } from './architecture-insights.js';
// =============================================================================
// COMPONENT STORAGE
// =============================================================================
/**
 * Store a component to disk
 */
export async function storeComponent(component, config, projectRoot) {
    const cfg = config || getConfig();
    ensureStorageDirectories(cfg, projectRoot);
    const componentsPath = getComponentsPath(cfg, projectRoot);
    ensureStableId(component);
    const filePath = path.join(componentsPath, `${component.component_id}.json`);
    await atomicWriteJSON(filePath, component);
    return {
        component_id: component.component_id,
        file_path: filePath,
    };
}
/**
 * Load a component by ID
 */
export async function loadComponent(componentId, config, projectRoot) {
    if (!isValidComponentId(componentId)) {
        return null;
    }
    const cfg = config || getConfig();
    const componentsPath = getComponentsPath(cfg, projectRoot);
    const filePath = path.join(componentsPath, `${componentId}.json`);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return ensureStableId(JSON.parse(content));
    }
    catch {
        return null;
    }
}
/**
 * Load all components (parallelized for efficiency)
 */
export async function loadAllComponents(config, projectRoot) {
    const cfg = config || getConfig();
    const componentsPath = getComponentsPath(cfg, projectRoot);
    if (!fs.existsSync(componentsPath)) {
        return [];
    }
    const files = await fs.promises.readdir(componentsPath);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    // Parallelize reads
    const results = await Promise.all(jsonFiles.map(async (file) => {
        try {
            const filePath = path.join(componentsPath, file);
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return ensureStableId(JSON.parse(content));
        }
        catch {
            return null;
        }
    }));
    return results.filter((c) => c !== null);
}
/**
 * Delete a component by ID
 */
export async function deleteComponent(componentId, config, projectRoot) {
    if (!isValidComponentId(componentId)) {
        return false;
    }
    const cfg = config || getConfig();
    const componentsPath = getComponentsPath(cfg, projectRoot);
    const filePath = path.join(componentsPath, `${componentId}.json`);
    if (!fs.existsSync(filePath)) {
        return false;
    }
    await fs.promises.unlink(filePath);
    return true;
}
// =============================================================================
// CONNECTION STORAGE
// =============================================================================
/**
 * Store a connection to disk
 */
export async function storeConnection(connection, config, projectRoot) {
    const cfg = config || getConfig();
    ensureStorageDirectories(cfg, projectRoot);
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    const filePath = path.join(connectionsPath, `${connection.connection_id}.json`);
    await atomicWriteJSON(filePath, connection);
    return {
        connection_id: connection.connection_id,
        file_path: filePath,
    };
}
/**
 * Load a connection by ID
 */
export async function loadConnection(connectionId, config, projectRoot) {
    if (!isValidConnectionId(connectionId)) {
        return null;
    }
    const cfg = config || getConfig();
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    const filePath = path.join(connectionsPath, `${connectionId}.json`);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Load all connections (parallelized for efficiency)
 */
export async function loadAllConnections(config, projectRoot) {
    const cfg = config || getConfig();
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    if (!fs.existsSync(connectionsPath)) {
        return [];
    }
    const files = await fs.promises.readdir(connectionsPath);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    // Parallelize reads
    const results = await Promise.all(jsonFiles.map(async (file) => {
        try {
            const filePath = path.join(connectionsPath, file);
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }));
    return results.filter((c) => c !== null);
}
/**
 * Delete a connection by ID
 */
export async function deleteConnection(connectionId, config, projectRoot) {
    if (!isValidConnectionId(connectionId)) {
        return false;
    }
    const cfg = config || getConfig();
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    const filePath = path.join(connectionsPath, `${connectionId}.json`);
    if (!fs.existsSync(filePath)) {
        return false;
    }
    await fs.promises.unlink(filePath);
    return true;
}
// =============================================================================
// INDEX MANAGEMENT
// =============================================================================
/**
 * Build and save the index from current components and connections
 */
export async function buildIndex(config, projectRoot, projectMetadata) {
    const cfg = config || getConfig();
    const components = await loadAllComponents(cfg, projectRoot);
    const connections = await loadAllConnections(cfg, projectRoot);
    const index = {
        schema_version: SCHEMA_VERSION,
        version: '1.0.0',
        last_scan: Date.now(),
        project_path: projectRoot || process.cwd(),
        components: {
            by_name: {},
            by_type: {},
            by_layer: {},
            by_status: {},
        },
        connections: {
            by_type: {},
            by_from: {},
            by_to: {},
        },
        stats: {
            total_components: components.length,
            total_connections: connections.length,
            components_by_type: {},
            connections_by_type: {},
            outdated_count: 0,
            vulnerable_count: 0,
        },
    };
    // Attach project metadata if provided
    if (projectMetadata && Object.keys(projectMetadata).length > 0) {
        index.project = projectMetadata;
    }
    // Index components
    for (const component of components) {
        // By name
        index.components.by_name[component.name] = component.component_id;
        // By type
        if (!index.components.by_type[component.type]) {
            index.components.by_type[component.type] = [];
        }
        index.components.by_type[component.type].push(component.component_id);
        // By layer
        if (!index.components.by_layer[component.role.layer]) {
            index.components.by_layer[component.role.layer] = [];
        }
        index.components.by_layer[component.role.layer].push(component.component_id);
        // By status
        if (!index.components.by_status[component.status]) {
            index.components.by_status[component.status] = [];
        }
        index.components.by_status[component.status].push(component.component_id);
        // Stats
        index.stats.components_by_type[component.type] =
            (index.stats.components_by_type[component.type] || 0) + 1;
        if (component.status === 'outdated')
            index.stats.outdated_count++;
        if (component.status === 'vulnerable')
            index.stats.vulnerable_count++;
    }
    // Index connections
    for (const connection of connections) {
        // By type
        if (!index.connections.by_type[connection.connection_type]) {
            index.connections.by_type[connection.connection_type] = [];
        }
        index.connections.by_type[connection.connection_type].push(connection.connection_id);
        // By from
        if (!index.connections.by_from[connection.from.component_id]) {
            index.connections.by_from[connection.from.component_id] = [];
        }
        index.connections.by_from[connection.from.component_id].push(connection.connection_id);
        // By to
        if (!index.connections.by_to[connection.to.component_id]) {
            index.connections.by_to[connection.to.component_id] = [];
        }
        index.connections.by_to[connection.to.component_id].push(connection.connection_id);
        // Stats
        index.stats.connections_by_type[connection.connection_type] =
            (index.stats.connections_by_type[connection.connection_type] || 0) + 1;
    }
    // Save index (atomic: write to .tmp, then rename)
    const indexPath = getIndexPath(cfg, projectRoot);
    await atomicWriteJSON(indexPath, index);
    return index;
}
/**
 * Load the index
 */
export async function loadIndex(config, projectRoot) {
    const cfg = config || getConfig();
    const indexPath = getIndexPath(cfg, projectRoot);
    if (!fs.existsSync(indexPath)) {
        return null;
    }
    try {
        const content = await fs.promises.readFile(indexPath, 'utf-8');
        const parsed = JSON.parse(content);
        // Read-time defaults for back-compat with 1.0.0 archives.
        // 1.0.0 archives have no schema_version, last_full_scan, or
        // incrementals_since_full. Synthesize sensible defaults so callers
        // (especially selectScanMode) can treat 1.0.0 + 1.1.0 uniformly.
        if (!parsed.schema_version) {
            parsed.schema_version = '1.0.0';
        }
        if (parsed.last_full_scan === undefined) {
            // Treat the existing last_scan as if it had been a full scan.
            // This is conservative: it ensures the 7-day staleness rule
            // doesn't immediately demand a full scan on the first 1.1.0 run.
            parsed.last_full_scan = parsed.last_scan ?? 0;
        }
        if (parsed.incrementals_since_full === undefined) {
            parsed.incrementals_since_full = 0;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
// =============================================================================
// GRAPH BUILDING
// =============================================================================
/**
 * Build the connection graph
 */
export async function buildGraph(config, projectRoot) {
    const cfg = config || getConfig();
    const components = await loadAllComponents(cfg, projectRoot);
    const connections = await loadAllConnections(cfg, projectRoot);
    const nodes = components.map((c) => ({
        id: c.component_id,
        stable_id: c.stable_id ?? ensureStableId(c).stable_id,
        name: c.name,
        type: c.type,
        layer: c.role.layer,
    }));
    const edges = connections.map((c) => ({
        id: c.connection_id,
        source: c.from.component_id,
        target: c.to.component_id,
        type: c.connection_type,
        label: c.description,
    }));
    const graph = {
        schema_version: SCHEMA_VERSION,
        nodes,
        edges,
        metadata: {
            generated_at: Date.now(),
            component_count: nodes.length,
            connection_count: edges.length,
        },
    };
    // Save graph (atomic)
    const graphPath = getGraphPath(cfg, projectRoot);
    await atomicWriteJSON(graphPath, graph);
    return graph;
}
// =============================================================================
// FILE MAP (Tier 2 - O(1) file-to-component lookup)
// =============================================================================
/**
 * Build a map of file paths → component IDs for fast lookup in hooks.
 * Sources: component config_files + connection code_reference files + connection locations.
 */
export async function buildFileMap(config, projectRoot) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    const components = await loadAllComponents(cfg, root);
    const connections = await loadAllConnections(cfg, root);
    const fileMap = {};
    // Index config files from components
    for (const c of components) {
        for (const f of c.source.config_files || []) {
            fileMap[f] = c.component_id;
        }
    }
    // Index source files from connections (code_reference, from.location, to.location)
    for (const conn of connections) {
        if (conn.code_reference?.file) {
            // Map to the "from" component — this file uses/imports the dependency
            fileMap[conn.code_reference.file] = conn.from.component_id;
        }
        if (conn.from.location?.file) {
            fileMap[conn.from.location.file] = conn.from.component_id;
        }
        if (conn.to.location?.file) {
            fileMap[conn.to.location.file] = conn.to.component_id;
        }
    }
    const wrapped = {
        schema_version: SCHEMA_VERSION,
        generated_at: Date.now(),
        files: fileMap,
    };
    const fileMapPath = getFileMapPath(cfg, root);
    await atomicWriteJSON(fileMapPath, wrapped);
    return fileMap;
}
/**
 * Load the file map (file path → component ID)
 */
export async function loadFileMap(config, projectRoot) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    const fileMapPath = getFileMapPath(cfg, root);
    if (!fs.existsSync(fileMapPath)) {
        return {};
    }
    try {
        const content = await fs.promises.readFile(fileMapPath, 'utf-8');
        const parsed = JSON.parse(content);
        return parsed.files || {};
    }
    catch {
        return {};
    }
}
// =============================================================================
// PROMPT STORAGE (Tier 2 - Full prompt content for on-demand loading)
// =============================================================================
/**
 * Save prompt scan results to prompts.json
 */
export async function savePromptScan(promptData, config, projectRoot) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    ensureStorageDirectories(cfg, root);
    const promptsPath = getPromptsPath(cfg, root);
    // Spread schema_version into prompt output
    const output = typeof promptData === 'object' && promptData !== null
        ? { schema_version: SCHEMA_VERSION, ...promptData }
        : promptData;
    await atomicWriteJSON(promptsPath, output);
}
// =============================================================================
// SUMMARY GENERATION (Tier 1 - Hot Context for LLMs)
// =============================================================================
const AI_PROVIDER_NAMES = new Set([
    'openai', '@anthropic-ai/sdk', '@langchain/core', '@langchain/openai',
    '@langchain/anthropic', '@langchain/groq', 'groq-sdk', 'langsmith',
    '@mistralai/mistralai', 'replicate', '@huggingface/inference',
    '@google/generative-ai', '@vercel/ai', 'ai', 'cohere-ai',
]);
/**
 * Build a concise markdown summary with pointers to detail files.
 * This is the "hot context" an LLM reads first on cold start.
 */
export async function buildSummary(config, projectRoot, promptScan, projectMetadata, latestDiff, gitInfo) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    const components = await loadAllComponents(cfg, root);
    const connections = await loadAllConnections(cfg, root);
    const now = new Date().toISOString();
    const aiComponents = components.filter((c) => AI_PROVIDER_NAMES.has(c.name) || c.type === 'llm' || c.type === 'service');
    // Group components by layer
    const byLayer = new Map();
    for (const c of components) {
        const layer = c.role.layer;
        if (!byLayer.has(layer))
            byLayer.set(layer, []);
        byLayer.get(layer).push(c);
    }
    // Sort each layer by architectural importance (production-critical first, noise last)
    const criticalTypes = new Set(['database', 'queue', 'llm', 'framework', 'infra', 'service', 'cron']);
    const isNoiseComponent = (c) => {
        const file = c.source.config_files[0]?.toLowerCase() || c.name.toLowerCase();
        return /(_archive|__tests__|\.test\.|\.spec\.|\/tests\/|\/scripts\/|\/examples?\/|\/dist\/|\/mock|\.example\.)/.test(file) ||
            c.name.startsWith('_archive') || c.name.endsWith('.test') || c.name.endsWith('.spec');
    };
    for (const [, group] of byLayer) {
        group.sort((a, b) => {
            const aIsCritical = criticalTypes.has(a.type) ? 0 : 1;
            const bIsCritical = criticalTypes.has(b.type) ? 0 : 1;
            if (aIsCritical !== bIsCritical)
                return aIsCritical - bIsCritical;
            const aIsNoise = isNoiseComponent(a) ? 1 : 0;
            const bIsNoise = isNoiseComponent(b) ? 1 : 0;
            if (aIsNoise !== bIsNoise)
                return aIsNoise - bIsNoise;
            const aConns = a.connects_to.length + a.connected_from.length;
            const bConns = b.connects_to.length + b.connected_from.length;
            if (bConns !== aConns)
                return bConns - aConns;
            return a.name.localeCompare(b.name);
        });
    }
    // Build markdown
    const lines = [];
    lines.push('# Architecture Summary');
    lines.push(`> NavGator auto-generated | Scanned: ${now}`);
    lines.push(`> ${components.length} components | ${connections.length} connections | ${aiComponents.length} AI providers`);
    if (gitInfo) {
        lines.push(`> Branch: **${gitInfo.branch}** @ \`${gitInfo.commit}\``);
    }
    lines.push('');
    // Project metadata (agent orientation)
    if (projectMetadata && projectMetadata.type) {
        lines.push('## Project');
        lines.push(`- **Type:** ${projectMetadata.type}`);
        if (projectMetadata.platforms?.length) {
            lines.push(`- **Platforms:** ${projectMetadata.platforms.join(', ')}`);
        }
        if (projectMetadata.architecture_pattern) {
            lines.push(`- **Architecture:** ${projectMetadata.architecture_pattern}`);
        }
        if (projectMetadata.min_deployment) {
            const deploys = Object.entries(projectMetadata.min_deployment).map(([k, v]) => `${k} ${v}`).join(', ');
            lines.push(`- **Min deployment:** ${deploys}`);
        }
        if (projectMetadata.targets?.length) {
            lines.push(`- **Targets:** ${projectMetadata.targets.map(t => `${t.name} (${t.type})`).join(', ')}`);
        }
        if (projectMetadata.entitlements?.length) {
            lines.push(`- **Required entitlements:** ${projectMetadata.entitlements.map(e => e.key).join(', ')}`);
        }
        lines.push('');
        // Fragile connections (critical for agents)
        if (projectMetadata.fragile_keys?.length) {
            const sharedKeys = projectMetadata.fragile_keys.filter(k => k.files.length > 1);
            if (sharedKeys.length > 0) {
                lines.push('## Fragile Connections (string-keyed, multi-file)');
                lines.push('> These break at runtime, not compile time. Change the string → silent failure.');
                lines.push('');
                for (const key of sharedKeys) {
                    lines.push(`- **${key.key}** (${key.type}) — used in: ${key.files.join(', ')}`);
                }
                lines.push('');
            }
        }
    }
    // Components by layer
    lines.push('## Components');
    lines.push('');
    const layerOrder = ['frontend', 'backend', 'database', 'queue', 'infra', 'external'];
    for (const layer of layerOrder) {
        const group = byLayer.get(layer);
        if (!group || group.length === 0)
            continue;
        lines.push(`### ${layer.charAt(0).toUpperCase() + layer.slice(1)} (${group.length})`);
        for (const c of group) {
            const ver = c.version ? ` v${c.version}` : '';
            lines.push(`- **${c.name}**${ver} — ${c.role.purpose} \`components/${c.component_id}.json\``);
        }
        lines.push('');
    }
    // Top by PageRank + Mermaid cluster diagram (T6)
    // Reads metrics.json produced by computeAndStoreMetrics during scan.
    try {
        const metricsPath = path.join(getStoragePath(cfg, root), 'metrics.json');
        if (fs.existsSync(metricsPath)) {
            const raw = await fs.promises.readFile(metricsPath, 'utf-8');
            const report = JSON.parse(raw);
            if (!report.suppressed && report.metrics.length > 0) {
                lines.push('## Top by PageRank');
                lines.push(`> ${report.community_count} communities · modularity ${report.modularity?.toFixed(3) ?? 'n/a'}`);
                lines.push('');
                lines.push('| # | Component | PageRank | Community |');
                lines.push('|---|-----------|---------:|----------:|');
                const top = report.metrics.slice(0, 10);
                top.forEach((m, i) => {
                    lines.push(`| ${i + 1} | \`${m.name}\` | ${m.pagerank_score.toFixed(4)} | ${m.community_id} |`);
                });
                lines.push('');
                // Inline Mermaid cluster diagram — top 5 communities by PageRank-weighted size.
                const byCommunity = new Map();
                for (const m of report.metrics) {
                    if (!byCommunity.has(m.community_id))
                        byCommunity.set(m.community_id, []);
                    byCommunity.get(m.community_id).push(m);
                }
                const ranked = [...byCommunity.entries()]
                    .map(([id, members]) => ({
                    id,
                    members,
                    score: members.reduce((sum, x) => sum + x.pagerank_score, 0),
                }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5);
                if (ranked.length > 0) {
                    const sanitize = (s) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
                    lines.push('## Cluster Diagram');
                    lines.push('```mermaid');
                    lines.push('flowchart LR');
                    for (const cluster of ranked) {
                        const top3 = cluster.members
                            .sort((a, b) => b.pagerank_score - a.pagerank_score)
                            .slice(0, 3);
                        lines.push(`  subgraph C${cluster.id}["Community ${cluster.id} (${cluster.members.length} nodes)"]`);
                        for (const m of top3) {
                            lines.push(`    ${sanitize(m.component_id)}["${m.name}"]`);
                        }
                        lines.push('  end');
                    }
                    lines.push('```');
                    lines.push('');
                }
            }
        }
    }
    catch {
        // metrics.json missing or malformed — silent skip; legacy scans may not have it.
    }
    // AI/LLM routing table
    if (aiComponents.length > 0 || connections.some((c) => c.connection_type === 'service-call')) {
        lines.push('## AI/LLM Routing');
        lines.push('| Provider | File | Line | Purpose | Detail |');
        lines.push('|----------|------|------|---------|--------|');
        const aiConnections = connections.filter((c) => {
            const targetComp = components.find((comp) => comp.component_id === c.to.component_id);
            return targetComp && (AI_PROVIDER_NAMES.has(targetComp.name) || targetComp.type === 'llm' || targetComp.type === 'service');
        });
        for (const conn of aiConnections) {
            const target = components.find((comp) => comp.component_id === conn.to.component_id);
            const file = conn.code_reference?.file || conn.from.location?.file || '—';
            const line = conn.code_reference?.line_start || conn.from.location?.line || '—';
            const purpose = conn.description || target?.role.purpose || '—';
            lines.push(`| ${target?.name || '?'} | ${file} | ${line} | ${purpose} | \`connections/${conn.connection_id}.json\` |`);
        }
        // Also list AI components with no connections yet
        for (const c of aiComponents) {
            const hasConn = connections.some((conn) => conn.to.component_id === c.component_id);
            if (!hasConn) {
                const configFile = c.source.config_files?.[0] || '—';
                lines.push(`| ${c.name} | ${configFile} | — | ${c.role.purpose} | \`components/${c.component_id}.json\` |`);
            }
        }
        lines.push('');
    }
    // Top connections (cap at 20)
    if (connections.length > 0) {
        const maxConns = Math.min(connections.length, 20);
        lines.push(`## Connections (${connections.length > 20 ? `top 20 of ${connections.length}` : connections.length})`);
        for (let i = 0; i < maxConns; i++) {
            const conn = connections[i];
            const fromComp = components.find((c) => c.component_id === conn.from.component_id);
            const toComp = components.find((c) => c.component_id === conn.to.component_id);
            const file = conn.code_reference?.file || '';
            const line = conn.code_reference?.line_start ? `:${conn.code_reference.line_start}` : '';
            lines.push(`- ${fromComp?.name || '?'} → ${toComp?.name || '?'} (${conn.connection_type}) ${file}${line}`);
        }
        lines.push('');
    }
    const hotspots = getTopHotspots(components, connections, 5);
    if (hotspots.length > 0) {
        lines.push('## Hotspots');
        lines.push('> Highest fan-in internal modules. Changes here ripple broadly.');
        lines.push('');
        for (const hotspot of hotspots) {
            const file = hotspot.component.source.config_files?.[0];
            lines.push(`- **${hotspot.component.name}** — ${hotspot.count} dependents${file ? ` (${file})` : ''}`);
        }
        lines.push('');
    }
    const fanOut = getTopFanOut(components, connections, 5).filter((entry) => entry.count >= 5);
    if (fanOut.length > 0) {
        lines.push('## Fan-Out Risks');
        lines.push('> High fan-out modules often accumulate too many responsibilities.');
        lines.push('');
        for (const entry of fanOut) {
            const file = entry.component.source.config_files?.[0];
            lines.push(`- **${entry.component.name}** — imports ${entry.count} modules${file ? ` (${file})` : ''}`);
        }
        lines.push('');
    }
    const layerViolations = detectLayerViolations(components, connections);
    lines.push('## Layer Health');
    if (layerViolations.length === 0) {
        lines.push('- No upward import violations detected from inferred internal layers.');
    }
    else {
        for (const violation of layerViolations.slice(0, 5)) {
            const file = violation.connection.code_reference?.file || violation.from.source.config_files?.[0] || '';
            const line = violation.connection.code_reference?.line_start ? `:${violation.connection.code_reference.line_start}` : '';
            lines.push(`- ${violation.from.name} → ${violation.to.name} (${file}${line}) crosses from tier ${violation.fromTier} to ${violation.toTier}`);
        }
        if (layerViolations.length > 5) {
            lines.push(`- ... and ${layerViolations.length - 5} more`);
        }
    }
    lines.push('');
    const cycles = detectImportCycles(components, connections, 5);
    lines.push('## Circular Dependencies');
    if (cycles.length === 0) {
        lines.push('- No import cycles detected.');
    }
    else {
        for (const cycle of cycles) {
            lines.push(`- ${cycle.join(' → ')}`);
        }
    }
    lines.push('');
    // Delta — use structured diff from timeline if available, else fall back to naive comparison
    const summaryPath = getSummaryPath(cfg, root);
    if (latestDiff && latestDiff.diff.stats.total_changes > 0) {
        const { formatDiffForSummary } = await import('./diff.js');
        const diffLines = formatDiffForSummary(latestDiff);
        lines.push(...diffLines);
    }
    else if (!latestDiff) {
        // Fallback: naive text-based delta for backwards compatibility (no timeline entry provided)
        if (fs.existsSync(summaryPath)) {
            try {
                const prev = await fs.promises.readFile(summaryPath, 'utf-8');
                const prevNames = new Set();
                for (const match of prev.matchAll(/^- \*\*(.+?)\*\*/gm)) {
                    prevNames.add(match[1]);
                }
                const currentNames = new Set(components.map((c) => c.name));
                const added = components.filter((c) => !prevNames.has(c.name));
                const removed = [...prevNames].filter((n) => !currentNames.has(n));
                if (added.length > 0 || removed.length > 0) {
                    lines.push('## Changes Since Last Scan');
                    for (const c of added) {
                        lines.push(`- Added: \`${c.name}\` (${c.role.layer})`);
                    }
                    for (const name of removed) {
                        lines.push(`- Removed: \`${name}\``);
                    }
                    lines.push('');
                }
            }
            catch {
                // First scan or parse error — skip delta
            }
        }
    }
    // Prompts section (pointers only — full content in prompts.json)
    if (promptScan && promptScan.prompts.length > 0) {
        lines.push(`## Prompts (${promptScan.prompts.length}) — full content: \`prompts.json\``);
        lines.push('| Name | File | Line | Provider | Category |');
        lines.push('|------|------|------|----------|----------|');
        const maxPrompts = Math.min(promptScan.prompts.length, 20);
        for (let i = 0; i < maxPrompts; i++) {
            const p = promptScan.prompts[i];
            const provider = p.provider?.provider || '—';
            const model = p.provider?.model ? ` (${p.provider.model})` : '';
            const cat = p.category || '—';
            lines.push(`| ${p.name} | ${p.location.file} | ${p.location.lineStart} | ${provider}${model} | ${cat} |`);
        }
        if (promptScan.prompts.length > 20) {
            lines.push(`| ... | | | ${promptScan.prompts.length - 20} more in prompts.json | |`);
        }
        lines.push('');
    }
    // Detail pointers
    lines.push('## Detail Pointers');
    lines.push(`- Full index: \`index.json\``);
    lines.push(`- Connection graph: \`graph.json\``);
    lines.push(`- File map: \`file_map.json\``);
    lines.push(`- Architecture timeline: \`timeline.json\``);
    if (promptScan && promptScan.prompts.length > 0) {
        lines.push(`- Prompts: \`prompts.json\` (${promptScan.prompts.length} prompts, full content)`);
    }
    lines.push(`- All components: \`components/\` (${components.length} files)`);
    lines.push(`- All connections: \`connections/\` (${connections.length} files)`);
    lines.push('');
    const fullContent = lines.join('\n');
    const lineCount = lines.length;
    const COMPRESSION_THRESHOLD = 150;
    if (lineCount > COMPRESSION_THRESHOLD) {
        // Write full version to NAVSUMMARY_FULL.md
        const fullPath = getSummaryFullPath(cfg, root);
        await fs.promises.writeFile(fullPath, fullContent, 'utf-8');
        // Build compressed version: top 10 per layer, AI routing, top 10 connections
        const compressed = [];
        compressed.push('# Architecture Summary (Compressed)');
        compressed.push('');
        compressed.push('> **This is a compressed summary.** Full version: `NAVSUMMARY_FULL.md`');
        compressed.push('');
        compressed.push(`> NavGator auto-generated | Scanned: ${now}`);
        compressed.push(`> ${components.length} components | ${connections.length} connections | ${aiComponents.length} AI providers`);
        compressed.push('');
        // Components (top 10 per layer)
        const hasLayerContent = layerOrder.some((l) => (byLayer.get(l)?.length || 0) > 0);
        if (hasLayerContent) {
            compressed.push('## Components (top 10 per layer)');
            compressed.push('');
            for (const layer of layerOrder) {
                const group = byLayer.get(layer);
                if (!group || group.length === 0)
                    continue;
                compressed.push(`### ${layer.charAt(0).toUpperCase() + layer.slice(1)} (${group.length})`);
                const top = group.slice(0, 10);
                for (const c of top) {
                    const ver = c.version ? ` v${c.version}` : '';
                    compressed.push(`- **${c.name}**${ver} — ${c.role.purpose} \`components/${c.component_id}.json\``);
                }
                if (group.length > 10) {
                    compressed.push(`- ... and ${group.length - 10} more (see NAVSUMMARY_FULL.md)`);
                }
                compressed.push('');
            }
        }
        // Top by PageRank (compressed: top 5 + 1 Mermaid block)
        try {
            const metricsPath = path.join(getStoragePath(cfg, root), 'metrics.json');
            if (fs.existsSync(metricsPath)) {
                const raw = await fs.promises.readFile(metricsPath, 'utf-8');
                const report = JSON.parse(raw);
                if (!report.suppressed && report.metrics.length > 0) {
                    compressed.push('## Top by PageRank');
                    compressed.push(`> ${report.community_count} communities · modularity ${report.modularity?.toFixed(3) ?? 'n/a'}`);
                    compressed.push('');
                    compressed.push('| # | Component | PageRank | Community |');
                    compressed.push('|---|-----------|---------:|----------:|');
                    report.metrics.slice(0, 5).forEach((m, i) => {
                        compressed.push(`| ${i + 1} | \`${m.name}\` | ${m.pagerank_score.toFixed(4)} | ${m.community_id} |`);
                    });
                    compressed.push('');
                }
            }
        }
        catch {
            // metrics.json missing or malformed — silent skip.
        }
        // AI/LLM routing table (preserved in compressed version)
        if (aiComponents.length > 0 || connections.some((c) => c.connection_type === 'service-call')) {
            compressed.push('## AI/LLM Routing');
            compressed.push('| Provider | File | Line | Purpose | Detail |');
            compressed.push('|----------|------|------|---------|--------|');
            const aiConnections = connections.filter((c) => {
                const targetComp = components.find((comp) => comp.component_id === c.to.component_id);
                return targetComp && (AI_PROVIDER_NAMES.has(targetComp.name) || targetComp.type === 'llm' || targetComp.type === 'service');
            });
            const maxAiConns = Math.min(aiConnections.length, 10);
            for (let i = 0; i < maxAiConns; i++) {
                const conn = aiConnections[i];
                const target = components.find((comp) => comp.component_id === conn.to.component_id);
                const file = conn.code_reference?.file || conn.from.location?.file || '—';
                const line = conn.code_reference?.line_start || conn.from.location?.line || '—';
                const purpose = conn.description || target?.role.purpose || '—';
                compressed.push(`| ${target?.name || '?'} | ${file} | ${line} | ${purpose} | \`connections/${conn.connection_id}.json\` |`);
            }
            if (aiConnections.length > 10) {
                compressed.push(`| ... | | | ${aiConnections.length - 10} more (see NAVSUMMARY_FULL.md) | |`);
            }
            // AI components with no connections
            for (const c of aiComponents) {
                const hasConn = connections.some((conn) => conn.to.component_id === c.component_id);
                if (!hasConn) {
                    const configFile = c.source.config_files?.[0] || '—';
                    compressed.push(`| ${c.name} | ${configFile} | — | ${c.role.purpose} | \`components/${c.component_id}.json\` |`);
                }
            }
            compressed.push('');
        }
        // Runtime Topology section
        const withRuntime = components.filter(c => c.runtime?.resource_type);
        if (withRuntime.length > 0) {
            compressed.push('## Runtime Topology');
            const rtSeen = new Set();
            for (const c of withRuntime) {
                const r = c.runtime;
                if (r.resource_type === 'api')
                    continue; // skip noisy env var URLs
                const engine = r.engine || c.name;
                const host = r.endpoint?.host ? ` @ ${r.endpoint.host}${r.endpoint.port ? ':' + r.endpoint.port : ''}` : '';
                const env = r.connection_env_var ? ` (via ${r.connection_env_var})` : '';
                const rtLine = `- **${r.resource_type}**: ${engine}${host}${env}`;
                if (!rtSeen.has(rtLine)) {
                    rtSeen.add(rtLine);
                    compressed.push(rtLine);
                }
            }
            // Queue names as a group
            const queueComps = withRuntime.filter(c => c.runtime?.resource_type === 'queue');
            if (queueComps.length > 0) {
                const queueNames = queueComps.map(c => c.runtime?.service_name || c.name).join(', ');
                const engine = queueComps[0].runtime?.engine || 'queue';
                compressed.push(`- **queues**: ${queueNames} (${engine})`);
            }
            compressed.push('');
        }
        // Connections (top 10)
        if (connections.length > 0) {
            const maxConns = Math.min(connections.length, 10);
            compressed.push(`## Connections (top 10 of ${connections.length})`);
            for (let i = 0; i < maxConns; i++) {
                const conn = connections[i];
                const fromComp = components.find((c) => c.component_id === conn.from.component_id);
                const toComp = components.find((c) => c.component_id === conn.to.component_id);
                const file = conn.code_reference?.file || '';
                const line = conn.code_reference?.line_start ? `:${conn.code_reference.line_start}` : '';
                compressed.push(`- ${fromComp?.name || '?'} → ${toComp?.name || '?'} (${conn.connection_type}) ${file}${line}`);
            }
            compressed.push('');
        }
        if (hotspots.length > 0) {
            compressed.push('## Hotspots');
            for (const hotspot of hotspots) {
                compressed.push(`- **${hotspot.component.name}** — ${hotspot.count} dependents`);
            }
            compressed.push('');
        }
        if (fanOut.length > 0) {
            compressed.push('## Fan-Out Risks');
            for (const entry of fanOut) {
                compressed.push(`- **${entry.component.name}** — imports ${entry.count} modules`);
            }
            compressed.push('');
        }
        compressed.push('## Layer Health');
        if (layerViolations.length === 0) {
            compressed.push('- No upward import violations detected.');
        }
        else {
            for (const violation of layerViolations.slice(0, 5)) {
                compressed.push(`- ${violation.from.name} → ${violation.to.name} crosses from tier ${violation.fromTier} to ${violation.toTier}`);
            }
        }
        compressed.push('');
        compressed.push('## Circular Dependencies');
        if (cycles.length === 0) {
            compressed.push('- No import cycles detected.');
        }
        else {
            for (const cycle of cycles) {
                compressed.push(`- ${cycle.join(' → ')}`);
            }
        }
        compressed.push('');
        // Add prompts pointer if available
        if (promptScan && promptScan.prompts.length > 0) {
            compressed.push(`## Prompts (${promptScan.prompts.length}) — full content: \`prompts.json\``);
            compressed.push('| Name | File | Provider |');
            compressed.push('|------|------|----------|');
            const maxP = Math.min(promptScan.prompts.length, 10);
            for (let i = 0; i < maxP; i++) {
                const p = promptScan.prompts[i];
                const name = p.name || '?';
                const file = p.location?.file ? `${p.location.file}:${p.location.lineStart}` : '?';
                const provider = p.provider?.provider || 'unknown';
                compressed.push(`| ${name} | ${file} | ${provider} |`);
            }
            if (promptScan.prompts.length > 10) {
                compressed.push(`| ... | +${promptScan.prompts.length - 10} more in prompts.json | |`);
            }
            compressed.push('');
        }
        compressed.push('## Detail Pointers');
        compressed.push('- **Full summary**: `NAVSUMMARY_FULL.md`');
        compressed.push(`- Full index: \`index.json\``);
        compressed.push(`- Connection graph: \`graph.json\``);
        compressed.push(`- File map: \`file_map.json\``);
        compressed.push(`- Prompts: \`prompts.json\` (${promptScan?.prompts?.length || 0} prompts, full content)`);
        compressed.push(`- All components: \`components/\` (${components.length} files)`);
        compressed.push(`- All connections: \`connections/\` (${connections.length} files)`);
        compressed.push('');
        const compressedContent = compressed.join('\n');
        await fs.promises.writeFile(summaryPath, compressedContent, 'utf-8');
        return compressedContent;
    }
    const content = lines.join('\n');
    await fs.promises.writeFile(summaryPath, content, 'utf-8');
    return content;
}
/**
 * Load the graph
 */
export async function loadGraph(config, projectRoot) {
    const cfg = config || getConfig();
    const graphPath = getGraphPath(cfg, projectRoot);
    if (!fs.existsSync(graphPath)) {
        return null;
    }
    try {
        const content = await fs.promises.readFile(graphPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
// =============================================================================
// SNAPSHOTS
// =============================================================================
/**
 * Create a snapshot of current architecture
 */
export async function createSnapshot(reason, config, projectRoot) {
    const cfg = config || getConfig();
    ensureStorageDirectories(cfg, projectRoot);
    const components = await loadAllComponents(cfg, projectRoot);
    const connections = await loadAllConnections(cfg, projectRoot);
    // Build component_id → name lookup for connection name resolution
    const componentIdToName = new Map();
    for (const c of components) {
        componentIdToName.set(c.component_id, c.name);
    }
    const timestamp = Date.now();
    const snapshotId = `SNAP_${new Date(timestamp).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
    const snapshot = {
        snapshot_id: snapshotId,
        snapshot_version: '2.0',
        timestamp,
        reason,
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
    const snapshotsPath = getSnapshotsPath(cfg, projectRoot);
    const filePath = path.join(snapshotsPath, `${snapshotId}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    return {
        snapshot_id: snapshotId,
        file_path: filePath,
    };
}
// =============================================================================
// BULK OPERATIONS
// =============================================================================
/**
 * Store multiple components at once (parallelized for efficiency)
 */
export async function storeComponents(components, config, projectRoot) {
    const cfg = config || getConfig();
    ensureStorageDirectories(cfg, projectRoot);
    const componentsPath = getComponentsPath(cfg, projectRoot);
    // Parallelize writes in batches to avoid overwhelming the filesystem
    const batchSize = 50;
    for (let i = 0; i < components.length; i += batchSize) {
        const batch = components.slice(i, i + batchSize);
        await Promise.all(batch.map(async (component) => {
            ensureStableId(component);
            const filePath = path.join(componentsPath, `${component.component_id}.json`);
            await atomicWriteJSON(filePath, component);
        }));
    }
}
/**
 * Store multiple connections at once (parallelized for efficiency)
 */
export async function storeConnections(connections, config, projectRoot) {
    const cfg = config || getConfig();
    ensureStorageDirectories(cfg, projectRoot);
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    // Parallelize writes in batches to avoid overwhelming the filesystem
    const batchSize = 50;
    for (let i = 0; i < connections.length; i += batchSize) {
        const batch = connections.slice(i, i + batchSize);
        await Promise.all(batch.map(async (connection) => {
            const filePath = path.join(connectionsPath, `${connection.connection_id}.json`);
            await atomicWriteJSON(filePath, connection);
        }));
    }
}
/**
 * Clear all stored data (parallelized for efficiency)
 */
export async function clearStorage(config, projectRoot) {
    const cfg = config || getConfig();
    const componentsPath = getComponentsPath(cfg, projectRoot);
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    const indexPath = getIndexPath(cfg, projectRoot);
    const graphPath = getGraphPath(cfg, projectRoot);
    const deletePromises = [];
    // Delete all component files
    if (fs.existsSync(componentsPath)) {
        const componentFiles = await fs.promises.readdir(componentsPath);
        deletePromises.push(...componentFiles.map((file) => fs.promises.unlink(path.join(componentsPath, file)).catch(() => { })));
    }
    // Delete all connection files
    if (fs.existsSync(connectionsPath)) {
        const connectionFiles = await fs.promises.readdir(connectionsPath);
        deletePromises.push(...connectionFiles.map((file) => fs.promises.unlink(path.join(connectionsPath, file)).catch(() => { })));
    }
    // Delete index and graph
    if (fs.existsSync(indexPath)) {
        deletePromises.push(fs.promises.unlink(indexPath).catch(() => { }));
    }
    if (fs.existsSync(graphPath)) {
        deletePromises.push(fs.promises.unlink(graphPath).catch(() => { }));
    }
    await Promise.all(deletePromises);
}
// =============================================================================
// STATISTICS
// =============================================================================
/**
 * Get storage statistics
 */
export async function getStorageStats(config, projectRoot) {
    const cfg = config || getConfig();
    const components = await loadAllComponents(cfg, projectRoot);
    const connections = await loadAllConnections(cfg, projectRoot);
    // Calculate disk usage
    const componentsPath = getComponentsPath(cfg, projectRoot);
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    let diskUsage = 0;
    if (fs.existsSync(componentsPath)) {
        const files = await fs.promises.readdir(componentsPath);
        for (const file of files) {
            const stats = await fs.promises.stat(path.join(componentsPath, file));
            diskUsage += stats.size;
        }
    }
    if (fs.existsSync(connectionsPath)) {
        const files = await fs.promises.readdir(connectionsPath);
        for (const file of files) {
            const stats = await fs.promises.stat(path.join(connectionsPath, file));
            diskUsage += stats.size;
        }
    }
    // Find oldest and newest timestamps
    const allTimestamps = [
        ...components.map((c) => c.timestamp),
        ...connections.map((c) => c.timestamp),
    ];
    return {
        total_components: components.length,
        total_connections: connections.length,
        disk_usage_kb: Math.round(diskUsage / 1024),
        oldest_timestamp: allTimestamps.length > 0 ? Math.min(...allTimestamps) : null,
        newest_timestamp: allTimestamps.length > 0 ? Math.max(...allTimestamps) : null,
    };
}
// =============================================================================
// FILE HASH TRACKING
// =============================================================================
/**
 * Compute SHA-256 hash of a file
 */
export async function computeFileHash(filePath) {
    const content = await fs.promises.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}
/**
 * Compute hashes for multiple files (parallelized in batches for efficiency)
 */
export async function computeFileHashes(files, projectRoot) {
    const hashes = {};
    const timestamp = Date.now();
    // Process in batches to avoid too many open file handles
    const batchSize = 100;
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (file) => {
            const filePath = path.join(projectRoot, file);
            try {
                const stats = await fs.promises.stat(filePath);
                if (!stats.isFile())
                    return null;
                const hash = await computeFileHash(filePath);
                return {
                    file,
                    record: {
                        hash,
                        lastScanned: timestamp,
                        size: stats.size,
                    },
                };
            }
            catch {
                return null;
            }
        }));
        for (const result of results) {
            if (result) {
                hashes[result.file] = result.record;
            }
        }
    }
    return hashes;
}
/**
 * Save file hashes to disk
 */
export async function saveHashes(hashes, config, projectRoot) {
    const cfg = config || getConfig();
    const root = projectRoot || process.cwd();
    ensureStorageDirectories(cfg, root);
    const navHashes = {
        version: '1.0',
        generatedAt: Date.now(),
        projectPath: root,
        files: hashes,
    };
    const hashesPath = getHashesPath(cfg, root);
    await atomicWriteJSON(hashesPath, navHashes);
}
/**
 * Load file hashes from disk
 */
export async function loadHashes(config, projectRoot) {
    const cfg = config || getConfig();
    const hashesPath = getHashesPath(cfg, projectRoot);
    if (!fs.existsSync(hashesPath)) {
        return null;
    }
    try {
        const content = await fs.promises.readFile(hashesPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Detect which files have changed since last scan
 */
export async function detectFileChanges(currentFiles, projectRoot, config) {
    const cfg = config || getConfig();
    const previousHashes = await loadHashes(cfg, projectRoot);
    const result = {
        added: [],
        modified: [],
        removed: [],
        unchanged: [],
    };
    // No previous scan - all files are new
    if (!previousHashes) {
        result.added = [...currentFiles];
        return result;
    }
    const previousFiles = new Set(Object.keys(previousHashes.files));
    // Check current files
    for (const file of currentFiles) {
        const filePath = path.join(projectRoot, file);
        if (!previousFiles.has(file)) {
            // New file
            result.added.push(file);
        }
        else {
            // File existed before - check if modified
            try {
                const currentHash = await computeFileHash(filePath);
                if (currentHash !== previousHashes.files[file].hash) {
                    result.modified.push(file);
                }
                else {
                    result.unchanged.push(file);
                }
            }
            catch {
                // Can't read file, treat as modified
                result.modified.push(file);
            }
            previousFiles.delete(file);
        }
    }
    // Remaining files in previousFiles were removed
    result.removed = Array.from(previousFiles);
    return result;
}
// =============================================================================
// ATOMIC WRITES (Run 1 — D1)
// =============================================================================
/**
 * Atomically write a string to disk. Writes to `<target>.tmp` first, then
 * renames over `<target>`. fs.rename is atomic on POSIX within the same
 * filesystem, so a crashed mid-write leaves the prior file intact.
 *
 * Use this for any file that must remain readable during/after a scan
 * (index.json, graph.json, file_map.json, NAVSUMMARY.md, hashes.json).
 */
export async function atomicWriteFile(target, content, encoding = 'utf-8') {
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(tmp, content, encoding);
    await fs.promises.rename(tmp, target);
}
/**
 * Atomically write a JSON-serializable value to disk (pretty-printed).
 */
export async function atomicWriteJSON(target, value) {
    await atomicWriteFile(target, JSON.stringify(value, null, 2), 'utf-8');
}
/**
 * Clear only the components and connections whose source files overlap
 * `changedPaths`. Used by incremental scans so we re-emit just the touched
 * subset and merge the rest by stable_id.
 *
 * - For components: a component is cleared if any of its `source.config_files`
 *   appears in `changedPaths`.
 * - For connections: a connection is cleared if its `code_reference.file`
 *   appears in `changedPaths`. (We do NOT delete based on the target's
 *   source files — that would over-clear.)
 *
 * Survivors stay on disk and get merged with new incoming data via
 * mergeByStableId.
 */
export async function clearForFiles(config, projectRoot, changedPaths) {
    const cfg = config || getConfig();
    const componentsPath = getComponentsPath(cfg, projectRoot);
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    let componentsCleared = 0;
    let connectionsCleared = 0;
    if (changedPaths.size === 0) {
        return { componentsCleared, connectionsCleared };
    }
    // Components: scan and delete those whose source.config_files overlap.
    if (fs.existsSync(componentsPath)) {
        const files = await fs.promises.readdir(componentsPath);
        await Promise.all(files.map(async (file) => {
            const fp = path.join(componentsPath, file);
            try {
                const content = await fs.promises.readFile(fp, 'utf-8');
                const c = JSON.parse(content);
                const sourceFiles = c.source?.config_files ?? [];
                for (const sf of sourceFiles) {
                    if (changedPaths.has(sf)) {
                        await fs.promises.unlink(fp).catch(() => { });
                        componentsCleared++;
                        return;
                    }
                }
            }
            catch {
                // Corrupt component file — leave alone; integrity check will catch it.
            }
        }));
    }
    // Connections: delete those whose origin file is in changedPaths.
    if (fs.existsSync(connectionsPath)) {
        const files = await fs.promises.readdir(connectionsPath);
        await Promise.all(files.map(async (file) => {
            const fp = path.join(connectionsPath, file);
            try {
                const content = await fs.promises.readFile(fp, 'utf-8');
                const c = JSON.parse(content);
                const refFile = c.code_reference?.file;
                if (refFile && changedPaths.has(refFile)) {
                    await fs.promises.unlink(fp).catch(() => { });
                    connectionsCleared++;
                }
            }
            catch {
                // Corrupt connection — leave alone.
            }
        }));
    }
    return { componentsCleared, connectionsCleared };
}
/**
 * Merge two arrays by stable_id, keeping the incoming entry on collision
 * (incoming wins because it's the freshly-scanned version of that entity).
 *
 * Generic over T because we use it for both components (keyed by stable_id)
 * and connections (keyed by composite from|to|type|file:line). Caller
 * supplies the key picker.
 */
export function mergeByStableId(existing, incoming, pickKey) {
    const merged = new Map();
    for (const e of existing) {
        const k = pickKey(e);
        if (k)
            merged.set(k, e);
    }
    for (const i of incoming) {
        const k = pickKey(i);
        if (k)
            merged.set(k, i); // incoming overwrites
    }
    return Array.from(merged.values());
}
/**
 * Load only the connections whose target component's source files include
 * any path in `changedFiles`. Returns the set of FROM-side source files —
 * i.e. files that import / depend on something in changedFiles.
 *
 * This is the reverse-dependency walk used by selectScanMode to widen the
 * incremental walk-set so changes to a leaf module re-scan the modules
 * that depend on it.
 *
 * Single-level only. Acceptable for Run 1; deeper transitivity is part of
 * Run 2's SQC audit layer.
 *
 * ALIASED IMPORTS (Run 1.6 — item #7 verify): connection target paths are
 * stored as RESOLVED, project-relative paths. The import scanner
 * (`src/scanners/connections/import-scanner.ts:resolveImport`) maps tsconfig
 * `paths` aliases (e.g. `@/utils/foo`) and `~/`-style aliases to actual file
 * paths (`src/utils/foo.ts`) before constructing the connection. This means
 * matching `changedFiles` against `code_reference.file` and the target
 * component's `source.config_files` is correct without alias-aware
 * normalization here. See `aliased-imports` test fixture for the regression
 * lock.
 *
 * RUN 1.6 — ITEM #8: This function now reads a derived
 * `.navgator/architecture/reverse-deps.json` index when present (single file
 * open per scan). Falls back to the per-edge JSON walk if the index file is
 * missing, corrupt, or schema-mismatched.
 */
export async function loadReverseDeps(changedFiles, config, projectRoot) {
    const cfg = config || getConfig();
    const out = new Set();
    if (changedFiles.size === 0)
        return out;
    // Run 1.6 — item #8 fast path: read the derived reverse-deps.json index if
    // present. Single file open vs O(connections) opens.
    const indexPath = path.join(getStoragePath(cfg, projectRoot), 'reverse-deps.json');
    if (fs.existsSync(indexPath)) {
        try {
            const raw = await fs.promises.readFile(indexPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.schema_version === '1.0.0' && parsed.edges) {
                for (const f of changedFiles) {
                    const importers = parsed.edges[f];
                    if (importers) {
                        for (const imp of importers)
                            out.add(imp);
                    }
                }
                return out;
            }
            // Bad shape → fall through to legacy walk.
        }
        catch {
            // Corrupt or unreadable → fall through to legacy walk.
        }
    }
    return loadReverseDepsLegacy(changedFiles, config, projectRoot);
}
/**
 * Legacy reverse-deps walk: opens every per-edge connection JSON. Retained
 * as the fallback when `reverse-deps.json` is missing, corrupt, or
 * schema-mismatched. Also useful as the regression baseline for the index.
 */
export async function loadReverseDepsLegacy(changedFiles, config, projectRoot) {
    const cfg = config || getConfig();
    const connectionsPath = getConnectionsPath(cfg, projectRoot);
    const componentsPath = getComponentsPath(cfg, projectRoot);
    const out = new Set();
    if (changedFiles.size === 0)
        return out;
    if (!fs.existsSync(connectionsPath) || !fs.existsSync(componentsPath)) {
        return out;
    }
    // Build component_id → source files map once (all on-disk components).
    const compSourceFiles = new Map();
    const compFiles = await fs.promises.readdir(componentsPath);
    await Promise.all(compFiles.map(async (file) => {
        try {
            const content = await fs.promises.readFile(path.join(componentsPath, file), 'utf-8');
            const c = JSON.parse(content);
            compSourceFiles.set(c.component_id, c.source?.config_files ?? []);
        }
        catch {
            // Corrupt component — ignore.
        }
    }));
    // Walk connections; if target's component has a source_file in changedFiles,
    // the FROM-side code_reference.file goes into the walk-set.
    const connFiles = await fs.promises.readdir(connectionsPath);
    await Promise.all(connFiles.map(async (file) => {
        try {
            const content = await fs.promises.readFile(path.join(connectionsPath, file), 'utf-8');
            const c = JSON.parse(content);
            const targetId = c.to?.component_id;
            if (!targetId)
                return;
            const targetSources = compSourceFiles.get(targetId) ?? [];
            const targetMatches = targetSources.some((sf) => changedFiles.has(sf));
            // Also cover the case where to.component_id IS a FILE: ref.
            const directFile = targetId.startsWith('FILE:') ? targetId.slice(5) : undefined;
            const directMatch = directFile ? changedFiles.has(directFile) : false;
            if (targetMatches || directMatch) {
                const fromFile = c.code_reference?.file;
                if (fromFile)
                    out.add(fromFile);
            }
        }
        catch {
            // Corrupt connection — ignore.
        }
    }));
    return out;
}
/**
 * Build and atomically write `.navgator/architecture/reverse-deps.json` from
 * the in-memory connection set + components. This avoids re-walking per-edge
 * JSON files on the next incremental scan.
 *
 * Run 1.6 — item #8: HEADLINE PERF WIN. On atomize-ai's 4,570 connections,
 * this drops `loadReverseDeps` from ~4,570 file opens to 1.
 */
export async function buildReverseDepsIndex(components, connections, config, projectRoot) {
    const cfg = config || getConfig();
    const indexPath = path.join(getStoragePath(cfg, projectRoot), 'reverse-deps.json');
    // component_id → source files map (in-memory, no I/O).
    const compSourceFiles = new Map();
    for (const c of components) {
        compSourceFiles.set(c.component_id, c.source?.config_files ?? []);
    }
    // Build edges: target_file → list of source files that import/reference it.
    const edges = {};
    let edgeCount = 0;
    for (const c of connections) {
        const fromFile = c.code_reference?.file;
        if (!fromFile)
            continue;
        const targetId = c.to?.component_id;
        if (!targetId)
            continue;
        // Resolve target file(s) — same logic as loadReverseDepsLegacy.
        const targetFiles = new Set();
        const targetSources = compSourceFiles.get(targetId) ?? [];
        for (const sf of targetSources)
            targetFiles.add(sf);
        if (targetId.startsWith('FILE:'))
            targetFiles.add(targetId.slice(5));
        // Also use to.location.file when present (e.g. import-scanner stores resolved path here).
        const locFile = c.to?.location?.file;
        if (locFile)
            targetFiles.add(locFile);
        for (const tf of targetFiles) {
            if (tf === fromFile)
                continue; // Skip self-edges
            if (!edges[tf])
                edges[tf] = new Set();
            if (!edges[tf].has(fromFile)) {
                edges[tf].add(fromFile);
                edgeCount += 1;
            }
        }
    }
    // Sets → arrays for JSON.
    const edgesOut = {};
    for (const [target, importers] of Object.entries(edges)) {
        edgesOut[target] = Array.from(importers).sort();
    }
    const payload = {
        schema_version: '1.0.0',
        generated_at: Date.now(),
        edges: edgesOut,
    };
    await atomicWriteJSON(indexPath, payload);
    return { path: indexPath, edge_count: edgeCount };
}
/**
 * Atomically write `.navgator/architecture/manifest.json` describing the
 * derived artifacts NavGator just emitted. Best-effort — the scan succeeds
 * even if this fails.
 */
export async function buildDerivedManifest(config, projectRoot, details) {
    const cfg = config || getConfig();
    const storeDir = getStoragePath(cfg, projectRoot);
    const manifestPath = path.join(storeDir, 'manifest.json');
    const now = Date.now();
    const files = {};
    const candidates = [
        { name: 'index.json' },
        { name: 'graph.json' },
        { name: 'file_map.json' },
        { name: 'reverse-deps.json', source_count: details.reverseDepsEdgeCount },
    ];
    for (const cand of candidates) {
        const full = path.join(storeDir, cand.name);
        try {
            const stat = await fs.promises.stat(full);
            files[cand.name] = {
                generated_at: stat.mtimeMs,
                ...(cand.source_count !== undefined ? { source_count: cand.source_count } : {}),
            };
        }
        catch {
            // File doesn't exist — skip silently.
        }
    }
    const payload = {
        schema_version: '1.0.0',
        generated_at: now,
        files,
    };
    await atomicWriteJSON(manifestPath, payload);
    return { path: manifestPath };
}
/**
 * Run an integrity check on the post-merge state.
 * - Every connection endpoint (from + to component_id) must exist in
 *   the components set, OR be a FILE:-prefixed unresolved ref.
 * - Every component's source.config_files must exist on disk
 *   (relative to projectRoot). Missing files → orphan component.
 * - Optional walkSet narrows the source-file existence check to
 *   files in the walk-set; full-scan callers pass an empty set
 *   (means "check all").
 *
 * Returns ok=false on any failure with a list of issue strings.
 * Caller is expected to log scan_type='incremental→full' and
 * fall through to a full scan on failure.
 */
export async function runIntegrityCheck(components, connections, projectRoot, walkSet = new Set()) {
    const issues = [];
    // 1. Every connection endpoint must exist (or be FILE:).
    const ids = new Set(components.map((c) => c.component_id));
    for (const c of connections) {
        const fromId = c.from?.component_id;
        const toId = c.to?.component_id;
        if (fromId && !fromId.startsWith('FILE:') && !ids.has(fromId)) {
            issues.push(`connection ${c.connection_id}: missing FROM component ${fromId}`);
        }
        if (toId && !toId.startsWith('FILE:') && !ids.has(toId)) {
            issues.push(`connection ${c.connection_id}: missing TO component ${toId}`);
        }
    }
    // 2. Every component's source.config_files must exist on disk.
    //    If walkSet is non-empty, only check files in the walk-set
    //    (we trust the rest from the prior scan).
    for (const comp of components) {
        const sourceFiles = comp.source?.config_files ?? [];
        for (const sf of sourceFiles) {
            if (walkSet.size > 0 && !walkSet.has(sf))
                continue;
            try {
                await fs.promises.access(path.join(projectRoot, sf));
            }
            catch {
                issues.push(`component ${comp.component_id} (${comp.name}): missing source file ${sf}`);
            }
        }
    }
    return { ok: issues.length === 0, issues };
}
/**
 * Get a summary of file changes for display
 */
export function formatFileChangeSummary(changes) {
    const parts = [];
    if (changes.added.length > 0) {
        parts.push(`${changes.added.length} added`);
    }
    if (changes.modified.length > 0) {
        parts.push(`${changes.modified.length} modified`);
    }
    if (changes.removed.length > 0) {
        parts.push(`${changes.removed.length} removed`);
    }
    if (parts.length === 0) {
        return 'No files changed';
    }
    return parts.join(', ');
}
//# sourceMappingURL=storage.js.map