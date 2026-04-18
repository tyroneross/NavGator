/**
 * NavGator MCP Tool Definitions
 *
 * Each tool maps to existing NavGator programmatic APIs.
 * Responses are formatted as concise text for LLM consumption.
 */

import { scan, getScanStatus } from "../scanner.js";
import {
  loadAllComponents,
  loadAllConnections,
  loadIndex,
  loadGraph,
  buildSummary,
} from "../storage.js";
import { computeImpact } from "../impact.js";
import { resolveComponent, findCandidates } from "../resolve.js";
import { traceDataflow, formatTraceOutput } from "../trace.js";
import {
  generateMermaidDiagram,
  generateComponentDiagram,
  generateLayerDiagram,
  generateSummaryDiagram,
} from "../diagram.js";
import { buildExecutiveSummary } from "../agent-output.js";
import { checkRules } from "../rules.js";
import { extractSubgraph } from "../subgraph.js";
import { deduplicateLLMUseCases } from "../llm-dedup.js";
import { getConfig, getPromptsPath } from "../config.js";
import { getGitInfo } from "../git.js";
import type { ArchitectureLayer } from "../types.js";
import * as fs from "fs";
import * as path from "path";

// --- Response helpers ---

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResponse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

// --- Tool definitions ---

export const TOOLS = [
  {
    name: "scan",
    description:
      "Scan project architecture — detect components (packages, services, databases) and connections between them. Use after adding dependencies, changing API routes, or modifying database schemas. Returns a summary of what was found and what changed since last scan.",
    inputSchema: {
      type: "object" as const,
      properties: {
        quick: {
          type: "boolean",
          description:
            "Quick scan (packages only, skip code analysis). Faster but less thorough.",
        },
      },
    },
    annotations: {
      title: "Scan Architecture",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "status",
    description:
      "Architecture summary — component counts by type/layer, connection counts, data freshness, and health overview. Use to get a quick picture of the project's architecture without running a new scan.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    annotations: {
      title: "Architecture Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "impact",
    description:
      "What breaks if you change this component? Shows downstream dependencies, affected files, and severity assessment. Use before modifying critical components like database tables, API endpoints, or shared services.",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: {
          type: "string",
          description:
            "Component name, file path, or partial match (e.g. 'prisma', 'stripe', 'api/users')",
        },
      },
      required: ["component"],
    },
    annotations: {
      title: "Impact Analysis",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "connections",
    description:
      "All connections for a component — incoming (what depends on it) and outgoing (what it depends on). Shows connection types, file locations, and semantic classification.",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: {
          type: "string",
          description:
            "Component name, file path, or partial match",
        },
        direction: {
          type: "string",
          enum: ["in", "out", "both"],
          description:
            "Filter direction: 'in' (dependents), 'out' (dependencies), 'both' (default)",
        },
      },
      required: ["component"],
    },
    annotations: {
      title: "Component Connections",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "diagram",
    description:
      "Generate a Mermaid architecture diagram. Modes: 'summary' (high-level overview), 'focus' (single component and its connections), 'layer' (grouped by architectural layer — specify which layer: frontend, backend, database, queue, infra, external).",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          enum: ["summary", "focus", "layer"],
          description: "Diagram mode (default: 'summary')",
        },
        focus: {
          type: "string",
          description:
            "Component name for 'focus' mode, or layer name for 'layer' mode (e.g. 'frontend', 'backend')",
        },
      },
    },
    annotations: {
      title: "Architecture Diagram",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "trace",
    description:
      "Trace dataflow paths through the architecture — follow how data moves from one component to others. Shows the chain of connections and which layers are crossed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: {
          type: "string",
          description: "Starting component for the trace",
        },
        direction: {
          type: "string",
          enum: ["forward", "backward", "both"],
          description:
            "Trace direction: 'forward' (downstream), 'backward' (upstream), 'both' (default)",
        },
      },
      required: ["component"],
    },
    annotations: {
      title: "Dataflow Trace",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "summary",
    description:
      "Executive summary with risks, blockers, and recommended next actions. Provides a high-level assessment of architecture health and areas needing attention.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    annotations: {
      title: "Executive Summary",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "review",
    description:
      "Composite architectural review — runs impact analysis, architecture rules, and runtime topology checks in a single call. Returns a compact, severity-scored report. Use before merging or after significant changes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: {
          type: "string",
          description: "Optional: focus review on a specific component",
        },
      },
    },
    annotations: {
      title: "Architecture Review",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "explore",
    description:
      "Deep dive into one component — shows its connections, runtime identity, impact severity, trace paths, and layer position in a single response. Use when you need to understand a component before modifying it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: {
          type: "string",
          description: "Component name, file path, or partial match",
        },
        depth: {
          type: "number",
          description: "How many hops to include (default: 2)",
        },
      },
      required: ["component"],
    },
    annotations: {
      title: "Explore Component",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "rules",
    description:
      "Check architecture against built-in rules — detects orphan components, layer violations, circular dependencies, hotspots, high fan-out, and more. Returns violations with severity and suggestions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    annotations: {
      title: "Architecture Rules",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

// --- Tool handlers ---

function getProjectRoot(): string {
  return process.cwd();
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case "scan":
        return await handleScan(args);
      case "status":
        return await handleStatus();
      case "impact":
        return await handleImpact(args);
      case "connections":
        return await handleConnections(args);
      case "diagram":
        return await handleDiagram(args);
      case "trace":
        return await handleTrace(args);
      case "summary":
        return await handleSummary();
      case "review":
        return await handleReview(args);
      case "explore":
        return await handleExplore(args);
      case "rules":
        return await handleRules();
      default:
        return errorResponse(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Tool execution failed"
    );
  }
}

