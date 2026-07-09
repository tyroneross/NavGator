/**
 * NavGator Agent Output
 * Stable envelope format and executive summary for machine consumers
 */
import { toCompactComponent, toCompactConnection, } from './types.js';
import { SCHEMA_VERSION } from './config.js';
import { checkRules } from './rules.js';
/** Hard caps keep machine-facing output predictable on large repositories. */
export const AGENT_OUTPUT_LIMITS = {
    risks: 20,
    blockers: 20,
    nextActions: 12,
    components: 50,
    connections: 100,
    ruleViolations: 20,
    commandItems: 50,
};
/** Return a deterministic prefix plus explicit total/returned accounting. */
export function boundAgentCollection(items, limit = AGENT_OUTPUT_LIMITS.commandItems) {
    const safeLimit = Math.max(0, Math.floor(limit));
    const returned = Math.min(items.length, safeLimit);
    return {
        items: items.slice(0, returned),
        truncation: {
            total: items.length,
            returned,
            truncated: returned < items.length,
            limit: safeLimit,
        },
    };
}
/**
 * Wrap any command output in a stable envelope for machine consumers.
 * Keys are sorted at the top level for deterministic output.
 */
export function wrapInEnvelope(command, data, metadata) {
    const envelope = {
        schema_version: SCHEMA_VERSION,
        command,
        timestamp: Date.now(),
        data,
    };
    if (metadata && Object.keys(metadata).length > 0) {
        envelope.metadata = metadata;
    }
    // Sort top-level keys for deterministic output
    const sorted = {};
    const envelopeRecord = envelope;
    for (const key of Object.keys(envelopeRecord).sort()) {
        sorted[key] = envelopeRecord[key];
    }
    return JSON.stringify(sorted, null, 2);
}
/**
 * Build an executive summary for agent orientation.
 * Uses compact component/connection forms for token efficiency.
 */
export function buildExecutiveSummary(components, connections, projectPath, git) {
    const violations = sortRuleViolations(checkRules(components, connections));
    const architectureRisks = violations
        .filter((violation) => violation.severity === 'error' && violation.rule_id !== 'vulnerable-dependency')
        .map((violation) => ({
        type: 'architecture_rule',
        severity: 'critical',
        component: violation.component,
        message: violation.message,
    }));
    const riskRank = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
    };
    const allRisks = [...architectureRisks, ...computeRisks(components)].sort((a, b) => riskRank[a.severity] - riskRank[b.severity] ||
        a.type.localeCompare(b.type) ||
        (a.component ?? '').localeCompare(b.component ?? '') ||
        a.message.localeCompare(b.message));
    const allBlockers = computeBlockers(components, connections).sort((a, b) => a.type.localeCompare(b.type) ||
        (a.component ?? '').localeCompare(b.component ?? '') ||
        a.message.localeCompare(b.message));
    const allNextActions = computeNextActions(components, allRisks, allBlockers, architectureRisks.length).sort((a, b) => a.action.localeCompare(b.action) || a.reason.localeCompare(b.reason));
    const risks = boundAgentCollection(allRisks, AGENT_OUTPUT_LIMITS.risks);
    const blockers = boundAgentCollection(allBlockers, AGENT_OUTPUT_LIMITS.blockers);
    const nextActions = boundAgentCollection(allNextActions, AGENT_OUTPUT_LIMITS.nextActions);
    const boundedComponents = boundAgentCollection([...components].sort((a, b) => a.component_id.localeCompare(b.component_id)), AGENT_OUTPUT_LIMITS.components);
    const boundedConnections = boundAgentCollection([...connections].sort((a, b) => a.connection_id.localeCompare(b.connection_id)), AGENT_OUTPUT_LIMITS.connections);
    const boundedViolations = boundAgentCollection(violations, AGENT_OUTPUT_LIMITS.ruleViolations);
    const compactComponents = boundedComponents.items.map(toCompactComponent);
    const compactConnections = boundedConnections.items.map(toCompactConnection);
    const outdatedCount = components.filter((c) => c.status === 'outdated').length;
    const vulnerableCount = components.filter((c) => c.status === 'vulnerable').length;
    return {
        project_path: projectPath,
        timestamp: Date.now(),
        git,
        risks: risks.items,
        blockers: blockers.items,
        next_actions: nextActions.items,
        stats: {
            total_components: components.length,
            total_connections: connections.length,
            outdated_count: outdatedCount,
            vulnerable_count: vulnerableCount,
        },
        components: compactComponents,
        connections: compactConnections,
        rule_health: {
            total: violations.length,
            errors: violations.filter((violation) => violation.severity === 'error').length,
            warnings: violations.filter((violation) => violation.severity === 'warning').length,
            info: violations.filter((violation) => violation.severity === 'info').length,
            violations: boundedViolations.items.map(toSummaryRuleViolation),
            truncation: boundedViolations.truncation,
        },
        truncation: {
            risks: risks.truncation,
            blockers: blockers.truncation,
            next_actions: nextActions.truncation,
            components: boundedComponents.truncation,
            connections: boundedConnections.truncation,
        },
    };
}
function sortRuleViolations(violations) {
    const rank = {
        error: 0,
        warning: 1,
        info: 2,
    };
    return [...violations].sort((a, b) => rank[a.severity] - rank[b.severity] ||
        a.rule_id.localeCompare(b.rule_id) ||
        (a.component ?? '').localeCompare(b.component ?? '') ||
        a.message.localeCompare(b.message));
}
function toSummaryRuleViolation(violation) {
    return {
        rule_id: violation.rule_id,
        severity: violation.severity,
        component: violation.component,
        message: violation.message,
        suggestion: violation.suggestion,
    };
}
function computeRisks(components) {
    const risks = [];
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
function computeBlockers(components, connections) {
    const blockers = [];
    // Find unused components (no incoming or outgoing connections)
    const connectedIds = new Set();
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
function computeNextActions(components, risks, blockers, architectureRuleErrors = 0) {
    const actions = [];
    if (architectureRuleErrors > 0) {
        actions.push({
            action: `Resolve ${architectureRuleErrors} architecture rule error${architectureRuleErrors !== 1 ? 's' : ''}`,
            reason: 'Architecture rule errors indicate unsafe dependency or layer boundaries',
            command: 'navgator rules --severity error',
        });
    }
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
//# sourceMappingURL=agent-output.js.map