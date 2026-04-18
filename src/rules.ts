/**
 * NavGator Architecture Rules
 * Built-in and custom rule checking for architectural gap detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { ArchitectureComponent, ArchitectureConnection } from './types.js';
import { detectImportCycles, detectLayerViolations, getTopFanOut, getTopHotspots } from './architecture-insights.js';

export interface ArchitectureRule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  check: (components: ArchitectureComponent[], connections: ArchitectureConnection[]) => RuleViolation[];
}

export interface RuleViolation {
  rule_id: string;
  severity: 'error' | 'warning' | 'info';
  component?: string;
  message: string;
  suggestion?: string;
}

/**
 * Get all built-in architecture rules
 */
export function getBuiltinRules(): ArchitectureRule[] {
  return [
    {
      id: 'orphan-component',
      name: 'Orphan Component',
      description: 'Component has 0 connections (neither from nor to)',
      severity: 'warning',
      check: (components, connections) => {
        const connectedIds = new Set<string>();
        for (const conn of connections) {
          connectedIds.add(conn.from.component_id);
          connectedIds.add(conn.to.component_id);
        }
        return components
          .filter(c => !connectedIds.has(c.component_id))
          .map(c => ({
            rule_id: 'orphan-component',
            severity: 'warning' as const,
            component: c.name,
            message: `${c.name} has no connections — may be unused or untracked`,
            suggestion: 'Verify this component is used, or remove it if not needed',
          }));
      },
    },
    {
      id: 'database-no-backend',
      name: 'Database Without Backend',
      description: 'Database layer component with no incoming connection from backend',
      severity: 'warning',
      check: (components, connections) => {
        const dbComponents = components.filter(c => c.role.layer === 'database');
        const backendComponents = new Set(
          components.filter(c => c.role.layer === 'backend').map(c => c.component_id)
        );

        return dbComponents
          .filter(db => {
            const incomingFromBackend = connections.some(
              conn => conn.to.component_id === db.component_id && backendComponents.has(conn.from.component_id)
            );
            return !incomingFromBackend;
          })
          .map(db => ({
            rule_id: 'database-no-backend',
            severity: 'warning' as const,
            component: db.name,
            message: `${db.name} (database) has no incoming connections from backend layer`,
            suggestion: 'Ensure backend services connect to this database, or verify it is accessed via another path',
          }));
      },
    },
    {
      id: 'frontend-direct-db',
      name: 'Frontend Direct Database Access',
      description: 'Frontend connects directly to database (skipping backend)',
      severity: 'error',
      check: (components, connections) => {
        const frontendIds = new Set(
          components.filter(c => c.role.layer === 'frontend').map(c => c.component_id)
        );
        const dbIds = new Set(
          components.filter(c => c.role.layer === 'database').map(c => c.component_id)
        );

        return connections
          .filter(conn => frontendIds.has(conn.from.component_id) && dbIds.has(conn.to.component_id))
          .map(conn => {
            const from = components.find(c => c.component_id === conn.from.component_id);
            const to = components.find(c => c.component_id === conn.to.component_id);
            return {
              rule_id: 'frontend-direct-db',
              severity: 'error' as const,
              component: from?.name,
              message: `${from?.name || '?'} (frontend) connects directly to ${to?.name || '?'} (database)`,
              suggestion: 'Add a backend API layer between frontend and database',
            };
          });
      },
    },
    {
      id: 'unused-package',
      name: 'Unused Package',
      description: 'Package component with status "unused"',
      severity: 'info',
      check: (components) => {
        return components
          .filter(c => c.status === 'unused')
          .map(c => ({
            rule_id: 'unused-package',
            severity: 'info' as const,
            component: c.name,
            message: `${c.name} is detected but unused`,
            suggestion: `Remove with: npm uninstall ${c.name}`,
          }));
      },
    },
    {
      id: 'vulnerable-dependency',
      name: 'Vulnerable Dependency',
      description: 'Package with status "vulnerable"',
      severity: 'error',
      check: (components) => {
        return components
          .filter(c => c.status === 'vulnerable')
          .map(c => ({
            rule_id: 'vulnerable-dependency',
            severity: 'error' as const,
            component: c.name,
            message: `${c.name} has known security vulnerabilities`,
            suggestion: 'Run npm audit fix or update to a patched version',
          }));
      },
    },
    {
      id: 'deprecated-dependency',
      name: 'Deprecated Dependency',
      description: 'Package with status "deprecated"',
      severity: 'warning',
      check: (components) => {
        return components
          .filter(c => c.status === 'deprecated')
          .map(c => ({
            rule_id: 'deprecated-dependency',
            severity: 'warning' as const,
            component: c.name,
            message: `${c.name} is deprecated`,
            suggestion: 'Find a replacement package before it becomes unmaintained',
          }));
      },
    },
    {
      id: 'single-point-of-failure',
      name: 'Single Point of Failure',
      description: 'Backend component with >5 dependents',
      severity: 'warning',
      check: (components, connections) => {
        const dependentCounts = new Map<string, number>();
        for (const conn of connections) {
          dependentCounts.set(
            conn.to.component_id,
            (dependentCounts.get(conn.to.component_id) || 0) + 1
          );
        }

        return components
          .filter(c => c.role.layer === 'backend' && (dependentCounts.get(c.component_id) || 0) > 5)
          .map(c => ({
            rule_id: 'single-point-of-failure',
            severity: 'warning' as const,
            component: c.name,
            message: `${c.name} has ${dependentCounts.get(c.component_id)} dependents — single point of failure`,
            suggestion: 'Consider adding redundancy or splitting responsibilities',
          }));
      },
    },
    {
      id: 'hotspot-module',
      name: 'Hotspot Module',
      description: 'Internal module with high fan-in',
      severity: 'warning',
      check: (components, connections) => {
        return getTopHotspots(components, connections, 20)
          .filter((entry) => entry.count >= 5)
          .map((entry) => ({
            rule_id: 'hotspot-module',
            severity: 'warning' as const,
            component: entry.component.name,
            message: `${entry.component.name} has ${entry.count} dependents — architectural hotspot`,
            suggestion: 'Treat changes here as high blast-radius and review downstream imports first',
          }));
      },
    },
    {
      id: 'high-fan-out',
      name: 'High Fan-Out',
      description: 'Internal module imports many other modules',
      severity: 'warning',
      check: (components, connections) => {
        return getTopFanOut(components, connections, 20)
          .filter((entry) => entry.count >= 8)
          .map((entry) => ({
            rule_id: 'high-fan-out',
            severity: 'warning' as const,
            component: entry.component.name,
            message: `${entry.component.name} imports ${entry.count} modules — possible god-object`,
            suggestion: 'Consider splitting responsibilities or introducing narrower abstractions',
          }));
      },
    },
    {
      id: 'layer-violation',
      name: 'Layer Violation',
      description: 'Internal module imports upward into a higher inferred layer',
      severity: 'error',
      check: (components, connections) => {
        return detectLayerViolations(components, connections).map((violation) => ({
          rule_id: 'layer-violation',
          severity: 'error' as const,
          component: violation.from.name,
          message: `${violation.from.name} imports ${violation.to.name} across inferred layers (${violation.fromTier} → ${violation.toTier})`,
          suggestion: 'Reverse the dependency or extract a lower-level shared module',
        }));
      },
    },
    {
      id: 'circular-dependency',
      name: 'Circular Dependency',
      description: 'Internal import graph contains a cycle',
      severity: 'error',
      check: (components, connections) => {
        return detectImportCycles(components, connections, 20).map((cycle) => ({
          rule_id: 'circular-dependency',
          severity: 'error' as const,
          component: cycle[0],
          message: `Import cycle detected: ${cycle.join(' → ')}`,
          suggestion: 'Break the cycle by extracting shared contracts or inverting one dependency',
        }));
      },
    },
    {
      id: 'duplicate-resource-creation',
      name: 'Duplicate Resource Creation',
      description: 'Service/LLM component instantiated in multiple places without singleton pattern',
      severity: 'warning',
      check: (components, connections) => {
        return checkDuplicateResourceCreation(components, connections);
      },
    },
    {
      id: 'transitively-dead',
      name: 'Transitively Dead',
      description: 'Component unreachable from any entry point via connection graph',
      severity: 'warning',
      check: (components, connections) => {
        return checkTransitivelyDead(components, connections);
      },
    },
  ];
}