async function handleScan(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectRoot = getProjectRoot();
  const quick = args.quick === true;

  const result = await scan(projectRoot, {
    quick,
    incremental: !quick,
  });

  const lines = [
    `Scan complete: ${result.stats.components_found} components, ${result.stats.connections_found} connections`,
    `Duration: ${result.stats.scan_duration_ms}ms`,
    `Files scanned: ${result.stats.files_scanned}`,
  ];

  if (result.stats.files_changed > 0) {
    lines.push(`Files changed since last scan: ${result.stats.files_changed}`);
  }

  if (result.warnings.length > 0) {
    lines.push(`\nWarnings (${result.warnings.length}):`);
    for (const w of result.warnings.slice(0, 5)) {
      lines.push(`- ${w.message}`);
    }
    if (result.warnings.length > 5) {
      lines.push(`  ... and ${result.warnings.length - 5} more`);
    }
  }

  // Component breakdown by type
  const byType: Record<string, number> = {};
  for (const c of result.components) {
    byType[c.type] = (byType[c.type] || 0) + 1;
  }
  const typeBreakdown = Object.entries(byType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");
  lines.push(`\nBy type: ${typeBreakdown}`);

  // Connection breakdown
  const connByType: Record<string, number> = {};
  for (const c of result.connections) {
    connByType[c.connection_type] = (connByType[c.connection_type] || 0) + 1;
  }
  if (Object.keys(connByType).length > 0) {
    const connBreakdown = Object.entries(connByType)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ");
    lines.push(`Connections: ${connBreakdown}`);
  }

  return textResponse(lines.join("\n"));
}

async function handleStatus(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const projectRoot = getProjectRoot();
  const status = await getScanStatus(projectRoot);

  if (!status.initialized) {
    return textResponse(
      "No architecture data found. Run the scan tool first to map the project."
    );
  }

  const config = getConfig();
  const index = await loadIndex(config, projectRoot);

  const staleness = status.needs_rescan ? "stale" : "fresh";
  const lastScanStr = status.last_scan
    ? new Date(status.last_scan).toISOString()
    : "unknown";

  const lines = [
    `Architecture data: ${staleness}`,
    `Last scan: ${lastScanStr}`,
    `Components: ${status.component_count}`,
    `Connections: ${status.connection_count}`,
  ];

  if (index) {
    if (index.stats.components_by_type) {
      const types = Object.entries(index.stats.components_by_type)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .map(([type, count]) => `${type}: ${count}`)
        .join(", ");
      lines.push(`\nBy type: ${types}`);
    }

    if (index.stats.outdated_count > 0) {
      lines.push(`Outdated packages: ${index.stats.outdated_count}`);
    }
    if (index.stats.vulnerable_count > 0) {
      lines.push(`Vulnerable packages: ${index.stats.vulnerable_count}`);
    }
  }

  return textResponse(lines.join("\n"));
}

async function handleImpact(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const query = String(args.component);
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return errorResponse(
      "No architecture data. Run the scan tool first."
    );
  }

  const component = resolveComponent(query, components);
  if (!component) {
    const candidates = findCandidates(query, components, 5);
    if (candidates.length > 0) {
      return errorResponse(
        `Component "${query}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`
      );
    }
    return errorResponse(`Component "${query}" not found.`);
  }

  const impact = computeImpact(component, components, connections);

  const lines = [
    `Impact analysis for: ${component.name} (${component.type})`,
    `Severity: ${impact.severity.toUpperCase()}`,
    `${impact.summary}`,
    `Total files affected: ${impact.total_files_affected}`,
  ];

  if (impact.affected.length > 0) {
    lines.push(`\nAffected components (${impact.affected.length}):`);
    for (const a of impact.affected.slice(0, 10)) {
      lines.push(
        `- ${a.component.name} (${a.component.type}) — ${a.change_required}`
      );
    }
    if (impact.affected.length > 10) {
      lines.push(`  ... and ${impact.affected.length - 10} more`);
    }
  }

  return textResponse(lines.join("\n"));
}

