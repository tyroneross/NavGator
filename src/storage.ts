/**
 * NavGator Storage System
 * File-based persistence for components and connections
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ArchitectureIndex,
  ConnectionGraph,
  NavGatorConfig,
  ComponentType,
  ConnectionType,
  ArchitectureLayer,
  ComponentStatus,
  GraphNode,
  GraphEdge,
  NavHashes,
  FileHashRecord,
  FileChangeResult,
  TimelineEntry,
  GitInfo,
} from './types.js';
import {
  getConfig,
  getComponentsPath,
  getConnectionsPath,
  getIndexPath,
  getGraphPath,
  getSnapshotsPath,
  getHashesPath,
  getSummaryPath,
  getSummaryFullPath,
  getFileMapPath,
  getPromptsPath,
  ensureStorageDirectories,
  isValidComponentId,
  isValidConnectionId,
  SCHEMA_VERSION,
} from './config.js';

// =============================================================================
// COMPONENT STORAGE
// =============================================================================

/**
 * Store a component to disk
 */
export async function storeComponent(
  component: ArchitectureComponent,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<{ component_id: string; file_path: string }> {
  const cfg = config || getConfig();
  ensureStorageDirectories(cfg, projectRoot);

  const componentsPath = getComponentsPath(cfg, projectRoot);
  const filePath = path.join(componentsPath, `${component.component_id}.json`);

  await fs.promises.writeFile(filePath, JSON.stringify(component, null, 2), 'utf-8');

  return {
    component_id: component.component_id,
    file_path: filePath,
  };
}

/**
 * Load a component by ID
 */
export async function loadComponent(
  componentId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<ArchitectureComponent | null> {
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
    return JSON.parse(content) as ArchitectureComponent;
  } catch {
    return null;
  }
}

/**
 * Load all components (parallelized for efficiency)
 */
export async function loadAllComponents(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<ArchitectureComponent[]> {
  const cfg = config || getConfig();
  const componentsPath = getComponentsPath(cfg, projectRoot);

  if (!fs.existsSync(componentsPath)) {
    return [];
  }

  const files = await fs.promises.readdir(componentsPath);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  // Parallelize reads
  const results = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const filePath = path.join(componentsPath, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(content) as ArchitectureComponent;
      } catch {
        return null;
      }
    })
  );

  return results.filter((c): c is ArchitectureComponent => c !== null);
}

/**
 * Delete a component by ID
 */
