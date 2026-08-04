/**
 * NavGator Explore Report
 *
 * Single shared implementation of the `explore` composite, used by both the
 * `navgator explore` CLI command and the MCP `explore` tool handler. Builds a
 * structured report from the architecture graph, then formats it to the
 * human-readable text that predates this module (byte-identical to the prior
 * inline implementation in src/mcp/tools.ts).
 */

import { loadAllComponents, loadAllConnections } from "./storage.js";
import { getConfig } from "./config.js";
import { computeImpact } from "./impact.js";
import { resolveComponent, findCandidates } from "./resolve.js";
import { traceDataflow } from "./trace.js";
import type { ArchitectureLayer, ImpactSeverity } from "./types.js";

export interface ExploreComponentInfo {
  name: string;
  type: string;
  layer: ArchitectureLayer;
  status: string;
  purpose: string;
}

export interface ExploreRuntimeInfo {
  engine?: string;
  service_name?: string;
  platform?: string;
  host?: string;
  port?: number;
  connection_env_var?: string;
}

export interface ExploreConnectionSummary {
  name: string;
  connection_type: string;
}

export interface ExploreTracePath {
  names: string[];
}

export interface ExploreTraceSummary {
  paths: ExploreTracePath[];
  layers_crossed: ArchitectureLayer[];
}

export interface ExploreImpactSummary {
  severity: ImpactSeverity;
  total_files_affected: number;
  summary: string;
}

export interface ExploreReport {
  component: ExploreComponentInfo;
  runtime?: ExploreRuntimeInfo;
  impact: ExploreImpactSummary;
  outgoing: ExploreConnectionSummary[];
  incoming: ExploreConnectionSummary[];
  trace: ExploreTraceSummary;
}

export interface ExploreReportError {
  error: string;
  candidates?: string[];
}

/**
 * Build a structured explore report for `query` (a component name, ID, or
 * file path). Returns an error shape when there is no architecture data, or
 * when `query` does not resolve to a component (with "did you mean"
 * candidates when any are close enough to suggest).
 */
export async function buildExploreReport(
  query: string,
  opts: { projectRoot?: string; depth?: number } = {}
): Promise<ExploreReport | ExploreReportError> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const depth = typeof opts.depth === "number" ? opts.depth : 2;
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return { error: "No architecture data. Run the scan tool first." };
  }

  const component = resolveComponent(query, components);
  if (!component) {
    const candidates = findCandidates(query, components, 5);
    if (candidates.length > 0) {
      return {
        error: `Component "${query}" not found. Did you mean:\n${candidates.map(c => `- ${c}`).join("\n")}`,
        candidates,
      };
    }
    return { error: `Component "${query}" not found.` };
  }

  const runtime = component.runtime
    ? {
        engine: component.runtime.engine,
        service_name: component.runtime.service_name,
        platform: component.runtime.platform,
        host: component.runtime.endpoint?.host,
        port: component.runtime.endpoint?.port,
        connection_env_var: component.runtime.connection_env_var,
      }
    : undefined;

  const impact = computeImpact(component, components, connections);

  const outgoingConns = connections.filter(c => c.from.component_id === component.component_id);
  const incomingConns = connections.filter(c => c.to.component_id === component.component_id);

  const outgoing: ExploreConnectionSummary[] = outgoingConns.map(c => {
    const target = components.find(comp => comp.component_id === c.to.component_id);
    return { name: target?.name || c.to.component_id, connection_type: c.connection_type };
  });

  const incoming: ExploreConnectionSummary[] = incomingConns.map(c => {
    const source = components.find(comp => comp.component_id === c.from.component_id);
    return { name: source?.name || c.from.component_id, connection_type: c.connection_type };
  });

  const traceResult = traceDataflow(component, components, connections, { direction: "both", maxDepth: depth });
  const trace: ExploreTraceSummary = {
    paths: traceResult.paths.map(p => ({ names: p.steps.map(s => s.component.n) })),
    layers_crossed: traceResult.layers_crossed,
  };

  return {
    component: {
      name: component.name,
      type: component.type,
      layer: component.role.layer,
      status: component.status,
      purpose: component.role.purpose,
    },
    runtime,
    impact: {
      severity: impact.severity,
      total_files_affected: impact.total_files_affected,
      summary: impact.summary,
    },
    outgoing,
    incoming,
    trace,
  };
}

/**
 * Render an ExploreReport to the human-readable text NavGator has always
 * produced for `explore`. Kept byte-identical to the pre-refactor inline
 * implementation so existing tests and the release verifier keep matching.
 */
export function formatExploreReport(report: ExploreReport): string {
  const lines: string[] = [
    `COMPONENT: ${report.component.name}`,
    `Type: ${report.component.type} | Layer: ${report.component.layer} | Status: ${report.component.status}`,
    `Purpose: ${report.component.purpose}`,
  ];

  if (report.runtime) {
    const r = report.runtime;
    const parts: string[] = [];
    if (r.engine) parts.push(`engine: ${r.engine}`);
    if (r.service_name) parts.push(`service: ${r.service_name}`);
    if (r.platform) parts.push(`platform: ${r.platform}`);
    if (r.host) parts.push(`host: ${r.host}${r.port ? `:${r.port}` : ""}`);
    if (r.connection_env_var) parts.push(`env: ${r.connection_env_var}`);
    if (parts.length > 0) {
      lines.push(`Runtime: ${parts.join(", ")}`);
    }
  }

  lines.push(`\nImpact severity: ${report.impact.severity.toUpperCase()} (${report.impact.total_files_affected} files)`);

  if (report.outgoing.length > 0) {
    lines.push(`\nDepends on (${report.outgoing.length}):`);
    for (const c of report.outgoing.slice(0, 10)) {
      lines.push(`  → ${c.name} (${c.connection_type})`);
    }
    if (report.outgoing.length > 10) lines.push(`  ... +${report.outgoing.length - 10} more`);
  }

  if (report.incoming.length > 0) {
    lines.push(`\nDepended on by (${report.incoming.length}):`);
    for (const c of report.incoming.slice(0, 10)) {
      lines.push(`  ← ${c.name} (${c.connection_type})`);
    }
    if (report.incoming.length > 10) lines.push(`  ... +${report.incoming.length - 10} more`);
  }

  if (report.trace.paths.length > 0) {
    lines.push(`\nData flow paths (${report.trace.paths.length}, layers: ${report.trace.layers_crossed.join(" → ")}):`);
    for (const p of report.trace.paths.slice(0, 5)) {
      lines.push(`  ${p.names.join(" → ")}`);
    }
    if (report.trace.paths.length > 5) lines.push(`  ... +${report.trace.paths.length - 5} more paths`);
  }

  return lines.join("\n");
}