async function handleConnections(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const query = String(args.component);
  const direction = (args.direction as string) || "both";
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return errorResponse("No architecture data. Run the scan tool first.");
  }

  const component = resolveComponent(query, components);
  if (!component) {
    const candidates = findCandidates(query, components, 5);
    if (candidates.length > 0) {
      return errorResponse(
        `Component "${query}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`
      );
    }
    return errorResponse(`Component "${query}" not found.`);
  }

  const outgoing =
    direction === "in"
      ? []
      : connections.filter(
          (c) => c.from.component_id === component.component_id
        );
  const incoming =
    direction === "out"
      ? []
      : connections.filter(
          (c) => c.to.component_id === component.component_id
        );

  const lines = [
    `Connections for: ${component.name} (${component.type}, ${component.role.layer})`,
  ];

  if (outgoing.length > 0) {
    lines.push(`\nOutgoing (${outgoing.length} — what this depends on):`);
    for (const c of outgoing.slice(0, 15)) {
      const target = components.find(
        (comp) => comp.component_id === c.to.component_id
      );
      const targetName = target ? target.name : c.to.component_id;
      const semantic = c.semantic
        ? ` [${c.semantic.classification}]`
        : "";
      const fileRef = c.code_reference?.file
        ? `${path.basename(c.code_reference.file)}:${c.code_reference.line_start ?? c.code_reference.symbol ?? "?"}`
        : "";
      lines.push(
        `- ${targetName} (${c.connection_type})${semantic}${fileRef ? ` -- ${fileRef}` : ""}`
      );
    }
    if (outgoing.length > 15) {
      lines.push(`  ... and ${outgoing.length - 15} more`);
    }
  }

  if (incoming.length > 0) {
    lines.push(`\nIncoming (${incoming.length} — what depends on this):`);
    for (const c of incoming.slice(0, 15)) {
      const source = components.find(
        (comp) => comp.component_id === c.from.component_id
      );
      const sourceName = source ? source.name : c.from.component_id;
      const semantic = c.semantic
        ? ` [${c.semantic.classification}]`
        : "";
      const fileRef = c.code_reference?.file
        ? `${path.basename(c.code_reference.file)}:${c.code_reference.line_start ?? c.code_reference.symbol ?? "?"}`
        : "";
      lines.push(
        `- ${sourceName} (${c.connection_type})${semantic}${fileRef ? ` -- ${fileRef}` : ""}`
      );
    }
    if (incoming.length > 15) {
      lines.push(`  ... and ${incoming.length - 15} more`);
    }
  }

  if (outgoing.length === 0 && incoming.length === 0) {
    lines.push("\nNo connections found (orphaned component).");
  }

  return textResponse(lines.join("\n"));
}