export async function deleteComponent(
  componentId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<boolean> {
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
export async function storeConnection(
  connection: ArchitectureConnection,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<{ connection_id: string; file_path: string }> {
  const cfg = config || getConfig();
  ensureStorageDirectories(cfg, projectRoot);

  const connectionsPath = getConnectionsPath(cfg, projectRoot);
  const filePath = path.join(connectionsPath, `${connection.connection_id}.json`);

  await fs.promises.writeFile(filePath, JSON.stringify(connection, null, 2), 'utf-8');

  return {
    connection_id: connection.connection_id,
    file_path: filePath,
  };
}

/**
 * Load a connection by ID
 */
export async function loadConnection(
  connectionId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<ArchitectureConnection | null> {
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
    return JSON.parse(content) as ArchitectureConnection;
  } catch {
    return null;
  }
}

/**
 * Load all connections (parallelized for efficiency)
 */
export async function loadAllConnections(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<ArchitectureConnection[]> {
  const cfg = config || getConfig();
  const connectionsPath = getConnectionsPath(cfg, projectRoot);

  if (!fs.existsSync(connectionsPath)) {
    return [];
  }

  const files = await fs.promises.readdir(connectionsPath);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  // Parallelize reads
  const results = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const filePath = path.join(connectionsPath, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(content) as ArchitectureConnection;
      } catch {
        return null;
      }
    })
  );

  return results.filter((c): c is ArchitectureConnection => c !== null);
}

/**
 * Delete a connection by ID
 */
export async function deleteConnection(
  connectionId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<boolean> {
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
export async function buildIndex(
  config?: NavGatorConfig,
  projectRoot?: string,
  projectMetadata?: Partial<import('./types.js').ProjectMetadata>
): Promise<ArchitectureIndex> {
  const cfg = config || getConfig();
  const components = await loadAllComponents(cfg, projectRoot);
  const connections = await loadAllConnections(cfg, projectRoot);

  const index: ArchitectureIndex = {
    schema_version: SCHEMA_VERSION,
    version: '1.0.0',
    last_scan: Date.now(),
    project_path: projectRoot || process.cwd(),

    components: {
      by_name: {},
      by_type: {} as Record<ComponentType, string[]>,
      by_layer: {} as Record<ArchitectureLayer, string[]>,
      by_status: {} as Record<ComponentStatus, string[]>,
    },

    connections: {
      by_type: {} as Record<ConnectionType, string[]>,
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
    index.project = projectMetadata as import('./types.js').ProjectMetadata;
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

    if (component.status === 'outdated') index.stats.outdated_count++;
    if (component.status === 'vulnerable') index.stats.vulnerable_count++;
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

  // Save index
  const indexPath = getIndexPath(cfg, projectRoot);
  await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  return index;
}

/**
 * Load the index
 */
export async function loadIndex(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<ArchitectureIndex | null> {
  const cfg = config || getConfig();
  const indexPath = getIndexPath(cfg, projectRoot);

  if (!fs.existsSync(indexPath)) {
    return null;
  }

  try {
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    return JSON.parse(content) as ArchitectureIndex;
  } catch {
    return null;
  }
}

// =============================================================================
// GRAPH BUILDING
// =============================================================================

/**
 * Build the connection graph
 */
export async function buildGraph(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<ConnectionGraph> {
  const cfg = config || getConfig();
  const components = await loadAllComponents(cfg, projectRoot);
  const connections = await loadAllConnections(cfg, projectRoot);

  const nodes: GraphNode[] = components.map((c) => ({
    id: c.component_id,
    name: c.name,
    type: c.type,
    layer: c.role.layer,
  }));

  const edges: GraphEdge[] = connections.map((c) => ({
    id: c.connection_id,
    source: c.from.component_id,
    target: c.to.component_id,
    type: c.connection_type,
    label: c.description,
  }));

  const graph: ConnectionGraph = {
    schema_version: SCHEMA_VERSION,
    nodes,
    edges,
    metadata: {
      generated_at: Date.now(),
      component_count: nodes.length,
      connection_count: edges.length,
    },
  };

  // Save graph
  const graphPath = getGraphPath(cfg, projectRoot);
  await fs.promises.writeFile(graphPath, JSON.stringify(graph, null, 2), 'utf-8');

  return graph;
}

// =============================================================================
// FILE MAP (Tier 2 - O(1) file-to-component lookup)
// =============================================================================

/**
 * Build a map of file paths → component IDs for fast lookup in hooks.
 * Sources: component config_files + connection code_reference files + connection locations.
 */
export async function buildFileMap(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<Record<string, string>> {
  const cfg = config || getConfig();
  const root = projectRoot || process.cwd();
  const components = await loadAllComponents(cfg, root);
  const connections = await loadAllConnections(cfg, root);

  const fileMap: Record<string, string> = {};

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
  await fs.promises.writeFile(fileMapPath, JSON.stringify(wrapped, null, 2), 'utf-8');

  return fileMap;
}

/**
 * Load the file map (file path → component ID)
 */
export async function loadFileMap(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<Record<string, string>> {
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
  } catch {
    return {};
  }
}

// =============================================================================
// PROMPT STORAGE (Tier 2 - Full prompt content for on-demand loading)
// =============================================================================

/**
 * Save prompt scan results to prompts.json
 */
export async function savePromptScan(
  promptData: unknown,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<void> {
  const cfg = config || getConfig();
  const root = projectRoot || process.cwd();
  ensureStorageDirectories(cfg, root);
  const promptsPath = getPromptsPath(cfg, root);

  // Spread schema_version into prompt output
  const output = typeof promptData === 'object' && promptData !== null
    ? { schema_version: SCHEMA_VERSION, ...(promptData as Record<string, unknown>) }
    : promptData;

  await fs.promises.writeFile(promptsPath, JSON.stringify(output, null, 2), 'utf-8');
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
export async function buildSummary(
  config?: NavGatorConfig,
  projectRoot?: string,
  promptScan?: { prompts: Array<{ name: string; location: { file: string; lineStart: number }; provider?: { provider: string; model?: string }; category?: string; messages: Array<{ role: string; content: string }> }>; summary: { totalPrompts: number } },
  projectMetadata?: Partial<import('./types.js').ProjectMetadata>,
  latestDiff?: TimelineEntry,
  gitInfo?: GitInfo
): Promise<string> {
  const cfg = config || getConfig();
  const root = projectRoot || process.cwd();
  const components = await loadAllComponents(cfg, root);
  const connections = await loadAllConnections(cfg, root);

  const now = new Date().toISOString();
  const aiComponents = components.filter(
    (c) => AI_PROVIDER_NAMES.has(c.name) || c.type === 'llm' || c.type === 'service'
  );

  // Group components by layer
  const byLayer = new Map<string, typeof components>();
  for (const c of components) {
    const layer = c.role.layer;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(c);
  }

  // Build markdown
  const lines: string[] = [];
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
    if (!group || group.length === 0) continue;
    lines.push(`### ${layer.charAt(0).toUpperCase() + layer.slice(1)} (${group.length})`);
    for (const c of group) {
      const ver = c.version ? ` v${c.version}` : '';
      lines.push(`- **${c.name}**${ver} — ${c.role.purpose} \`components/${c.component_id}.json\``);
    }
    lines.push('');
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

  // Delta — use structured diff from timeline if available, else fall back to naive comparison
  const summaryPath = getSummaryPath(cfg, root);
  if (latestDiff && latestDiff.diff.stats.total_changes > 0) {
    const { formatDiffForSummary } = await import('./diff.js');
    const diffLines = formatDiffForSummary(latestDiff);
    lines.push(...diffLines);
  } else if (!latestDiff) {
    // Fallback: naive text-based delta for backwards compatibility (no timeline entry provided)
    if (fs.existsSync(summaryPath)) {
      try {
        const prev = await fs.promises.readFile(summaryPath, 'utf-8');
        const prevNames = new Set<string>();
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
      } catch {
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
    // Write full version to SUMMARY_FULL.md
    const fullPath = getSummaryFullPath(cfg, root);
    await fs.promises.writeFile(fullPath, fullContent, 'utf-8');

    // Build compressed version: top 10 per layer, AI routing, top 10 connections
    const compressed: string[] = [];
    compressed.push('# Architecture Summary (Compressed)');
    compressed.push('');
    compressed.push('> **This is a compressed summary.** Full version: `SUMMARY_FULL.md`');
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
        if (!group || group.length === 0) continue;
        compressed.push(`### ${layer.charAt(0).toUpperCase() + layer.slice(1)} (${group.length})`);
        const top = group.slice(0, 10);
        for (const c of top) {
          const ver = c.version ? ` v${c.version}` : '';
          compressed.push(`- **${c.name}**${ver} — ${c.role.purpose} \`components/${c.component_id}.json\``);
        }
        if (group.length > 10) {
          compressed.push(`- ... and ${group.length - 10} more (see SUMMARY_FULL.md)`);
        }
        compressed.push('');
      }
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
        compressed.push(`| ... | | | ${aiConnections.length - 10} more (see SUMMARY_FULL.md) | |`);
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
    compressed.push('- **Full summary**: `SUMMARY_FULL.md`');
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
export async function loadGraph(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<ConnectionGraph | null> {
  const cfg = config || getConfig();
  const graphPath = getGraphPath(cfg, projectRoot);

  if (!fs.existsSync(graphPath)) {
    return null;
  }

  try {
    const content = await fs.promises.readFile(graphPath, 'utf-8');
    return JSON.parse(content) as ConnectionGraph;
  } catch {
    return null;
  }
}

// =============================================================================
// SNAPSHOTS
// =============================================================================

/**
 * Create a snapshot of current architecture
 */
export async function createSnapshot(
  reason?: string,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<{ snapshot_id: string; file_path: string }> {
  const cfg = config || getConfig();
  ensureStorageDirectories(cfg, projectRoot);

  const components = await loadAllComponents(cfg, projectRoot);
  const connections = await loadAllConnections(cfg, projectRoot);

  // Build component_id → name lookup for connection name resolution
  const componentIdToName = new Map<string, string>();
  for (const c of components) {
    componentIdToName.set(c.component_id, c.name);
  }

  const timestamp = Date.now();
  const snapshotId = `SNAP_${new Date(timestamp).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;

  const snapshot = {
    snapshot_id: snapshotId,
    snapshot_version: '2.0' as const,
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
export async function storeComponents(
  components: ArchitectureComponent[],
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<void> {
  const cfg = config || getConfig();
  ensureStorageDirectories(cfg, projectRoot);
  const componentsPath = getComponentsPath(cfg, projectRoot);

  // Parallelize writes in batches to avoid overwhelming the filesystem
  const batchSize = 50;
  for (let i = 0; i < components.length; i += batchSize) {
    const batch = components.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (component) => {
        const filePath = path.join(componentsPath, `${component.component_id}.json`);
        await fs.promises.writeFile(filePath, JSON.stringify(component, null, 2), 'utf-8');
      })
    );
  }
}

/**
 * Store multiple connections at once (parallelized for efficiency)
 */
export async function storeConnections(
  connections: ArchitectureConnection[],
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<void> {
  const cfg = config || getConfig();
  ensureStorageDirectories(cfg, projectRoot);
  const connectionsPath = getConnectionsPath(cfg, projectRoot);

  // Parallelize writes in batches to avoid overwhelming the filesystem
  const batchSize = 50;
  for (let i = 0; i < connections.length; i += batchSize) {
    const batch = connections.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (connection) => {
        const filePath = path.join(connectionsPath, `${connection.connection_id}.json`);
        await fs.promises.writeFile(filePath, JSON.stringify(connection, null, 2), 'utf-8');
      })
    );
  }
}

/**
 * Clear all stored data (parallelized for efficiency)
 */
export async function clearStorage(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<void> {
  const cfg = config || getConfig();

  const componentsPath = getComponentsPath(cfg, projectRoot);
  const connectionsPath = getConnectionsPath(cfg, projectRoot);
  const indexPath = getIndexPath(cfg, projectRoot);
  const graphPath = getGraphPath(cfg, projectRoot);

  const deletePromises: Promise<void>[] = [];

  // Delete all component files
  if (fs.existsSync(componentsPath)) {
    const componentFiles = await fs.promises.readdir(componentsPath);
    deletePromises.push(
      ...componentFiles.map((file) =>
        fs.promises.unlink(path.join(componentsPath, file)).catch(() => {})
      )
    );
  }

  // Delete all connection files
  if (fs.existsSync(connectionsPath)) {
    const connectionFiles = await fs.promises.readdir(connectionsPath);
    deletePromises.push(
      ...connectionFiles.map((file) =>
        fs.promises.unlink(path.join(connectionsPath, file)).catch(() => {})
      )
    );
  }

  // Delete index and graph
  if (fs.existsSync(indexPath)) {
    deletePromises.push(fs.promises.unlink(indexPath).catch(() => {}));
  }
  if (fs.existsSync(graphPath)) {
    deletePromises.push(fs.promises.unlink(graphPath).catch(() => {}));
  }

  await Promise.all(deletePromises);
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Get storage statistics
 */
export async function getStorageStats(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<{
  total_components: number;
  total_connections: number;
  disk_usage_kb: number;
  oldest_timestamp: number | null;
  newest_timestamp: number | null;
}> {
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
export async function computeFileHash(filePath: string): Promise<string> {
  const content = await fs.promises.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compute hashes for multiple files (parallelized in batches for efficiency)
 */
export async function computeFileHashes(
  files: string[],
  projectRoot: string
): Promise<Record<string, FileHashRecord>> {
  const hashes: Record<string, FileHashRecord> = {};
  const timestamp = Date.now();

  // Process in batches to avoid too many open file handles
  const batchSize = 100;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (file) => {
        const filePath = path.join(projectRoot, file);
        try {
          const stats = await fs.promises.stat(filePath);
          if (!stats.isFile()) return null;
          const hash = await computeFileHash(filePath);
          return {
            file,
            record: {
              hash,
              lastScanned: timestamp,
              size: stats.size,
            },
          };
        } catch {
          return null;
        }
      })
    );

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
export async function saveHashes(
  hashes: Record<string, FileHashRecord>,
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<void> {
  const cfg = config || getConfig();
  const root = projectRoot || process.cwd();
  ensureStorageDirectories(cfg, root);

  const navHashes: NavHashes = {
    version: '1.0',
    generatedAt: Date.now(),
    projectPath: root,
    files: hashes,
  };

  const hashesPath = getHashesPath(cfg, root);
  await fs.promises.writeFile(hashesPath, JSON.stringify(navHashes, null, 2), 'utf-8');
}

/**
 * Load file hashes from disk
 */
export async function loadHashes(
  config?: NavGatorConfig,
  projectRoot?: string
): Promise<NavHashes | null> {
  const cfg = config || getConfig();
  const hashesPath = getHashesPath(cfg, projectRoot);

  if (!fs.existsSync(hashesPath)) {
    return null;
  }

  try {
    const content = await fs.promises.readFile(hashesPath, 'utf-8');
    return JSON.parse(content) as NavHashes;
  } catch {
    return null;
  }
}

/**
 * Detect which files have changed since last scan
 */
export async function detectFileChanges(
  currentFiles: string[],
  projectRoot: string,
  config?: NavGatorConfig
): Promise<FileChangeResult> {
  const cfg = config || getConfig();
  const previousHashes = await loadHashes(cfg, projectRoot);

  const result: FileChangeResult = {
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
    } else {
      // File existed before - check if modified
      try {
        const currentHash = await computeFileHash(filePath);
        if (currentHash !== previousHashes.files[file].hash) {
          result.modified.push(file);
        } else {
          result.unchanged.push(file);
        }
      } catch {
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

/**
 * Get a summary of file changes for display
 */
export function formatFileChangeSummary(changes: FileChangeResult): string {
  const parts: string[] = [];

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
