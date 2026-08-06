/**
 * NavGator MCP Tool Definitions
 *
 * Each tool maps to existing NavGator programmatic APIs.
 * Responses are formatted as concise text for LLM consumption.
 */
import { scan, getScanStatus, autoRefreshIfStale } from "../scanner.js";
import { loadAllComponents, loadAllConnections, loadIndex, loadGraph, } from "../storage.js";
import { computeImpact } from "../impact.js";
import { resolveComponent, findCandidates } from "../resolve.js";
import { traceDataflow, formatTraceOutput } from "../trace.js";
import { generateComponentDiagram, generateLayerDiagram, generateSummaryDiagram, } from "../diagram.js";
import { buildExecutiveSummary } from "../agent-output.js";
import { checkRules } from "../rules.js";
import { getConfig } from "../config.js";
import { buildExploreReport, formatExploreReport } from "../explore-report.js";
import { buildReviewReport, formatReviewReport } from "../review-report.js";
import { getGitInfo } from "../git.js";
import { listProjects } from "../projects.js";
import { scanPortfolio, assertLocalStorageMode, excludeRemoteOriginProjects, formatRemoteExclusionNote, } from "../portfolio/scan.js";
import { buildCrossRepoMap } from "../portfolio/cross-repo.js";
import { writeSnapshotForCurrentRef } from "../git-aware/canonical.js";
import { premergeDiff } from "../git-aware/premerge-diff.js";
import { defaultCacheRoot } from "../remote/clone.js";
import * as path from "path";
/** Always present, in every output mode, per the plan's heuristic-labeling requirement. */
const SERVICE_CALL_DISCLAIMER = "serviceCalls are heuristic/inferred (host-match or service-name-match) — not a verified call graph.";
// --- Response helpers ---
function textResponse(text) {
    return { content: [{ type: "text", text }] };
}
function errorResponse(text) {
    return { content: [{ type: "text", text }], isError: true };
}
// --- Tool definitions ---
export const TOOLS = [
    {
        name: "scan",
        description: "Scan project architecture — detect components (packages, services, databases) and connections between them. Use after adding dependencies, changing API routes, or modifying database schemas. Returns a summary of what was found and what changed since last scan.",
        inputSchema: {
            type: "object",
            properties: {
                quick: {
                    type: "boolean",
                    description: "Quick scan (packages only, skip code analysis). Faster but less thorough.",
                },
                content: {
                    type: "boolean",
                    description: "Scan Markdown documents and internal content links in addition to code architecture.",
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
        description: "Architecture summary — component counts by type/layer, connection counts, data freshness, and health overview. Use to get a quick picture of the project's architecture without running a new scan.",
        inputSchema: {
            type: "object",
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
        description: "What breaks if you change this component? Shows downstream dependencies, affected files, and severity assessment. Use before modifying critical components like database tables, API endpoints, or shared services.",
        inputSchema: {
            type: "object",
            properties: {
                component: {
                    type: "string",
                    description: "Component name, file path, or partial match (e.g. 'prisma', 'stripe', 'api/users')",
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
        description: "All connections for a component — incoming (what depends on it) and outgoing (what it depends on). Shows connection types, file locations, and semantic classification.",
        inputSchema: {
            type: "object",
            properties: {
                component: {
                    type: "string",
                    description: "Component name, file path, or partial match",
                },
                direction: {
                    type: "string",
                    enum: ["in", "out", "both"],
                    description: "Filter direction: 'in' (dependents), 'out' (dependencies), 'both' (default)",
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
        description: "Generate a Mermaid architecture diagram. Modes: 'summary' (high-level overview), 'focus' (single component and its connections), 'layer' (grouped by architectural layer — specify which layer: frontend, backend, database, queue, infra, content, external).",
        inputSchema: {
            type: "object",
            properties: {
                mode: {
                    type: "string",
                    enum: ["summary", "focus", "layer"],
                    description: "Diagram mode (default: 'summary')",
                },
                focus: {
                    type: "string",
                    description: "Component name for 'focus' mode, or layer name for 'layer' mode (e.g. 'frontend', 'backend')",
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
        description: "Trace dataflow paths through the architecture — follow how data moves from one component to others. Shows the chain of connections and which layers are crossed.",
        inputSchema: {
            type: "object",
            properties: {
                component: {
                    type: "string",
                    description: "Starting component for the trace",
                },
                direction: {
                    type: "string",
                    enum: ["forward", "backward", "both"],
                    description: "Trace direction: 'forward' (downstream), 'backward' (upstream), 'both' (default)",
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
        description: "Executive summary with risks, blockers, and recommended next actions. Provides a high-level assessment of architecture health and areas needing attention.",
        inputSchema: {
            type: "object",
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
        description: "Composite architectural review — runs impact analysis, architecture rules, and runtime topology checks in a single call. Returns a compact, severity-scored report. Use before merging or after significant changes.",
        inputSchema: {
            type: "object",
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
        description: "Deep dive into one component — shows its connections, runtime identity, impact severity, trace paths, and layer position in a single response. Use when you need to understand a component before modifying it.",
        inputSchema: {
            type: "object",
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
        description: "Check architecture against built-in rules — detects orphan components, layer violations, circular dependencies, hotspots, high fan-out, and more. Returns violations with severity and suggestions.",
        inputSchema: {
            type: "object",
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
    {
        name: "portfolio",
        description: "Cross-repo architecture map. With 'dir', re-scans an already-registered NavGator project root and builds a shared-dependency and cross-repo service-call map (run `navgator scan` there first, or use the CLI, if it isn't registered yet — this tool will not sweep an arbitrary, previously-unseen filesystem path). Without 'dir', reports status over already-registered projects without scanning anything. Service-call edges are heuristic (host or service-name match), never a verified call graph — always labeled as such.",
        inputSchema: {
            type: "object",
            properties: {
                dir: {
                    type: "string",
                    description: "Path to an already-registered NavGator project root (each containing a .git dir or file). Must exactly match a path already known to the project registry; never a directory under the remote-scan cache root. Omit to report over already-registered projects instead of scanning.",
                },
                depth: {
                    type: "number",
                    description: "Directory depth to search for repos below 'dir' (default 1, max 3).",
                },
                concurrency: {
                    type: "number",
                    description: "Concurrent repo scans when 'dir' is given (default 1, max 4).",
                },
            },
        },
        annotations: {
            title: "Portfolio Scan",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
    {
        name: "arch_diff",
        description: "Pre-merge architecture diff — compares the current git branch's recorded architecture snapshot against the canonical (default-branch) baseline, or a named 'base' ref, so topology drift is visible before a merge. Read-only unless 'record' is true, which additionally writes the current ref's snapshot before diffing. A missing base or head snapshot returns available:false with an actionable reason, never an empty diff.",
        inputSchema: {
            type: "object",
            properties: {
                base: {
                    type: "string",
                    description: "Diff against this ref's recorded snapshot instead of the canonical baseline.",
                },
                record: {
                    type: "boolean",
                    description: "Also write the current ref's snapshot before diffing (canonical if on the default branch, else a branch-delta snapshot).",
                },
            },
        },
        annotations: {
            title: "Pre-Merge Architecture Diff",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
];
// --- Tool handlers ---
function getProjectRoot() {
    return process.cwd();
}
export async function handleToolCall(name, args) {
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
            case "portfolio":
                return await handlePortfolio(args);
            case "arch_diff":
                return await handleArchDiff(args);
            default:
                return errorResponse(`Unknown tool: ${name}`);
        }
    }
    catch (err) {
        return errorResponse(err instanceof Error ? err.message : "Tool execution failed");
    }
}
async function handleScan(args) {
    const projectRoot = getProjectRoot();
    const quick = args.quick === true;
    const content = args.content === true;
    const result = await scan(projectRoot, {
        quick,
        content,
        mode: "auto",
    });
    if (result.status === 'busy') {
        return errorResponse(`Scan busy (retryable): ${result.message}`);
    }
    const lines = [
        `${result.status === 'noop' ? 'Scan no changes' : 'Scan complete'}: ${result.stats.components_found} components, ${result.stats.connections_found} connections`,
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
    const byType = {};
    for (const c of result.components) {
        byType[c.type] = (byType[c.type] || 0) + 1;
    }
    const typeBreakdown = Object.entries(byType)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => `${type}: ${count}`)
        .join(", ");
    lines.push(`\nBy type: ${typeBreakdown}`);
    // Connection breakdown
    const connByType = {};
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
async function handleStatus() {
    const projectRoot = getProjectRoot();
    // R6 auto-refresh: cheapest read entrypoint — kick an incremental scan
    // when the index is stale so callers never operate on a graph that is
    // hours/days behind reality. Best-effort: failures don't block status.
    const refresh = await autoRefreshIfStale(projectRoot);
    const status = await getScanStatus(projectRoot);
    if (!status.initialized) {
        return textResponse("No architecture data found. Run the scan tool first to map the project.");
    }
    const config = getConfig();
    const index = await loadIndex(config, projectRoot);
    const staleness = status.needs_rescan ? "stale" : "fresh";
    const lastScanStr = status.last_scan
        ? new Date(status.last_scan).toISOString()
        : "unknown";
    const lines = [];
    if (refresh.refreshed || refresh.reason === 'busy') {
        lines.push(refresh.message);
    }
    lines.push(`Architecture data: ${staleness}`, `Last scan: ${lastScanStr}`, `Components: ${status.component_count}`, `Connections: ${status.connection_count}`);
    if (index) {
        if (index.stats.components_by_type) {
            const types = Object.entries(index.stats.components_by_type)
                .sort(([, a], [, b]) => b - a)
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
async function handleImpact(args) {
    const query = String(args.component);
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
            return errorResponse(`Component "${query}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`);
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
            lines.push(`- ${a.component.name} (${a.component.type}) — ${a.change_required}`);
        }
        if (impact.affected.length > 10) {
            lines.push(`  ... and ${impact.affected.length - 10} more`);
        }
    }
    return textResponse(lines.join("\n"));
}
async function handleConnections(args) {
    const query = String(args.component);
    const direction = args.direction || "both";
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
            return errorResponse(`Component "${query}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`);
        }
        return errorResponse(`Component "${query}" not found.`);
    }
    const outgoing = direction === "in"
        ? []
        : connections.filter((c) => c.from.component_id === component.component_id);
    const incoming = direction === "out"
        ? []
        : connections.filter((c) => c.to.component_id === component.component_id);
    const lines = [
        `Connections for: ${component.name} (${component.type}, ${component.role.layer})`,
    ];
    if (outgoing.length > 0) {
        lines.push(`\nOutgoing (${outgoing.length} — what this depends on):`);
        for (const c of outgoing.slice(0, 15)) {
            const target = components.find((comp) => comp.component_id === c.to.component_id);
            const targetName = target ? target.name : c.to.component_id;
            const semantic = c.semantic
                ? ` [${c.semantic.classification}]`
                : "";
            const fileRef = c.code_reference?.file
                ? `${path.basename(c.code_reference.file)}:${c.code_reference.line_start ?? c.code_reference.symbol ?? "?"}`
                : "";
            lines.push(`- ${targetName} (${c.connection_type})${semantic}${fileRef ? ` -- ${fileRef}` : ""}`);
        }
        if (outgoing.length > 15) {
            lines.push(`  ... and ${outgoing.length - 15} more`);
        }
    }
    if (incoming.length > 0) {
        lines.push(`\nIncoming (${incoming.length} — what depends on this):`);
        for (const c of incoming.slice(0, 15)) {
            const source = components.find((comp) => comp.component_id === c.from.component_id);
            const sourceName = source ? source.name : c.from.component_id;
            const semantic = c.semantic
                ? ` [${c.semantic.classification}]`
                : "";
            const fileRef = c.code_reference?.file
                ? `${path.basename(c.code_reference.file)}:${c.code_reference.line_start ?? c.code_reference.symbol ?? "?"}`
                : "";
            lines.push(`- ${sourceName} (${c.connection_type})${semantic}${fileRef ? ` -- ${fileRef}` : ""}`);
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
async function handleDiagram(args) {
    const mode = args.mode || "summary";
    const focus = args.focus;
    const projectRoot = getProjectRoot();
    const config = getConfig();
    const graph = await loadGraph(config, projectRoot);
    if (!graph) {
        return errorResponse("No graph data. Run the scan tool first.");
    }
    if (mode === "focus") {
        if (!focus) {
            return errorResponse("The 'focus' parameter is required when mode is 'focus'.");
        }
        const components = await loadAllComponents(config, projectRoot);
        const component = resolveComponent(focus, components);
        if (!component) {
            const candidates = findCandidates(focus, components, 5);
            if (candidates.length > 0) {
                return errorResponse(`Component "${focus}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`);
            }
            return errorResponse(`Component "${focus}" not found.`);
        }
        const diagram = generateComponentDiagram(graph, component.component_id);
        return textResponse(`Architecture diagram (focus: ${component.name}):\n\n\`\`\`mermaid\n${diagram}\n\`\`\``);
    }
    if (mode === "layer") {
        const layer = (focus || "backend");
        const diagram = generateLayerDiagram(graph, layer);
        return textResponse(`Architecture diagram (${layer} layer):\n\n\`\`\`mermaid\n${diagram}\n\`\`\``);
    }
    // Default: summary
    const diagram = generateSummaryDiagram(graph);
    return textResponse(`Architecture diagram (summary):\n\n\`\`\`mermaid\n${diagram}\n\`\`\``);
}
async function handleTrace(args) {
    const query = String(args.component);
    const direction = args.direction || "both";
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
            return errorResponse(`Component "${query}" not found. Did you mean:\n${candidates.map((c) => `- ${c}`).join("\n")}`);
        }
        return errorResponse(`Component "${query}" not found.`);
    }
    const result = traceDataflow(component, components, connections, {
        direction,
    });
    return textResponse(formatTraceOutput(result));
}
async function handleSummary() {
    const projectRoot = getProjectRoot();
    const config = getConfig();
    const components = await loadAllComponents(config, projectRoot);
    const connections = await loadAllConnections(config, projectRoot);
    if (components.length === 0) {
        return textResponse("No architecture data found. Run the scan tool first to map the project.");
    }
    const git = await getGitInfo(projectRoot);
    const summary = buildExecutiveSummary(components, connections, projectRoot, git || undefined);
    const projectName = projectRoot.split("/").pop() || projectRoot;
    const lines = [
        `Executive Summary — ${projectName}`,
        `Components: ${summary.stats.total_components} | Connections: ${summary.stats.total_connections}`,
        `Architecture rules: ${summary.rule_health.errors} error(s), ${summary.rule_health.warnings} warning(s), ${summary.rule_health.info} info`,
    ];
    if (summary.rule_health.errors > 0) {
        lines.push(`\nArchitecture rule errors (${summary.rule_health.errors}):`);
        for (const violation of summary.rule_health.violations.filter((item) => item.severity === 'error')) {
            lines.push(`- ${violation.message}`);
        }
        const returnedErrors = summary.rule_health.violations.filter((item) => item.severity === 'error').length;
        if (summary.rule_health.errors > returnedErrors) {
            lines.push(`  ... and ${summary.rule_health.errors - returnedErrors} more error(s)`);
        }
    }
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
async function handleReview(args) {
    const projectRoot = getProjectRoot();
    const focusQuery = args.component;
    const report = await buildReviewReport({ projectRoot, component: focusQuery });
    if ("error" in report) {
        return errorResponse(report.error);
    }
    return textResponse(formatReviewReport(report));
}
async function handleExplore(args) {
    const query = String(args.component);
    const depth = typeof args.depth === "number" ? args.depth : 2;
    const projectRoot = getProjectRoot();
    const report = await buildExploreReport(query, { projectRoot, depth });
    if ("error" in report) {
        return errorResponse(report.error);
    }
    return textResponse(formatExploreReport(report));
}
async function handleRules() {
    const projectRoot = getProjectRoot();
    const config = getConfig();
    const components = await loadAllComponents(config, projectRoot);
    const connections = await loadAllConnections(config, projectRoot);
    if (components.length === 0) {
        return textResponse("No architecture data. Run the scan tool first.");
    }
    const violations = checkRules(components, connections, undefined, projectRoot);
    if (violations.length === 0) {
        return textResponse("All architecture rules passed. No violations detected.");
    }
    const byLevel = {};
    for (const v of violations) {
        if (!byLevel[v.severity])
            byLevel[v.severity] = [];
        byLevel[v.severity].push(v);
    }
    const lines = [`Architecture rule violations (${violations.length}):`];
    for (const level of ["error", "warning", "info"]) {
        const group = byLevel[level];
        if (!group)
            continue;
        lines.push(`\n${level.toUpperCase()} (${group.length}):`);
        for (const v of group.slice(0, 10)) {
            lines.push(`- ${v.message}${v.suggestion ? ` → ${v.suggestion}` : ""}`);
        }
        if (group.length > 10)
            lines.push(`  ... +${group.length - 10} more`);
    }
    return textResponse(lines.join("\n"));
}
async function handlePortfolio(args) {
    const dir = typeof args.dir === "string" ? args.dir : undefined;
    const config = getConfig();
    if (!dir) {
        // f4: scanPortfolio() refuses shared storage mode internally, but this
        // no-dir status path bypasses scanPortfolio entirely — it fans out
        // loadAllComponents/loadAllConnections directly across every registered
        // project (below). In shared mode getStoragePath ignores projectRoot
        // and resolves one path under $HOME (src/config.ts:114-118), so every
        // project would load the SAME data and buildCrossRepoMap would fabricate
        // cross-repo sharing/service-call edges across all of them. Repeat the
        // same guard scanPortfolio uses rather than assume this path is safe by
        // omission.
        assertLocalStorageMode(config);
        // The 'dir' branch below refuses the remote-scan cache root, but that guard
        // does nothing here: `scan-remote` REGISTERS the clone, so a remote repo's
        // fabricated component names, descriptions, and prompt strings would flow
        // into this fan-out — an agent-reachable surface — with no marking at all.
        // `excludeRemoteOriginProjects` (src/portfolio/scan.ts) is the single
        // implementation of that exclusion, shared with the CLI's identical no-dir
        // fan-out (src/cli/commands/portfolio.ts) so the two cannot drift. See its
        // doc comment for why the check is by PATH as well as by flag.
        const projects = await listProjects();
        const { local: localProjects, skippedRemote } = excludeRemoteOriginProjects(projects);
        const inputs = [];
        for (const p of localProjects) {
            const components = await loadAllComponents(config, p.path);
            const connections = await loadAllConnections(config, p.path);
            inputs.push({ repo: p.path, components, connections, lastScan: p.lastScan });
        }
        const map = buildCrossRepoMap(inputs);
        const exclusionNote = formatRemoteExclusionNote(skippedRemote);
        return textResponse(formatPortfolioMap(map) + (exclusionNote ? `\n\n${exclusionNote}` : ''));
    }
    // SEC-004: 'dir' was previously a free-form path handed straight to
    // path.resolve() -> scanPortfolio(), which both reads from an arbitrary
    // filesystem location on an LLM's instruction and writes a managed
    // .gitignore/.git/info/exclude block into every repo it discovers
    // (src/gitignore-safety.ts) — destructiveHint:false understated that.
    // Constrain 'dir' to a path the project registry already knows about
    // (mirrors the no-dir branch above, which only ever touches registered
    // projects), and explicitly refuse the remote-scan cache root regardless
    // of registration status: that's the one location a human-gated
    // `navgator scan-remote` deliberately deposits untrusted cloned code, and
    // an injected instruction routing through this MCP-reachable tool would
    // otherwise be an unguarded back door to `scan_remote`'s deliberately
    // withheld network fetch (AGENTS.md:148).
    const resolvedDir = path.resolve(dir);
    const cacheRoot = path.resolve(defaultCacheRoot());
    if (resolvedDir === cacheRoot || resolvedDir.startsWith(cacheRoot + path.sep)) {
        return errorResponse(`Refusing 'dir' under the remote-scan cache root (${cacheRoot}): this is where ` +
            "`navgator scan-remote` deposits shallow clones of untrusted, human-approved repos. " +
            "The MCP 'portfolio' tool will not scan it — use the CLI directly if this is genuinely intended.");
    }
    const projects = await listProjects();
    const registeredRoots = new Set(projects.map((p) => path.resolve(p.path)));
    if (!registeredRoots.has(resolvedDir)) {
        return errorResponse(`Refusing 'dir' that is not an already-registered NavGator project root: ${resolvedDir}. ` +
            "The MCP 'portfolio' tool only re-scans directories NavGator already knows about " +
            "(run `navgator scan` there once, or use the CLI directly) — it will not sweep an " +
            "arbitrary, previously-unseen filesystem path on an LLM's instruction.");
    }
    const depth = typeof args.depth === "number" ? args.depth : 1;
    const concurrency = typeof args.concurrency === "number" ? args.concurrency : 1;
    const scanResult = await scanPortfolio(resolvedDir, { depth, concurrency });
    const inputs = [];
    for (const r of scanResult.repos) {
        const canLoad = r.status === "scanned" || r.status === "noop";
        const components = canLoad ? await loadAllComponents(config, r.path) : [];
        const connections = canLoad ? await loadAllConnections(config, r.path) : [];
        inputs.push({ repo: r.path, components, connections, scanStatus: r.status });
    }
    const map = buildCrossRepoMap(inputs);
    return textResponse(formatPortfolioMap(map, scanResult));
}
function formatPortfolioMap(map, scanResult) {
    const lines = [];
    if (scanResult) {
        lines.push(`Scanned ${scanResult.repos.length} repo(s) under ${scanResult.root}`);
        lines.push(`  completed/noop: ${scanResult.scanned + scanResult.noop}  busy: ${scanResult.busy}  failed: ${scanResult.failed}`);
        for (const r of scanResult.repos) {
            const detail = r.status === "busy" || r.status === "failed"
                ? ` (${r.message ?? "no detail"})`
                : r.stats
                    ? ` (${r.stats.components} components, ${r.stats.connections} connections)`
                    : "";
            lines.push(`  - ${r.name}: ${r.status}${detail}`);
        }
    }
    lines.push(`Status: ${map.status.repoCount} repo(s), ${map.status.totalComponents} components, ${map.status.totalConnections} connections`);
    if (map.status.staleRepos.length > 0)
        lines.push(`  Stale (>24h): ${map.status.staleRepos.join(", ")}`);
    if (map.status.failedRepos.length > 0)
        lines.push(`  Failed: ${map.status.failedRepos.join(", ")}`);
    if (map.status.busyRepos.length > 0)
        lines.push(`  Busy: ${map.status.busyRepos.join(", ")}`);
    lines.push(`\nShared dependencies (${map.sharedDependencies.length}):`);
    for (const d of map.sharedDependencies.slice(0, 15)) {
        const skew = d.versionSkew ? " [version skew]" : "";
        const versions = d.repos.map((r) => `${r.repo}@${r.version ?? "?"}`).join(", ");
        lines.push(`  - ${d.name} (${d.type})${skew}: ${versions}`);
    }
    if (map.sharedDependencies.length > 15)
        lines.push(`  ... +${map.sharedDependencies.length - 15} more`);
    lines.push(`\nCross-repo service calls — ${SERVICE_CALL_DISCLAIMER} (${map.serviceCalls.length}):`);
    for (const e of map.serviceCalls.slice(0, 15)) {
        lines.push(`  - ${e.fromRepo}:${e.fromComponent} -> ${e.toRepo}:${e.toComponent} [${e.basis}, confidence ${e.confidence.toFixed(2)}]`);
    }
    if (map.serviceCalls.length > 15)
        lines.push(`  ... +${map.serviceCalls.length - 15} more`);
    return lines.join("\n");
}
async function handleArchDiff(args) {
    const projectRoot = getProjectRoot();
    const base = typeof args.base === "string" ? args.base : undefined;
    const record = args.record === true;
    let recorded;
    if (record) {
        recorded = await writeSnapshotForCurrentRef(projectRoot);
    }
    const result = await premergeDiff(projectRoot, { base });
    const lines = [];
    if (recorded) {
        lines.push(`Recorded snapshot for "${recorded.ref ?? "(unknown)"}" -> ${recorded.path} (${recorded.isDefault ? "canonical" : "branch"})`);
    }
    lines.push(`Base: ${result.base}`);
    lines.push(`Head: ${result.head ?? "(unresolved)"}`);
    if (!result.available) {
        lines.push(`\nNo diff available: ${result.reason}`);
        return textResponse(lines.join("\n"));
    }
    const diff = result.diff;
    const sig = result.significance;
    lines.push(`\nSignificance: ${sig.significance} (${sig.triggers.join(", ") || "none"})`);
    lines.push(`Total changes: ${diff.stats.total_changes}`);
    lines.push(`\nComponents added (${diff.components.added.length}):`);
    for (const c of diff.components.added.slice(0, 10))
        lines.push(`  + ${c.name} (${c.type}, ${c.layer})`);
    if (diff.components.added.length > 10)
        lines.push(`  ... +${diff.components.added.length - 10} more`);
    lines.push(`Components removed (${diff.components.removed.length}):`);
    for (const c of diff.components.removed.slice(0, 10))
        lines.push(`  - ${c.name} (${c.type}, ${c.layer})`);
    if (diff.components.removed.length > 10)
        lines.push(`  ... +${diff.components.removed.length - 10} more`);
    lines.push(`Components modified (${diff.components.modified.length}):`);
    for (const c of diff.components.modified.slice(0, 10))
        lines.push(`  ~ ${c.name}: ${c.changes.join("; ")}`);
    if (diff.components.modified.length > 10)
        lines.push(`  ... +${diff.components.modified.length - 10} more`);
    lines.push(`\nConnections added (${diff.connections.added.length}):`);
    for (const c of diff.connections.added.slice(0, 10))
        lines.push(`  + ${c.from_name} -> ${c.to_name} (${c.type})`);
    if (diff.connections.added.length > 10)
        lines.push(`  ... +${diff.connections.added.length - 10} more`);
    lines.push(`Connections removed (${diff.connections.removed.length}):`);
    for (const c of diff.connections.removed.slice(0, 10))
        lines.push(`  - ${c.from_name} -> ${c.to_name} (${c.type})`);
    if (diff.connections.removed.length > 10)
        lines.push(`  ... +${diff.connections.removed.length - 10} more`);
    return textResponse(lines.join("\n"));
}
//# sourceMappingURL=tools.js.map