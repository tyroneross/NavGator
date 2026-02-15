/**
 * NavGator Impact Analysis
 * Severity-scored impact analysis with transitive dependency tracking
 */

import {
  ArchitectureComponent,
  ArchitectureConnection,
  ImpactAnalysis,
  ImpactSeverity,
  AffectedComponent,
} from './types.js';

/**
 * Compute severity level for a component based on its role and dependent count.
 *
 * - critical: database/infra layer, or >5 dependents, or role.critical
 * - high: backend layer, or 3-5 dependents
 * - medium: 2 dependents
 * - low: 0-1 dependents
 */
export function computeSeverity(
  component: ArchitectureComponent,
  dependentCount: number
): ImpactSeverity {
  const layer = component.role.layer;

  // Critical: infrastructure/database, high fan-in, or explicitly marked critical
  if (
    layer === 'database' ||
    layer === 'infra' ||
    dependentCount > 5 ||
    component.role.critical
  ) {
    return 'critical';
  }

  // High: backend services or moderate fan-in
  if (layer === 'backend' || (dependentCount >= 3 && dependentCount <= 5)) {
    return 'high';
  }

  // Medium: 2 dependents
  if (dependentCount === 2) {
    return 'medium';
  }

  // Low: 0-1 dependents
  return 'low';
}

/**
 * Compute full impact analysis for a component.
 * Includes direct and one-level transitive dependents.
 */
export function computeImpact(
  component: ArchitectureComponent,
  allComponents: ArchitectureComponent[],
  allConnections: ArchitectureConnection[]
): ImpactAnalysis {
  // Find direct dependents — connections TO this component (things that use it)
  const directConnections = allConnections.filter(
    (c) => c.to.component_id === component.component_id
  );

  const affected: AffectedComponent[] = [];
  const affectedFiles = new Set<string>();
  const directComponentIds = new Set<string>();

  // Direct dependents
  for (const conn of directConnections) {
    const dependentComponent = allComponents.find(
      (c) => c.component_id === conn.from.component_id
    );
    if (!dependentComponent) continue;

    directComponentIds.add(dependentComponent.component_id);

    affected.push({
      component: dependentComponent,
      connection: conn,
      impact_type: 'direct',
      change_required: `Uses ${component.name} via ${conn.connection_type} at ${conn.code_reference?.file || 'unknown'}`,
    });

    if (conn.code_reference?.file) {
      affectedFiles.add(conn.code_reference.file);
    }
  }

  // Transitive dependents (one level deep)
  for (const directId of directComponentIds) {
    const transitiveConnections = allConnections.filter(
      (c) => c.to.component_id === directId && !directComponentIds.has(c.from.component_id) && c.from.component_id !== component.component_id
    );

    for (const conn of transitiveConnections) {
      const transitiveComponent = allComponents.find(
        (c) => c.component_id === conn.from.component_id
      );
      if (!transitiveComponent) continue;

      const directDep = allComponents.find((c) => c.component_id === directId);

      affected.push({
        component: transitiveComponent,
        connection: conn,
        impact_type: 'transitive',
        change_required: `Indirectly affected via ${directDep?.name || directId}`,
      });

      if (conn.code_reference?.file) {
        affectedFiles.add(conn.code_reference.file);
      }
    }
  }

  const severity = computeSeverity(component, directComponentIds.size);
  const directCount = directComponentIds.size;
  const transitiveCount = affected.filter((a) => a.impact_type === 'transitive').length;

  return {
    component,
    severity,
    affected,
    total_files_affected: affectedFiles.size,
    summary: `${severity.toUpperCase()}: ${directCount} direct dependent${directCount !== 1 ? 's' : ''}, ${transitiveCount} transitive, ${affectedFiles.size} file${affectedFiles.size !== 1 ? 's' : ''} affected`,
  };
}
