/**
 * NavGator Agent Output
 * Stable envelope format and executive summary for machine consumers
 */

import {
  ArchitectureComponent,
  ArchitectureConnection,
  GitInfo,
  AgentEnvelope,
  ExecutiveSummary,
  SummaryRisk,
  SummaryBlocker,
  SummaryAction,
  CompactComponent,
  CompactConnection,
  toCompactComponent,
  toCompactConnection,
} from './types.js';
import { SCHEMA_VERSION } from './config.js';

/**
 * Wrap any command output in a stable envelope for machine consumers.
 * Keys are sorted at the top level for deterministic output.
 */
export function wrapInEnvelope<T>(command: string, data: T, metadata?: Record<string, unknown>): string {
  const envelope: AgentEnvelope<T> & { metadata?: Record<string, unknown> } = {
    schema_version: SCHEMA_VERSION,
    command,
    timestamp: Date.now(),
    data,
  };

  if (metadata && Object.keys(metadata).length > 0) {
    envelope.metadata = metadata;
  }

  // Sort top-level keys for deterministic output
  const sorted: Record<string, unknown> = {};
  const envelopeRecord = envelope as unknown as Record<string, unknown>;
  for (const key of Object.keys(envelopeRecord).sort()) {
    sorted[key] = envelopeRecord[key];
  }

  return JSON.stringify(sorted, null, 2);
}

/**
 * Build an executive summary for agent orientation.
 * Uses compact component/connection forms for token efficiency.
 */
export function buildExecutiveSummary(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  projectPath: string,
  git?: GitInfo
): ExecutiveSummary {
  const compactComponents: CompactComponent[] = components.map(toCompactComponent);
  const compactConnections: CompactConnection[] = connections.map(toCompactConnection);

  const risks = computeRisks(components);
  const blockers = computeBlockers(components, connections);
  const nextActions = computeNextActions(components, risks, blockers);

  const outdatedCount = components.filter((c) => c.status === 'outdated').length;
  const vulnerableCount = components.filter((c) => c.status === 'vulnerable').length;

  return {
    project_path: projectPath,
    timestamp: Date.now(),
    git,
    risks,
    blockers,
    next_actions: nextActions,
    stats: {
      total_components: components.length,
      total_connections: connections.length,
      outdated_count: outdatedCount,
      vulnerable_count: vulnerableCount,
    },
    components: compactComponents,
    connections: compactConnections,
  };
}

function computeRisks(components: ArchitectureComponent[]): SummaryRisk[] {
  const risks: SummaryRisk[] = [];

  for (const c of components) {
    if (c.status === 'vulnerable') {
      risks.push({
        type: 'vulnerability',
        severity: 'critical',
        component: c.name,
        message: `${c.name} has known vulnerabilities`,
      });
    }

    if (c.status === 'deprecated') {
      risks.push({
        type: 'deprecated',
        severity: 'high',
        component: c.name,
        message: `${c.name} is deprecated`,
      });
    }

    if (c.status === 'outdated') {
      const updateType = c.health?.update_type;
      const severity = updateType === 'major' ? 'high' : 'medium';
      risks.push({
        type: 'outdated',
        severity,
        component: c.name,
        message: `${c.name} has ${updateType || 'an'} update available${c.health?.update_available ? ` (${c.health.update_available})` : ''}`,
      });
    }
  }

  return risks;
}

function computeBlockers(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): SummaryBlocker[] {
  const blockers: SummaryBlocker[] = [];

  // Find unused components (no incoming or outgoing connections)
  const connectedIds = new Set<string>();
  for (const conn of connections) {
    connectedIds.add(conn.from.component_id);
    connectedIds.add(conn.to.component_id);
  }

  for (const c of components) {
    if (c.status === 'unused') {
      blockers.push({
        type: 'unused',
        component: c.name,
        message: `${c.name} is detected but unused — consider removing`,
      });
    }
  }

  return blockers;
}

function computeNextActions(
  components: ArchitectureComponent[],
  risks: SummaryRisk[],
  blockers: SummaryBlocker[]
): SummaryAction[] {
  const actions: SummaryAction[] = [];

  const vulnerableRisks = risks.filter((r) => r.type === 'vulnerability');
  if (vulnerableRisks.length > 0) {
    actions.push({
      action: `Fix ${vulnerableRisks.length} vulnerable package${vulnerableRisks.length !== 1 ? 's' : ''}`,
      reason: 'Security vulnerabilities detected',
      command: 'npm audit fix',
    });
  }

  const outdatedRisks = risks.filter((r) => r.type === 'outdated');
  if (outdatedRisks.length > 0) {
    actions.push({
      action: `Update ${outdatedRisks.length} outdated package${outdatedRisks.length !== 1 ? 's' : ''}`,
      reason: 'Newer versions available',
      command: 'npm outdated',
    });
  }

  const deprecatedRisks = risks.filter((r) => r.type === 'deprecated');
  if (deprecatedRisks.length > 0) {
    actions.push({
      action: `Replace ${deprecatedRisks.length} deprecated package${deprecatedRisks.length !== 1 ? 's' : ''}`,
      reason: 'Deprecated packages may lose support',
    });
  }

  if (blockers.length > 0) {
    actions.push({
      action: `Review ${blockers.length} unused component${blockers.length !== 1 ? 's' : ''}`,
      reason: 'Unused dependencies add weight and attack surface',
    });
  }

  return actions;
}
