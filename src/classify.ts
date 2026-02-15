/**
 * NavGator Semantic Connection Classification
 * Classifies connections as production, admin, analytics, test, dev-only, migration, or unknown
 */

import { ArchitectureComponent, ArchitectureConnection } from './types.js';

export type SemanticClassification = 'production' | 'admin' | 'analytics' | 'test' | 'dev-only' | 'migration' | 'unknown';

export interface SemanticInfo {
  classification: SemanticClassification;
  confidence: number;
}

/**
 * Classify a connection based on file path patterns of source and target components.
 */
export function classifyConnection(
  conn: ArchitectureConnection,
  fromComponent: ArchitectureComponent,
  toComponent: ArchitectureComponent
): SemanticInfo {
  // Collect all relevant file paths
  const paths = [
    conn.code_reference?.file,
    conn.from.location?.file,
    conn.to.location?.file,
    ...(fromComponent.source.config_files || []),
  ].filter(Boolean) as string[];

  // Check each classification pattern against all paths
  for (const p of paths) {
    const lower = p.toLowerCase();

    // Test patterns (highest priority — test files shouldn't be treated as production)
    if (isTestPath(lower)) {
      return { classification: 'test', confidence: 0.9 };
    }

    // Migration patterns
    if (isMigrationPath(lower)) {
      return { classification: 'migration', confidence: 0.9 };
    }

    // Dev-only patterns
    if (isDevPath(lower)) {
      return { classification: 'dev-only', confidence: 0.9 };
    }

    // Admin patterns
    if (isAdminPath(lower)) {
      return { classification: 'admin', confidence: 0.9 };
    }

    // Analytics patterns
    if (isAnalyticsPath(lower)) {
      return { classification: 'analytics', confidence: 0.9 };
    }
  }

  // Component name heuristic
  const fromName = fromComponent.name.toLowerCase();
  const toName = toComponent.name.toLowerCase();

  if (fromName.includes('test') || toName.includes('test')) {
    return { classification: 'test', confidence: 0.7 };
  }
  if (fromName.includes('admin') || toName.includes('admin')) {
    return { classification: 'admin', confidence: 0.7 };
  }
  if (fromName.includes('analytics') || fromName.includes('metric') || toName.includes('analytics') || toName.includes('metric')) {
    return { classification: 'analytics', confidence: 0.7 };
  }

  // Default: production for frontend/backend/database layers, unknown for others
  const prodLayers = new Set(['frontend', 'backend', 'database']);
  if (prodLayers.has(fromComponent.role.layer) || prodLayers.has(toComponent.role.layer)) {
    return { classification: 'production', confidence: 0.5 };
  }

  return { classification: 'unknown', confidence: 0.5 };
}

/**
 * Classify all connections in a batch
 */
export function classifyAllConnections(
  connections: ArchitectureConnection[],
  components: ArchitectureComponent[]
): Map<string, SemanticInfo> {
  const componentMap = new Map(components.map(c => [c.component_id, c]));
  const result = new Map<string, SemanticInfo>();

  for (const conn of connections) {
    const from = componentMap.get(conn.from.component_id);
    const to = componentMap.get(conn.to.component_id);
    if (from && to) {
      result.set(conn.connection_id, classifyConnection(conn, from, to));
    } else {
      result.set(conn.connection_id, { classification: 'unknown', confidence: 0.3 });
    }
  }

  return result;
}

function isTestPath(p: string): boolean {
  return /(__tests__|\.test\.|\.spec\.|\/tests?\/|\/testing\/)/.test(p);
}

function isMigrationPath(p: string): boolean {
  return /(\/migrations?\/|\/migrate|\.migration\.|\/seeds?\/)/.test(p);
}

function isDevPath(p: string): boolean {
  return /(\/scripts\/|\/dev\/|\.dev\.|webpack\.config|vite\.config|rollup\.config|jest\.config|eslint|prettier|\.storybook)/.test(p);
}

function isAdminPath(p: string): boolean {
  return /(\/admin\/|\/dashboard\/|\/internal\/|\/backoffice\/)/.test(p);
}

function isAnalyticsPath(p: string): boolean {
  return /(\/analytics\/|\/tracking\/|\/telemetry\/|\/metrics\/|\/monitoring\/)/.test(p);
}