// =============================================================================
// DUPLICATE RESOURCE CREATION DETECTION
// =============================================================================

/**
 * For each service/llm component, find all components that import it.
 * If >1 unique importing component instantiates the class (ClassName()),
 * and no singleton pattern is detected, flag it.
 *
 * Singleton patterns detected: static let/var, lazy var, .shared
 */
function checkDuplicateResourceCreation(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  // Find service and llm components
  const serviceComponents = components.filter(
    c => c.type === 'service' || c.type === 'llm'
  );

  for (const svc of serviceComponents) {
    // Find all connections TO this service (i.e., components that use/import it)
    const importers = connections.filter(
      c => c.to.component_id === svc.component_id
    );

    if (importers.length <= 1) continue;

    // Check code snippets for instantiation patterns: ClassName()
    const instantiationSites: string[] = [];
    for (const conn of importers) {
      const snippet = conn.code_reference?.code_snippet || '';
      const file = conn.code_reference?.file || '';
      const fromComp = components.find(c => c.component_id === conn.from.component_id);

      // Check if the snippet or file context suggests instantiation
      if (snippet.includes(`${svc.name}(`) || snippet.includes(`${svc.name}()`) || snippet.includes(`= ${svc.name}`)) {
        // Check for singleton patterns in the snippet
        const hasSingleton = /static\s+(let|var)|lazy\s+var|\.shared/.test(snippet);
        if (!hasSingleton) {
          instantiationSites.push(fromComp?.name || conn.from.component_id);
        }
      }
    }

    if (instantiationSites.length > 1) {
      violations.push({
        rule_id: 'duplicate-resource-creation',
        severity: 'warning',
        component: svc.name,
        message: `${svc.name} instantiated in ${instantiationSites.length} places: ${instantiationSites.slice(0, 5).join(', ')}${instantiationSites.length > 5 ? ` +${instantiationSites.length - 5} more` : ''}`,
        suggestion: `Use a singleton pattern (static let shared, lazy var, or dependency injection) for ${svc.name}`,
      });
    }
  }

  return violations;
}