async function handleDiagram(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const mode = (args.mode as string) || "summary";
  const focus = args.focus as string | undefined;
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const graph = await loadGraph(config, projectRoot);
  if (!graph) {
    return errorResponse("No graph data. Run the scan tool first.");
  }

  if (mode === "focus") {
    if (!focus) {
      return errorResponse(
        "The 'focus' parameter is required when mode is 'focus'."
      );
    }

    const components = await loadAllComponents(config, projectRoot);
    const component = resolveComponent(focus, components);

    if (!component) {
      const candidates = findCandidates(focus, components, 5);
      if (candidates.length > 0) {
        return errorResponse(
          `Component "${focus}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`
        );
      }
      return errorResponse(`Component "${focus}" not found.`);
    }

    const diagram = generateComponentDiagram(
      graph,
      component.component_id
    );
    return textResponse(
      `Architecture diagram (focus: ${component.name}):\n\n\`\`\`mermaid\n${diagram}\n\`\`\``
    );
  }

  if (mode === "layer") {
    const layer = (focus || "backend") as ArchitectureLayer;
    const diagram = generateLayerDiagram(graph, layer);
    return textResponse(
      `Architecture diagram (${layer} layer):\n\n\`\`\`mermaid\n${diagram}\n\`\`\``
    );
  }

  // Default: summary
  const diagram = generateSummaryDiagram(graph);
  return textResponse(
    `Architecture diagram (summary):\n\n\`\`\`mermaid\n${diagram}\n\`\`\``
  );
}

async function handleTrace(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const query = String(args.component);
  const direction =
    (args.direction as "forward" | "backward" | "both") || "both";
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return errorResponse("No architecture data. Run the scan tool first.");
  }

  const component = resolveComponent(query, components);
  if (!component) {
    const candidates = findCandidates(query, components, 5);
    if (candidates.length > 0) {
      return errorResponse(
        `Component "${query}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`
      );
    }
    return errorResponse(`Component "${query}" not found.`);
  }

  const result = traceDataflow(component, components, connections, {
    direction,
  });

  return textResponse(formatTraceOutput(result));
}

async function handleSummary(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return textResponse(
      "No architecture data found. Run the scan tool first to map the project."
    );
  }

  const git = await getGitInfo(projectRoot);
  const summary = buildExecutiveSummary(
    components,
    connections,
    projectRoot,
    git || undefined
  );

  const projectName = projectRoot.split("/").pop() || projectRoot;
  const lines = [
    `Executive Summary — ${projectName}`,
    `Components: ${summary.stats.total_components} | Connections: ${summary.stats.total_connections}`,
  ];

  if (summary.risks.length > 0) {
    lines.push(`\nRisks (${summary.risks.length}):`);
    for (const r of summary.risks.slice(0, 10)) {
      lines.push(`[${r.severity.toUpperCase()}] ${r.message}`);
    }
    if (summary.risks.length > 10) {
      lines.push(`  ... and ${summary.risks.length - 10} more`);
    }
  }

  if (summary.blockers.length > 0) {
    lines.push(`\nBlockers (${summary.blockers.length}):`);
    for (const b of summary.blockers) {
      lines.push(`- ${b.message}`);
    }
  }

  if (summary.next_actions.length > 0) {
    lines.push(`\nRecommended actions:`);
    for (const a of summary.next_actions) {
      lines.push(`- ${a.action}${a.reason ? ` — ${a.reason}` : ""}`);
    }
  }

  return textResponse(lines.join("\n"));
}

