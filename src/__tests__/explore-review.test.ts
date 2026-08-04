/**
 * C2 — explore/review composite extraction.
 *
 * Locks down two things:
 *  1. buildExploreReport / buildReviewReport return the structured fields a
 *     machine consumer needs (component identity, impact, connections,
 *     trace, rule violations, runtime topology, LLM use cases).
 *  2. formatExploreReport / formatReviewReport reproduce, byte-for-byte, the
 *     text the pre-refactor inline MCP handlers produced for the same
 *     inputs (derived independently from src/rules.ts / src/impact.ts /
 *     src/trace.ts, not from the new formatter itself).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetConfig, setConfig } from '../config.js';
import { ensureStorageDirectories, getStoragePath } from '../config.js';
import { writeFullComponentsJsonl, writeFullConnectionsJsonl } from '../storage/markdown-view.js';
import { createComponent, createConnection } from './helpers.js';
import { buildExploreReport, formatExploreReport } from '../explore-report.js';
import { buildReviewReport, formatReviewReport } from '../review-report.js';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-c2-explore-review-'));
}

async function seedFixture(root: string) {
  const authsvc = createComponent({ name: 'authsvc', layer: 'backend', type: 'api-endpoint', file: 'src/authsvc.ts' });
  const userstore = createComponent({ name: 'userstore', layer: 'database', type: 'database', file: 'src/userstore.ts' });
  const deadcode = createComponent({ name: 'deadcode', layer: 'backend', type: 'component', file: 'src/deadcode.ts' });
  userstore.runtime = { resource_type: 'database', engine: 'postgres' };

  const conn = createConnection(authsvc, userstore, { connection_type: 'api-calls-db' });

  ensureStorageDirectories({
    storageMode: 'local',
    storagePath: '.navgator/architecture',
    autoScan: false,
    healthCheckEnabled: false,
    scanDepth: 'shallow',
    defaultConfidenceThreshold: 0.6,
    maxResultsPerQuery: 20,
    perEntityFiles: false,
  }, root);
  const storeDir = getStoragePath({
    storageMode: 'local',
    storagePath: '.navgator/architecture',
    autoScan: false,
    healthCheckEnabled: false,
    scanDepth: 'shallow',
    defaultConfidenceThreshold: 0.6,
    maxResultsPerQuery: 20,
    perEntityFiles: false,
  }, root);

  await writeFullComponentsJsonl(storeDir, [authsvc, userstore, deadcode]);
  await writeFullConnectionsJsonl(storeDir, [conn]);

  return { authsvc, userstore, deadcode, conn };
}

describe('explore/review shared report modules', () => {
  let root: string;

  beforeEach(() => {
    root = tmpRoot();
    resetConfig();
    setConfig({ storageMode: 'local', perEntityFiles: false });
  });

  afterEach(() => {
    resetConfig();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('buildExploreReport', () => {
    it('no architecture data -> error shape', async () => {
      const empty = tmpRoot();
      try {
        const report = await buildExploreReport('anything', { projectRoot: empty });
        expect('error' in report).toBe(true);
        if ('error' in report) {
          expect(report.error).toBe('No architecture data. Run the scan tool first.');
        }
      } finally {
        fs.rmSync(empty, { recursive: true, force: true });
      }
    });

    it('component not found -> error shape with candidates', async () => {
      await seedFixture(root);
      const report = await buildExploreReport('authsvcx', { projectRoot: root });
      expect('error' in report).toBe(true);
      if ('error' in report) {
        expect(report.error).toContain('Component "authsvcx" not found.');
        expect(report.candidates).toEqual(['authsvc']);
      }
    });

    it('returns structured fields for a resolved component', async () => {
      await seedFixture(root);
      const report = await buildExploreReport('authsvc', { projectRoot: root, depth: 2 });
      expect('error' in report).toBe(false);
      if ('error' in report) return;

      expect(report.component).toEqual({
        name: 'authsvc',
        type: 'api-endpoint',
        layer: 'backend',
        status: 'active',
        purpose: 'Test: authsvc',
      });
      expect(report.runtime).toBeUndefined();
      expect(report.impact.severity).toBe('high');
      expect(report.impact.total_files_affected).toBe(0);
      expect(report.outgoing).toEqual([{ name: 'userstore', connection_type: 'api-calls-db' }]);
      expect(report.incoming).toEqual([]);
      expect(report.trace.paths).toHaveLength(1);
      expect(report.trace.paths[0].names).toEqual(['authsvc', 'userstore']);
      expect(report.trace.layers_crossed).toEqual(['backend', 'database']);
    });

    it('formatExploreReport matches the pre-refactor MCP text exactly', async () => {
      await seedFixture(root);
      const report = await buildExploreReport('authsvc', { projectRoot: root, depth: 2 });
      expect('error' in report).toBe(false);
      if ('error' in report) return;

      const expected = [
        'COMPONENT: authsvc',
        'Type: api-endpoint | Layer: backend | Status: active',
        'Purpose: Test: authsvc',
        '\nImpact severity: HIGH (0 files)',
        '\nDepends on (1):',
        '  → userstore (api-calls-db)',
        '\nData flow paths (1, layers: backend → database):',
        '  authsvc → userstore',
      ].join('\n');

      expect(formatExploreReport(report)).toBe(expected);
    });
  });

  describe('buildReviewReport', () => {
    it('no architecture data -> error shape', async () => {
      const empty = tmpRoot();
      try {
        const report = await buildReviewReport({ projectRoot: empty });
        expect('error' in report).toBe(true);
        if ('error' in report) {
          expect(report.error).toBe('No architecture data. Run the scan tool first.');
        }
      } finally {
        fs.rmSync(empty, { recursive: true, force: true });
      }
    });

    it('returns structured fields: violations, focus, runtime topology', async () => {
      await seedFixture(root);
      const report = await buildReviewReport({ projectRoot: root, component: 'authsvc' });
      expect('error' in report).toBe(false);
      if ('error' in report) return;

      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]).toMatchObject({
        rule_id: 'orphan-component',
        severity: 'warning',
        component: 'deadcode',
        message: 'deadcode has no connections — may be unused or untracked',
      });
      expect(report.focus).toEqual({
        component_name: 'authsvc',
        severity: 'high',
        summary: 'HIGH: 0 direct dependents, 0 transitive, 0 files affected',
        affected: [],
      });
      expect(report.runtime_topology).toEqual({ database: 1 });
      expect(report.llm).toBeUndefined();
    });

    it('formatReviewReport matches the pre-refactor MCP text exactly', async () => {
      await seedFixture(root);
      const report = await buildReviewReport({ projectRoot: root, component: 'authsvc' });
      expect('error' in report).toBe(false);
      if ('error' in report) return;

      const expected = [
        'ARCHITECTURE REVIEW',
        '\nRule violations (1):',
        '\nWARNING (1):',
        '[WARNING] deadcode has no connections — may be unused or untracked',
        '  -> Verify this component is used, or remove it if not needed',
        '\nImpact for authsvc: HIGH',
        'HIGH: 0 direct dependents, 0 transitive, 0 files affected',
        '\nRuntime topology: database: 1',
      ].join('\n');

      expect(formatReviewReport(report)).toBe(expected);
    });
  });
});