// =============================================================================
// TRANSITIVE DEAD CODE DETECTION
// =============================================================================

/**
 * BFS from entry points through the connection graph.
 * Components unreachable from any entry point are transitively dead.
 *
 * Entry points are identified by:
 * - type: 'api-endpoint', 'worker', 'cron' (natural entry points)
 * - component names matching app delegate patterns (AppDelegate, App, @main)
 * - tags containing 'entrypoint', 'route', or 'navigation-root'
 * - role.layer === 'infra' or role.layer === 'external' (not code we own)
 */
function checkTransitivelyDead(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): RuleViolation[] {
  if (components.length === 0) return [];

  // Build adjacency list (both directions for reachability)
  const adj = new Map<string, Set<string>>();
  for (const c of components) {
    adj.set(c.component_id, new Set());
  }
  for (const conn of connections) {
    // Forward edges
    adj.get(conn.from.component_id)?.add(conn.to.component_id);
    // Reverse edges: if B depends on A, A is reachable from B's perspective
    adj.get(conn.to.component_id)?.add(conn.from.component_id);
  }

  // Identify entry points
  const entryPointTypes = new Set(['api-endpoint', 'worker', 'cron', 'xcode-target']);
  const entryPointNamePatterns = /App$|AppDelegate|@main|ContentView|SceneDelegate|Main/i;
  const excludedTypes = new Set(['npm', 'pip', 'spm', 'cargo', 'go', 'gem', 'composer', 'infra', 'config']);

  const entryPoints = new Set<string>();
  for (const c of components) {
    if (entryPointTypes.has(c.type)) {
      entryPoints.add(c.component_id);
    } else if (entryPointNamePatterns.test(c.name)) {
      entryPoints.add(c.component_id);
    } else if (c.tags?.some(t => ['entrypoint', 'route', 'navigation-root'].includes(t))) {
      entryPoints.add(c.component_id);
    } else if (c.role.layer === 'infra' || c.role.layer === 'external') {
      entryPoints.add(c.component_id);
    }
  }

  // If no entry points found, skip (can't determine reachability without roots)
  if (entryPoints.size === 0) return [];

  // BFS from all entry points
  const reachable = new Set<string>();
  const queue: string[] = [...entryPoints];
  for (const ep of entryPoints) {
    reachable.add(ep);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Components not reachable and not excluded types are transitively dead
  const violations: RuleViolation[] = [];
  for (const c of components) {
    if (reachable.has(c.component_id)) continue;
    if (excludedTypes.has(c.type)) continue;
    // Skip components that already have no connections (caught by orphan-component)
    const hasAnyConnection = connections.some(
      conn => conn.from.component_id === c.component_id || conn.to.component_id === c.component_id
    );
    if (!hasAnyConnection) continue;

    violations.push({
      rule_id: 'transitively-dead',
      severity: 'warning',
      component: c.name,
      message: `${c.name} (${c.type}) is connected but unreachable from any entry point`,
      suggestion: 'Verify this component is used in an active code path, or remove if obsolete',
    });
  }

  return violations;
}

/**
 * JSON format for custom rules in .navgator/architecture/rules.json
 */
interface CustomRuleJSON {
  id: string;
  name: string;
  severity: 'error' | 'warning' | 'info';
  description?: string;
  forbidden?: {
    from?: { layer?: string; type?: string; name?: string };
    to?: { layer?: string; type?: string; name?: string };
  };
  required?: {
    from?: { layer?: string; type?: string };
    to?: { layer?: string; type?: string };
    message?: string;
  };
}

/**
 * Load custom rules from .navgator/architecture/rules.json
 */
export function loadCustomRules(projectRoot?: string): ArchitectureRule[] {
  const root = projectRoot || process.cwd();
  const rulesPath = path.join(root, '.navgator', 'architecture', 'rules.json');

  if (!fs.existsSync(rulesPath)) return [];

  try {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    const parsed: CustomRuleJSON[] = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(convertCustomRule).filter((r): r is ArchitectureRule => r !== null);
  } catch {
    return [];
  }
}

function convertCustomRule(json: CustomRuleJSON): ArchitectureRule | null {
  if (!json.id || !json.severity) return null;

  return {
    id: json.id,
    name: json.name || json.id,
    description: json.description || '',
    severity: json.severity,
    check: (components, connections) => {
      const violations: RuleViolation[] = [];

      if (json.forbidden) {
        // Find connections that match the forbidden pattern
        for (const conn of connections) {
          const from = components.find(c => c.component_id === conn.from.component_id);
          const to = components.find(c => c.component_id === conn.to.component_id);
          if (!from || !to) continue;

          const fromMatch = matchesPattern(from, json.forbidden.from);
          const toMatch = matchesPattern(to, json.forbidden.to);

          if (fromMatch && toMatch) {
            violations.push({
              rule_id: json.id,
              severity: json.severity,
              component: from.name,
              message: `${from.name} → ${to.name} violates rule: ${json.name || json.id}`,
              suggestion: json.description,
            });
          }
        }
      }

      return violations;
    },
  };
}

function matchesPattern(
  component: ArchitectureComponent,
  pattern?: { layer?: string; type?: string; name?: string }
): boolean {
  if (!pattern) return true; // No pattern = matches everything
  if (pattern.layer && component.role.layer !== pattern.layer) return false;
  if (pattern.type && component.type !== pattern.type) return false;
  if (pattern.name && !component.name.toLowerCase().includes(pattern.name.toLowerCase())) return false;
  return true;
}

/**
 * Check all rules (builtin + custom) against architecture
 */
export function checkRules(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  rules?: ArchitectureRule[]
): RuleViolation[] {
  const allRules = rules || [...getBuiltinRules(), ...loadCustomRules()];
  const violations: RuleViolation[] = [];

  for (const rule of allRules) {
    violations.push(...rule.check(components, connections));
  }

  return violations;
}

/**
 * Format rule violations for human-readable CLI output
 */
export function formatRulesOutput(violations: RuleViolation[], filterSeverity?: string): string {
  let filtered = violations;
  if (filterSeverity) {
    filtered = violations.filter(v => v.severity === filterSeverity);
  }

  if (filtered.length === 0) {
    return 'No architecture rule violations found.';
  }

  const lines: string[] = [];
  lines.push(`NavGator - Architecture Rules: ${filtered.length} violation(s)`);
  lines.push('');

  // Group by severity
  const bySeverity = new Map<string, RuleViolation[]>();
  for (const v of filtered) {
    if (!bySeverity.has(v.severity)) bySeverity.set(v.severity, []);
    bySeverity.get(v.severity)!.push(v);
  }

  const severityOrder = ['error', 'warning', 'info'];
  const severityIcons: Record<string, string> = { error: 'ERROR', warning: 'WARN', info: 'INFO' };

  for (const sev of severityOrder) {
    const group = bySeverity.get(sev);
    if (!group || group.length === 0) continue;

    lines.push(`${severityIcons[sev]} (${group.length}):`);
    for (const v of group) {
      const comp = v.component ? ` [${v.component}]` : '';
      lines.push(`  - ${v.message}${comp}`);
      if (v.suggestion) {
        lines.push(`    → ${v.suggestion}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
