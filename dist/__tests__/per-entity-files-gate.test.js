/**
 * R6 footprint fix — per-entity files are opt-in and the migration that
 * removes legacy per-entity files is idempotent + safe.
 *
 * Without the fix, every scan on atomize-ai (2,475 components +
 * 6,737 connections) wrote ~9,200 JSON files into `components/` and
 * `connections/`, totalling ~70MB on disk. The consolidated `graph.json`,
 * `index.json`, `connections.jsonl`, and `reverse-deps.json` carry the
 * same information.
 *
 * These tests lock the invariants the fix promises:
 *   1. Default config (perEntityFiles=false) → storeComponents +
 *      storeConnections write NOTHING to disk.
 *   2. Opt-in (perEntityFiles=true) → both writers behave the legacy way.
 *   3. migratePerEntityFiles deletes any legacy per-entity *.json files
 *      and the now-empty dirs, WITHOUT touching consolidated files in the
 *      same storage root.
 *   4. migratePerEntityFiles is idempotent (running it twice is fine).
 *   5. migratePerEntityFiles is a no-op when perEntityFiles=true.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { storeComponents, storeConnections, migratePerEntityFiles, } from '../storage.js';
import { getComponentsPath, getConnectionsPath, getStoragePath, } from '../config.js';
import { createComponent, createConnection } from './helpers.js';
function tmpProjectRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-r6-'));
}
function baseConfig(perEntityFiles) {
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
function listJsonFiles(dir) {
    if (!fs.existsSync(dir))
        return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
}
describe('R6 — per-entity files gate', () => {
    let root;
    beforeEach(() => {
        root = tmpProjectRoot();
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });
    it('does NOT write per-entity files when perEntityFiles=false (default)', async () => {
        const cfg = baseConfig(false);
        const components = [
            createComponent({ name: 'core/a', type: 'component', file: 'src/a.ts' }),
            createComponent({ name: 'core/b', type: 'component', file: 'src/b.ts' }),
        ];
        const connections = [
            createConnection(components[0], components[1], { connection_type: 'imports' }),
        ];
        await storeComponents(components, cfg, root);
        await storeConnections(connections, cfg, root);
        expect(fs.existsSync(getComponentsPath(cfg, root))).toBe(false);
        expect(fs.existsSync(getConnectionsPath(cfg, root))).toBe(false);
    });
    it('stamps stable IDs onto components even when not writing files', async () => {
        // ensureStableId is what graph.json + file_map.json rely on. We must
        // never short-circuit it on the "skip writes" path.
        const cfg = baseConfig(false);
        const comp = createComponent({ name: 'core/a', type: 'component', file: 'src/a.ts' });
        const idBefore = comp.component_id;
        await storeComponents([comp], cfg, root);
        expect(comp.component_id).toBeTruthy();
        expect(typeof comp.component_id).toBe('string');
        // ID may be regenerated/stabilized — that's fine. Important: it exists
        // and is a non-empty string after the call.
        expect(comp.component_id.length).toBeGreaterThan(0);
        // helpers default to a deterministic ID, so the function shouldn't blank it.
        expect(comp.component_id).toBe(idBefore);
    });
    it('writes per-entity files when perEntityFiles=true (opt-in)', async () => {
        const cfg = baseConfig(true);
        const components = [
            createComponent({ name: 'core/a', type: 'component', file: 'src/a.ts' }),
            createComponent({ name: 'core/b', type: 'component', file: 'src/b.ts' }),
        ];
        const connections = [
            createConnection(components[0], components[1], { connection_type: 'imports' }),
        ];
        await storeComponents(components, cfg, root);
        await storeConnections(connections, cfg, root);
        expect(listJsonFiles(getComponentsPath(cfg, root))).toHaveLength(2);
        expect(listJsonFiles(getConnectionsPath(cfg, root))).toHaveLength(1);
    });
    it('migratePerEntityFiles removes legacy *.json files + empty dirs (perEntityFiles=false)', async () => {
        // Seed legacy files as if a pre-R6 scan had run.
        const cfg = baseConfig(false);
        const compsDir = getComponentsPath(cfg, root);
        const connsDir = getConnectionsPath(cfg, root);
        fs.mkdirSync(compsDir, { recursive: true });
        fs.mkdirSync(connsDir, { recursive: true });
        fs.writeFileSync(path.join(compsDir, 'COMP_x.json'), '{}');
        fs.writeFileSync(path.join(compsDir, 'COMP_y.json'), '{}');
        fs.writeFileSync(path.join(connsDir, 'CONN_z.json'), '{}');
        // Also seed a consolidated file to confirm the migration NEVER touches it.
        const storageRoot = getStoragePath(cfg, root);
        fs.writeFileSync(path.join(storageRoot, 'graph.json'), '{"keep":true}');
        fs.writeFileSync(path.join(storageRoot, 'connections.jsonl'), '{"keep":true}\n');
        const summary = await migratePerEntityFiles(cfg, root);
        expect(summary.componentsRemoved).toBe(2);
        expect(summary.connectionsRemoved).toBe(1);
        expect(summary.dirsRemoved).toBe(2);
        expect(fs.existsSync(compsDir)).toBe(false);
        expect(fs.existsSync(connsDir)).toBe(false);
        // Consolidated files SURVIVED.
        expect(fs.readFileSync(path.join(storageRoot, 'graph.json'), 'utf-8')).toBe('{"keep":true}');
        expect(fs.readFileSync(path.join(storageRoot, 'connections.jsonl'), 'utf-8')).toBe('{"keep":true}\n');
    });
    it('migratePerEntityFiles is idempotent', async () => {
        const cfg = baseConfig(false);
        const compsDir = getComponentsPath(cfg, root);
        fs.mkdirSync(compsDir, { recursive: true });
        fs.writeFileSync(path.join(compsDir, 'COMP_x.json'), '{}');
        const first = await migratePerEntityFiles(cfg, root);
        expect(first.componentsRemoved).toBe(1);
        expect(first.dirsRemoved).toBe(1);
        const second = await migratePerEntityFiles(cfg, root);
        expect(second.componentsRemoved).toBe(0);
        expect(second.connectionsRemoved).toBe(0);
        expect(second.dirsRemoved).toBe(0);
    });
    it('migratePerEntityFiles is a no-op when perEntityFiles=true', async () => {
        const cfg = baseConfig(true);
        const compsDir = getComponentsPath(cfg, root);
        fs.mkdirSync(compsDir, { recursive: true });
        fs.writeFileSync(path.join(compsDir, 'COMP_keep.json'), '{}');
        const summary = await migratePerEntityFiles(cfg, root);
        expect(summary.componentsRemoved).toBe(0);
        expect(summary.dirsRemoved).toBe(0);
        expect(fs.existsSync(path.join(compsDir, 'COMP_keep.json'))).toBe(true);
    });
    it('leaves non-*.json siblings alone (defensive)', async () => {
        // If a future feature drops a README or marker file into components/,
        // migration must not eat it. The dir survives because non-json files remain.
        const cfg = baseConfig(false);
        const compsDir = getComponentsPath(cfg, root);
        fs.mkdirSync(compsDir, { recursive: true });
        fs.writeFileSync(path.join(compsDir, 'COMP_x.json'), '{}');
        fs.writeFileSync(path.join(compsDir, 'README.md'), '# detail files');
        await migratePerEntityFiles(cfg, root);
        expect(fs.existsSync(path.join(compsDir, 'COMP_x.json'))).toBe(false);
        expect(fs.existsSync(path.join(compsDir, 'README.md'))).toBe(true);
        expect(fs.existsSync(compsDir)).toBe(true);
    });
});
//# sourceMappingURL=per-entity-files-gate.test.js.map