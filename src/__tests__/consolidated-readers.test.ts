/**
 * R6 consolidated-readers regression — with per-entity files off (the new
 * default), the rest of NavGator (MCP tools, CLI commands, audit) MUST
 * still be able to read full ArchitectureComponent/Connection objects.
 *
 * The bug this locks down: without these fallbacks, the first atomize-ai
 * end-to-end validation produced an `index.json` with `total_components: 0`
 * and `graph.json` with 0 nodes — even though the in-memory scan saw
 * 2,471 components. `buildIndex` / `buildGraph` / `buildFileMap` were
 * implicitly going through `loadAllComponents` which read per-entity files.
 *
 * The fix has two prongs:
 *  1. `buildIndex` / `buildGraph` / `buildFileMap` / `buildSummary` accept
 *     an in-memory `data` parameter so the scanner can hand them the
 *     final state directly.
 *  2. `loadAllComponents` / `loadAllConnections` fall back to
 *     `components.full.jsonl` / `connections.full.jsonl` when the
 *     per-entity dirs are missing or empty.
 *
 * These tests cover both prongs in isolation.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildIndex,
  buildGraph,
  buildFileMap,
  loadAllComponents,
  loadAllConnections,
  loadIndex,
} from '../storage.js';
import {
  writeFullComponentsJsonl,
  writeFullConnectionsJsonl,
} from '../storage/markdown-view.js';
import {
  getStoragePath,
  getComponentsPath,
  ensureStorageDirectories,
} from '../config.js';
import { createComponent, createConnection } from './helpers.js';
import type { NavGatorConfig, ArchitectureComponent, ArchitectureConnection } from '../types.js';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-r6-cons-'));
}

function cfg(perEntityFiles = false): NavGatorConfig {
  return {
    storageMode: 'local',
    storagePath: '.navgator/architecture',
    autoScan: false,
    healthCheckEnabled: false,
    scanDepth: 'shallow',
    defaultConfidenceThreshold: 0.6,
    maxResultsPerQuery: 20,
    perEntityFiles,
  };
}

function fixture(): { components: ArchitectureComponent[]; connections: ArchitectureConnection[] } {
  const a = createComponent({ name: 'core/a', type: 'component', file: 'src/a.ts' });
  const b = createComponent({ name: 'core/b', type: 'component', file: 'src/b.ts' });
  const c = createComponent({ name: 'core/c', type: 'component', file: 'src/c.ts' });
  return {
    components: [a, b, c],
    connections: [
      createConnection(a, b, { connection_type: 'imports' }),
      createConnection(b, c, { connection_type: 'imports' }),
    ],
  };
}

describe('R6 — derived builders accept in-memory data', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('buildIndex with data param does NOT touch per-entity dirs', async () => {
    const config = cfg(false);
    ensureStorageDirectories(config, root);
    const { components, connections } = fixture();

    const index = await buildIndex(config, root, undefined, { components, connections });

    expect(index.stats.total_components).toBe(3);
    expect(index.stats.total_connections).toBe(2);
    // The components/ dir was not pre-created (R6 ensureStorageDirectories gate).
    expect(fs.existsSync(getComponentsPath(config, root))).toBe(false);
  });

  it('buildGraph with data param produces correct nodes/edges from memory', async () => {
    const config = cfg(false);
    const { components, connections } = fixture();

    const graph = await buildGraph(config, root, { components, connections });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.metadata?.component_count).toBe(3);
  });

  it('buildFileMap with data param maps every component file', async () => {
    const config = cfg(false);
    const { components, connections } = fixture();

    const fileMap = await buildFileMap(config, root, { components, connections });

    expect(Object.keys(fileMap)).toContain('src/a.ts');
    expect(Object.keys(fileMap)).toContain('src/b.ts');
    expect(Object.keys(fileMap)).toContain('src/c.ts');
  });
});

describe('R6 — loadAll* fall back to *.full.jsonl', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('loadAllComponents reads components.full.jsonl when components/ is absent', async () => {
    const config = cfg(false);
    const storeDir = getStoragePath(config, root);
    fs.mkdirSync(storeDir, { recursive: true });
    const { components } = fixture();

    await writeFullComponentsJsonl(storeDir, components);

    const loaded = await loadAllComponents(config, root);
    expect(loaded).toHaveLength(3);
    const names = loaded.map((c) => c.name).sort();
    expect(names).toEqual(['core/a', 'core/b', 'core/c']);
    // Component shape is preserved — config_files, role, etc.
    expect(loaded[0].role.layer).toBeTruthy();
    expect(loaded[0].source.config_files).toBeTruthy();
  });

  it('loadAllConnections reads connections.full.jsonl when connections/ is absent', async () => {
    const config = cfg(false);
    const storeDir = getStoragePath(config, root);
    fs.mkdirSync(storeDir, { recursive: true });
    const { connections } = fixture();

    await writeFullConnectionsJsonl(storeDir, connections);

    const loaded = await loadAllConnections(config, root);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].connection_type).toBe('imports');
  });

  it('per-entity dir wins over jsonl fallback when both exist (back-compat)', async () => {
    const config = cfg(true); // opted in — writers create per-entity files
    const storeDir = getStoragePath(config, root);
    fs.mkdirSync(storeDir, { recursive: true });
    const { components, connections } = fixture();

    // Seed BOTH: per-entity files via scanner-equivalent, and full jsonl.
    const { storeComponents, storeConnections } = await import('../storage.js');
    await storeComponents(components, config, root);
    await storeConnections(connections, config, root);
    // Pretend an older full jsonl exists with stale data — single record only.
    await writeFullComponentsJsonl(storeDir, components.slice(0, 1));
    await writeFullConnectionsJsonl(storeDir, connections.slice(0, 1));

    // Per-entity wins — full 3 + 2 returned.
    const comps = await loadAllComponents(config, root);
    const conns = await loadAllConnections(config, root);
    expect(comps).toHaveLength(3);
    expect(conns).toHaveLength(2);
  });

  it('returns [] when neither per-entity dir nor jsonl exists', async () => {
    const config = cfg(false);
    expect(await loadAllComponents(config, root)).toEqual([]);
    expect(await loadAllConnections(config, root)).toEqual([]);
  });
});

describe('R6 — end-to-end: index.json reflects in-memory data when per-entity off', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('written index.json carries correct totals and round-trips through loadIndex', async () => {
    const config = cfg(false);
    const { components, connections } = fixture();
    ensureStorageDirectories(config, root);

    await buildIndex(config, root, undefined, { components, connections });

    const loaded = await loadIndex(config, root);
    expect(loaded).not.toBeNull();
    expect(loaded?.stats.total_components).toBe(3);
    expect(loaded?.stats.total_connections).toBe(2);
  });
});