async function handleReview(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return errorResponse("No architecture data. Run the scan tool first.");
  }

  const lines: string[] = ["ARCHITECTURE REVIEW"];

  // 1. Rules check — grouped by severity, capped at 5 per group
  const violations = checkRules(components, connections);
  if (violations.length > 0) {
    lines.push(`\nRule violations (${violations.length}):`);
    const bySev: Record<string, typeof violations> = {};
    for (const v of violations) {
      if (!bySev[v.severity]) bySev[v.severity] = [];
      bySev[v.severity].push(v);
    }
    for (const sev of ["error", "warning", "info"]) {
      const group = bySev[sev];
      if (!group || group.length === 0) continue;
      lines.push(`\n${sev.toUpperCase()} (${group.length}):`);
      for (const v of group.slice(0, 5)) {
        lines.push(`[${v.severity.toUpperCase()}] ${v.message}`);
        if (v.suggestion) lines.push(`  -> ${v.suggestion}`);
      }
      if (group.length > 5) {
        lines.push(`  ... and ${group.length - 5} more ${sev} violations`);
      }
    }
  } else {
    lines.push("\nRules: all passed");
  }

  // 2. Focused impact (if component specified)
  const focusQuery = args.component as string | undefined;
  if (focusQuery) {
    const component = resolveComponent(focusQuery, components);
    if (component) {
      const impact = computeImpact(component, components, connections);
      lines.push(`\nImpact for ${component.name}: ${impact.severity.toUpperCase()}`);
      lines.push(impact.summary);
      if (impact.affected.length > 0) {
        lines.push(`Affected: ${impact.affected.slice(0, 5).map(a => a.component.name).join(", ")}${impact.affected.length > 5 ? ` +${impact.affected.length - 5} more` : ""}`);
      }
    }
  }

  // 3. Runtime topology summary
  const withRuntime = components.filter(c => c.runtime?.resource_type);
  if (withRuntime.length > 0) {
    const rtGroups: Record<string, number> = {};
    for (const c of withRuntime) {
      const rt = c.runtime!.resource_type!;
      rtGroups[rt] = (rtGroups[rt] || 0) + 1;
    }
    const rtSummary = Object.entries(rtGroups).map(([t, n]) => `${t}: ${n}`).join(", ");
    lines.push(`\nRuntime topology: ${rtSummary}`);
  }

  // 4. LLM use case summary
  try {
    let prompts;
    try {
      const promptsPath = getPromptsPath(config, projectRoot);
      const raw = await fs.promises.readFile(promptsPath, "utf-8");
      prompts = JSON.parse(raw)?.prompts;
    } catch { /* no prompts */ }

    const dedup = deduplicateLLMUseCases(components, connections, prompts);
    if (dedup.useCases.length > 0) {
      lines.push(`\nAI/LLM: ${dedup.useCases.length} use cases across ${dedup.providers.length} providers`);
    }
  } catch { /* dedup not available */ }

  return textResponse(lines.join("\n"));
}

async function handleExplore(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const query = String(args.component);
  const depth = typeof args.depth === "number" ? args.depth : 2;
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return errorResponse("No architecture data. Run the scan tool first.");
  }

  const component = resolveComponent(query, components);
  if (!component) {
    const candidates = findCandidates(query, components, 5);
    if (candidates.length > 0) {
      return errorResponse(
        `Component "${query}" not found. Did you mean:\n${candidates.map(c => `- ${c}`).join("\n")}`
      );
    }
    return errorResponse(`Component "${query}" not found.`);
  }

  const lines: string[] = [
    `COMPONENT: ${component.name}`,
    `Type: ${component.type} | Layer: ${component.role.layer} | Status: ${component.status}`,
    `Purpose: ${component.role.purpose}`,
  ];

  // Runtime identity
  if (component.runtime) {
    const r = component.runtime;
    const parts: string[] = [];
    if (r.engine) parts.push(`engine: ${r.engine}`);
    if (r.service_name) parts.push(`service: ${r.service_name}`);
    if (r.platform) parts.push(`platform: ${r.platform}`);
    if (r.endpoint?.host) parts.push(`host: ${r.endpoint.host}${r.endpoint.port ? `:${r.endpoint.port}` : ""}`);
    if (r.connection_env_var) parts.push(`env: ${r.connection_env_var}`);
    if (parts.length > 0) {
      lines.push(`Runtime: ${parts.join(", ")}`);
    }
  }

  // Impact
  const impact = computeImpact(component, components, connections);
  lines.push(`\nImpact severity: ${impact.severity.toUpperCase()} (${impact.total_files_affected} files)`);

  // Connections
  const outgoing = connections.filter(c => c.from.component_id === component.component_id);
  const incoming = connections.filter(c => c.to.component_id === component.component_id);

  if (outgoing.length > 0) {
    lines.push(`\nDepends on (${outgoing.length}):`);
    for (const c of outgoing.slice(0, 10)) {
      const target = components.find(comp => comp.component_id === c.to.component_id);
      lines.push(`  → ${target?.name || c.to.component_id} (${c.connection_type})`);
    }
    if (outgoing.length > 10) lines.push(`  ... +${outgoing.length - 10} more`);
  }

  if (incoming.length > 0) {
    lines.push(`\nDepended on by (${incoming.length}):`);
    for (const c of incoming.slice(0, 10)) {
      const source = components.find(comp => comp.component_id === c.from.component_id);
      lines.push(`  ← ${source?.name || c.from.component_id} (${c.connection_type})`);
    }
    if (incoming.length > 10) lines.push(`  ... +${incoming.length - 10} more`);
  }

  // Trace
  const trace = traceDataflow(component, components, connections, { direction: "both", maxDepth: depth });
  if (trace.paths.length > 0) {
    lines.push(`\nData flow paths (${trace.paths.length}, layers: ${trace.layers_crossed.join(" → ")}):`);
    for (const p of trace.paths.slice(0, 5)) {
      const chain = p.steps.map(s => s.component.n).join(" → ");
      lines.push(`  ${chain}`);
    }
    if (trace.paths.length > 5) lines.push(`  ... +${trace.paths.length - 5} more paths`);
  }

  return textResponse(lines.join("\n"));
}

async function handleRules(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const projectRoot = getProjectRoot();
  const config = getConfig();

  const components = await loadAllComponents(config, projectRoot);
  const connections = await loadAllConnections(config, projectRoot);

  if (components.length === 0) {
    return textResponse("No architecture data. Run the scan tool first.");
  }

  const violations = checkRules(components, connections);

  if (violations.length === 0) {
    return textResponse("All architecture rules passed. No violations detected.");
  }

  const byLevel: Record<string, typeof violations> = {};
  for (const v of violations) {
    if (!byLevel[v.severity]) byLevel[v.severity] = [];
    byLevel[v.severity].push(v);
  }

  const lines = [`Architecture rule violations (${violations.length}):`];
  for (const level of ["error", "warning", "info"]) {
    const group = byLevel[level];
    if (!group) continue;
    lines.push(`\n${level.toUpperCase()} (${group.length}):`);
    for (const v of group.slice(0, 10)) {
      lines.push(`- ${v.message}${v.suggestion ? ` → ${v.suggestion}` : ""}`);
    }
    if (group.length > 10) lines.push(`  ... +${group.length - 10} more`);
  }

  return textResponse(lines.join("\n"));
}
